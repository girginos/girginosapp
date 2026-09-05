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
 * ANA MAKİNE ADI, İZİN VERİLEN BİÇİMLE TANIMLANIYOR - YASAKLI KARAKTERLERLE DEĞİL.
 *
 * Önce "boşluk, /, @, ?, # yoksa geçerli" deniyordu. Bu yanlıştı, çünkü
 * proxyRules bir URL DEĞİL: Chromium'un kendi mini dili. Orada "=" şema
 * ayracı, ";" ve "," ise kural ayracı. Windows'un kayıt defterindeki ve
 * hazır vekil listelerindeki en yaygın yazım olan
 *
 *   http=1.2.3.4:8080
 *
 * o denetimden geçiyordu; ortaya "http://http=1.2.3.4:8080" çıkıyor, Chromium
 * bunu çözemeyip kural kümesini BOŞ bırakıyor ve her şey doğrudan gidiyordu.
 * Kullanıcı ayarlarda "Elle" ve kendi adresini görürken bütün trafik gerçek
 * adresten çıkıyordu - fail-closed sözünün tam tersi.
 *
 * Aşağıdaki denetim ne kastettiğimizi tarif ediyor. Dizeye bakan her denetim
 * er ya da geç Chromium'un ayrıştırıcısından geri kalır; bu yüzden main.js
 * uyguladıktan SONRA resolveProxy ile kararı da okuyor.
 */
const ANA_MAKINE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*$/i;
const IPV4 = /^\d{1,3}(?:\.\d{1,3}){3}$/;

/*
 * Atlama listesi girdisi. Chromium burada "*.ornek.com", "10.0.0.0/8" ve
 * "<local>" gibi biçimleri kabul ediyor; ama tek başına "*" HER ŞEYİ atlatır,
 * yani vekili sessizce kapatır. Ayarlarda hâlâ "Elle" yazarken.
 */
const ATLAMA_GIRDISI = /^(?:<local>|\*\.[a-z0-9-]+(?:\.[a-z0-9-]+)*|[a-z0-9[\]:.-]+(?:\/\d{1,3})?)$/i;

function atlamaGirdisiGecerliMi(girdi) {
  if (!girdi || girdi === '*' || /^\*+$/.test(girdi)) return false;
  return ATLAMA_GIRDISI.test(girdi);
}

/** Atlama listesindeki her girdi kabul edilebilir mi? */
function atlamaGecerliMi(ham) {
  const girdiler = String(ham == null ? '' : ham).split(/[,\s;]+/).map((s) => s.trim()).filter(Boolean);
  return girdiler.every(atlamaGirdisiGecerliMi);
}

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

  if (!ANA_MAKINE.test(host) && !IPV4.test(host) && !host.startsWith('[')) return null;

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
  // Geçersiz girdi ATILIYOR, listeye konmuyor: tek bir "*" bütün vekili
  // sessizce kapatırdı. Ayarlar sayfası da kullanıcıya reddedildiğini söyler.
  for (const g of girilen) if (atlamaGirdisiGecerliMi(g) && !hepsi.includes(g)) hepsi.push(g);
  return hepsi.join(',');
}

/**
 * Ayarlardan Electron'un session.setProxy() beklediği nesneyi üretir.
 *
 * @param {object} ayar
 * @param {string} ayar.vekilKip     'sistem' | 'kapali' | 'elle'
 *
 * VARSAYILAN 'sistem'. Onceden 'kapali' idi ve mode 'direct' uretiyordu; bu,
 * bu surumden once hic setProxy cagrilmadigi icin isletim sisteminin vekil
 * ayarini kullanan HERKESIN baglantisini keserdi. Kurumsal ag ya da PAC dosyasi
 * kullanan kullanici, guncellemeden sonra sebebi yazmayan bir kopukluk yasardi.
 * 'kapali' artik "isletim sistemini de yok say, dogrudan baglan" demek ve
 * kullanicinin bilerek sectigi bir sey.
 * @param {string} ayar.vekilAdres   'socks5://127.0.0.1:9050'
 * @param {string} ayar.vekilAtla    virgülle ayrılmış alan adları
 * @returns {{mode: string, proxyRules?: string, proxyBypassRules?: string}}
 */
function vekilKurallari(ayar) {
  const kip = (ayar && ayar.vekilKip) || 'sistem';

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

module.exports = {
  adresCoz, adresGecerliMi, atlamaKurali, atlamaGecerliMi, atlamaGirdisiGecerliMi,
  vekilKurallari, SEMALAR, HEP_ATLANAN
};
