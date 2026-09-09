'use strict';

const { adresOzelMi, yerelAdMi } = require('./adresler');

/*
 * HTTPS ZORLAMA (HTTPS-First).
 *
 * Düz HTTP'de oturum çerezi ve sayfa içeriği ağı dinleyen herkese açıktır;
 * kafe/otel ağında oturum çalmanın klasik yolu budur. Bu yüzden ÜST DÜZEY
 * gezinmeler https'e yükseltiliyor.
 *
 * GERİ DÜŞME: sunucu HTTPS konuşmuyorsa (bağlantı reddi/sıfırlama/zaman aşımı/
 * SSL protokol hatası) o host bu oturum için istisnaya alınıp http ile
 * yükleniyor - aksi hâlde yalnızca http sunan siteler tamamen erişilemez olurdu.
 * SERTİFİKA hataları geri düşme sebebi DEĞİL: geçersiz sertifika MITM işareti
 * olabilir, sessizce http'ye inmek saldırganın işine yarardı; Chromium'un
 * sertifika uyarısı görünsün.
 *
 * KAPSAM: yalnız mainFrame. Alt kaynaklarda karışık içeriği Chromium zaten
 * engelliyor; orada yükseltmeye kalkmak kırılganlık üretir.
 *
 * MUAF: yerel/özel adresler (localhost, 192.168.x, .local ...). İntranet
 * cihazlarının çoğu yalnızca http konuşur; onları kırmak istemiyoruz.
 */

// Sunucunun HTTPS konuşmadığını gösteren hatalar (geri düşülür).
const GERI_DUSME_HATALARI = new Set([
  -7,     // TIMED_OUT
  -100,   // CONNECTION_CLOSED
  -101,   // CONNECTION_RESET
  -102,   // CONNECTION_REFUSED
  -104,   // CONNECTION_FAILED
  -107,   // SSL_PROTOCOL_ERROR
  -113,   // SSL_VERSION_OR_CIPHER_MISMATCH
  -118    // CONNECTION_TIMED_OUT
]);

// Bu oturumda https denenip başarısız olan hostlar (kalıcı değil: her açılışta
// yeniden denenir, çünkü site sonradan HTTPS'e geçmiş olabilir).
const istisnalar = new Set();

function istisnaEkle(host) {
  const h = String(host || '').toLowerCase();
  if (h) istisnalar.add(h);
}
function istisnaVarMi(host) {
  return istisnalar.has(String(host || '').toLowerCase());
}
function istisnalariTemizle() {
  istisnalar.clear();
}
function geriDusulurMu(hataKodu) {
  return GERI_DUSME_HATALARI.has(Number(hataKodu));
}

/*
 * Yükseltilecekse https adresini, yükseltilmeyecekse null döner.
 * SENKRON: webRequest yolunda çalışıyor, DNS çözümlemesi yapılamaz; bu yüzden
 * yalnız düz-yazı ipuçlarına (yerel ad / IP değişmezi) bakılır. DNS ile iç ağa
 * çözülen adlar yükseltilir, konuşmuyorsa geri düşme yakalar.
 */
function yukseltmeAdresi(url, { acik = true } = {}) {
  if (!acik) return null;
  const ham = String(url || '');
  if (!/^http:\/\//i.test(ham)) return null;
  let u;
  try { u = new URL(ham); } catch { return null; }
  if (u.protocol !== 'http:') return null;
  const host = u.hostname.toLowerCase();
  if (!host) return null;
  if (yerelAdMi(host) || adresOzelMi(host)) return null;   // intranet muaf
  if (istisnaVarMi(host)) return null;                     // https denendi, konuşmuyor
  // Varsayılan olmayan port verilmişse dokunma: 8080 gibi portlar http'ye özgü
  // olabiliyor, https'e çevirmek çoğunlukla bağlantı hatasına düşerdi.
  if (u.port && u.port !== '80') return null;
  u.protocol = 'https:';
  if (u.port === '80') u.port = '';
  return u.toString();
}

module.exports = {
  yukseltmeAdresi, istisnaEkle, istisnaVarMi, istisnalariTemizle, geriDusulurMu,
  GERI_DUSME_HATALARI
};
