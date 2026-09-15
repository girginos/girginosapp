package main

import (
	"strconv"
	"sync"
	"testing"
)

func TestKaynakOnek(t *testing.T) {
	deneme := []struct{ ip, beklenen string }{
		// IPv6 -> /64: aynı /64'teki iki adres AYNI anahtara düşmeli.
		{"2a01:4f8:c015:8611::1", "2a01:4f8:c015:8611::/64"},
		{"2a01:4f8:c015:8611:dead:beef:1:2", "2a01:4f8:c015:8611::/64"},
		// Farklı /64 -> farklı anahtar (rotasyon tek /64 içinde sınırlı kalsın).
		{"2a01:4f8:c015:8612::1", "2a01:4f8:c015:8612::/64"},
		// IPv4 -> /32 (tam adres): farklı meşru kullanıcılar gruplanmasın.
		{"1.2.3.4", "1.2.3.4/32"},
		{"1.2.3.5", "1.2.3.5/32"},
	}
	for _, d := range deneme {
		if g := kaynakOnek(d.ip); g != d.beklenen {
			t.Errorf("kaynakOnek(%q) = %q; beklenen %q", d.ip, g, d.beklenen)
		}
	}
	// IPv6 /64 rotasyonu: iki farklı adres tek anahtara indiği için savunma çökmez.
	if kaynakOnek("2a01:4f8:c015:8611::1") != kaynakOnek("2a01:4f8:c015:8611:ffff::9") {
		t.Fatal("aynı /64'teki iki adres farklı anahtara düştü - rotasyon bypass'ı açık")
	}
}

func TestOnekTavani(t *testing.T) {
	onekMu.Lock()
	onekSayila = map[string]int{}
	onekMu.Unlock()

	const o = "test-onek"
	verilen := 0
	for i := 0; i < onekTavan+50; i++ {
		if onekGiris(o) {
			verilen++
		}
	}
	if verilen != onekTavan {
		t.Fatalf("tavan %d olmalı, %d verildi", onekTavan, verilen)
	}
	// Bir slot bırak -> bir tane daha alınabilmeli.
	onekCikis(o)
	if !onekGiris(o) {
		t.Fatal("slot boşaldıktan sonra giriş reddedildi")
	}
	// Başka önek kendi tavanına sahip olmalı (biri diğerini kilitlemesin).
	if !onekGiris("baska-onek") {
		t.Fatal("ayrı önek kendi slotunu alamadı")
	}
}

// Sayaç eşzamanlı giriş/çıkışta tutarlı mı ve harita sıfıra dönünce
// temizleniyor mu (şişme yok)?
func TestOnekSayacYarisi(t *testing.T) {
	onekMu.Lock()
	onekSayila = map[string]int{}
	onekMu.Unlock()

	var wg sync.WaitGroup
	for i := 0; i < 40; i++ {
		wg.Add(1)
		go func(n int) {
			defer wg.Done()
			o := "y-" + strconv.Itoa(n%5)
			for j := 0; j < 300; j++ {
				if onekGiris(o) {
					onekCikis(o)
				}
			}
		}(i)
	}
	wg.Wait()
	onekMu.Lock()
	kalan := len(onekSayila)
	onekMu.Unlock()
	if kalan != 0 {
		t.Fatalf("tüm çıkışlardan sonra harita boş olmalı, %d giriş kaldı (sızıntı/şişme)", kalan)
	}
}
