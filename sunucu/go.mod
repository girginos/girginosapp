module girginos.app/browservpn

// Bağımlılık taraması x/crypto 0.28.0'ı çok sayıda açıkla işaretledi (OSV'de 39
// kayıt, aralarında kritik olanlar). 0.56.0'a çıkıldı; bu sürümde eşleşen tek
// kayıt GO-2026-5932 ve o bizi İLGİLENDİRMİYOR: uyarı x/crypto/openpgp'nin
// bakımsız olduğunu söylüyor, biz yalnızca acme/autocert'i import ediyoruz ve
// openpgp'nin düzeltilmiş bir sürümü yok (uyarı tüm sürümleri kapsıyor), yani
// yükseltmeyle kapanmaz. Tarama bunu yine gösterirse: kullanılmıyor.
//
// go yönergesi 1.26.0: x/crypto 0.56.0'ın KENDİSİ bunu beyan ediyor ve Go
// ana modülün yönergesinin bağımlılıklarınkinden düşük olmasına izin vermiyor.
// 1.23/1.24/1.25 denendi, üçü de "updates to go.mod needed" veriyor.
// CI araç zincirini bu satırdan okuyor (go-version-file), ikisi ayrışmasın.
go 1.26.0

require (
	golang.org/x/crypto v0.56.0
	golang.org/x/time v0.14.0
)

// Dolaylı bağımlılıklar. Go 1.21+ derleme grafiğindeki HER modülün go.mod'da
// beyan edilmesini ister; bu blok eksikken `go vet` "updates to go.mod needed"
// deyip CI'da kaldı. Bunlar go.sum'da zaten vardı - yani CVE taraması onları
// görüyordu; eksik olan tek şey beyandı.
// (go.mod yalnızca // yorumu kabul eder, /* */ ayrıştırma hatası verir.)
require (
	golang.org/x/net v0.57.0 // indirect
	golang.org/x/text v0.41.0 // indirect
)
