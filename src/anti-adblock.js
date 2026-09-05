'use strict';

/*
 * ANTI-ADBLOCK KARŞI-ÖNLEMİ.
 *
 * "AdBlock Detected" duvarları iki katmanda çalışıyor (blackhatworld.com'da
 * ölçüldü): (1) yem ögelerin geometrisini/görünürlüğünü sorgulayan JS
 * kontrolleri - bizim kozmetik CSS'imiz yemi display:none yaptığı için pozitif
 * oluyor; (2) reklam scriptlerine giden fetch/XHR - ağ engelleyicimiz kestiği
 * için pozitif oluyor. Herhangi BİR kontrol adblock görürse tam ekran örtü
 * çıkıyor. Örtü sayfayı kilitlemiyor (kaydırma kilidi ölü kod), yalnızca görsel
 * bir kapak.
 *
 * İKİ KATMANLI CEVAP:
 *   PROAKTİF - sayfanın kendi script'lerinden ÖNCE ana dünyaya girip yem
 *     ögelerin ölçümünü kandırır (getComputedStyle, offsetHeight ve
 *     getBoundingClientRect görünür değer döndürür). Duvarın hiç çıkmaması
 *     hedeflenir.
 *   YEDEK - proaktif kaçırırsa (farklı teknik, 5. tetikleyici), yükleme sonrası
 *     bir MutationObserver tam-ekran + yüksek z-index + "adblock" metinli örtüyü
 *     görünmeden kaldırır ve kaydırmayı geri açar.
 *
 * DÜRÜST KAPSAM: proaktif katman her tespit tekniğini kapatmaz - siteler yeni
 * yem biçimleri kullanabilir. Yedek katman görünen duvarı kaldırır ama site
 * JS düzeyinde hâlâ şüphelenebilir. Tespit yüzeyi geniş; bu kesin görünmezlik
 * değil, en yaygın duvarları etkisiz kılan bir savunma.
 *
 * Bu dosya main.js'te session.setPreloads ile persist:pusula oturumuna
 * yükleniyor. Oturum arayüz penceresi, katman ve newtab ile PAYLAŞILIYOR;
 * o yüzden preload yalnızca üst çerçeve http/https sayfalarında çalışır.
 */

/*
 * ANA DÜNYADA çalışacak kod. Fonksiyon olarak yazılıp toString() ile string'e
 * çevriliyor: preload sandbox'ında okunabilir kalıyor, çalıştırılırken
 * webFrame.executeJavaScript ile sayfanın ana dünyasına geçiyor. Fonksiyon
 * KENDİ İÇİNDE KAPALI olmalı - preload kapsamındaki hiçbir şeye erişemez.
 */
function anaDunyaKodu() {
  'use strict';
  if (window.__pusulaAA) return;
  var durum = { yem: 0, ortu: 0 };
  window.__pusulaAA = durum;

  /* ---------------- 1) YEM ÖGE GEOMETRİ KORUMASI ---------------- */
  /*
   * Bilinen adblock-yem sınıf/kimlik parçaları. blackhatworld yem ögeye
   * "topRightAd adbox2 cpmstarHeadline ads336_280 ad-120-60" veriyor; bunlar
   * EasyList'in yaygın yem adları. Bir öge bunlardan birini taşıyorsa ve bizim
   * CSS'imizle gizlenmişse, ölçüm sorgusuna GÖRÜNÜR cevap veriyoruz - sayfanın
   * gerçek yerleşimi değişmiyor, yalnızca "gizli mi" sorusunu yanıtlıyoruz.
   */
  var YEM = /(?:^|[\s_-])(?:ad|ads|adbox|adbox2|adbanner|advert|adsbox|adsbygoogle|adslot|adunit|adcontainer|adwrapper|adframe|adheader|adheadline|ad-\d|ads\d|pub_\d|sponsor|sponsored|doubleclick|topad|toprightad|cpmstar|banner_ad|bannerad|google_ad|textad)(?:[\s_-]|\d|$)/i;

  function yemMi(el) {
    try {
      if (!el || el.nodeType !== 1) return false;
      var s = (typeof el.className === 'string' ? el.className : '') + ' ' + (el.id || '');
      return YEM.test(s);
    } catch (e) { return false; }
  }

  // Öge bizim tarafımızdan (ya da başka yolla) gizli mi?
  function gizliMi(el) {
    try {
      var c = window.__pusulaGCS ? window.__pusulaGCS(el) : null;
      if (!c) return false;
      return c.display === 'none' || c.visibility === 'hidden' || parseFloat(c.opacity) === 0;
    } catch (e) { return false; }
  }

  // getComputedStyle'ı sarmala: yem + gizli öge için görünür değer göster.
  var gcsOrijinal = window.getComputedStyle;
  window.__pusulaGCS = function (el, sp) { return gcsOrijinal.call(window, el, sp); };
  window.getComputedStyle = function (el, sp) {
    var c = gcsOrijinal.call(window, el, sp);
    if (!yemMi(el)) return c;
    // Proxy ile yalnızca görünürlük anahtarlarını yalanla; gerisi gerçek.
    try {
      return new Proxy(c, {
        get: function (hedef, ad) {
          if (ad === 'display') { durum.yem++; return 'block'; }
          if (ad === 'visibility') return 'visible';
          if (ad === 'opacity') return '1';
          if (ad === 'getPropertyValue') {
            return function (p) {
              if (p === 'display') { durum.yem++; return 'block'; }
              if (p === 'visibility') return 'visible';
              if (p === 'opacity') return '1';
              return hedef.getPropertyValue(p);
            };
          }
          var v = hedef[ad];
          return typeof v === 'function' ? v.bind(hedef) : v;
        }
      });
    } catch (e) { return c; }
  };

  // offset*/client* getter'ları: yem + gizli öge için pozitif değer.
  function boyutKoru(ad, sahte) {
    try {
      var proto = window.HTMLElement && window.HTMLElement.prototype;
      var d = proto && Object.getOwnPropertyDescriptor(proto, ad);
      if (!d || !d.get) return;
      var orij = d.get;
      Object.defineProperty(proto, ad, {
        configurable: true, enumerable: d.enumerable,
        get: function () {
          var v = orij.call(this);
          if ((v === 0 || v == null) && yemMi(this) && gizliMi(this)) { durum.yem++; return sahte; }
          return v;
        }
      });
    } catch (e) { /* tarayıcı izin vermezse geç */ }
  }
  boyutKoru('offsetHeight', 14);
  boyutKoru('offsetWidth', 300);
  boyutKoru('clientHeight', 14);
  boyutKoru('clientWidth', 300);

  // getBoundingClientRect: yem + gizli öge için boş olmayan dörtgen.
  try {
    var grOrij = window.Element.prototype.getBoundingClientRect;
    window.Element.prototype.getBoundingClientRect = function () {
      var r = grOrij.call(this);
      if ((!r || (r.height === 0 && r.width === 0)) && yemMi(this) && gizliMi(this)) {
        durum.yem++;
        return { x: 0, y: 0, top: 0, left: 0, right: 300, bottom: 14, width: 300, height: 14,
          toJSON: function () { return this; } };
      }
      return r;
    };
  } catch (e) { /* geç */ }

  /* ---------------- 2) ÖRTÜ NÖTRLEME (YEDEK) ---------------- */
  var ADBLOCK = /(ad\s?block|reklam engelley|disable your ad|turn off your ad|reklam\s?engel)/i;

  function tamEkranMi(el, c) {
    try {
      if (!c || c.position !== 'fixed') return false;
      var z = parseInt(c.zIndex, 10);
      if (!(z >= 9990)) return false;
      var r = el.getBoundingClientRect();
      // ~tam görüntü alanı: kenarlar viewport'a yakın, alan büyük.
      return r.width >= window.innerWidth * 0.9 && r.height >= window.innerHeight * 0.9;
    } catch (e) { return false; }
  }

  function ortuMu(el) {
    try {
      if (!el || el.nodeType !== 1) return false;
      var c = gcsOrijinal.call(window, el);
      if (!tamEkranMi(el, c)) return false;
      // Metin ipucu: yalnızca konum/boyut meşru bir modalı da yakalar; "adblock"
      // metni şartı false-positive'i (çerez/giriş kutusu) daraltır.
      return ADBLOCK.test(el.innerText || el.textContent || '');
    } catch (e) { return false; }
  }

  function kaldir(el) {
    try {
      el.style.setProperty('display', 'none', 'important');
      durum.ortu++;
    } catch (e) { /* geç */ }
  }

  // Kaydırma kilidini geri aç: örtü çıkınca bazı siteler body'yi kilitliyor.
  function kaydirmayiAc() {
    try {
      var h = document.documentElement, b = document.body;
      if (h) h.style.setProperty('overflow', 'auto', 'important');
      if (b) {
        b.style.setProperty('overflow', 'auto', 'important');
        b.style.setProperty('position', 'static', 'important');
      }
    } catch (e) { /* geç */ }
  }

  /*
   * TARAMA UCUZ OLMALI. Örtü her zaman body'nin DOĞRUDAN çocuğu (ya da <dialog>)
   * olarak eklenir; tüm belgeyi querySelectorAll('div,...') ile taramak (binlerce
   * öge × getComputedStyle) ağır SPA'larda (chromewebstore/YouTube) renderer'ı
   * kilitliyordu - ölçüldü. Artık yalnız body'nin ~onlarca doğrudan çocuğu +
   * <dialog>'lar taranıyor. Örtü buraya eklendiği için kapsam aynı, maliyet cüzi.
   */
  function tara() {
    try {
      var b = document.body;
      if (!b) return;
      var bulundu = false;
      var c = b.children;
      for (var i = 0; i < c.length; i++) {
        if (ortuMu(c[i])) { kaldir(c[i]); bulundu = true; }
      }
      var dlg = document.getElementsByTagName('dialog');
      for (var k = 0; k < dlg.length; k++) {
        if (ortuMu(dlg[k])) { kaldir(dlg[k]); bulundu = true; }
      }
      if (bulundu) kaydirmayiAc();
    } catch (e) { /* geç */ }
  }

  try {
    /*
     * Gözlemci DEBOUNCE'LU ve SINIRLI. Her mutasyonda tam tarama yapmak yerine
     * eklenen düğümün KENDİSİNİ ucuz kontrol ediyor (alt ağaç taraması YOK) ve
     * tam taramayı en çok ~600 ms'de bir, toplam EN_COK kez planlıyor. Duvar
     * yükleme çevresinde çıkar; sonrasında gözlemci kendini kapatıyor ki uzun
     * ömürlü SPA'da sonsuza dek CPU yemesin.
     */
    var taramaBekliyor = false, taramaSayisi = 0;
    var EN_COK = 20;
    var gozlemci = null;
    function taraPlanla() {
      if (taramaBekliyor || taramaSayisi >= EN_COK) return;
      taramaBekliyor = true;
      setTimeout(function () {
        taramaBekliyor = false; taramaSayisi++;
        tara();
        if (taramaSayisi >= EN_COK && gozlemci) { try { gozlemci.disconnect(); } catch (e) { /* geç */ } }
      }, 600);
    }
    gozlemci = new MutationObserver(function (kayitlar) {
      for (var i = 0; i < kayitlar.length; i++) {
        var ekli = kayitlar[i].addedNodes;
        for (var j = 0; j < ekli.length; j++) {
          var d = ekli[j];
          if (d.nodeType === 1 && ortuMu(d)) { kaldir(d); kaydirmayiAc(); }
        }
      }
      taraPlanla();   // tam tarama debounce'lu + sınırlı
    });
    var basla = function () {
      if (document.documentElement) {
        gozlemci.observe(document.documentElement, { childList: true, subtree: true });
      }
      tara();
    };
    if (document.documentElement) basla();
    else document.addEventListener('readystatechange', basla, { once: true });
    // Örtü çoğunlukla window load'da çıkıyor; birkaç kez daha (ucuz) tara.
    window.addEventListener('DOMContentLoaded', function () { tara(); });
    window.addEventListener('load', function () {
      tara();
      setTimeout(tara, 600);
      setTimeout(tara, 1600);
    });
  } catch (e) { /* observer yoksa yalnızca proaktif katman kalır */ }
}

const ANA_DUNYA_KODU = '(' + anaDunyaKodu.toString() + ')();';

/*
 * PRELOAD DOSYASI ÜRETİLİYOR, REQUIRE EDİLMİYOR.
 *
 * session.setPreloads ile eklenen preload, sekmelerle aynı sandbox'ta çalışıyor
 * ve ölçüldü: sandbox preload'da require('electron') çalışır ama yerel bir
 * modülü (require('./anti-adblock')) "module not found" ile reddeder. O yüzden
 * ana dünya kodu preload'ın İÇİNE gömülüyor; preload yalnızca electron'a
 * dayanıyor. Kaynak yine burada kalıp test edilebiliyor, main.js çalışma
 * anında bu metni diske yazıp setPreloads'a veriyor.
 *
 * OTURUM PAYLAŞILIYOR (arayüz penceresi, katman, newtab); preload yalnızca üst
 * çerçeve http/https sayfalarında çalışır.
 */
/**
 * @param {string} [kurulumKodu]  betikler.anaDunyaKurulumKodu() - STATİK kurulum:
 *   kütüphaneyi + window.__pusulaBetikCalistir'ı sayfaya kurar (kural GÖMMEDEN).
 *   Verilirse, o host'a ait eşleşmeler ana süreçten sendSync ile alınıp yalnız
 *   onlar çalıştırılır. Böylece her sayfaya tüm kural kümesi (~590 KB) gömülmüyor.
 */
function preloadKaynagi(kurulumKodu) {
  const gövde = [
    "'use strict';",
    "const { webFrame, ipcRenderer } = require('electron');",
    'try {',
    "  if (window.top === window && /^https?:$/.test(location.protocol)) {",
    '    // false = ana dünya (izole dünya değil).',
    '    webFrame.executeJavaScript(' + JSON.stringify(ANA_DUNYA_KODU) + ', false);'
  ];
  if (kurulumKodu) {
    // ÖNCE eşleşmeleri sor; YALNIZCA eşleşme varsa kütüphaneyi kur ve çalıştır.
    // Böylece scriptlet'i olmayan sayfalar (çoğu) hiç kütüphane parse etmiyor.
    gövde.push(
      '    var __m = null;',
      "    try { __m = ipcRenderer.sendSync('betik:coz', location.hostname); } catch (e) { __m = null; }",
      '    if (__m && __m.length) {',
      '      webFrame.executeJavaScript(' + JSON.stringify(kurulumKodu) + ', false);',
      "      webFrame.executeJavaScript('window.__pusulaBetikCalistir&&window.__pusulaBetikCalistir(' + JSON.stringify(__m) + ')', false);",
      '    }'
    );
  }
  gövde.push(
    '  }',
    '} catch (e) {',
    "  try { console.debug('anti-adblock preload:', e && e.message); } catch (_) { /* geç */ }",
    '}',
    ''
  );
  return gövde.join('\n');
}

module.exports = { anaDunyaKodu, ANA_DUNYA_KODU, preloadKaynagi };
