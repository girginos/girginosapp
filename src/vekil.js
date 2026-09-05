'use strict';

/*
 * Vekil (proxy) sunucu ayarı.
 *
 * Buradaki her şey saf: Electron yok, ağ yok. Yalnızca "kullanıcının yazdığı
 * adres" ile "Chromium'un anladığı kural dizesi" arasındaki çeviri.
 *
 * BİR VEKİL YA HER YERE UYGULANIR YA DA HİÇBİR İŞE YARAMAZ. Tarayıcı sekmesi
 * vekilden çıkarken güncelleme denetimi ya da filtre listesi indirmesi doğrudan
 * çıkarsa, gerçek adres yine görünür - üstelik kullanıcı korunduğunu sanarak.
 * Uygulayan taraf (main.js) bu yüzden BÜTÜN oturumları tek listeden geçiriyor
 * ve bir sözleşme testi listenin eksiksizliğini denetliyor.
 */

// socks4 BİLEREK yok: Chromium'da socks4 alan adını YEREL çözer, yani
// gezdiğiniz her sitenin adı vekilden önce DNS'e düşer. socks5'te çözümü vekil
// yapar. "Vekil kullanıyorum" diyen birinin alan adlarının sızması, korumanın
// sessizce yarısını kaybetmesidir.
const SEMALAR = new Set(['http', 'https', 'socks5']);

const VARSAYILAN_PORT = { http: 8080, https: 8080, socks5: 1080 };

/*
 * Yerel adresler her zaman vekilin dışında kalır: 127.0.0.1'e giden bir isteği
 * uzak bir vekile göndermek hem anlamsız hem de Tor gibi vekillerde hata.
 */
const HEP_ATLANAN = ['localhost', '127.0.0.1', '::1', '<local>'];

/**
 * "socks5://127.0.0.1:9050" -> { sema, host, port } | geçersizse null
 */
function adresCoz(ham) {
  const metin = String(ham == null ? '' : ham).trim();
  if (!metin) return null;

  const m = /^([a-z0-9]+):\/\/(.+)$/i.exec(metin);
  // Şema yazılmadıysa http varsayılıyor; kullanıcıların çoğu "1.2.3.4:8080" yazıyor.
  const sema = (m ? m[1] : 'http').toLowerCase();
  const govde = m ? m[2] : metin;
  if (!SEMALAR.has(sema)) return null;

  // IPv6 köşeli parantez içinde: [::1]:9050
  const ipv6 = /^\[([0-9a-f:.]+)\](?::(\d+))?$/i.exec(govde);
  let host;
  let portMetni;
  if (ipv6) {
    host = '[' + ipv6[1] + ']';
    portMetni = ipv6[2];
  } else {
    const parcalar = govde.split(':');
    if (parcalar.length > 2) return null;
    host = parcalar[0];
    portMetni = parcalar[1];
  }

  if (!host || /[\s/@?#]/.test(host)) return null;
  // Yol, kullanıcı adı ya da sorgu taşıyan bir adres vekil adresi değildir.

  let port;
  if (portMetni === undefined) port = VARSAYILAN_PORT[sema];
  else {
    if (!/^\d{1,5}$/.test(portMetni)) return null;
    port = Number(portMetni);
    if (port < 1 || port > 65535) return null;
  }

  return { sema, host, port };
}

function adresGecerliMi(ham) {
  return adresCoz(ham) !== null;
}

/**
 * Kullanıcının yazdığı atlama listesini Chromium biçimine çevirir.
 * Yerel adresler her zaman eklenir.
 */
function atlamaKurali(ham) {
  const girilen = String(ham == null ? '' : ham)
    .split(/[,\s;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const hepsi = [...HEP_ATLANAN];
  for (const g of girilen) if (!hepsi.includes(g)) hepsi.push(g);
  return hepsi.join(',');
}

/**
 * Ayarlardan Electron'un session.setProxy() beklediği nesneyi üretir.
 *
 * @param {object} ayar
 * @param {string} ayar.vekilKip     'kapali' | 'sistem' | 'elle'
 * @param {string} ayar.vekilAdres   'socks5://127.0.0.1:9050'
 * @param {string} ayar.vekilAtla    virgülle ayrılmış alan adları
 * @returns {{mode: string, proxyRules?: string, proxyBypassRules?: string}}
 */
function vekilKurallari(ayar) {
  const kip = (ayar && ayar.vekilKip) || 'kapali';

  if (kip === 'sistem') return { mode: 'system' };

  if (kip === 'elle') {
    const c = adresCoz(ayar.vekilAdres);
    /*
     * Adres bozuksa DOĞRUDAN bağlanmaya düşmüyoruz. "Vekil kullan" deyip
     * yazım hatası yapan biri, korunduğunu sanarak gezmeye devam ederdi.
     * mode 'fixed_servers' + erişilemeyen bir kural, istekleri başarısız kılar:
     * hata görünür, sızıntı görünmez.
     */
    const kural = c ? c.sema + '://' + c.host + ':' + c.port : 'http://0.0.0.0:1';
    return {
      mode: 'fixed_servers',
      proxyRules: kural,
      proxyBypassRules: atlamaKurali(ayar.vekilAtla),
      gecerli: !!c
    };
  }

  return { mode: 'direct' };
}

module.exports = { adresCoz, adresGecerliMi, atlamaKurali, vekilKurallari, SEMALAR, HEP_ATLANAN };
