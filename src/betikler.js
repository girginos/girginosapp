'use strict';

/*
 * SCRIPTLET (uBO "+js(...)") MOTORU.
 *
 * Kozmetik CSS bir kutuyu gizler; scriptlet ise sayfanın KENDİ JavaScript'ine
 * karışır: bir değişkeni sabitler, bir script'i erkenden düşürür, bir zamanlayıcıyı
 * etkisiz kılar. Anti-adblock duvarlarının çoğu tam olarak böyle kırılır - örneğin
 * blackhatworld.com'un kuralı "##+js(acs, navigator.userAgent, AdBlockOn)": UA'yı
 * okuyan ve metninde "AdBlockOn" geçen script'i, o script çalışmadan düşür.
 *
 * uBlock Origin scriptlet'lerini bu motor sadeleştirilmiş ama ANLAMCA SADIK biçimde
 * yeniden yazar. Her scriptlet sayfanın ANA DÜNYASINA, sayfanın kendi script'lerinden
 * ÖNCE giren bir demetin içinde çalışır (bkz. anti-adblock preload kanalı). Bu erken
 * zamanlama scriptlet'in bütün noktası: acs/aopr geç enjekte edilirse hedef script çoktan
 * çalışmış olur.
 *
 * DÜRÜST KAPSAM: uBO'da ~150 scriptlet var; burada en yaygın ~12'si. Karşılanmayan bir
 * scriptlet adı sessizce atlanıyor (kural düşürülüyor), yanlış çalıştırılmıyor. Amaç uBO
 * paritesi değil, gerçek listelerdeki scriptlet kurallarının büyük çoğunluğunu doğru
 * uygulamak.
 */

// Kozmetikle aynı alan-eşleştirme mantığı (alan.com / alan.* / ~istisna).
const { alanUyar } = require('./kozmetik');

/* =========================================================================
 * 1) KÜTÜPHANE - ANA DÜNYADA çalışacak scriptlet gerçeklemeleri.
 *
 * Fonksiyon olarak yazılıyor ki burada söz dizimi denetlensin ve toString() ile
 * enjekte edilen demete gömülebilsin. Her biri ilk argüman olarak ortak yardımcı
 * "H"yi alır; gerisi kuralın argümanlarıdır. Fonksiyonlar KENDİ İÇİNDE KAPALI
 * olmalı - yalnızca H'ye ve tarayıcı global'lerine dokunabilir.
 * ========================================================================= */

// abort-current-script / acs / abort-current-inline-script / acis
function acs(H, zincir, iğne, bağlam) {
  if (!zincir) return;
  var reIğne = H.re(iğne);
  var reBağlam = H.re(bağlam);
  var sahip = window;
  var parçalar = String(zincir).split('.');
  var özellik = parçalar.pop();
  for (var i = 0; i < parçalar.length; i++) {
    sahip = sahip[parçalar[i]];
    if (sahip === undefined || sahip === null) return;
  }
  var tanım = Object.getOwnPropertyDescriptor(sahip, özellik);
  if (tanım && tanım.get && tanım.get.__pusula) return;   // zaten kurulu
  var değer;
  if (tanım && 'value' in tanım) değer = tanım.value;
  else { try { değer = sahip[özellik]; } catch (e) { değer = undefined; } }

  var büyü = 'pusula_' + H.rastgele();
  var eşleşme = function () {
    var cs = document.currentScript;
    if (!cs) return false;
    var metin = '';
    try { metin = cs.src ? cs.src : (cs.textContent || ''); } catch (e) { return false; }
    if (reBağlam && cs.src && !reBağlam.test(cs.src)) return false;
    return reIğne ? reIğne.test(metin) : true;
  };
  var getir = function () {
    if (eşleşme()) throw new ReferenceError(büyü);
    return değer;
  };
  getir.__pusula = true;
  try {
    Object.defineProperty(sahip, özellik, {
      get: getir, set: function (v) { değer = v; }, configurable: true
    });
  } catch (e) { return; }
  H.hatayıYut(büyü);
}

// abort-on-property-read / aopr
function aopr(H, zincir) {
  if (!zincir) return;
  var sahip = window, parçalar = String(zincir).split('.'), özellik = parçalar.pop();
  for (var i = 0; i < parçalar.length; i++) { sahip = sahip[parçalar[i]]; if (sahip == null) return; }
  var büyü = 'pusula_' + H.rastgele();
  try {
    Object.defineProperty(sahip, özellik, {
      get: function () { throw new ReferenceError(büyü); },
      set: function () {}, configurable: true
    });
    H.hatayıYut(büyü);
  } catch (e) { /* geç */ }
}

// abort-on-property-write / aopw
function aopw(H, zincir) {
  if (!zincir) return;
  var sahip = window, parçalar = String(zincir).split('.'), özellik = parçalar.pop();
  for (var i = 0; i < parçalar.length; i++) { sahip = sahip[parçalar[i]]; if (sahip == null) return; }
  var büyü = 'pusula_' + H.rastgele();
  try {
    Object.defineProperty(sahip, özellik, {
      get: function () { return undefined; },
      set: function () { throw new ReferenceError(büyü); }, configurable: true
    });
    H.hatayıYut(büyü);
  } catch (e) { /* geç */ }
}

// set-constant / set
/*
 * TEMBEL ZİNCİR. "ytInitialPlayerResponse.playerAds" gibi bir zincirde ara
 * nesne enjeksiyon anında HENÜZ YOKTUR (sayfa script'i sonra oluşturur). Eski
 * sürüm zinciri hevesle yürüyüp ara nesne yoksa pes ediyordu; YouTube'da hiçbir
 * şey yapmıyordu. Şimdi ara segmentlere setter konuyor: sayfa o nesneyi
 * atadığında araya girip son özelliği sabitliyoruz - reklam verisi okunduğunda
 * sabit dönüyor. uBO'nun yaklaşımı.
 */
function setConstant(H, zincir, hamDeğer) {
  if (!zincir) return;
  var değer = H.sabit(hamDeğer);
  if (değer === H.GEÇERSİZ) return;
  var parçalar = String(zincir).split('.');

  function sabitle(sahip, özellik) {
    try {
      var d = Object.getOwnPropertyDescriptor(sahip, özellik);
      if (d && d.get && d.get.__pusula) return;         // zaten kurulu
      var g = function () { return değer; };
      g.__pusula = true;
      Object.defineProperty(sahip, özellik, {
        get: g, set: function () { /* sabit */ }, configurable: true
      });
    } catch (e) { /* geç */ }
  }

  function uygula(sahip, i) {
    if (sahip == null) return;
    var özellik = parçalar[i];
    if (i === parçalar.length - 1) { sabitle(sahip, özellik); return; }

    var mevcut = sahip[özellik];
    if (mevcut != null && (typeof mevcut === 'object' || typeof mevcut === 'function')) {
      uygula(mevcut, i + 1);                              // ara nesne zaten var
      return;
    }
    // Ara nesne yok: atandığı anda araya gir.
    var devam = function (v) { uygula(v, i + 1); };
    try {
      var d = Object.getOwnPropertyDescriptor(sahip, özellik);
      if (d && d.set && d.set.__pusulaAra) {
        /*
         * BU (sahip, özellik) için ara setter ZATEN var (aynı nesneye başka bir
         * set kuralı - ör. ytInitialPlayerResponse.playerAds + .adPlacements +
         * .adSlots). Erken çıkarsak yalnız ilk kural işler; onun yerine devam
         * işlevimizi ekliyoruz. Değer atanmışsa hemen uygula.
         */
        d.set.__devam.push(devam);
        if (d.get && d.get.__deger != null) devam(d.get.__deger);
        return;
      }
      var saklanan = mevcut;
      var devamlar = [devam];
      var g = function () { return saklanan; };
      g.__deger = saklanan;
      var st = function (v) {
        saklanan = v; g.__deger = v;
        if (v != null && (typeof v === 'object' || typeof v === 'function')) {
          for (var k = 0; k < devamlar.length; k++) { try { devamlar[k](v); } catch (e) { /* geç */ } }
        }
      };
      st.__pusulaAra = true;
      st.__devam = devamlar;
      Object.defineProperty(sahip, özellik, { get: g, set: st, configurable: true });
    } catch (e) { /* geç */ }
  }

  uygula(window, 0);
}

// no-setInterval-if / nosiif / setInterval-defuser
function noSetIntervalIf(H, iğne, hamGecikme) {
  var değil = false, i2 = iğne;
  if (i2 && i2.charAt(0) === '!') { değil = true; i2 = i2.slice(1); }
  var re = H.re(i2);
  var gecikme = (hamGecikme !== undefined && hamGecikme !== '') ? parseInt(hamGecikme, 10) : NaN;
  var orij = window.setInterval;
  if (typeof orij !== 'function') return;
  window.setInterval = function (cb, t) {
    try {
      var kaynak = (typeof cb === 'function') ? cb.toString() : String(cb);
      var mİğne = re ? re.test(kaynak) : true;
      if (değil) mİğne = !mİğne;
      var mGecikme = isNaN(gecikme) ? true : (Number(t) === gecikme);
      if (mİğne && mGecikme) return 0;   // zamanlayıcı hiç kurulmaz
    } catch (e) { /* geç */ }
    return orij.apply(this, arguments);
  };
}

// no-setTimeout-if / nostif / setTimeout-defuser
function noSetTimeoutIf(H, iğne, hamGecikme) {
  var değil = false, i2 = iğne;
  if (i2 && i2.charAt(0) === '!') { değil = true; i2 = i2.slice(1); }
  var re = H.re(i2);
  var gecikme = (hamGecikme !== undefined && hamGecikme !== '') ? parseInt(hamGecikme, 10) : NaN;
  var orij = window.setTimeout;
  if (typeof orij !== 'function') return;
  window.setTimeout = function (cb, t) {
    try {
      var kaynak = (typeof cb === 'function') ? cb.toString() : String(cb);
      var mİğne = re ? re.test(kaynak) : true;
      if (değil) mİğne = !mİğne;
      var mGecikme = isNaN(gecikme) ? true : (Number(t) === gecikme);
      if (mİğne && mGecikme) return 0;
    } catch (e) { /* geç */ }
    return orij.apply(this, arguments);
  };
}

// json-prune
function jsonPrune(H, hamBudanacak, hamİğne) {
  // "important" bir yol değil, uBO değiştiricisi; ayıkla (yoksa yol sanılır).
  var atla = { important: 1 };
  var budanacak = String(hamBudanacak || '').split(/\s+/).filter(function (p) { return p && !atla[p]; });
  var iğneler = String(hamİğne || '').split(/\s+/).filter(function (p) { return p && !atla[p]; });
  if (!budanacak.length) return;
  var buda = function (o) {
    if (!o || typeof o !== 'object') return o;
    if (iğneler.length) {
      var varMı = false;
      for (var i = 0; i < iğneler.length; i++) { if (H.yolVar(o, iğneler[i])) { varMı = true; break; } }
      if (!varMı) return o;
    }
    for (var j = 0; j < budanacak.length; j++) H.yolSil(o, budanacak[j]);
    return o;
  };
  var oP = JSON.parse;
  JSON.parse = function () { var r = oP.apply(this, arguments); try { return buda(r); } catch (e) { return r; } };
  try {
    if (window.Response && Response.prototype.json) {
      var oj = Response.prototype.json;
      Response.prototype.json = function () {
        return oj.apply(this, arguments).then(function (r) { try { return buda(r); } catch (e) { return r; } });
      };
    }
  } catch (e) { /* geç */ }
}

// remove-attr / ra
function removeAttr(H, hamNitelik, seçici, hamDavranış) {
  var nitelikler = String(hamNitelik || '').split(/\s*\|\s*/).filter(Boolean);
  if (!nitelikler.length) return;
  var sel = seçici || ('[' + nitelikler.join('],[') + ']');
  H.periyodik(function () {
    var els; try { els = document.querySelectorAll(sel); } catch (e) { return; }
    for (var i = 0; i < els.length; i++) {
      for (var j = 0; j < nitelikler.length; j++) {
        try { els[i].removeAttribute(nitelikler[j]); } catch (e) { /* geç */ }
      }
    }
  }, hamDavranış);
}

// remove-class / rc
function removeClass(H, hamSınıf, seçici, hamDavranış) {
  var sınıflar = String(hamSınıf || '').split(/\s*\|\s*/).filter(Boolean);
  if (!sınıflar.length) return;
  var sel = seçici || ('.' + sınıflar.join(',.'));
  H.periyodik(function () {
    var els; try { els = document.querySelectorAll(sel); } catch (e) { return; }
    for (var i = 0; i < els.length; i++) {
      for (var j = 0; j < sınıflar.length; j++) {
        try { els[i].classList.remove(sınıflar[j]); } catch (e) { /* geç */ }
      }
    }
  }, hamDavranış);
}

// no-fetch-if
function noFetchIf(H, hamKoşul) {
  var koşullar = H.propKoşul(hamKoşul);
  var oF = window.fetch;
  if (typeof oF !== 'function') return;
  window.fetch = function (girdi, ayar) {
    try {
      var url = (typeof girdi === 'string') ? girdi : (girdi && girdi.url) || '';
      var yöntem = (ayar && ayar.method) || (girdi && girdi.method) || 'GET';
      if (H.fetchEşleşir(koşullar, url, yöntem)) {
        return Promise.resolve(new Response('', { status: 200, statusText: 'OK' }));
      }
    } catch (e) { /* geç */ }
    return oF.apply(this, arguments);
  };
}

// nowebrtc
function nowebrtc(H) {
  try {
    var boş = function () { throw new Error('WebRTC kapalı'); };
    ['RTCPeerConnection', 'webkitRTCPeerConnection', 'mozRTCPeerConnection'].forEach(function (ad) {
      if (window[ad]) {
        try { Object.defineProperty(window, ad, { value: boş, writable: false, configurable: true }); }
        catch (e) { window[ad] = boş; }
      }
    });
  } catch (e) { /* geç */ }
}

// addEventListener-defuser / aeld
function aeld(H, tur, desen) {
  var reTur = H.re(tur), reDesen = H.re(desen);
  var orij = EventTarget.prototype.addEventListener;
  if (typeof orij !== 'function') return;
  EventTarget.prototype.addEventListener = function (t, dinleyici, sec) {
    try {
      var kaynak = '';
      try {
        kaynak = (typeof dinleyici === 'function') ? dinleyici.toString()
          : (dinleyici && dinleyici.handleEvent ? String(dinleyici.handleEvent) : String(dinleyici));
      } catch (e) { /* geç */ }
      var mTur = reTur ? reTur.test(String(t)) : true;
      var mDesen = reDesen ? reDesen.test(kaynak) : true;
      if (mTur && mDesen) return;   // dinleyici hiç eklenmez
    } catch (e) { /* geç */ }
    return orij.call(this, t, dinleyici, sec);
  };
}

// no-window-open-if / nowoif
function noWindowOpenIf(H, desen) {
  var değil = false, d = desen;
  if (d && d.charAt(0) === '!') { değil = true; d = d.slice(1); }
  var re = H.re(d);
  var orij = window.open;
  if (typeof orij !== 'function') return;
  function sahtePencere() {
    var noop = function () {};
    return {
      closed: false, close: function () { this.closed = true; }, focus: noop, blur: noop,
      postMessage: noop, moveTo: noop, resizeTo: noop,
      document: { write: noop, writeln: noop, open: noop, close: noop },
      location: { href: 'about:blank', assign: noop, replace: noop, reload: noop }
    };
  }
  window.open = function (url) {
    try {
      var u = String(url || '');
      var m = re ? re.test(u) : true;
      if (değil) m = !m;
      if (m) return sahtePencere();   // site dönen değeri kullanıyorsa kırılmasın
    } catch (e) { /* geç */ }
    return orij.apply(this, arguments);
  };
}

// no-xhr-if
function noXhrIf(H, hamKoşul) {
  var koşullar = H.propKoşul(hamKoşul);
  var Orij = window.XMLHttpRequest;
  if (typeof Orij !== 'function') return;
  function Sarmal() {
    var xhr = new Orij();
    var eşleşti = false;
    var acOrij = xhr.open;
    xhr.open = function (yöntem, url) {
      try { eşleşti = H.fetchEşleşir(koşullar, String(url || ''), String(yöntem || 'GET')); }
      catch (e) { eşleşti = false; }
      return acOrij.apply(xhr, arguments);
    };
    var gonderOrij = xhr.send;
    xhr.send = function () {
      if (!eşleşti) return gonderOrij.apply(xhr, arguments);
      // Eşleşti: gerçek istek gitmez, boş ama başarılı bir yanıt taklit edilir.
      try {
        Object.defineProperty(xhr, 'readyState', { value: 4, configurable: true });
        Object.defineProperty(xhr, 'status', { value: 200, configurable: true });
        Object.defineProperty(xhr, 'responseText', { value: '', configurable: true });
        Object.defineProperty(xhr, 'response', { value: '', configurable: true });
      } catch (e) { /* getter'lar sabit olabilir; yine de istek gitmedi */ }
      var ateşle = function () {
        try { if (typeof xhr.onreadystatechange === 'function') xhr.onreadystatechange(); } catch (e) { /* geç */ }
        try { xhr.dispatchEvent(new Event('readystatechange')); } catch (e) { /* geç */ }
        try { xhr.dispatchEvent(new Event('load')); } catch (e) { /* geç */ }
        try { xhr.dispatchEvent(new Event('loadend')); } catch (e) { /* geç */ }
      };
      setTimeout(ateşle, 1);
    };
    return xhr;
  }
  Sarmal.prototype = Orij.prototype;
  try { window.XMLHttpRequest = Sarmal; } catch (e) { /* geç */ }
}

// set-local-storage-item
function setLocalStorageItem(H, anahtar, hamDeğer) {
  if (!anahtar) return;
  var değer = H.depoDeğeri(hamDeğer);
  if (değer === H.GEÇERSİZ) return;
  try {
    if (değer === H.SIL) window.localStorage.removeItem(anahtar);
    else window.localStorage.setItem(anahtar, değer);
  } catch (e) { /* geç */ }
}

// href-sanitizer: izleme sarmalı bağlantıları gerçek adresine indir.
function hrefSanitizer(H, seçici, kaynak) {
  if (!seçici) return;
  kaynak = kaynak || 'text';
  function çöz(a) {
    try {
      var yeni = '';
      if (kaynak === 'text') yeni = (a.textContent || '').trim();
      else if (kaynak.charAt(0) === '?') { try { yeni = new URL(a.href).searchParams.get(kaynak.slice(1)) || ''; } catch (e) { /* geç */ } }
      else if (kaynak.charAt(0) === '[') yeni = a.getAttribute(kaynak.slice(1, -1)) || '';
      if (yeni && /^https?:\/\//i.test(yeni)) a.setAttribute('href', yeni);
    } catch (e) { /* geç */ }
  }
  H.periyodik(function () {
    var els; try { els = document.querySelectorAll(seçici); } catch (e) { return; }
    for (var i = 0; i < els.length; i++) if (els[i].tagName === 'A') çöz(els[i]);
  });
}

// cookie-remover / remove-cookie
function cookieRemover(H, desen) {
  var re = H.re(desen);
  function sil() {
    try {
      var cs = document.cookie ? document.cookie.split(';') : [];
      for (var i = 0; i < cs.length; i++) {
        var ad = cs[i].split('=')[0].trim();
        if (!ad || (re && !re.test(ad))) continue;
        var alanlar = [location.hostname, '.' + location.hostname];
        document.cookie = ad + '=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/';
        for (var a = 0; a < alanlar.length; a++) {
          document.cookie = ad + '=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/; domain=' + alanlar[a];
        }
      }
    } catch (e) { /* geç */ }
  }
  sil();
  try { window.addEventListener('load', sil); } catch (e) { /* geç */ }
  try { var g = setInterval(sil, 1000); setTimeout(function () { clearInterval(g); }, 10000); } catch (e) { /* geç */ }
}

// noeval-if / noeval
function noEvalIf(H, desen) {
  var re = H.re(desen);
  var orij = window.eval;
  if (typeof orij !== 'function') return;
  // Not: yalnızca window.eval(...) (dolaylı eval) sarılabilir; sayfanın kendi
  // kapsamındaki doğrudan eval() etkilenmez - uBO'da da aynı sınır.
  try {
    window.eval = function (kod) {
      try { if (re ? re.test(String(kod)) : true) return undefined; } catch (e) { /* geç */ }
      return orij.apply(this, arguments);
    };
  } catch (e) { /* geç */ }
}

// remove-node-text / rmnt
function removeNodeText(H, düğümAdı, desen) {
  var reAd = H.re(düğümAdı);
  var reDesen = H.re(desen);
  function temizle() {
    try {
      if (!document.body) return;
      var yürü = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);
      var n, sil = [];
      while ((n = yürü.nextNode())) {
        var eb = n.parentNode;
        if (!eb) continue;
        if (reAd && !reAd.test(eb.nodeName)) continue;
        if (reDesen && !reDesen.test(n.textContent)) continue;
        sil.push(n);
      }
      for (var i = 0; i < sil.length; i++) sil[i].textContent = '';
    } catch (e) { /* geç */ }
  }
  H.periyodik(temizle);
}

/*
 * trusted-replace-fetch-response: eşleşen fetch YANITININ metninde desen->karşılık
 * değiştirir. YouTube'un asıl güncel reklam yöntemi bu: player API yanıtındaki
 * "adPlacements" -> "no_ads". "trusted" çünkü yanıt gövdesini yeniden yazar;
 * yalnızca güvendiğimiz kaynaklardan (uBO resmi listeleri + yerleşik) geliyor.
 */
function trustedReplaceFetchResponse(H, hamDesen, karşılık, hamKoşul) {
  var re = H.reGenel(hamDesen);
  if (karşılık === undefined) karşılık = '';
  var koşullar = H.propKoşul(hamKoşul);
  var oF = window.fetch;
  if (typeof oF !== 'function') return;
  window.fetch = function (girdi, ayar) {
    var url = '';
    try { url = (typeof girdi === 'string') ? girdi : (girdi && girdi.url) || ''; } catch (e) { /* geç */ }
    var yöntem = (ayar && ayar.method) || (girdi && girdi.method) || 'GET';
    var uygun = true;
    try { uygun = H.fetchEşleşir(koşullar, url, yöntem); } catch (e) { uygun = false; }
    var p = oF.apply(this, arguments);
    if (!uygun || !re) return p;
    return p.then(function (yanıt) {
      try {
        return yanıt.clone().text().then(function (metin) {
          var yeni;
          try { yeni = metin.replace(re, karşılık); } catch (e) { return yanıt; }
          if (yeni === metin) return yanıt;
          var y2 = new Response(yeni, { status: yanıt.status, statusText: yanıt.statusText, headers: yanıt.headers });
          try { Object.defineProperty(y2, 'url', { value: yanıt.url }); } catch (e) { /* geç */ }
          return y2;
        }).catch(function () { return yanıt; });
      } catch (e) { return yanıt; }
    });
  };
}

/*
 * ORTAK YARDIMCI (H) - fabrika olarak yazılıyor ki ana dünyada çağrılıp taze bir
 * H üretsin. Buradaki her şey enjekte edilen demete gömülür.
 */
function yardımcıFabrika() {
  'use strict';
  var H = {
    GEÇERSİZ: {},
    SIL: {},          // set-local-storage-item için "$remove$" işareti
    _yutulan: null,
    re: function (s) {
      if (s === undefined || s === null || s === '') return null;
      s = String(s);
      if (s.length > 2 && s.charAt(0) === '/' && s.charAt(s.length - 1) === '/') {
        try { return new RegExp(s.slice(1, -1)); } catch (e) { return null; }
      }
      return new RegExp(s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    },
    // Bayrakları KORUYAN regex (trusted-replace için: /"adPlacements.../gms).
    // Düz metin verilirse kaçırılıp yalnız ilk eşleşme değişir (uBO string davranışı).
    reGenel: function (s) {
      if (s === undefined || s === null || s === '') return null;
      s = String(s);
      var m = /^\/(.*)\/([a-z]*)$/s.exec(s);
      if (m) { try { return new RegExp(m[1], m[2]); } catch (e) { return null; } }
      try { return new RegExp(s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')); } catch (e) { return null; }
    },
    // set-local-storage-item değer eşlemesi.
    depoDeğeri: function (ham) {
      var s = String(ham);
      if (s === '$remove$') return this.SIL;
      switch (s) {
        case 'true': case 'false': case 'yes': case 'no':
        case 'on': case 'off': case '': return s;
        case 'emptyArr': return '[]';
        case 'emptyObj': return '{}';
        case 'undefined': case 'null': return s;
        default:
          if (/^-?\d+(\.\d+)?$/.test(s)) return s;
          return this.GEÇERSİZ;
      }
    },
    rastgele: function () { return Math.floor(Math.random() * 1e9).toString(36) + Date.now().toString(36); },
    hatayıYut: function (büyü) {
      var self = this;
      if (!this._yutulan) {
        this._yutulan = {};
        window.addEventListener('error', function (ev) {
          var m = ev && ev.error && ev.error.message;
          if (m && self._yutulan[m]) { ev.preventDefault(); ev.stopImmediatePropagation(); return false; }
        }, true);
      }
      this._yutulan[büyü] = true;
    },
    sabit: function (ham) {
      switch (String(ham)) {
        case 'true': return true;
        case 'false': return false;
        case 'null': return null;
        case 'undefined': return undefined;
        case '': return '';
        case 'noopFunc': return function () {};
        case 'trueFunc': return function () { return true; };
        case 'falseFunc': return function () { return false; };
        case 'emptyArr': return [];
        case 'emptyObj': return {};
        default:
          if (/^-?\d+(\.\d+)?$/.test(String(ham))) return Number(ham);
          return this.GEÇERSİZ;   // tanınmayan değer: property'yi bozma
      }
    },
    // "a.b.c" yolunu izleyerek son sahibi + anahtarı döndürür (yoksa null).
    _yol: function (o, yol) {
      var p = String(yol).split('.');
      var son = p.pop();
      for (var i = 0; i < p.length; i++) {
        if (o == null || typeof o !== 'object') return null;
        o = p[i] === '*' ? o : o[p[i]];   // tek düzey joker desteklenmez, aynen geç
      }
      return (o && typeof o === 'object') ? { sahip: o, anahtar: son } : null;
    },
    yolVar: function (o, yol) { var r = this._yol(o, yol); return !!(r && (r.anahtar in r.sahip)); },
    yolSil: function (o, yol) { var r = this._yol(o, yol); if (r) { try { delete r.sahip[r.anahtar]; } catch (e) { /* geç */ } } },
    // "url:reklam method:GET" -> [{ad:'url', re:/reklam/}, ...]
    propKoşul: function (ham) {
      var out = [];
      String(ham || '').split(/\s+/).forEach(function (parça) {
        var i = parça.indexOf(':');
        if (i === -1) { if (parça) out.push({ ad: 'url', re: H.re(parça) }); return; }
        out.push({ ad: parça.slice(0, i), re: H.re(parça.slice(i + 1)) });
      });
      return out;
    },
    fetchEşleşir: function (koşullar, url, yöntem) {
      if (!koşullar.length) return true;
      for (var i = 0; i < koşullar.length; i++) {
        var k = koşullar[i];
        var hedef = k.ad === 'method' ? String(yöntem) : String(url);
        if (k.re && !k.re.test(hedef)) return false;
      }
      return true;
    },
    // DOM üstünde bir işi tekrar tekrar çalıştır: yükleme + mutasyon + birkaç zaman.
    periyodik: function (iş, davranış) {
      var self = this;
      var çalış = function () { try { iş(); } catch (e) { /* geç */ } };
      var başla = function () {
        çalış();
        try {
          var g = new MutationObserver(function () { çalış(); });
          g.observe(document.documentElement || document, { childList: true, subtree: true, attributes: true });
        } catch (e) { /* observer yoksa zamanlı geç */ }
      };
      if (document.documentElement) başla();
      else document.addEventListener('readystatechange', başla, { once: true });
      window.addEventListener('DOMContentLoaded', çalış);
      window.addEventListener('load', function () { çalış(); setTimeout(çalış, 500); setTimeout(çalış, 1500); });
    }
  };
  return H;
}

/*
 * KÜTÜPHANE HARİTASI: kanonik ad -> fonksiyon. Adlar uBO'nun uzun adları; kısa
 * adlar (acs, aopr...) TAKMA ile buraya yönlendirilir.
 */
const KİTAPLIK = {
  'abort-current-script': acs,
  'abort-on-property-read': aopr,
  'abort-on-property-write': aopw,
  'set-constant': setConstant,
  'no-setInterval-if': noSetIntervalIf,
  'no-setTimeout-if': noSetTimeoutIf,
  'json-prune': jsonPrune,
  'remove-attr': removeAttr,
  'remove-class': removeClass,
  'no-fetch-if': noFetchIf,
  'nowebrtc': nowebrtc,
  'addEventListener-defuser': aeld,
  'no-window-open-if': noWindowOpenIf,
  'no-xhr-if': noXhrIf,
  'set-local-storage-item': setLocalStorageItem,
  'href-sanitizer': hrefSanitizer,
  'cookie-remover': cookieRemover,
  'noeval-if': noEvalIf,
  'remove-node-text': removeNodeText,
  'trusted-replace-fetch-response': trustedReplaceFetchResponse
};

// uBO kısa adları / eş adları -> kanonik ad.
const TAKMA = {
  'acs': 'abort-current-script',
  'abort-current-inline-script': 'abort-current-script',
  'acis': 'abort-current-script',
  'aopr': 'abort-on-property-read',
  'aopw': 'abort-on-property-write',
  'set': 'set-constant',
  'nosiif': 'no-setInterval-if',
  'setInterval-defuser': 'no-setInterval-if',
  'sid': 'no-setInterval-if',
  'nostif': 'no-setTimeout-if',
  'setTimeout-defuser': 'no-setTimeout-if',
  'std': 'no-setTimeout-if',
  'ra': 'remove-attr',
  'rc': 'remove-class',
  'nowebrtc': 'nowebrtc',
  'aeld': 'addEventListener-defuser',
  'prevent-addEventListener': 'addEventListener-defuser',
  'nowoif': 'no-window-open-if',
  'window.open-defuser': 'no-window-open-if',
  'noxhrif': 'no-xhr-if',
  'prevent-xhr': 'no-xhr-if',
  'sls': 'set-local-storage-item',
  'remove-cookie': 'cookie-remover',
  'cookie-remover': 'cookie-remover',
  'noeval': 'noeval-if',
  'prevent-eval-if': 'noeval-if',
  'rmnt': 'remove-node-text',
  'trusted-rpfr': 'trusted-replace-fetch-response'
};

// Kanonik ad: ".js" eki soyulur (bazı listeler "aeld.js" yazıyor), sonra takma çözülür.
function kanonik(ad) {
  var t = String(ad || '').replace(/\.js$/, '');
  return TAKMA[t] || t;
}

/* =========================================================================
 * 2) AYRIŞTIRICI - "[alanlar]##+js(ad, arg...)" / "[alanlar]#@#+js(...)"
 * ========================================================================= */

/*
 * "+js(...)" içindeki argümanları böler. Virgül ayraç; "\," kaçırılmış virgül,
 * gerçek argüman parçasıdır. uBO'nun kaçış kuralı. Baş/son boşluk atılır, çevreleyen
 * eşleşen tırnaklar soyulur.
 */
function argümanlarıBöl(içerik) {
  var out = [];
  var tampon = '';
  for (var i = 0; i < içerik.length; i++) {
    var c = içerik[i];
    if (c === '\\' && i + 1 < içerik.length) {
      var s = içerik[i + 1];
      if (s === ',' || s === '\\' || s === ')') { tampon += s; i++; continue; }
      tampon += c; continue;
    }
    if (c === ',') { out.push(tampon); tampon = ''; continue; }
    tampon += c;
  }
  out.push(tampon);
  return out.map(function (a) {
    a = a.trim();
    if (a.length >= 2 && ((a[0] === '"' && a.slice(-1) === '"') || (a[0] === "'" && a.slice(-1) === "'"))) {
      a = a.slice(1, -1);
    }
    return a;
  });
}

/**
 * Bir scriptlet filtre satırını çözer.
 * @returns {{tip:'betik'|'istisna', alanlar:string[], eksiler:string[], ad:string, argümanlar:string[]}|null}
 */
function betikCoz(satır) {
  // Ayraç: "#@#" (istisna) "##"dan önce denenir çünkü ikisi de "#" ile başlıyor.
  var yer = -1, tip = null;
  for (var idx = 0; idx < 2; idx++) {
    var a = idx === 0 ? '#@#' : '##';
    var i = satır.indexOf(a);
    if (i !== -1 && (yer === -1 || i < yer)) { yer = i; tip = a; }
  }
  if (yer === -1) return null;

  var gövde = satır.slice(yer + tip.length).trim();
  if (gövde.slice(0, 4) !== '+js(' || gövde.charAt(gövde.length - 1) !== ')') return null;
  var içerik = gövde.slice(4, -1);

  var parçalar = argümanlarıBöl(içerik);
  var ad = (parçalar.shift() || '').trim();
  // İstisnada boş ad ("#@#+js()") geçerli: o alanda TÜM scriptlet'leri kapat.
  if (!ad && tip !== '#@#') return null;

  var alanBölümü = satır.slice(0, yer);
  if (alanBölümü && !/^[a-z0-9.,~*_-]+$/i.test(alanBölümü)) return null;

  var alanlar = [], eksiler = [];
  alanBölümü.split(',').forEach(function (ham) {
    var d = ham.trim().toLowerCase();
    if (!d) return;
    if (d[0] === '~') { if (d.length > 1) eksiler.push(d.slice(1)); }
    else alanlar.push(d);
  });

  return {
    tip: tip === '#@#' ? 'istisna' : 'betik',
    alanlar: alanlar,
    eksiler: eksiler,
    ad: ad,
    argümanlar: parçalar.map(function (a) { return a.trim(); })
  };
}

// Bir kuralın "imzası": ad + argümanlar. İstisnaların hedef kuralı eşlemesi için.
function imza(ad, argümanlar) {
  return kanonik(ad) + '(' + (argümanlar || []).join(',') + ')';
}

/* =========================================================================
 * 3) DEPO - kozmetik depoyla aynı biçim: genel / alan / istisna / genelIstisna.
 * ========================================================================= */

class BetikDepo {
  constructor() {
    this.genel = [];               // [{ad, argümanlar, eksiler?}]
    this.alan = new Map();         // kuralAlan -> [{ad, argümanlar, eksiler?}]
    this.istisna = new Map();      // kuralAlan -> Set(imza | '*')
    this.genelIstisna = new Set(); // alan yazılmamış "#@#+js(...)"
  }

  get sayı() {
    var n = this.genel.length;
    for (var v of this.alan.values()) n += v.length;
    return n;
  }

  /**
   * @param {object} kural  betikCoz çıktısı
   * @param {boolean} [guvenilir=true]  Liste güvenilir mi? "trusted-*" scriptlet'ler
   *   yanıt gövdesini yeniden yazabildiği için YALNIZCA güvenilir (yerleşik +
   *   varsayılan uBO) listelerden çalıştırılır; kullanıcının eklediği listelerden
   *   gelirse sessizce atılır. Kötü niyetli bir özel liste trusted-replace ile
   *   sayfa yanıtlarını kurcalamasın.
   */
  ekle(kural, guvenilir = true) {
    if (!kural) return;
    const { tip, alanlar, eksiler, ad, argümanlar } = kural;

    if (tip === 'istisna') {
      // Boş ad -> o alanda TÜM scriptlet'leri kapat ('*'). Aksi halde imzayla.
      const im = ad ? imza(ad, argümanlar) : '*';
      if (!alanlar.length) { this.genelIstisna.add(im); return; }
      for (const d of alanlar) {
        if (!this.istisna.has(d)) this.istisna.set(d, new Set());
        this.istisna.get(d).add(im);
      }
      return;
    }

    const kanon = kanonik(ad);
    if (!KİTAPLIK[kanon]) return;                       // desteklenmeyen scriptlet: sessizce atla
    if (!guvenilir && kanon.indexOf('trusted-') === 0) return;  // güvenilmeyen listeden trusted scriptlet çalıştırma
    const giriş = { ad: kanon, argümanlar: argümanlar || [] };
    if (eksiler && eksiler.length) giriş.eksiler = eksiler;
    if (!alanlar.length) { this.genel.push(giriş); return; }
    for (const d of alanlar) {
      if (!this.alan.has(d)) this.alan.set(d, []);
      this.alan.get(d).push(giriş);
    }
  }

  disaAktar() {
    const seri = (liste) => liste.map((k) => (k.eksiler ? [k.ad, k.argümanlar, k.eksiler] : [k.ad, k.argümanlar]));
    const alanNesne = {};
    for (const [k, v] of this.alan) alanNesne[k] = seri(v);
    const istisnaNesne = {};
    for (const [k, v] of this.istisna) istisnaNesne[k] = [...v];
    return {
      genel: seri(this.genel),
      alan: alanNesne,
      istisna: istisnaNesne,
      genelIstisna: [...this.genelIstisna]
    };
  }

  static iceAktar(veri) {
    const d = new BetikDepo();
    if (!veri) return d;
    const coz = (liste) => (liste || []).map(
      (k) => (k.length > 2 ? { ad: k[0], argümanlar: k[1] || [], eksiler: k[2] } : { ad: k[0], argümanlar: k[1] || [] })
    );
    d.genel = coz(veri.genel);
    for (const [k, v] of Object.entries(veri.alan || {})) d.alan.set(k, coz(v));
    for (const [k, v] of Object.entries(veri.istisna || {})) d.istisna.set(k, new Set(v));
    for (const s of veri.genelIstisna || []) d.genelIstisna.add(s);
    return d;
  }

  birlestir(öteki) {
    this.genel.push(...öteki.genel);
    for (const [k, v] of öteki.alan) {
      if (!this.alan.has(k)) this.alan.set(k, []);
      this.alan.get(k).push(...v);
    }
    for (const [k, v] of öteki.istisna) {
      if (!this.istisna.has(k)) this.istisna.set(k, new Set());
      for (const s of v) this.istisna.get(k).add(s);
    }
    for (const s of öteki.genelIstisna) this.genelIstisna.add(s);
  }

  /**
   * Bu ana makine için çalışacak scriptlet'ler.
   * @returns {{ad:string, argümanlar:string[]}[]}
   */
  eslesenler(host) {
    if (!host) return [];

    const disla = new Set(this.genelIstisna);
    for (const [kuralAlan, küme] of this.istisna) {
      if (!alanUyar(kuralAlan, host)) continue;
      for (const s of küme) disla.add(s);
    }
    const hepsiKapalı = disla.has('*');

    const çıktı = [];
    const görülen = new Set();
    const kat = (liste) => {
      for (const k of liste) {
        if (hepsiKapalı) return;
        if (disla.has(imza(k.ad, k.argümanlar))) continue;
        if (k.eksiler && k.eksiler.some((d) => alanUyar(d, host))) continue;
        const anahtar = imza(k.ad, k.argümanlar);
        if (görülen.has(anahtar)) continue;   // aynı scriptlet iki kez çalışmasın
        görülen.add(anahtar);
        çıktı.push({ ad: k.ad, argümanlar: k.argümanlar });
      }
    };

    kat(this.genel);
    for (const [kuralAlan, liste] of this.alan) {
      if (alanUyar(kuralAlan, host)) kat(liste);
    }
    return çıktı;
  }
}

/* =========================================================================
 * 4) ANA DÜNYA KODU ÜRETECİ - derlenmiş depo + kütüphane + eşleştiriciyi tek
 * bir demete gömer. Demet preload'a giriyor; çalışma anında location.hostname'e
 * göre eşleşen scriptlet'leri çalıştırıyor.
 * ========================================================================= */

/*
 * Yalnızca KULLANILAN scriptlet fonksiyonlarını gömer. Her sayfaya 11 fonksiyonu
 * (~14 KB) enjekte edip ayrıştırmak boşuna: kurallarda hangi scriptlet varsa
 * yalnızca onu koyuyoruz. blackhatworld gibi tek kurallı durumda demet küçülür,
 * sayfa açılışı hafifler.
 */
function kütüphaneKaynağı(kullanılanlar) {
  const satırlar = [];
  for (const ad of Object.keys(KİTAPLIK)) {
    if (kullanılanlar && !kullanılanlar.has(ad)) continue;
    satırlar.push('  ' + JSON.stringify(ad) + ': ' + KİTAPLIK[ad].toString());
  }
  return '{\n' + satırlar.join(',\n') + '\n}';
}

// Derlenmiş depoda gerçekten geçen kanonik scriptlet adları.
function kullanılanAdlar(veri) {
  const küme = new Set();
  const topla = (liste) => { for (const k of (liste || [])) küme.add(kanonik(k[0])); };
  topla(veri.genel);
  for (const liste of Object.values(veri.alan || {})) topla(liste);
  return küme;
}

/*
 * ANA DÜNYA KURULUMU (kural GÖMMEDEN). Kütüphane + H bir kez sayfaya kurulur ve
 * window.__pusulaBetikCalistir(eslesmeler) tanımlanır. Kurallar burada DEĞİL:
 * eşleştirme ana süreçte yapılıp yalnızca O host'a ait küçük liste sendSync ile
 * geliyor. Böylece her sayfaya 4900+ kuralı (~590 KB) gömmüyoruz - o tasarım
 * çoklu sekmede belleği/CPU'yu boğup tarayıcıyı donduruyordu. Ölçüldü.
 *
 * eslesmeler: [[ad, argümanlar], ...] (ad zaten kanonik).
 */
function anaDunyaKurulumKodu() {
  const calistir = function (eslesmeler) {
    'use strict';
    if (window.__pusulaBetik) return;
    window.__pusulaBetik = 1;
    if (!/^https?:$/.test(location.protocol)) return;
    if (!eslesmeler || !eslesmeler.length) return;
    var H = window.__pusulaBetikH();
    var LIB = kütüphaneMetni;   // yer tutucu; codegen gerçek nesneyle değiştirir
    for (var i = 0; i < eslesmeler.length; i++) {
      var ad = eslesmeler[i][0];
      var args = eslesmeler[i][1] || [];
      var fn = LIB[ad];
      if (typeof fn !== 'function') continue;
      try { fn.apply(null, [H].concat(args)); } catch (e) { /* tek scriptlet çökmesi yayılmasın */ }
    }
  };
  const hKur = 'window.__pusulaBetikH = window.__pusulaBetikH || (' + yardımcıFabrika.toString() + ');';
  const calistirMetni = calistir.toString()
    .replace('var LIB = kütüphaneMetni;', 'var LIB = ' + kütüphaneKaynağı() + ';');
  return hKur + '\nwindow.__pusulaBetikCalistir = ' + calistirMetni + ';';
}

/*
 * Ana dünyada, gömülü kuralları location.hostname'e göre çözüp çalıştıran demet.
 * (ESKİ YOL - artık preload'da kullanılmıyor; kurallar 590 KB olup her sayfaya
 * gömülüyordu. Test/gerekirse diye duruyor. Yeni yol: anaDunyaKurulumKodu +
 * ana süreçte eşleştirme + sendSync.)
 */
function anaDunyaKodu(disaAktarılmış, izinli) {
  const veri = disaAktarılmış || { genel: [], alan: {}, istisna: {}, genelIstisna: [] };
  const gövde = function (RULES, TAKMA, İZİNLİ, kütüphaneMetni) {
    'use strict';
    if (window.__pusulaBetik) return;
    window.__pusulaBetik = 1;
    if (!/^https?:$/.test(location.protocol)) return;

    var LIB = kütüphaneMetni;   // yer tutucu; codegen gerçek nesneyle değiştirir
    var H = window.__pusulaBetikH();
    var host = (location.hostname || '').toLowerCase();

    // Bu sitede engelleyici kapatılmışsa (kullanıcı izin listesi) hiç çalışma.
    for (var z = 0; z < İZİNLİ.length; z++) {
      var iz = İZİNLİ[z];
      if (host === iz || host.slice(-(iz.length + 1)) === ('.' + iz)) return;
    }

    // kozmetik.alanUyar'ın ana-dünya kopyası.
    function varlıkUyar(kök, h) {
      var kaçış = kök.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      var re = new RegExp('(^|\\.)' + kaçış + '\\.[a-z]{2,}(\\.[a-z]{2,})?$');
      return re.test(h);
    }
    function alanUyar(kuralAlan, h) {
      if (kuralAlan.slice(-2) === '.*') return varlıkUyar(kuralAlan.slice(0, -2), h);
      return h === kuralAlan || h.slice(-(kuralAlan.length + 1)) === ('.' + kuralAlan);
    }
    function imza(ad, args) { return (TAKMA[ad] || ad) + '(' + (args || []).join(',') + ')'; }

    var disla = {}; var hepsiKapalı = false;
    (RULES.genelIstisna || []).forEach(function (s) { if (s === '*') hepsiKapalı = true; else disla[s] = 1; });
    for (var ka in RULES.istisna) {
      if (!alanUyar(ka, host)) continue;
      RULES.istisna[ka].forEach(function (s) { if (s === '*') hepsiKapalı = true; else disla[s] = 1; });
    }

    var çalışacak = [], görülen = {};
    function kat(liste) {
      if (!liste) return;
      for (var i = 0; i < liste.length; i++) {
        if (hepsiKapalı) return;
        var ad = liste[i][0], args = liste[i][1] || [], eksiler = liste[i][2];
        var im = imza(ad, args);
        if (disla[im]) continue;
        if (eksiler && eksiler.some(function (d) { return alanUyar(d, host); })) continue;
        if (görülen[im]) continue;
        görülen[im] = 1;
        çalışacak.push([ad, args]);
      }
    }
    kat(RULES.genel);
    for (var k in RULES.alan) { if (alanUyar(k, host)) kat(RULES.alan[k]); }

    for (var j = 0; j < çalışacak.length; j++) {
      var ad2 = TAKMA[çalışacak[j][0]] || çalışacak[j][0];
      var fn = LIB[ad2];
      if (typeof fn !== 'function') continue;
      try { fn.apply(null, [H].concat(çalışacak[j][1] || [])); } catch (e) { /* tek scriptlet çökmesi yayılmasın */ }
    }
  };

  // H fabrikasını ana dünyaya bir kez kur, sonra gövdeyi çalıştır.
  const hKur = 'window.__pusulaBetikH = window.__pusulaBetikH || (' + yardımcıFabrika.toString() + ');';
  const gövdeMetni = gövde.toString()
    // "var LIB = kütüphaneMetni;" satırını YALNIZCA kullanılan fonksiyonlarla değiştir.
    .replace('var LIB = kütüphaneMetni;', 'var LIB = ' + kütüphaneKaynağı(kullanılanAdlar(veri)) + ';');

  return hKur + '\n('
    + gövdeMetni
    + ')(' + JSON.stringify(veri) + ',' + JSON.stringify(TAKMA)
    + ',' + JSON.stringify(izinli || []) + ');';
}

/* =========================================================================
 * 5) YERLEŞİK KURALLAR - liste indirilmeden de çalışan küçük, elle seçilmiş
 * anti-adblock scriptlet kümesi. Listelerdeki aynı kural bunları güçlendirir.
 * ========================================================================= */
const YERLEŞİK = [
  // blackhatworld: UA'yı okuyup metninde "AdBlockOn" geçen script'i düşür.
  'blackhatworld.com##+js(acs, navigator.userAgent, AdBlockOn)'
];

function yerleşikDepo() {
  const d = new BetikDepo();
  for (const s of YERLEŞİK) d.ekle(betikCoz(s));
  return d;
}

module.exports = {
  BetikDepo,
  betikCoz,
  argümanlarıBöl,
  imza,
  kanonik,
  anaDunyaKodu,
  anaDunyaKurulumKodu,
  yardımcıFabrika,
  KİTAPLIK,
  TAKMA,
  YERLEŞİK,
  yerleşikDepo
};
