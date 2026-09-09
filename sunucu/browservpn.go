// browservpn — Girginos Browser VPN arka ucu.
//
// TLS'li HTTP forward proxy (CONNECT + düz HTTP). Chromium'da "https proxy"
// olarak kullanılır: tarayıcı<->sunucu TLS ile ŞİFRELİ. Let's Encrypt sertifikası
// autocert ile otomatik (TLS-ALPN-01, :443). Her token'a 100 Mbps üst sınır (o
// token'ın TÜM bağlantıları paylaşır -> "ne olursa olsun aşamasın"). Limit
// SUNUCUDA; açık kaynak istemci limiti sökemez.
//
// KİMLİK DOĞRULAMA — OTOMATİK, KULLANICI GİRİŞSİZ:
// Kullanıcı token yazmaz. İstemci cihaz kimliğini `/kayit` uç noktasına gönderir,
// sunucu gizli anahtarla token = base64url(HMAC-SHA256(secret, cihaz)) üretip
// döner. Proxy kimlik doğrulaması `Proxy-Authorization: Basic base64(cihaz:token)`
// ve sunucu HMAC'i yeniden hesaplayıp karşılaştırır (DURUMSUZ: token dosyası yok).
// Her cihaz = ayrı token = ayrı 100 Mbps kovası. Kayıt açık (kimliksiz); kötüye
// kullanım denetimi ileride (limit yine token başına korur).
package main

import (
	"crypto/hmac"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"fmt"
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
	secretFile = "/etc/browservpn/secret" // gizli HMAC anahtarı (openssl rand -hex 32)
)

var (
	secretMu sync.RWMutex
	secret   []byte

	limMu    sync.Mutex
	limiters = map[string]*rate.Limiter{}
)

// Gizli anahtarı diskten yükler. Yoksa/çok kısaysa süreç durur: anahtarsız
// çalışmak tüm token'ları geçersiz kılar (sessizce açık proxy olmaktansa hata).
func loadSecret() {
	data, err := os.ReadFile(secretFile)
	if err != nil {
		log.Fatalf("secret okunamadı (%s): %v — 'openssl rand -hex 32 > %s' ile üretin", secretFile, err, secretFile)
	}
	s := strings.TrimSpace(string(data))
	if len(s) < 16 {
		log.Fatalf("secret çok kısa (%d bayt); en az 16", len(s))
	}
	secretMu.Lock()
	secret = []byte(s)
	secretMu.Unlock()
	log.Printf("secret yüklendi (%d bayt)", len(s))
}

// token = base64url(HMAC-SHA256(secret, cihaz)). Cihaz kimliği opak bir dizedir.
func hmacToken(cihaz string) string {
	secretMu.RLock()
	key := secret
	secretMu.RUnlock()
	mac := hmac.New(sha256.New, key)
	mac.Write([]byte(cihaz))
	return base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}

// Cihaz kimliği kabul edilebilir mi? (aşırı/boş girdiyi ele)
func gecerliCihaz(cihaz string) bool {
	if len(cihaz) < 8 || len(cihaz) > 200 {
		return false
	}
	for _, r := range cihaz {
		ok := r == '-' || r == '_' || r == '.' ||
			(r >= '0' && r <= '9') || (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z')
		if !ok {
			return false
		}
	}
	return true
}

// Kimliksiz tünele izin verilen hedefler: yalnızca kendi güncelleme sunucumuz.
// Sabit liste; kullanıcı girdisiyle genişlemez (açık relay olmasın).
var kimliksizHedefler = map[string]bool{
	"browserapp.girginos.app:443": true,
}

func kimliksizHedef(host string) bool {
	return kimliksizHedefler[strings.ToLower(host)]
}

// Kimlik doğrulama: token, cihaz için beklenen HMAC'e sabit-zaman eşit mi?
func kimlikDogrula(cihaz, token string) bool {
	if !gecerliCihaz(cihaz) || token == "" {
		return false
	}
	beklenen := hmacToken(cihaz)
	return subtle.ConstantTimeCompare([]byte(beklenen), []byte(token)) == 1
}

func limiterFor(anahtar string) *rate.Limiter {
	limMu.Lock()
	defer limMu.Unlock()
	l := limiters[anahtar]
	if l == nil {
		l = rate.NewLimiter(rate.Limit(limitBytes), limitBytes)
		limiters[anahtar] = l
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

func parseProxyAuth(h string) (cihaz, token string, ok bool) {
	const p = "Basic "
	if !strings.HasPrefix(h, p) {
		return "", "", false
	}
	dec, err := base64.StdEncoding.DecodeString(strings.TrimSpace(h[len(p):]))
	if err != nil {
		return "", "", false
	}
	i := strings.IndexByte(string(dec), ':')
	if i < 0 {
		return "", "", false
	}
	return string(dec[:i]), string(dec[i+1:]), true // kullanıcı = cihaz kimliği, parola = token
}

var hopHeaders = []string{"Proxy-Authorization", "Proxy-Connection", "Connection", "Keep-Alive", "Te", "Trailer", "Transfer-Encoding", "Upgrade"}

func stripHop(h http.Header) {
	for _, k := range hopHeaders {
		h.Del(k)
	}
}

// Cihaz kaydı: kimliğe karşılık gelen HMAC token'ı döner. Kullanıcı girişsiz.
func handleKayit(w http.ResponseWriter, r *http.Request) {
	cihaz := r.URL.Query().Get("cihaz")
	if !gecerliCihaz(cihaz) {
		http.Error(w, "gecersiz cihaz", http.StatusBadRequest)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	_ = json.NewEncoder(w).Encode(map[string]string{"token": hmacToken(cihaz)})
}

func handler(w http.ResponseWriter, r *http.Request) {
	// Doğrudan (proxy olmayan) istekler origin-form gelir: kayıt / sağlık.
	// Proxy istekleri absolute-form (düz HTTP) ya da CONNECT'tir.
	if r.Method != http.MethodConnect && !r.URL.IsAbs() {
		switch r.URL.Path {
		case "/kayit":
			handleKayit(w, r)
		case "/saglik":
			fmt.Fprint(w, "ok")
		default:
			http.NotFound(w, r)
		}
		return
	}

	// GÜNCELLEME SUNUCUSUNA KİMLİKSİZ TÜNEL: eski istemciler (<=0.5.5) proxy
	// kimliğini güncelleme isteğine ekleyemiyordu; VPN açıkken 407 alıp
	// güncelleme alamıyorlardı. Yalnızca KENDİ güncelleme sunucumuza CONNECT
	// kimliksiz geçer (açık relay değil; hedef sabit), kendi kovasıyla kısılır.
	if r.Method == http.MethodConnect && kimliksizHedef(r.Host) {
		ip, _, _ := net.SplitHostPort(r.RemoteAddr)
		handleConnect(w, r, limiterFor("guncelleme:"+ip))
		return
	}

	cihaz, token, ok := parseProxyAuth(r.Header.Get("Proxy-Authorization"))
	if !ok || !kimlikDogrula(cihaz, token) {
		w.Header().Set("Proxy-Authenticate", `Basic realm="browservpn"`)
		http.Error(w, "proxy authentication required", http.StatusProxyAuthRequired)
		return
	}
	lim := limiterFor(cihaz) // kova cihaz başına
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
	loadSecret()
	// SIGHUP: gizli anahtarı yeniden yükle (döndürülürse restart gerekmesin).
	sig := make(chan os.Signal, 1)
	signal.Notify(sig, syscall.SIGHUP)
	go func() {
		for range sig {
			loadSecret()
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
	log.Printf("browservpn :443 dinliyor (domain %s, otomatik HMAC token, limit 100 Mbps/cihaz)", domain)
	log.Fatal(srv.ListenAndServeTLS("", ""))
}
