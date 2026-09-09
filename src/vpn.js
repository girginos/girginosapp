'use strict';

/*
 * VPN = kendi uzak proxy sunucularına ŞİFRELİ tünel.
 *
 * Bu bir sistem-geneli VPN (TUN/WireGuard) DEĞİL: tarayıcı trafiği bir uzak
 * proxy'den geçiyor (tarayıcı "VPN"lerinin hepsi böyle). Alt yapı src/vekil.js;
 * burada yalnızca VPN sunucu KATALOĞU + seçili lokasyondan Chromium proxy
 * kuralı üretimi var. Uygulamayı main.js (session.setProxy) yapıyor.
 *
 * BANT GENİŞLİĞİ LİMİTİ (100 Mbps/kullanıcı) BURADA UYGULANMAZ - UYGULANAMAZ.
 * Yazılım açık kaynak; istemciye konan bir limit sökülür. "Ne olursa olsun
 * aşamasın" garantisi yalnızca SUNUCUDA (proxy, ör. 3proxy bandlimin) verilir.
 * İstemci sadece bağlanır ve cihaz token'ını verir; sunucu token başına kısar.
 * Buradaki limitMbps yalnızca ARAYÜZDE göstermek içindir (bilgi amaçlı).
 */

const { adresCoz, HEP_ATLANAN } = require('./vekil');

/*
 * SUNUCU KATALOĞU. host alanlarını kendi VPN sunucularınla doldur.
 *   sema: 'https' (browser<->sunucu TLS ile ŞİFRELİ, ÖNERİLEN) ya da 'socks5'.
 *   limitMbps: yalnızca gösterim; gerçek kısıtlama sunucuda.
 * Kimlik doğrulama (cihaz token'ı) main.js'teki 'login' olayıyla veriliyor;
 * adrese GÖMÜLMÜYOR (proxyRules kimlik bilgisi taşıyamaz + sızdırmayalım).
 */
/*
 * ad ARTIK BURADA TUTULMUYOR: ülke adı dile göre değişir (Almanya/Germany/...).
 * Görünen ad main.js'te cev('ulke.' + ulke) + ' #' + no ile kurulur; burada
 * yalnızca dil-bağımsız kimlik var (ulke kodu + aynı ülkedeki sunucu sırası).
 */
const SUNUCULAR = [
  { id: 'de-1', ulke: 'DE', no: 1, sema: 'https', host: 'de-browservpn.girginos.app', port: 443, limitMbps: 100 }
];

function sunucuBul(id) {
  return SUNUCULAR.find((s) => s.id === id) || null;
}

// Geçerli bir lokasyon kimliği mi? (ayar doğrulaması için)
function lokasyonGecerliMi(id) {
  return typeof id === 'string' && !!sunucuBul(id);
}

/*
 * Seçili VPN sunucusundan session.setProxy kuralı üretir.
 * Yerel adresler her zaman bypass. Sunucu bulunamazsa/adresi bozuksa null;
 * çağıran (main.js) null gelince fail-closed davranmalı (doğrudan bağlanma).
 *
 * @param {string} lokasyonId
 * @returns {{mode:'fixed_servers', proxyRules:string, proxyBypassRules:string}|null}
 */
function vpnVekilKurali(lokasyonId) {
  const s = sunucuBul(lokasyonId) || SUNUCULAR[0];
  if (!s) return null;
  const c = adresCoz(s.sema + '://' + s.host + ':' + s.port);
  if (!c) return null;
  return {
    mode: 'fixed_servers',
    proxyRules: c.sema + '://' + c.host + ':' + c.port,
    proxyBypassRules: HEP_ATLANAN.join(',')
  };
}

// Arayüz için sunucu listesi (host/port gizli tutulabilir; ülke/sıra/limit yeter).
// Görünen ad çağıranda (main.js) dile göre kurulur: cev('ulke.'+ulke) + ' #'+no.
function katalog() {
  return SUNUCULAR.map((s) => ({ id: s.id, ulke: s.ulke, no: s.no, limitMbps: s.limitMbps }));
}

/*
 * Cihaz kaydı (otomatik token) uç noktasının URL'i. İstemci cihaz kimliğini
 * gönderir, sunucu HMAC ile üretilmiş token'ı döner — kullanıcı hiçbir şey
 * girmez. Yalnızca 'https' sunucularda anlamlı (socks5'te kayıt yok).
 *
 * @param {string} lokasyonId
 * @param {string} cihaz  cihaz kimliği (opak, sunucuya gönderilir)
 * @returns {string} tam https URL ya da '' (kayıt desteklenmiyorsa)
 */
function vpnKayitUrl(lokasyonId, cihaz) {
  const s = sunucuBul(lokasyonId) || SUNUCULAR[0];
  if (!s || s.sema !== 'https') return '';
  return 'https://' + s.host + ':' + s.port + '/kayit?cihaz=' + encodeURIComponent(String(cihaz || ''));
}

module.exports = { SUNUCULAR, sunucuBul, lokasyonGecerliMi, vpnVekilKurali, katalog, vpnKayitUrl };
