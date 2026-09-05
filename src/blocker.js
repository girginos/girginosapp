'use strict';

const { LISTE } = require('./blocklist');
const { cerezTasinsinMi } = require('./cerezler');

/*
 * İki seviyeli son ekler. Kayıtlanabilir alan adını doğru bulmak için gerekli:
 * "bank.co.uk" ile "reklam.co.uk" AYNI site sayılırsa hem çerez engeli hem de
 * istek engeli o son ekin altındaki her yerde çöker.
 *
 * TAM BİR PUBLIC SUFFIX LIST DEĞİL. Elle yazılan kısım aşağıda; ayrıca
 * GENEL_IKINCI + iki harfli ülke kodu birleşimi kalıp olarak tanınıyor, çünkü
 * elle liste tutmak ".co.il", ".com.ph", ".co.th" gibi düzinelerce son eki
 * dışarıda bırakıyordu. Barındırma son ekleri (github.io, vercel.app...) da
 * eklendi: oralarda iki AYRI kullanıcının siteleri aynı taraf sayılıyordu.
 */
const IKI_SEVIYELI = new Set([
  'co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'me.uk', 'net.uk',
  'com.tr', 'net.tr', 'org.tr', 'gov.tr', 'edu.tr', 'bel.tr', 'k12.tr', 'av.tr',
  'com.au', 'net.au', 'org.au', 'com.br', 'com.cn', 'com.mx', 'com.ar',
  'co.jp', 'ne.jp', 'or.jp', 'co.kr', 'co.in', 'co.za', 'co.nz', 'com.sg',
  'com.hk', 'com.tw', 'com.my', 'com.ua', 'com.pl', 'com.ru', 'com.es',
  // Barındırma (özel) son ekleri: altındaki her ad başka bir kullanıcının.
  'github.io', 'gitlab.io', 'pages.dev', 'workers.dev', 'vercel.app',
  'netlify.app', 'netlify.com', 'web.app', 'firebaseapp.com', 'appspot.com',
  'blogspot.com', 'herokuapp.com', 'glitch.me', 'surge.sh', 'neocities.org',
  'azurewebsites.net', 'cloudfront.net', 'r2.dev',
  'wordpress.com', 'tumblr.com', 'myshopify.com', 'weebly.com', 'wixsite.com'
]);

/*
 * "co.il", "com.ph", "co.th" ... hepsini elle yazmak yerine kalıp: yaygın
 * genel ikinci seviye + iki harfli ülke kodu. Bu kalıp olmadan o ülkelerde
 * bütün siteler tek bir kayıtlanabilir alan adına düşüyordu.
 */
// Uc etiketli son ekler; iki etiketli kontrolden once bakilmali.
const UC_SEVIYELI = new Set(['s3.amazonaws.com', 'compute.amazonaws.com', 'ap-south-1.amazonaws.com']);

const GENEL_IKINCI = new Set(['co', 'com', 'net', 'org', 'gov', 'edu', 'ac', 'ne', 'or', 'mil', 'int']);

function ikiSeviyeliMi(son2) {
  if (IKI_SEVIYELI.has(son2)) return true;
  const p = son2.split('.');
  return p.length === 2 && GENEL_IKINCI.has(p[0]) && /^[a-z]{2}$/.test(p[1]);
}

// IP ile erişilen adreslerde "kayıtlanabilir alan adı" diye bir şey yoktur;
// son iki okteti kesmek 142.250.185.14 ile 10.0.185.14'ü aynı kovaya atardı.
function ipMi(host) {
  return /^\[[0-9a-f:.]+\]$/i.test(host) || /^\d{1,3}(\.\d{1,3}){3}$/.test(host);
}

function kokAlanAdi(host) {
  if (!host) return '';
  const h = host.toLowerCase().replace(/\.+$/, '');
  if (ipMi(h)) return h;
  const p = h.split('.');
  if (p.length <= 2) return h;
  if (p.length >= 4 && UC_SEVIYELI.has(p.slice(-3).join('.'))) return p.slice(-4).join('.');
  const son2 = p.slice(-2).join('.');
  if (ikiSeviyeliMi(son2) && p.length >= 3) return p.slice(-3).join('.');
  return son2;
}

// Sondaki nokta atılmazsa "izleyici.com." listedeki "izleyici.com" ile
// eşleşmez ve engelleyici tek karakterle atlatılır.
function hostAl(url) {
  try { return new URL(url).hostname.toLowerCase().replace(/\.+$/, ''); } catch { return ''; }
}

/*
 * Başlık adları büyük/küçük harf duyarsız ve Electron aynı başlığı isteğe göre
 * "Cookie" ya da "cookie" diye verebiliyor. Tek bir yazımı silmek, öbür yazım
 * geldiğinde SESSİZCE hiçbir şey yapmamak olurdu.
 */
/*
 * "Üst alan adı bilinmiyor" işareti. Boş dize KULLANILAMAZ: cerezler.js boş
 * üst alanı "emin değiliz, dokunma" diye okuyup çerezi taşır - kapatmak
 * istediğimiz yolun ta kendisi. Hiçbir gerçek alan adında bulunamayacak bir
 * karakter taşıyor, yani hiçbir siteye eşit çıkamaz.
 */
const BILINMEYEN_UST = '\u0000bilinmeyen';

function basligiSil(basliklar, ad) {
  const aranan = ad.toLowerCase();
  let silindi = false;
  for (const anahtar of Object.keys(basliklar)) {
    if (anahtar.toLowerCase() === aranan) {
      delete basliklar[anahtar];
      silindi = true;
    }
  }
  return silindi;
}

class Blocker {
  constructor(store) {
    this.store = store;
    this.liste = new Set(LISTE);
    this.listeler = null;        // indirilen filtre listeleri (ListeYoneticisi)
    this.sayaclar = new Map();   // webContentsId -> engellenen istek sayısı
    this.ustAlan = new Map();    // webContentsId -> sekmedeki üst seviye kök alan adı
    this.birikenToplam = 0;
    this._yazZamanlayici = null;
  }

  get acik() { return this.store.ayarlar.engelleyiciAcik; }

  ustAlanAyarla(wcId, url) {
    const kok = kokAlanAdi(hostAl(url));
    this.ustAlan.set(wcId, kok);
    this.sayaclar.set(wcId, 0);
  }

  // Gezinme baslarken sayac sifirlanir; ust alan adi ise gezinme BITINCE
  // yazilir (bkz. main.js did-start-navigation).
  sayaciSifirla(wcId) { this.sayaclar.set(wcId, 0); }

  sayac(wcId) { return this.sayaclar.get(wcId) || 0; }

  unut(wcId) {
    this.sayaclar.delete(wcId);
    this.ustAlan.delete(wcId);
  }

  // Alan adı ya da üst alan adlarından biri listede mi?
  listede(host) {
    if (this.liste.has(host)) return true;
    let i = host.indexOf('.');
    while (i !== -1) {
      const ust = host.slice(i + 1);
      if (this.liste.has(ust)) return true;
      i = host.indexOf('.', i + 1);
    }
    return false;
  }

  engellensinMi(details) {
    if (!this.acik) return false;
    if (details.resourceType === 'mainFrame') return false;

    const host = hostAl(details.url);
    if (!host) return false;

    const kok = kokAlanAdi(host);
    const wcId = details.webContentsId;
    const ust = wcId != null ? this.ustAlan.get(wcId) : undefined;

    // Birinci taraf istekleri hiç engellenmez: sitenin kendi alan adı çalışsın.
    if (ust && kok === ust) return false;
    // Kullanıcı bu site için engelleyiciyi kapattıysa dokunma.
    if (ust && this.store.siteIzinliMi(ust)) return false;

    // Yerleşik liste her zaman kazanır: indirilen listelerdeki bir istisna
    // kuralı bizim elle seçtiğimiz izleyicileri serbest bırakamasın.
    if (this.listede(host)) return true;
    return this.listeler ? this.listeler.engelleniyorMu(host) : false;
  }

  // Sec-CH-UA basliklarini uretecek islev; main.js baglar.
  ipuclariniBagla(saglayici) {
    this.ipucuSaglayici = saglayici;
  }

  /*
   * Bu istekte çerez taşınmalı mı? Karar mantığı src/cerezler.js'te; burada
   * yalnızca isteğin tarafları çıkarılıyor.
   *
   * ÜST SEVİYE GEZİNMELER HER ZAMAN MUAF. ustAlan haritası gezinme BİTİNCE
   * güncelleniyor; A sitesinden B sitesine giderken istek hâlâ A'nın altında
   * görünür, yani "üçüncü taraf" sayılır. Orada çerezi kesmek, adres çubuğuna
   * yazılarak girilen her siteye çıkış yapılmış gibi görünmesine yol açardı.
   */
  cerezTasinirMi(details) {
    if (details.resourceType === 'mainFrame') return true;

    const istekKoku = kokAlanAdi(hostAl(details.url));
    const wcId = details.webContentsId;
    let ustKok = wcId != null ? this.ustAlan.get(wcId) : undefined;

    /*
     * SEKMEYE BAĞLANAMAYAN İSTEKLER.
     *
     * Service worker'dan çıkan her istekte webContentsId YOK. Önceden bu
     * durumda "bilmiyoruz, dokunmayalım" deniyordu ve engel tamamen
     * atlanıyordu: üçüncü taraf bir çerçeve üç satırla kendi service
     * worker'ını kaydedip hem çerezini taşıyor hem de Set-Cookie ile yeni
     * kimlik yazdırabiliyordu. Ölçüldü.
     *
     * Artık isteğin kökü AÇIK SEKMELERDEN birinin üst alan adıysa birinci
     * taraf sayılıyor; değilse üçüncü taraf. Sitenin kendi service worker'ı
     * çalışmaya devam ediyor, başkasınınki çerez taşımıyor.
     */
    if (ustKok === undefined) ustKok = this.acikUstAlanMi(istekKoku) ? istekKoku : BILINMEYEN_UST;

    return cerezTasinsinMi({
      istekKoku,
      ustKok,
      engelleAcik: this.store.ayarlar.ucuncuTarafCerez !== false,
      istisna: !!ustKok && this.store.cerezIstisnasiMi(ustKok)
    });
  }

  // Bu kök şu an açık sekmelerden birinin üst alan adı mı?
  acikUstAlanMi(kok) {
    if (!kok) return false;
    for (const ust of this.ustAlan.values()) if (ust === kok) return true;
    return false;
  }

  listeleriBagla(yonetici) {
    this.listeler = yonetici;
  }

  bagla(ses, degisimBildir) {
    /*
     * HER ISLEYICI KORUMA ALTINDA.
     *
     * webRequest isleyicisi firlatirsa callback hic cagrilmiyor ve istek
     * SONSUZA kadar asili kaliyor: sayfa yuklenmiyor, hata da yok. Olculdu -
     * alti saniye sonra hala bekliyordu. Kullanicinin elle duzenleyebildigi
     * pusula-veri.json'da tek bozuk alan butun tarayiciyi durdurmaya yetiyor.
     *
     * Hata durumunda istek DOKUNULMADAN gecirilir: bir cerezi kacirmak,
     * tarayiciyi kilitlemekten iyidir.
     */
    const korumali = (ad, isleyici) => (details, callback) => {
      try {
        isleyici(details, callback);
      } catch (e) {
        console.error('webRequest/' + ad + ' hata verdi, istek dokunulmadan gecti:', e.message);
        callback({});
      }
    };

    ses.webRequest.onBeforeRequest(korumali('onBeforeRequest', (details, callback) => {
      if (this.engellensinMi(details)) {
        const wcId = details.webContentsId;
        if (wcId != null) this.sayaclar.set(wcId, (this.sayaclar.get(wcId) || 0) + 1);
        this.birikenToplam++;
        this._toplamiYaz(degisimBildir);
        return callback({ cancel: true });
      }
      callback({});
    }));

    ses.webRequest.onBeforeSendHeaders(korumali('onBeforeSendHeaders', (details, callback) => {
      const headers = { ...details.requestHeaders };
      if (this.store.ayarlar.dntGonder) {
        headers['DNT'] = '1';
        headers['Sec-GPC'] = '1';
      }
      /*
       * Sec-CH-UA basliklari. Electron bunlari hic gondermiyor; User-Agent
       * "Chrome/152" derken Client Hints'in hic olmamasi, bot korumalarinin
       * baktigi bir tutarsizlik. Degerler sayfanin kendi userAgentData'sindan
       * uretiliyor, yani yeni bir iddia eklemiyoruz.
       */
      const ipuclari = this.ipucuSaglayici ? this.ipucuSaglayici() : null;
      if (ipuclari) Object.assign(headers, ipuclari);

      if (!this.cerezTasinirMi(details)) basligiSil(headers, 'Cookie');
      callback({ requestHeaders: headers });
    }));

    // Giden çerezi kesmek yetmez: üçüncü taraf yanıtla YENİ çerez yazabilir ve
    // bir dahaki ziyarette aynı kimlikle karşımıza çıkar. Set-Cookie de düşer.
    ses.webRequest.onHeadersReceived(korumali('onHeadersReceived', (details, callback) => {
      if (this.cerezTasinirMi(details)) return callback({});
      const headers = { ...details.responseHeaders };
      if (!basligiSil(headers, 'Set-Cookie')) return callback({});
      callback({ responseHeaders: headers });
    }));
  }

  // Sayaç her istekte diske yazılmasın diye biriktir.
  _toplamiYaz(degisimBildir) {
    if (this._yazZamanlayici) return;
    this._yazZamanlayici = setTimeout(() => {
      this._yazZamanlayici = null;
      if (this.birikenToplam > 0) {
        this.store.engellendiSay(this.birikenToplam);
        this.birikenToplam = 0;
      }
      if (degisimBildir) degisimBildir();
    }, 700);
  }
}

module.exports = { Blocker, kokAlanAdi, hostAl, basligiSil, IKI_SEVIYELI };
