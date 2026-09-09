// browservpn — Girginos Browser VPN arka ucu.
//
// TLS'li HTTP forward proxy (CONNECT + düz HTTP). Chromium'da "https proxy"
// olarak kullanılır: tarayıcı<->sunucu TLS ile ŞİFRELİ. Let's Encrypt sertifikası
// autocert ile otomatik (TLS-ALPN-01, :443). Cihaz token'ı ile kimlik doğrulama
// (Proxy-Authorization: Basic). Her token'a 100 Mbps üst sınır (o token'ın TÜM
// bağlantıları paylaşır -> "ne olursa olsun aşamasın"). Limit SUNUCUDA; açık
// kaynak istemci limiti sökemez.
package main

import (
	"crypto/subtle"
	"encoding/base64"
	"io"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"sync"
	"syscall"
	"time"

	"golang.org/x/crypto/acme/autocert"
	"golang.org/x/time/rate"
)

const (
	domain     = "de-browservpn.girginos.app"
	limitBytes = 12_500_000 // 100 Mbps = 100e6 bit/s ≈ 12.5 MB/s
	certDir    = "/etc/browservpn/cert"
	tokenFile  = "/etc/browservpn/tokens"
)

var (
	tokensMu sync.RWMutex
	tokens   = map[string]bool{}
	limMu    sync.Mutex
	limiters = map[string]*rate.Limiter{}
)

func loadTokens() {
	data, err := os.ReadFile(tokenFile)
	if err != nil {
		log.Printf("UYARI token dosyası okunamadı (%s): %v", tokenFile, err)
		return
	}
	m := map[string]bool{}
	for _, line := range strings.Split(string(data), "\n") {
		t := strings.TrimSpace(line)
		if t != "" && !strings.HasPrefix(t, "#") {
			m[t] = true
		}
	}
	tokensMu.Lock()
	tokens = m
	tokensMu.Unlock()
	log.Printf("%d token yüklendi", len(m))
}

func tokenOK(t string) bool {
	tokensMu.RLock()
	defer tokensMu.RUnlock()
	// sabit-zaman değil ama token yüksek entropili; map araması yeterli.
	for k := range tokens {
		if subtle.ConstantTimeCompare([]byte(k), []byte(t)) == 1 {
			return true
		}
	}
	return false
}

func limiterFor(t string) *rate.Limiter {
	limMu.Lock()
	defer limMu.Unlock()
	l := limiters[t]
	if l == nil {
		l = rate.NewLimiter(rate.Limit(limitBytes), limitBytes)
		limiters[t] = l
	}
	return l
}

// Token hızına göre kopya. n bayt için rezervasyon yapıp gecikmeyi uyguluyor.
func limitedCopy(dst io.Writer, src io.Reader, l *rate.Limiter) {
	buf := make([]byte, 64*1024)
	for {
		n, err := src.Read(buf)
		if n > 0 {
			if r := l.ReserveN(time.Now(), n); r.OK() {
				if d := r.Delay(); d > 0 {
					time.Sleep(d)
				}
			}
			if _, werr := dst.Write(buf[:n]); werr != nil {
				return
			}
		}
		if err != nil {
			return
		}
	}
}

func parseProxyAuth(h string) (pass string, ok bool) {
	const p = "Basic "
	if !strings.HasPrefix(h, p) {
		return "", false
	}
	dec, err := base64.StdEncoding.DecodeString(strings.TrimSpace(h[len(p):]))
	if err != nil {
		return "", false
	}
	i := strings.IndexByte(string(dec), ':')
	if i < 0 {
		return "", false
	}
	return string(dec[i+1:]), true // kullanıcı = cihaz kimliği (yok sayılıyor), parola = token
}

var hopHeaders = []string{"Proxy-Authorization", "Proxy-Connection", "Connection", "Keep-Alive", "Te", "Trailer", "Transfer-Encoding", "Upgrade"}

func stripHop(h http.Header) {
	for _, k := range hopHeaders {
		h.Del(k)
	}
}

func handler(w http.ResponseWriter, r *http.Request) {
	pass, ok := parseProxyAuth(r.Header.Get("Proxy-Authorization"))
	if !ok || !tokenOK(pass) {
		w.Header().Set("Proxy-Authenticate", `Basic realm="browservpn"`)
		http.Error(w, "proxy authentication required", http.StatusProxyAuthRequired)
		return
	}
	lim := limiterFor(pass)
	if r.Method == http.MethodConnect {
		handleConnect(w, r, lim)
		return
	}
	handleHTTP(w, r, lim)
}

func handleConnect(w http.ResponseWriter, r *http.Request, lim *rate.Limiter) {
	dst, err := net.DialTimeout("tcp", r.Host, 20*time.Second)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}
	hj, ok := w.(http.Hijacker)
	if !ok {
		http.Error(w, "hijack yok", http.StatusInternalServerError)
		dst.Close()
		return
	}
	client, _, err := hj.Hijack()
	if err != nil {
		dst.Close()
		return
	}
	client.Write([]byte("HTTP/1.1 200 Connection Established\r\n\r\n"))
	go func() { limitedCopy(dst, client, lim); dst.Close() }()
	limitedCopy(client, dst, lim)
	client.Close()
}

func handleHTTP(w http.ResponseWriter, r *http.Request, lim *rate.Limiter) {
	if !r.URL.IsAbs() {
		http.Error(w, "yalnızca proxy istekleri", http.StatusBadRequest)
		return
	}
	r.RequestURI = ""
	stripHop(r.Header)
	resp, err := http.DefaultTransport.RoundTrip(r)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}
	defer resp.Body.Close()
	stripHop(resp.Header)
	for k, vv := range resp.Header {
		for _, v := range vv {
			w.Header().Add(k, v)
		}
	}
	w.WriteHeader(resp.StatusCode)
	limitedCopy(w, resp.Body, lim)
}

func main() {
	loadTokens()
	// SIGHUP: token dosyasını yeniden yükle (yeni cihaz eklenince restart gerekmesin).
	sig := make(chan os.Signal, 1)
	signal.Notify(sig, syscall.SIGHUP)
	go func() {
		for range sig {
			loadTokens()
		}
	}()

	m := &autocert.Manager{
		Cache:      autocert.DirCache(certDir),
		Prompt:     autocert.AcceptTOS,
		HostPolicy: autocert.HostWhitelist(domain),
	}
	tlsCfg := m.TLSConfig()
	// h2 YOK: HTTP/2'de CONNECT hijack çalışmaz. http/1.1 + acme-tls/1 (autocert challenge).
	tlsCfg.NextProtos = []string{"http/1.1", "acme-tls/1"}

	srv := &http.Server{
		Addr:         ":443",
		Handler:      http.HandlerFunc(handler),
		TLSConfig:    tlsCfg,
		ReadTimeout:  0,
		WriteTimeout: 0,
	}
	log.Printf("browservpn :443 dinliyor (domain %s, limit 100 Mbps/token)", domain)
	log.Fatal(srv.ListenAndServeTLS("", ""))
}
