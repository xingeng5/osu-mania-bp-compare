// osu! API v2 上游：client_credentials 换 token、401 刷新、429 退避。
//
// 刻意不缓存接口响应：这个工具使用频率低、数据要新鲜，每次对比都重新取。
// token 仍然保留（24 小时有效，不保留等于每次请求都重新认证）。
package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"
	"time"
)

const (
	userAgent = "mania-bp-compare/0.1 (local web app)"
	tokenTTL  = 24 * time.Hour
	tokenSkew = 60 * time.Second
)

// apiOrigin 是变量（不是常量）只是为了测试里能指向 httptest 的假上游。
var apiOrigin = "https://osu.ppy.sh"

// errMissingCreds 表示用户还没填凭据（不是网络错误）。
var errMissingCreds = errors.New("缺少 OSU_CLIENT_ID / OSU_CLIENT_SECRET")

// errConfigMissing 用于 /api/osu 分支给出和 Node 版一致的提示。
var errConfigMissing = errors.New("尚未配置 osu! OAuth 凭据，请刷新页面填写")

type upstream struct {
	mu    sync.Mutex
	get   func() (id string, secret string)
	token string
	exp   time.Time
	owner string

	client *http.Client
}

func newUpstream(get func() (string, string)) *upstream {
	return &upstream{
		get:    get,
		client: &http.Client{Timeout: 30 * time.Second},
	}
}

// tokenFor 返回可用的 access token。凭据变了就丢弃旧 token。
func (u *upstream) tokenFor(force bool) (string, error) {
	id, secret := u.get()
	if id == "" || secret == "" {
		return "", errMissingCreds
	}
	owner := id + ":" + secret

	u.mu.Lock()
	defer u.mu.Unlock()

	if u.owner != owner {
		u.token = ""
		u.exp = time.Time{}
		u.owner = owner
	}
	if !force && u.token != "" && time.Now().Before(u.exp) {
		return u.token, nil
	}

	payload, _ := json.Marshal(map[string]any{
		"client_id":     id,
		"client_secret": secret,
		"grant_type":    "client_credentials",
		"scope":         "public",
	})
	req, err := http.NewRequest(http.MethodPost, apiOrigin+"/oauth/token", bytes.NewReader(payload))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", userAgent)

	res, err := u.client.Do(req)
	if err != nil {
		return "", err
	}
	defer res.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(res.Body, 1<<16))

	if res.StatusCode != http.StatusOK {
		return "", fmt.Errorf("token %d: %s", res.StatusCode, trim(raw, 200))
	}
	var out struct {
		AccessToken string `json:"access_token"`
	}
	if err := json.Unmarshal(raw, &out); err != nil || out.AccessToken == "" {
		return "", fmt.Errorf("token 响应没有 access_token: %s", trim(raw, 200))
	}

	// 期间用户可能又改了凭据，只在 owner 未变时记录
	if u.owner == owner {
		u.token = out.AccessToken
		u.exp = time.Now().Add(tokenTTL - tokenSkew)
	}
	return out.AccessToken, nil
}

// call 请求 /api/v2 下的某个路径（path 形如 /users/Kalkai/mania）。
func (u *upstream) call(path, bearer string) (int, string, error) {
	req, err := http.NewRequest(http.MethodGet, apiOrigin+"/api/v2"+path, nil)
	if err != nil {
		return 0, "", err
	}
	req.Header.Set("Authorization", "Bearer "+bearer)
	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", userAgent)

	res, err := u.client.Do(req)
	if err != nil {
		return 0, "", err
	}
	defer res.Body.Close()
	raw, _ := io.ReadAll(res.Body)
	return res.StatusCode, string(raw), nil
}

// request 取一条数据：401 换 token 重试一次，429 等一下重试一次。
func (u *upstream) request(path string) (int, string, error) {
	bearer, err := u.tokenFor(false)
	if err != nil {
		return 0, "", err
	}
	status, body, err := u.call(path, bearer)
	if err != nil {
		return 0, "", err
	}
	if status == http.StatusUnauthorized {
		if bearer, err = u.tokenFor(true); err != nil {
			return 0, "", err
		}
		if status, body, err = u.call(path, bearer); err != nil {
			return 0, "", err
		}
	}
	if status == http.StatusTooManyRequests {
		time.Sleep(1500 * time.Millisecond)
		if status, body, err = u.call(path, bearer); err != nil {
			return 0, "", err
		}
	}
	return status, body, nil
}

func trim(b []byte, n int) string {
	s := strings.TrimSpace(string(b))
	if len(s) > n {
		return s[:n]
	}
	return s
}