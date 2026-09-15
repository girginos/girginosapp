package main

/*
 * EŞZAMANLI BAĞLANTI SINIRLARI + KAYNAK ÖNEK ANAHTARLAMA.
 *
 * Bant limiti byte'ı kısar ama bağlantı SAYISINI kısmaz. /kayit kimliksiz
 * olduğu için saldırgan bedava token üretip binlerce CONNECT açabilir; her biri
 * 2 goroutine + 2 soket tutar, fd/goroutine tükenince sunucu HERKESE kapanır.
 * İki kademe koyuyoruz:
 *   - küresel tavan: tüm sunucu için toplam eşzamanlı bağlantı (dinleyici sarma)
 *   - önek başına tavan: tek istemci tüm sunucuyu yiyemesin
 *
 * ÖNEK ANAHTARLAMA: kovalar (bant + kayıt kotası) eskiden TAM IP ile
 * anahtarlanıyordu. IPv6'da bir istemciye tipik olarak /64 tahsis edilir =
 * 2^64 kaynak adres = sınırsız taze kota/bant. Bu yüzden IPv6'yı /64,
 * IPv4'ü /32 (tek adres; bir saldırgan tüm /24'ü nadiren kontrol eder, /24
 * ile anahtarlamak farklı meşru kullanıcıları haksızca gruplar) ile
 * anahtarlıyoruz. Log/SonIP hâlâ tam IP kullanır; yalnızca KOVA anahtarı önek.
 */

import (
	"net"
	"net/netip"
	"sync"
)

const (
	kureselTavan = 3000 // tüm sunucu: aynı anda en fazla bu kadar bağlantı
	onekTavan    = 150  // /64 (IPv6) veya /32 (IPv4) başına eşzamanlı bağlantı
)

// kaynakOnek: kova/sayaç anahtarı için kaynağın öneki. IPv6 -> /64, IPv4 -> /32.
func kaynakOnek(ip string) string {
	ap, err := netip.ParseAddr(ip)
	if err != nil {
		return ip // ayrıştırılamıyorsa ham değeri anahtar yap (güvenli taraf)
	}
	ap = ap.Unmap()
	var bit int
	if ap.Is6() {
		bit = 64
	} else {
		bit = 32
	}
	pref, err := ap.Prefix(bit)
	if err != nil {
		return ip
	}
	return pref.String()
}

// --- önek başına eşzamanlı bağlantı sayacı ---

var (
	onekMu     sync.Mutex
	onekSayila = map[string]int{}
)

// onekGiris: bu önek için bir bağlantı slotu almayı dener. Tavan aşıldıysa false.
func onekGiris(onek string) bool {
	onekMu.Lock()
	defer onekMu.Unlock()
	if onekSayila[onek] >= onekTavan {
		return false
	}
	onekSayila[onek]++
	return true
}

func onekCikis(onek string) {
	onekMu.Lock()
	defer onekMu.Unlock()
	if onekSayila[onek] > 0 {
		onekSayila[onek]--
	}
	if onekSayila[onek] == 0 {
		delete(onekSayila, onek) // harita şişmesin
	}
}

// --- küresel eşzamanlı bağlantı tavanı (dinleyici sarma) ---

// sinirliDinleyici: kureselTavan'a ulaşınca Accept bloklar (TCP backlog'da
// bekletir), yani yeni bağlantı kurulmaz ama var olanlar etkilenmez.
type sinirliDinleyici struct {
	net.Listener
	yuva chan struct{}
}

func sinirlaDinleyici(l net.Listener, n int) net.Listener {
	return &sinirliDinleyici{Listener: l, yuva: make(chan struct{}, n)}
}

func (d *sinirliDinleyici) Accept() (net.Conn, error) {
	d.yuva <- struct{}{}
	c, err := d.Listener.Accept()
	if err != nil {
		<-d.yuva
		return nil, err
	}
	return &sinirliConn{Conn: c, yuva: d.yuva}, nil
}

type sinirliConn struct {
	net.Conn
	yuva chan struct{}
	bir  sync.Once
}

func (c *sinirliConn) Close() error {
	c.bir.Do(func() { <-c.yuva })
	return c.Conn.Close()
}
