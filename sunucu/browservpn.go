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
// sunucu SÜRELİ bir token üretir: "<bitis>.<HMAC(secret, cihaz|bitis)>". Proxy
// kimlik doğrulaması `Proxy-Authorization: Basic base64(cihaz:token)`; sunucu
// MAC'i yeniden hesaplayıp sabit zamanda karşılaştırır (DURUMSUZ: token dosyası
// yok, süre token'ın içinde ve MAC'e dahil olduğu için oynanamaz).
//
// KÖTÜYE KULLANIM: /kayit bilerek kimliksiz (kullanıcı hiçbir şey girmesin).
// Tek başına bırakılsa saldırgan sınırsız kimlikle sınırsız token üretip
// "kişi başı 100 Mbps"i anlamsızlaştırır ve sunucuyu açık proxy'ye çevirirdi.
// Üç önlem: (1) bant limiti cihazın YANINDA kaynak IP'ye de uygulanır - token
// çoğaltmak ek bant kazandırmaz, (2) /kayit IP başına saatlik kotalı,
// (3) token'lar süreli, biriktirilenler ölür. Ayrıntı: aşağıdaki sabitler.
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
	"strconv"
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

	/*
	 * KÖTÜYE KULLANIM ÖNLEMLERİ.
	 *
	 * /kayit kasıtlı olarak kimliksiz: kullanıcı hiçbir şey girmesin istiyoruz.
	 * Ama kimliksiz kayıt tek başına bırakılırsa saldırgan sınırsız cihaz
	 * kimliğiyle sınırsız token üretir ve "kişi başı 100 Mbps" sözü anlamını
	 * yitirir; sunucu herkese açık bir proxy'ye döner.
	 *
	 * ÇÖZÜM: kıt kaynağı KİMLİK BAŞINA değil KAYNAK BAŞINA da kısıtlamak.
	 *   1) Bant limiti hem cihaz hem KAYNAK IP için ayrı ayrı uygulanır -> bin
	 *      token üretmek tek bir saldırgana ek bant kazandırmaz.
	 *   2) Kayıt ucu IP başına saatlik kotayla sınırlı -> token çiftliği pahalı.
	 *   3) Token'lar SÜRELİ -> biriktirilen token'lar kendiliğinden ölür.
	 *      (İstemci VPN'i her açışta yeniden kaydoluyor, kullanıcı fark etmez.)
	 */
	tokenOmru     = 30 * 24 * time.Hour // token geçerlilik süresi
	kayitSaatBasi = 10                  // IP başına saatlik kayıt kotası
	kovaOmru      = time.Hour           // boşta kalan kova bu süre sonra silinir
)

type kova struct {
	lim *rate.Limiter
	son time.Time // son kullanım; temizlik bunu okuyor
}

var (
	secretMu sync.RWMutex
	secret   []byte

	// Kovalar sınırsız büyümemeli: saldırgan token üreterek belleği şişirebilir.
	// Boştakiler temizleyici tarafından atılıyor (bkz. kovalariTemizle).
	limMu         sync.Mutex
	bantKovalari  = map[string]*kova{} // "cihaz:x" / "ip:x" -> bant limiti
	kayitKovalari = map[string]*kova{} // IP -> kayıt kotası
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

/*
 * TOKEN = "<bitis>.<mac>", mac = base64url(HMAC-SHA256(secret, cihaz|bitis)).
 *
 * Bitiş zamanı token'ın İÇİNDE ve MAC'e dahil: saldırgan süreyi uzatmak için
 * oynayamaz, çünkü MAC tutmaz. Sunucu hiçbir şey saklamıyor (durumsuz).
 */
func macHesapla(cihaz string, bitis int64) string {
	secretMu.RLock()
	key := secret
	secretMu.RUnlock()
	mac := hmac.New(sha256.New, key)
	fmt.Fprintf(mac, "%s|%d", cihaz, bitis)
	return base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}

func tokenUret(cihaz string) string {
	bitis := time.Now().Add(tokenOmru).Unix()
	return strconv.FormatInt(bitis, 10) + "." + macHesapla(cihaz, bitis)
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

// Kimlik doğrulama: süresi geçmemiş ve MAC'i tutan token mı? (sabit zaman)
func kimlikDogrula(cihaz, token string) bool {
	if !gecerliCihaz(cihaz) || token == "" {
		return false
	}
	i := strings.IndexByte(token, '.')
	if i <= 0 {
		return false // eski (süresiz) biçim artık kabul edilmiyor
	}
	bitis, err := strconv.ParseInt(token[:i], 10, 64)
	if err != nil || time.Now().Unix() > bitis {
		return false // bozuk ya da süresi geçmiş
	}
	beklenen := macHesapla(cihaz, bitis)
	return subtle.ConstantTimeCompare([]byte(beklenen), []byte(token[i+1:])) == 1
}

// İstemcinin kaynak IP'si. X-Forwarded-For'a GÜVENİLMEZ: doğrudan internete
// açığız, o başlığı saldırgan kendisi yazıp kotayı atlatırdı.
func kaynakIP(r *http.Request) string {
	ip, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return ip
}

func bantLimiti(anahtar string) *rate.Limiter {
	limMu.Lock()
	defer limMu.Unlock()
	k := bantKovalari[anahtar]
	if k == nil {
		k = &kova{lim: rate.NewLimiter(rate.Limit(limitBytes), limitBytes)}
		bantKovalari[anahtar] = k
	}
	k.son = time.Now()
	return k.lim
}

// IP başına kayıt kotası. Kota dolduysa false; çağıran 429 döner.
func kayitIzni(ip string) bool {
	limMu.Lock()
	defer limMu.Unlock()
	k := kayitKovalari[ip]
	if k == nil {
		k = &kova{lim: rate.NewLimiter(rate.Every(time.Hour/kayitSaatBasi), kayitSaatBasi)}
		kayitKovalari[ip] = k
	}
	k.son = time.Now()
	return k.lim.Allow()
}

// Boşta kalan kovaları atar: yoksa saldırgan sınırsız kimlik/IP ile belleği
// şişirebilirdi (kotaları uygularken kendimizi tüketmeyelim).
func kovalariTemizle() {
	for {
		time.Sleep(10 * time.Minute)
		sinir := time.Now().Add(-kovaOmru)
		limMu.Lock()
		for a, k := range bantKovalari {
			if k.son.Before(sinir) {
				delete(bantKovalari, a)
			}
		}
		for a, k := range kayitKovalari {
			if k.son.Before(sinir) {
				delete(kayitKovalari, a)
			}
		}
		limMu.Unlock()
	}
}

/*
 * Sınırlı kopya. BİRDEN ÇOK limit uygulanabiliyor: cihaz kovası ADİL PAYLAŞIM
 * için, kaynak IP kovası KÖTÜYE KULLANIMA karşı. En uzun gecikme kadar bekleniyor,
 * yani en dar limit belirleyici oluyor.
 */
func limitedCopy(dst io.Writer, src io.Reader, ls ...*rate.Limiter) {
	buf := make([]byte, 64*1024)
	for {
		n, err := src.Read(buf)
		if n > 0 {
			simdi := time.Now()
			var bekle time.Duration
			for _, l := range ls {
				if l == nil {
					continue
				}
				if r := l.ReserveN(simdi, n); r.OK() {
					if d := r.Delay(); d > bekle {
						bekle = d
					}
				}
			}
			if bekle > 0 {
				time.Sleep(bekle)
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

/*
 * Cihaz kaydı: kimliğe karşılık SÜRELİ token döner. Kullanıcı girişsiz.
 *
 * Kimlik doğrulaması YOK (tasarım gereği), bu yüzden IP başına saatlik kota
 * var: token çiftliği kurmak pahalansın. Kota tek başına yeterli değil -
 * asıl koruma bant limitinin KAYNAK IP'ye de uygulanması (bkz. handler).
 */
func handleKayit(w http.ResponseWriter, r *http.Request) {
	cihaz := r.URL.Query().Get("cihaz")
	if !gecerliCihaz(cihaz) {
		http.Error(w, "gecersiz cihaz", http.StatusBadRequest)
		return
	}
	if !kayitIzni(kaynakOnek(kaynakIP(r))) {
		w.Header().Set("Retry-After", "3600")
		http.Error(w, "kayit kotasi doldu", http.StatusTooManyRequests)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	_ = json.NewEncoder(w).Encode(map[string]string{"token": tokenUret(cihaz)})
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
		onek := kaynakOnek(kaynakIP(r))
		if !onekGiris(onek) {
			http.Error(w, "429 cok fazla es zamanli baglanti", http.StatusTooManyRequests)
			return
		}
		defer onekCikis(onek)
		handleConnect(w, r, bantLimiti("guncelleme:"+onek))
		return
	}

	cihaz, token, ok := parseProxyAuth(r.Header.Get("Proxy-Authorization"))
	if !ok || !kimlikDogrula(cihaz, token) {
		w.Header().Set("Proxy-Authenticate", `Basic realm="browservpn"`)
		http.Error(w, "proxy authentication required", http.StatusProxyAuthRequired)
		return
	}
	/*
	 * İKİ KOVA. Cihaz kovası kullanıcılar arasında ADİL PAYLAŞIM için; kaynak
	 * IP kovası kötüye kullanımı keser: kimliksiz kayıt yüzünden saldırgan
	 * istediği kadar token üretebilir ama hepsi aynı IP'den aktığı için toplam
	 * bandı yine 100 Mbps'te kalır - token çoğaltmak kazanç sağlamaz.
	 */
	onek := kaynakOnek(kaynakIP(r))
	if !onekGiris(onek) {
		http.Error(w, "429 cok fazla es zamanli baglanti", http.StatusTooManyRequests)
		return
	}
	defer onekCikis(onek)
	cihazKova := bantLimiti("cihaz:" + cihaz)
	ipKova := bantLimiti("ip:" + onek)
	if r.Method == http.MethodConnect {
		handleConnect(w, r, cihazKova, ipKova)
		return
	}
	handleHTTP(w, r, cihazKova, ipKova)
}

func handleConnect(w http.ResponseWriter, r *http.Request, ls ...*rate.Limiter) {
	dst, err := guvenliDial(r.Host)
	if err != nil {
		// Jenerik yanıt: hangi iç IP'nin var/kapalı olduğunu doğrulayan
		// yan kanal olmasın (err iç adresi/portu içerebilir).
		log.Printf("connect reddedildi %s: %v", r.Host, err)
		http.Error(w, "502 bad gateway", http.StatusBadGateway)
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
	go func() { limitedCopy(dst, client, ls...); dst.Close() }()
	limitedCopy(client, dst, ls...)
	client.Close()
}

func handleHTTP(w http.ResponseWriter, r *http.Request, ls ...*rate.Limiter) {
	if !r.URL.IsAbs() {
		http.Error(w, "yalnızca proxy istekleri", http.StatusBadRequest)
		return
	}
	r.RequestURI = ""
	stripHop(r.Header)
	resp, err := guvenliTransport.RoundTrip(r)
	if err != nil {
		log.Printf("http reddedildi %s: %v", r.Host, err)
		http.Error(w, "502 bad gateway", http.StatusBadGateway)
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
	limitedCopy(w, resp.Body, ls...)
}

func main() {
	loadSecret()
	yerelIPleriTopla()   // hedef kilidi: iç aralıklar + kendi adresleri kapalı
	go kovalariTemizle() // boşta kalan kotalar belleği şişirmesin
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
		ReadTimeout:  0, // CONNECT tünelleri uzun ömürlü; gövde deadline'ı yok
		WriteTimeout: 0,
		// Başlığı hiç tamamlamayan bağlantı (slowloris) goroutine tutmasın.
		// Hijack başlıktan SONRA olduğu için tüneli etkilemez.
		ReadHeaderTimeout: 10 * time.Second,
		IdleTimeout:       90 * time.Second,
	}
	log.Printf("browservpn :443 dinliyor (domain %s, otomatik süreli token, limit 100 Mbps/cihaz + 100 Mbps/IP)", domain)
	ln, err := net.Listen("tcp", ":443")
	if err != nil {
		log.Fatalf(":443 dinlenemedi: %v", err)
	}
	// Küresel eşzamanlı bağlantı tavanı: fd/goroutine tükenmesine karşı.
	ln = sinirlaDinleyici(ln, kureselTavan)
	log.Fatal(srv.ServeTLS(ln, "", ""))
}
