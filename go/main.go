// mania BP 对比器（便携版，Go 实现）
//
// 一个单文件 exe：内嵌前端静态资源，起一个只监听 127.0.0.1 的 HTTP 服务，
// 用 /api/osu/* 转发 osu! API v2，凭据由使用者自己在 /setup 页面填写，
// 存在 exe 同目录的 mania-bp-compare.config.json（只读目录则退到 %LOCALAPPDATA%）。
package main

import (
	"embed"
	"encoding/json"
	"errors"
	"io"
	"io/fs"
	"net"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"
)

//go:embed web
var webAssets embed.FS

var webRoot, _ = fs.Sub(webAssets, "web")

const configName = "mania-bp-compare.config.json"

var defaultPorts = []int{7788, 7789, 7790, 7791, 7792, 7793, 7794, 7795}

var mimeByExt = map[string]string{
	".html":  "text/html; charset=utf-8",
	".js":    "text/javascript; charset=utf-8",
	".css":   "text/css; charset=utf-8",
	".json":  "application/json; charset=utf-8",
	".svg":   "image/svg+xml",
	".png":   "image/png",
	".ico":   "image/x-icon",
	".woff2": "font/woff2",
}

type storedConfig struct {
	ClientID     string `json:"clientId,omitempty"`
	ClientSecret string `json:"clientSecret,omitempty"`
	SavedAt      string `json:"savedAt,omitempty"`
}

type app struct {
	mu           sync.RWMutex
	clientID     string
	clientSecret string
	configPath   string
	port         int
	up           *upstream
}

func (a *app) creds() (string, string) {
	a.mu.RLock()
	defer a.mu.RUnlock()
	return a.clientID, a.clientSecret
}

func (a *app) configured() bool {
	id, secret := a.creds()
	return id != "" && secret != ""
}

func (a *app) setCreds(id, secret string) {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.clientID, a.clientSecret = id, secret
}

// appDir 是 exe 所在目录。
func appDir() string {
	exe, err := os.Executable()
	if err != nil {
		return "."
	}
	if resolved, err := filepath.EvalSymlinks(exe); err == nil {
		exe = resolved
	}
	return filepath.Dir(exe)
}

func configPaths() []string {
	paths := []string{filepath.Join(appDir(), configName)}
	if local := os.Getenv("LOCALAPPDATA"); local != "" {
		paths = append(paths, filepath.Join(local, "mania-bp-compare", configName))
	}
	return paths
}

// readConfigFile 返回第一个有效的配置文件；坏文件当作没配置，让用户重填。
func readConfigFile() (string, *storedConfig) {
	for _, file := range configPaths() {
		raw, err := os.ReadFile(file)
		if err != nil {
			continue
		}
		var cfg storedConfig
		if err := json.Unmarshal(raw, &cfg); err != nil {
			continue
		}
		if cfg.ClientID != "" && cfg.ClientSecret != "" {
			return file, &cfg
		}
	}
	return "", nil
}

func writeConfig(id, secret string) (string, error) {
	payload, _ := json.MarshalIndent(storedConfig{
		ClientID:     id,
		ClientSecret: secret,
		SavedAt:      time.Now().UTC().Format(time.RFC3339),
	}, "", "  ")
	targets := configPaths()
	for _, file := range targets {
		if err := os.MkdirAll(filepath.Dir(file), 0o755); err != nil {
			continue
		}
		if err := os.WriteFile(file, payload, 0o600); err != nil {
			continue
		}
		return file, nil
	}
	return "", errors.New("无法写入凭据文件：" + strings.Join(targets, " / "))
}

// fail 统一错误响应：error 保持中文原文（兼容旧脚本），code 供界面按语言翻译。
func fail(w http.ResponseWriter, status int, code, msg, detail string) {
	out := map[string]any{"error": msg, "code": code}
	if detail != "" {
		out["detail"] = detail
	}
	sendJSON(w, status, out)
}

func sendJSON(w http.ResponseWriter, status int, payload any) {
	body, err := json.Marshal(payload)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_, _ = w.Write(body)
}

func sendAsset(w http.ResponseWriter, name string) bool {
	data, err := fs.ReadFile(webRoot, name)
	if err != nil {
		return false
	}
	if contentType, ok := mimeByExt[strings.ToLower(filepath.Ext(name))]; ok {
		w.Header().Set("Content-Type", contentType)
	}
	if strings.HasPrefix("/"+name, "/assets/") {
		w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
	} else {
		w.Header().Set("Cache-Control", "no-cache")
	}
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(data)
	return true
}

// isLocalHost 只接受本机 Host 头，挡 DNS rebinding。
func isLocalHost(host string, port int) bool {
	host = strings.ToLower(strings.TrimSpace(host))
	if host == "" {
		return false
	}
	name := host
	if h, p, err := net.SplitHostPort(host); err == nil {
		if n, convErr := strconv.Atoi(p); convErr == nil && port != 0 && n != port {
			return false
		}
		name = h
	}
	switch name {
	case "127.0.0.1", "localhost", "::1":
		return true
	}
	return false
}

func (a *app) handleConfig(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		id, _ := a.creds()
		dir := "%LOCALAPPDATA%\\mania-bp-compare"
		if filepath.Dir(a.configPath) == appDir() {
			dir = "."
		}
		sendJSON(w, http.StatusOK, map[string]any{
			"configured": a.configured(),
			"clientId":   id,
			"configFile": configName,
			"configDir":  dir,
			"note":       "",
		})
		return
	case http.MethodPost:
	default:
		sendJSON(w, http.StatusMethodNotAllowed, map[string]any{"error": "只支持 GET / POST"})
		return
	}

	raw, err := io.ReadAll(io.LimitReader(r.Body, 64*1024+1))
	if err != nil {
		fail(w, http.StatusBadRequest, "readFailed", "读取请求失败", err.Error())
		return
	}
	if len(raw) > 64*1024 {
		fail(w, http.StatusBadRequest, "bodyTooLarge", "请求体过大", "")
		return
	}
	var body struct {
		ClientID     string `json:"clientId"`
		ClientSecret string `json:"clientSecret"`
	}
	if len(raw) > 0 {
		if err := json.Unmarshal(raw, &body); err != nil {
			fail(w, http.StatusBadRequest, "badJSON", "请求体不是合法 JSON", "")
			return
		}
	}
	id := strings.TrimSpace(body.ClientID)
	secret := strings.TrimSpace(body.ClientSecret)

	if id == "" || strings.Trim(id, "0123456789") != "" {
		fail(w, http.StatusBadRequest, "invalidId", "Client ID 应该是纯数字", "")
		return
	}
	if len(secret) < 10 {
		fail(w, http.StatusBadRequest, "shortSecret", "Client Secret 看起来不完整", "")
		return
	}

	prevID, prevSecret := a.creds()
	a.setCreds(id, secret)
	if _, err := a.up.tokenFor(true); err != nil {
		a.setCreds(prevID, prevSecret)
		fail(w, http.StatusBadRequest, "rejected", "osu 拒绝了这组凭据："+err.Error(), err.Error())
		return
	}
	file, err := writeConfig(id, secret)
	if err != nil {
		fail(w, http.StatusBadRequest, "writeFailed", "无法写入配置文件："+err.Error(), err.Error())
		return
	}
	a.mu.Lock()
	a.configPath = file
	a.mu.Unlock()
	sendJSON(w, http.StatusOK, map[string]any{"ok": true, "configFile": configName})
}

func (a *app) handleProxy(w http.ResponseWriter, r *http.Request) {
	if !a.configured() {
		fail(w, http.StatusInternalServerError, "notConfigured", errConfigMissing.Error(), "")
		return
	}
	path := strings.TrimPrefix(r.URL.Path, "/api/osu")
	if r.URL.RawQuery != "" {
		path += "?" + r.URL.RawQuery
	}
	status, body, err := a.up.request(path)
	if err != nil {
		code := http.StatusBadGateway
		if errors.Is(err, errMissingCreds) {
			code = http.StatusInternalServerError
		}
		sendJSON(w, code, map[string]any{"error": err.Error()})
		return
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_, _ = io.WriteString(w, body)
}

func (a *app) serveHTTP(w http.ResponseWriter, r *http.Request) {
	if !isLocalHost(r.Host, a.port) {
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		w.WriteHeader(http.StatusForbidden)
		_, _ = io.WriteString(w, "403 只接受通过 127.0.0.1 / localhost 访问")
		return
	}

	pathname := r.URL.Path

	switch {
	case pathname == "/api/config":
		a.handleConfig(w, r)
		return
	case strings.HasPrefix(pathname, "/api/osu/"):
		a.handleProxy(w, r)
		return
	case pathname == "/setup":
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Header().Set("Cache-Control", "no-cache")
		_, _ = io.WriteString(w, setupHTML)
		return
	case !a.configured() && (pathname == "/" || pathname == "/index.html"):
		http.Redirect(w, r, "/setup", http.StatusFound)
		return
	}

	name := strings.TrimPrefix(pathname, "/")
	if name == "" {
		name = "index.html"
	}
	if sendAsset(w, name) {
		return
	}
	// 单页应用：未知且无扩展名的路径回落 index.html
	if filepath.Ext(pathname) == "" && sendAsset(w, "index.html") {
		return
	}
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.WriteHeader(http.StatusNotFound)
	_, _ = io.WriteString(w, "404")
}

func listenOn(port int) (net.Listener, error) {
	return net.Listen("tcp", net.JoinHostPort("127.0.0.1", strconv.Itoa(port)))
}

func openBrowser(url string) {
	cmd := exec.Command("cmd", "/c", "start", "", url)
	if err := cmd.Start(); err == nil {
		_ = cmd.Process.Release()
	}
}

func parseArgs(args []string) (noOpen bool, ports []int) {
	base := defaultPorts[0]
	for _, arg := range args {
		if arg == "--no-open" {
			noOpen = true
		}
		if strings.HasPrefix(arg, "--port=") {
			if n, err := strconv.Atoi(strings.TrimPrefix(arg, "--port=")); err == nil && n > 0 && n < 65536 {
				base = n
			}
		}
	}
	ports = []int{base}
	for _, p := range defaultPorts {
		if p != base {
			ports = append(ports, p)
		}
	}
	return noOpen, ports
}

func main() {
	noOpen, ports := parseArgs(os.Args[1:])

	a := &app{}
	if file, cfg := readConfigFile(); cfg != nil {
		a.clientID, a.clientSecret, a.configPath = cfg.ClientID, cfg.ClientSecret, file
	} else {
		a.configPath = configPaths()[0]
	}
	// 环境变量优先（方便临时试跑），不写盘
	if id := os.Getenv("OSU_CLIENT_ID"); id != "" {
		a.clientID = id
	}
	if secret := os.Getenv("OSU_CLIENT_SECRET"); secret != "" {
		a.clientSecret = secret
	}
	a.up = newUpstream(a.creds)

	var (
		listener net.Listener
		err      error
	)
	for _, port := range ports {
		if listener, err = listenOn(port); err == nil {
			a.port = port
			break
		}
	}
	if listener == nil {
		os.Stderr.WriteString("启动失败：端口全部被占用\n")
		os.Exit(1)
	}

	server := &http.Server{
		Handler:           http.HandlerFunc(a.serveHTTP),
		ReadHeaderTimeout: 10 * time.Second,
	}

	base := "http://127.0.0.1:" + strconv.Itoa(a.port) + "/"
	target := base
	note := ""
	if !a.configured() {
		target = base + "setup"
		note = "（尚未配置，浏览器会打开设置页）"
	}
	shownConfig := configName + "（本程序所在目录）"
	if filepath.Dir(a.configPath) != appDir() {
		shownConfig = a.configPath
	}

	out := os.Stdout
	_, _ = io.WriteString(out, "\n  mania BP 对比器（便携版）\n")
	_, _ = io.WriteString(out, "  已就绪："+base+"\n")
	_, _ = io.WriteString(out, "  凭据文件："+shownConfig+note+"\n")
	_, _ = io.WriteString(out, "  关闭这个窗口即退出程序。\n\n")

	if !noOpen {
		openBrowser(target)
	}

	go func() {
		stop := make(chan os.Signal, 1)
		signal.Notify(stop, os.Interrupt)
		<-stop
		_, _ = io.WriteString(out, "  已退出。\n")
		os.Exit(0)
	}()

	if err := server.Serve(listener); err != nil && !errors.Is(err, http.ErrServerClosed) {
		os.Stderr.WriteString("启动失败：" + err.Error() + "\n")
		os.Exit(1)
	}
}