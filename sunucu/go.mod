module girginos.app/browservpn

// Bağımlılık taraması x/crypto 0.28.0'ı çok sayıda açıkla işaretledi (OSV'de 39
// kayıt, aralarında kritik olanlar). 0.56.0'a çıkıldı; bu sürümde eşleşen tek
// kayıt GO-2026-5932 ve o bizi İLGİLENDİRMİYOR: uyarı x/crypto/openpgp'nin
// bakımsız olduğunu söylüyor, biz yalnızca acme/autocert'i import ediyoruz ve
// openpgp'nin düzeltilmiş bir sürümü yok (uyarı tüm sürümleri kapsıyor), yani
// yükseltmeyle kapanmaz. Tarama bunu yine gösterirse: kullanılmıyor.
go 1.23

require (
	golang.org/x/crypto v0.56.0
	golang.org/x/time v0.14.0
)
