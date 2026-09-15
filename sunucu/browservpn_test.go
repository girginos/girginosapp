package main

/*
 * SUNUCU TESTLERİ.
 *
 * İki iş yapıyor:
 *   1. Token kapısının doğruluğu (süre MAC'e dahil mi, oynanmış token geçiyor mu)
 *   2. Eşzamanlılık: kovalar ve gizli anahtar birden çok goroutine'den
 *      kullanılıyor. `go test -race` altında çalıştırılmak üzere yazıldı.
 *
 * Neden race önemli: proxy her bağlantıda bantLimiti/kayitIzni çağırıyor,
 * temizleyici aynı haritaları arka planda dolaşıyor, SIGHUP gizli anahtarı
 * değiştirebiliyor. Bu üçü aynı anda olur.
 */

import (
	"crypto/rand"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"
)

func testSecretKur(t *testing.T) {
	t.Helper()
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		t.Fatal(err)
	}
	secretMu.Lock()
	secret = b
	secretMu.Unlock()
}

func TestTokenSureliVeOynanamaz(t *testing.T) {
	testSecretKur(t)
	const cihaz = "c-test-1"
	tok := tokenUret(cihaz)

	if !kimlikDogrula(cihaz, tok) {
		t.Fatal("taze token reddedildi")
	}
	parca := strings.SplitN(tok, ".", 2)
	if len(parca) != 2 {
		t.Fatalf("token biçimi <bitis>.<mac> değil: %q", tok)
	}
	bitis, err := strconv.ParseInt(parca[0], 10, 64)
	if err != nil {
		t.Fatalf("bitiş sayı değil: %v", err)
	}
	if kalan := time.Until(time.Unix(bitis, 0)); kalan < tokenOmru-time.Minute || kalan > tokenOmru {
		t.Fatalf("ömür beklenenden farklı: %v", kalan)
	}

	// Süre MAC'e dahil: uzatılmış bitiş aynı MAC'le geçmemeli.
	uzatilmis := strconv.FormatInt(bitis+365*24*3600, 10) + "." + parca[1]
	if kimlikDogrula(cihaz, uzatilmis) {
		t.Fatal("süresi uzatılmış token KABUL EDİLDİ - MAC süreyi kapsamıyor")
	}
	// Süresi geçmiş token.
	gecmis := strconv.FormatInt(time.Now().Add(-time.Hour).Unix(), 10) + "." + parca[1]
	if kimlikDogrula(cihaz, gecmis) {
		t.Fatal("süresi geçmiş token kabul edildi")
	}
	// Eski (süresiz) biçim.
	if kimlikDogrula(cihaz, parca[1]) {
		t.Fatal("eski süresiz biçim kabul edildi")
	}
	// Başka cihazın token'ı.
	if kimlikDogrula("c-test-2", tok) {
		t.Fatal("başka cihazın token'ı kabul edildi")
	}
	// Boş/bozuk girdiler panik etmemeli ve geçmemeli.
	for _, kotu := range []string{"", ".", "abc.def", "9999999999.", ".mac", strings.Repeat("x", 500)} {
		if kimlikDogrula(cihaz, kotu) {
			t.Fatalf("bozuk token kabul edildi: %q", kotu)
		}
	}
}

func TestKayitKotasi(t *testing.T) {
	limMu.Lock()
	kayitKovalari = map[string]*kova{}
	limMu.Unlock()

	const ip = "203.0.113.9"
	verilen := 0
	for i := 0; i < kayitSaatBasi*3; i++ {
		if kayitIzni(ip) {
			verilen++
		}
	}
	if verilen != kayitSaatBasi {
		t.Fatalf("saatlik kota %d olmalı, %d verildi", kayitSaatBasi, verilen)
	}
	// Başka IP kendi kotasına sahip olmalı (bir IP diğerini kilitlemesin).
	if !kayitIzni("203.0.113.10") {
		t.Fatal("ayrı IP kendi kotasını alamadı")
	}
}

func TestGecerliCihazVeKimliksizHedef(t *testing.T) {
	if gecerliCihaz("") || gecerliCihaz(strings.Repeat("a", 1000)) {
		t.Fatal("boş/aşırı uzun cihaz kimliği geçerli sayıldı")
	}
	if !gecerliCihaz("c-" + strings.Repeat("a", 30)) {
		t.Fatal("olağan cihaz kimliği reddedildi")
	}
	if !kimliksizHedef("browserapp.girginos.app:443") {
		t.Fatal("güncelleme sunucusu tüneli kapandı")
	}
	if kimliksizHedef("example.com:443") {
		t.Fatal("rastgele hedef kimliksiz geçiyor - AÇIK RELAY")
	}
}

/*
 * Yarış testi: gerçek yükün şeklini taklit eder. Çok sayıda goroutine aynı
 * anda kova alır, kota sorar, token doğrular; bir goroutine de temizleyicinin
 * yaptığını yapar (aynı haritaları kilit altında süpürür) ve bir başkası
 * gizli anahtarı döndürür (SIGHUP yolu).
 */
func TestEsZamanliKullanimYarisi(t *testing.T) {
	testSecretKur(t)
	limMu.Lock()
	bantKovalari = map[string]*kova{}
	kayitKovalari = map[string]*kova{}
	limMu.Unlock()

	const goroutineSayisi = 48
	const tur = 150

	dur := make(chan struct{})
	var arka sync.WaitGroup

	// Temizleyicinin gövdesi (kovalariTemizle 10 dk uyuduğu için kopyası).
	arka.Add(1)
	go func() {
		defer arka.Done()
		for {
			select {
			case <-dur:
				return
			default:
			}
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
	}()

	// Gizli anahtar döndürme (SIGHUP).
	arka.Add(1)
	go func() {
		defer arka.Done()
		for {
			select {
			case <-dur:
				return
			default:
			}
			b := make([]byte, 32)
			_, _ = rand.Read(b)
			secretMu.Lock()
			secret = b
			secretMu.Unlock()
		}
	}()

	var wg sync.WaitGroup
	for i := 0; i < goroutineSayisi; i++ {
		wg.Add(1)
		go func(n int) {
			defer wg.Done()
			cihaz := "c-yaris-" + strconv.Itoa(n%8)
			ip := "198.51.100." + strconv.Itoa(n%16)
			for j := 0; j < tur; j++ {
				bantLimiti("cihaz:" + cihaz)
				bantLimiti("ip:" + ip)
				kayitIzni(ip)
				// Anahtar dönerken doğrulama sonucu değişebilir; burada
				// ölçtüğümüz şey doğruluk değil, yarış yokluğu.
				kimlikDogrula(cihaz, tokenUret(cihaz))
			}
		}(i)
	}
	wg.Wait()
	close(dur)
	arka.Wait()
}
