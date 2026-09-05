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
function setConstant(H, zincir, hamDeğer) {
  if (!zincir) return;
  var değer = H.sabit(hamDeğer);
  if (değer === H.GEÇERSİZ) return;
  var sahip = window, parçalar = String(zincir).split('.'), özellik = parçalar.pop();
  for (var i = 0; i < parçalar.length; i++) { sahip = sahip[parçalar[i]]; if (sahip == null) return; }
  try {
    Object.defineProperty(sahip, özellik, {
      get: function () { return değer; },
      set: function () { /* sabit tutuluyor */ }, configurable: true
    });
  } catch (e) { /* geç */ }
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
  var budanacak = String(hamBudanacak || '').split(/\s+/).filter(Boolean);
  var iğneler = String(hamİğne || '').split(/\s+/).filter(Boolean);
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

/*
 * ORTAK YARDIMCI (H) - fabrika olarak yazılıyor ki ana dünyada çağrılıp taze bir
 * H üretsin. Buradaki her şey enjekte edilen demete gömülür.
 */
function yardımcıFabrika() {
  'use strict';
  var H = {
    GEÇERSİZ: {},
    _yutulan: null,
    re: function (s) {
      if (s === undefined || s === null || s === '') return null;
      s = String(s);
      if (s.length > 2 && s.charAt(0) === '/' && s.charAt(s.length - 1) === '/') {
        try { return new RegExp(s.slice(1, -1)); } catch (e) { return null; }
      }
      return new RegExp(s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
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
  'nowebrtc': nowebrtc
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
  'nowebrtc': 'nowebrtc'
};

function kanonik(ad) { return TAKMA[ad] || ad; }

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

  ekle(kural) {
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

    if (!KİTAPLIK[kanonik(ad)]) return;   // desteklenmeyen scriptlet: sessizce atla
    const giriş = { ad: kanonik(ad), argümanlar: argümanlar || [] };
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
 * Ana dünyada, gömülü kuralları location.hostname'e göre çözüp çalıştıran demet.
 * Eşleştirme (alanUyar/varlık deseni) burada BAĞIMSIZ olarak yeniden yazılıyor:
 * demet preload'un dışına, sayfanın ana dünyasına geçtiği için hiçbir modüle
 * erişemez. Node tarafındaki kozmetik.alanUyar ile aynı anlamı taşımalı.
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
  yardımcıFabrika,
  KİTAPLIK,
  TAKMA,
  YERLEŞİK,
  yerleşikDepo
};
