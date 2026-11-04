// 针对上游封装与 HTTP 路由的单元测试：用一个假的 osu 端点验证
// 「token 复用 / 401 换 token 重试 / 429 退避 / 代理透传」这几条逻辑，
// 不需要真实凭据，也不会请求 osu 官方接口。
package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

// fakeUpstream 起一个假的 osu：/oauth/token 发 token，/api/v2/* 按脚本返回。
func fakeUpstream(t *testing.T, apiHandler http.HandlerFunc) (*httptest.Server, *int32) {
	t.Helper()
	var tokenCalls int32
	mux := http.NewServeMux()
	mux.HandleFunc("/oauth/token", func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&tokenCalls, 1)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"access_token":"tok` + strings.Repeat("x", 4) + `","expires_in":86400}`))
	})
	mux.HandleFunc("/api/v2/", apiHandler)

	srv := httptest.NewServer(mux)
	old := apiOrigin
	apiOrigin = srv.URL
	t.Cleanup(func() {
		apiOrigin = old
		srv.Close()
	})
	return srv, &tokenCalls
}

func newTestUpstream(id, secret string) *upstream {
	return newUpstream(func() (string, string) { return id, secret })
}

func TestTokenIsReused(t *testing.T) {
	_, calls := fakeUpstream(t, func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer tokxxxx" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		_, _ = w.Write([]byte(`{"ok":true}`))
	})

	u := newTestUpstream("123", "secretsecret")
	for i := 0; i < 3; i++ {
		status, body, err := u.request("/users/1/mania")
		if err != nil || status != 200 || !strings.Contains(body, "ok") {
			t.Fatalf("第 %d 次请求失败: status=%d body=%q err=%v", i+1, status, body, err)
		}
	}
	if got := atomic.LoadInt32(calls); got != 1 {
		t.Fatalf("token 应该只换一次，实际 %d 次", got)
	}
}

func TestRefreshesTokenOn401(t *testing.T) {
	var apiCalls int32
	_, tokenCalls := fakeUpstream(t, func(w http.ResponseWriter, r *http.Request) {
		if atomic.AddInt32(&apiCalls, 1) == 1 {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		_, _ = w.Write([]byte(`{"ok":true}`))
	})

	u := newTestUpstream("123", "secretsecret")
	status, body, err := u.request("/users/1/mania")
	if err != nil || status != 200 || !strings.Contains(body, "ok") {
		t.Fatalf("401 后应换 token 重试成功: status=%d body=%q err=%v", status, body, err)
	}
	if got := atomic.LoadInt32(tokenCalls); got != 2 {
		t.Fatalf("应换两次 token，实际 %d", got)
	}
}

func TestRetriesOn429(t *testing.T) {
	var apiCalls int32
	fakeUpstream(t, func(w http.ResponseWriter, r *http.Request) {
		if atomic.AddInt32(&apiCalls, 1) == 1 {
			w.WriteHeader(http.StatusTooManyRequests)
			return
		}
		_, _ = w.Write([]byte(`{"ok":true}`))
	})

	u := newTestUpstream("123", "secretsecret")
	start := time.Now()
	status, body, err := u.request("/users/1/mania")
	if err != nil || status != 200 || !strings.Contains(body, "ok") {
		t.Fatalf("429 后应重试成功: status=%d body=%q err=%v", status, body, err)
	}
	if elapsed := time.Since(start); elapsed < time.Second {
		t.Fatalf("429 退避时间太短: %v", elapsed)
	}
}

func TestMissingCreds(t *testing.T) {
	u := newTestUpstream("", "")
	if _, _, err := u.request("/users/1/mania"); err != errMissingCreds {
		t.Fatalf("没凭据时应返回 errMissingCreds，实际 %v", err)
	}
}

func TestCredsChangeDropsToken(t *testing.T) {
	_, tokenCalls := fakeUpstream(t, func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"ok":true}`))
	})

	id, secret := "123", "secret-one"
	u := newUpstream(func() (string, string) { return id, secret })
	if _, _, err := u.request("/users/1/mania"); err != nil {
		t.Fatal(err)
	}
	secret = "secret-two" // 换凭据后必须重新换 token
	if _, _, err := u.request("/users/1/mania"); err != nil {
		t.Fatal(err)
	}
	if got := atomic.LoadInt32(tokenCalls); got != 2 {
		t.Fatalf("换凭据后应重新换 token，总换 token 次数 %d", got)
	}
}

func TestProxyPassthroughAndHostGuard(t *testing.T) {
	fakeUpstream(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v2/users/1/mania" || r.URL.RawQuery != "x=1" {
			w.WriteHeader(http.StatusNotFound)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"statistics":{"variants":[]}}`))
	})

	a := &app{clientID: "123", clientSecret: "secretsecret", port: 7788}
	a.up = newUpstream(a.creds)

	req := httptest.NewRequest(http.MethodGet, "/api/osu/users/1/mania?x=1", nil)
	req.Host = "127.0.0.1:7788"
	rec := httptest.NewRecorder()
	a.serveHTTP(rec, req)
	if rec.Code != 200 || !strings.Contains(rec.Body.String(), "variants") {
		t.Fatalf("代理应透传上游响应: %d %s", rec.Code, rec.Body.String())
	}
	if got := rec.Header().Get("Cache-Control"); got != "no-store" {
		t.Fatalf("代理响应不应被缓存，Cache-Control=%q", got)
	}

	// 外来 Host 必须被挡（DNS rebinding）
	evil := httptest.NewRequest(http.MethodGet, "/api/osu/users/1/mania", nil)
	evil.Host = "evil.example"
	rec2 := httptest.NewRecorder()
	a.serveHTTP(rec2, evil)
	if rec2.Code != http.StatusForbidden {
		t.Fatalf("外来 Host 应 403，实际 %d", rec2.Code)
	}

	// 没配置凭据时给 500 + 中文提示
	b := &app{port: 7788}
	b.up = newUpstream(b.creds)
	noCfg := httptest.NewRequest(http.MethodGet, "/api/osu/users/1/mania", nil)
	noCfg.Host = "127.0.0.1:7788"
	rec3 := httptest.NewRecorder()
	b.serveHTTP(rec3, noCfg)
	if rec3.Code != 500 || !strings.Contains(rec3.Body.String(), "尚未配置") {
		t.Fatalf("未配置应 500 并提示，实际 %d %s", rec3.Code, rec3.Body.String())
	}
}

func TestConfigRoundTripAndValidation(t *testing.T) {
	fakeUpstream(t, func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"ok":true}`))
	})

	dir := t.TempDir()
	t.Setenv("LOCALAPPDATA", dir) // 让写入落到临时目录
	a := &app{configPath: dir + "/" + configName}
	a.up = newUpstream(a.creds)

	post := func(body string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodPost, "/api/config", strings.NewReader(body))
		req.Host = "127.0.0.1:7788"
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()
		a.serveHTTP(rec, req)
		return rec
	}

	if rec := post(`{"clientId":"abc","clientSecret":"0123456789"}`); rec.Code != 400 {
		t.Fatalf("非数字 ID 应 400，实际 %d", rec.Code)
	}
	if rec := post(`{"clientId":"123","clientSecret":"short"}`); rec.Code != 400 {
		t.Fatalf("过短 secret 应 400，实际 %d", rec.Code)
	}

	rec := post(`{"clientId":"123","clientSecret":"0123456789abcdef"}`)
	if rec.Code != 200 {
		t.Fatalf("合法凭据应 200，实际 %d %s", rec.Code, rec.Body.String())
	}
	var ok map[string]any
	_ = json.Unmarshal(rec.Body.Bytes(), &ok)
	if ok["ok"] != true || ok["configFile"] != configName {
		t.Fatalf("POST 返回体不对: %v", ok)
	}

	get := httptest.NewRequest(http.MethodGet, "/api/config", nil)
	get.Host = "127.0.0.1:7788"
	rec2 := httptest.NewRecorder()
	a.serveHTTP(rec2, get)
	var cfg map[string]any
	_ = json.Unmarshal(rec2.Body.Bytes(), &cfg)
	if cfg["configured"] != true || cfg["clientId"] != "123" {
		t.Fatalf("GET 应报告已配置: %v", cfg)
	}
	if strings.Contains(rec2.Body.String(), dir) {
		t.Fatalf("GET 不应泄露绝对路径: %s", rec2.Body.String())
	}
}

// 设置页必须自带中英两套文案，错误响应要带 code 让页面按语言翻译。
func TestSetupPageIsBilingualAndErrorsCarryCode(t *testing.T) {
	for _, want := range []string{"Save and start", "保存并开始", "English", "LANG_KEY", "mania-bp-compare.lang", "codeRejected"} {
		if !strings.Contains(setupHTML, want) {
			t.Fatalf("设置页缺少 %q", want)
		}
	}
	if strings.Contains(setupHTML, "D:\\") {
		t.Fatal("设置页不应出现绝对路径")
	}

	dir := t.TempDir()
	t.Setenv("LOCALAPPDATA", dir)
	a := &app{configPath: dir + "/" + configName}
	a.up = newUpstream(a.creds)

	req := httptest.NewRequest(http.MethodPost, "/api/config", strings.NewReader(`{"clientId":"abc","clientSecret":"0123456789"}`))
	req.Host = "127.0.0.1:7788"
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	a.serveHTTP(rec, req)

	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("错误响应不是 JSON: %s", rec.Body.String())
	}
	if body["code"] != "invalidId" {
		t.Fatalf("错误响应应带 code=invalidId，实际 %v", body)
	}

	get := httptest.NewRequest(http.MethodGet, "/setup", nil)
	get.Host = "127.0.0.1:7788"
	rec2 := httptest.NewRecorder()
	a.serveHTTP(rec2, get)
	if rec2.Code != 200 || !strings.Contains(rec2.Body.String(), "Save and start") || !strings.Contains(rec2.Body.String(), "保存并开始") {
		t.Fatalf("/setup 应返回中英双语页面，实际 %d", rec2.Code)
	}
}
