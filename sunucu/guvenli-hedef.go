package main

/*
 * HESAP İZOLASYONU / KAYNAK GİZLEME.
 *
 * Bu bir forward proxy: hedefi kullanıcı belirler. Hiçbir filtre yokken bir
 * kullanıcı (hatta /kayit kimliksiz olduğu için HERKES) şunlara CONNECT
 * edebiliyordu — canlıda ölçüldü:
 *   127.0.0.1:22        -> sunucunun SSH'ı (afiş: SSH-2.0-OpenSSH_9.9)
 *   127.0.0.1:443       -> proxy'nin kendi iç yüzeyi (loopback amplifikasyon)
 *   169.254.169.254     -> bulut metadata (instance-id, MAC, IPv6, DNS sızdı)
 *   10/8, 192.168/16 …  -> iç ağ taraması
 * Yani her hesap sunucunun kaynaklarını ve iç ağını görebiliyordu.
 *
 * KURAL: yalnızca GENEL (public) bir IP'ye bağlan. Kontrol, isim çözümlemesi
 * SONRASI gerçekten bağlanılacak IP üzerinde (net.Dialer.Control) yapılıyor;
 * böylece "dışarıda çöz, içeriye bağlan" (DNS rebinding / TOCTOU) da kapanıyor.
 * Allow-list değil deny-list: bir VPN meşru olarak her genel siteye/porta
 * gitmeli, o yüzden portu kısıtlamıyoruz — tehlike iç HEDEFTE, portta değil;
 * iç IP'ler kapanınca SSH/DB/metadata endişesi de kapanır.
 */

import (
	"context"
	"errors"
	"log"
	"net"
	"net/http"
	"net/netip"
	"syscall"
	"time"
)

// 100.64.0.0/10: operatör NAT'ı (CGNAT). Genel değil; iç altyapıya işaret eder.
var cgnat = netip.MustParsePrefix("100.64.0.0/10")

// Sunucunun kendi arayüz adresleri: bunlara bağlanmak proxy'yi kendine
// döndürmek (amplifikasyon) demek. Başlangıçta bir kez toplanıyor.
var yerelIPler = map[netip.Addr]bool{}

func yerelIPleriTopla() {
	adresler, err := net.InterfaceAddrs()
	if err != nil {
		log.Printf("yerel adresler okunamadı: %v (kendine-bağlanma kilidi eksik)", err)
		return
	}
	for _, a := range adresler {
		if ipnet, ok := a.(*net.IPNet); ok {
			if ip, ok := netip.AddrFromSlice(ipnet.IP); ok {
				yerelIPler[ip.Unmap()] = true
			}
		}
	}
	log.Printf("hedef kilidi kuruldu (%d yerel adres, iç aralıklar + metadata kapalı)", len(yerelIPler))
}

// ipYasak: bu IP'ye forward proxy üzerinden bağlanmak yasak mı?
// Unmap: ::ffff:127.0.0.1 gibi IPv4-eşlemeli IPv6 hilesini de düzler.
func ipYasak(ip netip.Addr) bool {
	ip = ip.Unmap()
	return ip.IsLoopback() ||
		ip.IsPrivate() ||
		ip.IsLinkLocalUnicast() ||
		ip.IsLinkLocalMulticast() ||
		ip.IsInterfaceLocalMulticast() ||
		ip.IsMulticast() ||
		ip.IsUnspecified() ||
		(ip.Is4() && cgnat.Contains(ip)) ||
		yerelIPler[ip]
}

// ErrYasakHedef: dial reddedildiğinde dönen hata. İstemciye ham hâliyle
// gösterilmiyor (bkz. browservpn.go handleConnect/handleHTTP): hangi iç IP'nin
// var olduğunu doğrulayan bir yan kanal olmasın.
var ErrYasakHedef = errors.New("hedef reddedildi: yalnızca genel adreslere bağlanılır")

// guvenliKontrol: net.Dialer.Control kancası. address ARTIK çözülmüş "ip:port".
func guvenliKontrol(_, address string, _ syscall.RawConn) error {
	ap, err := netip.ParseAddrPort(address)
	if err != nil {
		return err
	}
	if ipYasak(ap.Addr()) {
		return ErrYasakHedef
	}
	return nil
}

var guvenliCevirici = &net.Dialer{
	Timeout: 20 * time.Second,
	Control: guvenliKontrol,
}

// guvenliDial: CONNECT yolu bunu kullanıyor (net.DialTimeout yerine).
func guvenliDial(hostPort string) (net.Conn, error) {
	return guvenliCevirici.DialContext(context.Background(), "tcp", hostPort)
}

// guvenliTransport: düz HTTP (absolute-form) yolu bunu kullanıyor
// (http.DefaultTransport yerine) — aynı deny-list, tek noktadan.
var guvenliTransport = &http.Transport{
	DialContext:           guvenliCevirici.DialContext,
	MaxIdleConns:          100,
	IdleConnTimeout:       90 * time.Second,
	TLSHandshakeTimeout:   10 * time.Second,
	ExpectContinueTimeout: time.Second,
}
