'use strict';

/*
 * YORDAMSAL KOZMETİK FİLTRELER (uBO/AdGuard procedural cosmetics).
 *
 * Bazı reklamlar saf CSS ile hedeflenemiyor: r10.net'in yan bannerları
 * rastgele sınıf adı taşıyor ve reklam veren dönüşümlü (ideasoft, ticimax...).
 * Onları yakalayan GENEL kural yordamsal:
 *   r10.net##.rPanel:has(> .head:contains(/^Reklam $/))
 * ":contains()" yerel CSS değil; sayfayı tarayan bir çalışma zamanı gerekiyor.
 *
 * Bu modül HEM ana süreçte (kuralı ayrıştır/doğrula) HEM sayfada (DOM'u tara,
 * eşleşeni gizle/kaldır) kullanılıyor. Ayrıştırıcı saf fonksiyon: aynı kod
 * toString() ile sayfaya da gömülüyor, böylece tek bir doğru ayrıştırıcı var.
 *
 * DESTEKLENEN operatörler: :has(), :has-text()/:contains(), :not() (yerel),
 * :upward(n|sel), :nth-ancestor(n), :matches-css(-before/-after)(prop:value),
 * :min-text-length(n); sonlandırıcı :remove() ve :style(decl) (yoksa gizle).
 * Desteklenmeyen operatör (xpath, watch-attr...) -> ayrıştırma başarısız,
 * kural GÜVENLE düşer (yordamsal olmayan kardeşlerini etkilemez).
 */

// Bölünecek yordamsal operatörler (yalnızca dışa aktarım/başvuru için;
// zincirle KENDİ kopyasını içinde tutuyor - sayfaya toString() ile gömülünce
// modül kapsamındaki sabitlere erişemez). ":not(" listede YOK: yerel CSS.
const OPS = ['has', 'has-text', 'contains', 'matches-css-before', 'matches-css-after',
  'matches-css', 'upward', 'nth-ancestor', 'min-text-length', 'remove', 'style'];

/*
 * Bir seçici dizisini işlem zincirine böler.
 * @returns {{op:string, arg:string}[]|null}  op 'css' düz seçici; null=çözülemedi
 * KENDİ İÇİNDE KAPALI saf fonksiyon (DOM yok, dış değişken yok) - hem Node hem
 * sayfa (toString ile gömülü) kullanır.
 */
function zincirle(secici) {
  // Sabitler İÇERİDE: fonksiyon sayfaya gömülünce modül kapsamı yok.
  const OPS = ['has', 'has-text', 'contains', 'matches-css-before', 'matches-css-after',
    'matches-css', 'upward', 'nth-ancestor', 'min-text-length', 'remove', 'style'];
  const DESTEKLENEN = new Set(OPS);
  const zincir = [];
  let i = 0;
  let css = '';
  const n = secici.length;
  while (i < n) {
    const k = secici[i];
    if (k === ':') {
      // operatör mü?
      let ad = '';
      let j = i + 1;
      while (j < n && /[a-z-]/i.test(secici[j])) { ad += secici[j]; j++; }
      const adLower = ad.toLowerCase();
      if (secici[j] === '(' && OPS.includes(adLower)) {
        // dengeli parantezi yakala
        let derinlik = 0, k2 = j, arg = '';
        for (; k2 < n; k2++) {
          const c = secici[k2];
          if (c === '(') { derinlik++; if (derinlik === 1) continue; }
          else if (c === ')') { derinlik--; if (derinlik === 0) break; }
          arg += c;
        }
        if (derinlik !== 0) return null;   // dengesiz
        if (css.trim()) { zincir.push({ op: 'css', arg: css.trim() }); css = ''; }
        zincir.push({ op: adLower, arg: arg.trim() });
        i = k2 + 1;
        continue;
      }
      // yerel sözde-sınıf (:not, :hover, :scope...) -> css'te kalır
      css += k; i++;
      continue;
    }
    // köşeli parantez içeriğini olduğu gibi al (":", "(" içerebilir)
    if (k === '[') {
      let derinlik = 0;
      for (; i < n; i++) { const c = secici[i]; css += c; if (c === '[') derinlik++; else if (c === ']') { derinlik--; if (derinlik === 0) { i++; break; } } }
      continue;
    }
    css += k; i++;
  }
  if (css.trim()) zincir.push({ op: 'css', arg: css.trim() });
  if (!zincir.length) return null;
  // En az bir yordamsal op olmalı (yoksa bu düz CSS, kozmetik.js'e ait).
  if (!zincir.some((z) => z.op !== 'css')) return null;
  // Hepsi destekleniyor mu?
  for (const z of zincir) if (z.op !== 'css' && !DESTEKLENEN.has(z.op)) return null;
  return zincir;
}

/*
 * Yordamsal bir kozmetik satırını çözer (## veya #?#).
 * @returns {{tip:'gizle'|'istisna', alanlar:string[], eksiler:string[], secici:string}|null}
 */
function prosedurelCoz(satir) {
  let yer = -1, tip = null;
  for (const a of ['#@#', '#?#', '##']) {
    const idx = satir.indexOf(a);
    if (idx !== -1 && (yer === -1 || idx < yer)) { yer = idx; tip = a; }
  }
  if (yer === -1) return null;

  const secici = satir.slice(yer + tip.length).trim();
  if (!secici || secici.startsWith('+js(')) return null;
  // Güvenlik: süslü parantez / açıklama seçiciye girmesin.
  if (/[{}]/.test(secici) || secici.includes('/*') || secici.includes('*/')) return null;
  if (!zincirle(secici)) return null;   // çözülemiyorsa alma

  const alanBolumu = satir.slice(0, yer);
  if (alanBolumu && !/^[a-z0-9.,~*_-]+$/i.test(alanBolumu)) return null;
  const alanlar = [], eksiler = [];
  for (const ham of alanBolumu.split(',')) {
    const d = ham.trim().toLowerCase();
    if (!d) continue;
    if (d[0] === '~') { if (d.length > 1) eksiler.push(d.slice(1)); }
    else alanlar.push(d);
  }
  // Alan adı yazılmamış GENEL yordamsal kural fazla geniş + pahalı; almıyoruz.
  if (tip !== '#@#' && !alanlar.length) return null;
  return { tip: tip === '#@#' ? 'istisna' : 'gizle', alanlar, eksiler, secici };
}

/*
 * SAYFA TARAFI DEĞERLENDİRİCİ (kaynak). toString() ile sayfaya gömülüyor;
 * KENDİ İÇİNDE KAPALI olmalı - dışarıdaki hiçbir şeye erişemez. zincirle'yi
 * argüman olarak alıyor (aynı ayrıştırıcı).
 */
function degerlendiriciKodu() {
  'use strict';
  if (window.__pusulaProsedurelKuruldu) return;
  window.__pusulaProsedurelKuruldu = true;

  var zincirle = window.__pusulaZincirle;
  var kurallar = [];         // {zincir, sonlandirici, stil}
  var gozlemci = null;
  var bekleyen = false;
  var hata = window.__pusulaProcDebug = { kural: 0, calistir: 0, mutasyon: 0, gozlemci: false, sonHata: '' };

  function metinDesen(arg) {
    var m = /^\/(.*)\/([a-z]*)$/.exec(arg);
    if (m) { try { return new RegExp(m[1], m[2]); } catch (e) { return null; } }
    return arg; // düz metin
  }
  function metinUyar(el, arg) {
    var s = '';
    try { s = el.textContent || ''; } catch (e) {}
    var d = metinDesen(arg);
    if (d == null) return false;
    return (typeof d === 'string') ? s.indexOf(d) !== -1 : d.test(s);
  }
  function altVar(el, argZinciri) {
    // argZinciri: :has() argümanının zinciri. İlk css parçası kapsam.
    if (!argZinciri || !argZinciri.length) return false;
    var ilk = argZinciri[0];
    var kapsamCss = (ilk.op === 'css') ? ilk.arg : '*';
    var kalan = (ilk.op === 'css') ? argZinciri.slice(1) : argZinciri;
    var adaylar;
    try { adaylar = el.querySelectorAll(':scope ' + kapsamCss); }
    catch (e) { try { adaylar = el.querySelectorAll(kapsamCss); } catch (e2) { return false; } }
    for (var a = 0; a < adaylar.length; a++) {
      if (opZinciriUyar(adaylar[a], kalan)) return true;
    }
    return false;
  }
  // Bir eleman, op zincirine (css sonrası kalan opları) uyuyor mu? (filtre semantiği)
  function opZinciriUyar(el, ops) {
    for (var i = 0; i < ops.length; i++) {
      var o = ops[i];
      if (o.op === 'has') { if (!altVar(el, zincirle(o.arg) || [])) return false; }
      else if (o.op === 'has-text' || o.op === 'contains') { if (!metinUyar(el, o.arg)) return false; }
      else if (o.op === 'matches-css' || o.op === 'matches-css-before' || o.op === 'matches-css-after') {
        var ci = o.arg.indexOf(':'); if (ci === -1) return false;
        var prop = o.arg.slice(0, ci).trim(), val = o.arg.slice(ci + 1).trim();
        var pe = o.op === 'matches-css-before' ? '::before' : o.op === 'matches-css-after' ? '::after' : null;
        var cs; try { cs = getComputedStyle(el, pe); } catch (e) { return false; }
        var cur = cs ? cs.getPropertyValue(prop) : '';
        var d = metinDesen(val);
        if (typeof d === 'string') { if (cur.trim() !== d.replace(/^["']|["']$/g, '').trim() && cur.indexOf(d) === -1) return false; }
        else if (d) { if (!d.test(cur)) return false; } else return false;
      }
      else if (o.op === 'min-text-length') { var mn = parseInt(o.arg, 10); if (!((el.textContent || '').length >= mn)) return false; }
      else if (o.op === 'css') { try { if (!el.matches(o.arg)) return false; } catch (e) { return false; } }
      else return false; // upward/nth-ancestor filtre değil dönüştürücü; :has içinde beklenmez
    }
    return true;
  }

  function calistir() {
    hata.calistir++;
    for (var r = 0; r < kurallar.length; r++) {
      var kural = kurallar[r];
      var z = kural.zincir;
      // ilk css parçası taban küme
      var tabanCss = (z[0].op === 'css') ? z[0].arg : '*';
      var baslangic = z[0].op === 'css' ? 1 : 0;
      var dugumler;
      try { dugumler = Array.prototype.slice.call(document.querySelectorAll(tabanCss)); }
      catch (e) { continue; }
      for (var i = baslangic; i < z.length && dugumler.length; i++) {
        var o = z[i];
        if (o.op === 'has') dugumler = dugumler.filter(function (n) { return altVar(n, zincirle(o.arg) || []); });
        else if (o.op === 'has-text' || o.op === 'contains') dugumler = dugumler.filter(function (n) { return metinUyar(n, o.arg); });
        else if (o.op === 'matches-css' || o.op === 'matches-css-before' || o.op === 'matches-css-after') dugumler = dugumler.filter(function (n) { return opZinciriUyar(n, [o]); });
        else if (o.op === 'min-text-length') dugumler = dugumler.filter(function (n) { return opZinciriUyar(n, [o]); });
        else if (o.op === 'upward') {
          var say = parseInt(o.arg, 10);
          if (isNaN(say)) dugumler = dugumler.map(function (n) { return n.closest(o.arg); }).filter(Boolean);
          else dugumler = dugumler.map(function (n) { var e = n; for (var s = 0; s < say && e; s++) e = e.parentElement; return e; }).filter(Boolean);
        }
        else if (o.op === 'nth-ancestor') { var a2 = parseInt(o.arg, 10); dugumler = dugumler.map(function (n) { var e = n; for (var s = 0; s < a2 && e; s++) e = e.parentElement; return e; }).filter(Boolean); }
        else if (o.op === 'css') dugumler = dugumler.filter(function (n) { try { return n.matches(o.arg); } catch (e) { return false; } });
        else { dugumler = []; break; }
      }
      hata.sonEslesen = dugumler.length;
      for (var d = 0; d < dugumler.length; d++) {
        var el = dugumler[d];
        try {
          if (kural.sonlandirici === 'remove') { if (el.parentNode) el.parentNode.removeChild(el); }
          else if (kural.sonlandirici === 'style' && kural.stil) el.style.cssText += ';' + kural.stil;
          else { el.style.setProperty('display', 'none', 'important'); }
          hata.gizlenen = (hata.gizlenen || 0) + 1;
        } catch (e) { hata.sonHata = String(e && e.message); }
      }
    }
  }

  function tetikle() {
    if (bekleyen) return;
    bekleyen = true;
    // requestAnimationFrame KULLANILMIYOR: arka plandaki/görünmeyen sekmelerde
    // kısılıyor (ölçüldü - reklam geç enjekte olunca gizleme hiç çalışmıyordu).
    // setTimeout arka planda da tetikleniyor.
    setTimeout(function () { bekleyen = false; try { calistir(); } catch (e) {} }, 200);
  }

  window.__pusulaProsedurel = function (seciciler) {
    if (!seciciler || !seciciler.length) return;
    for (var i = 0; i < seciciler.length; i++) {
      var z = zincirle(seciciler[i]);
      if (!z) continue;
      var son = z[z.length - 1];
      var sonlandirici = null, stil = null;
      if (son.op === 'remove') { sonlandirici = 'remove'; z.pop(); }
      else if (son.op === 'style') { sonlandirici = 'style'; stil = son.arg; z.pop(); }
      if (!z.length) continue;
      kurallar.push({ zincir: z, sonlandirici: sonlandirici, stil: stil });
    }
    hata.kural = kurallar.length;
    if (!kurallar.length) return;
    calistir();
    if (!gozlemci) {
      try {
        gozlemci = new MutationObserver(function (m) { hata.mutasyon += m.length; tetikle(); });
        gozlemci.observe(document.documentElement || document, { childList: true, subtree: true });
        hata.gozlemci = true;
      } catch (e) { hata.sonHata = String(e && e.message); }
    }
    // Geç yüklenen reklamlar için birkaç gecikmeli tarama (arka planda da çalışır).
    setTimeout(tetikle, 500); setTimeout(tetikle, 1500); setTimeout(tetikle, 3000);
    setTimeout(tetikle, 6000); setTimeout(tetikle, 10000);
  };
}

const ZINCIRLE_KODU = zincirle.toString();
const DEGERLENDIRICI_KODU =
  'window.__pusulaZincirle=(' + ZINCIRLE_KODU + ');(' + degerlendiriciKodu.toString() + ')();';

const { alanUyar } = require('./kozmetik');

/*
 * Yordamsal kozmetik kurallarının deposu. Yalnızca alan-adına-özel kurallar
 * (genel/host'suz yordamsal fazla pahalı, prosedurelCoz zaten reddediyor).
 */
class ProsedurelDepo {
  constructor() {
    this.genel = [];            // [{secici, eksiler?}] - her sitede geçerli (yalnız yerleşik)
    this.alan = new Map();      // kuralAlan -> [{secici, eksiler?}]
    this.istisna = new Map();   // kuralAlan -> Set(secici)
  }

  get sayı() {
    let n = this.genel.length;
    for (const v of this.alan.values()) n += v.length;
    return n;
  }

  ekle(kural) {
    if (!kural) return;
    const { tip, alanlar, eksiler, secici } = kural;
    if (tip === 'istisna') {
      for (const d of alanlar) {
        if (!this.istisna.has(d)) this.istisna.set(d, new Set());
        this.istisna.get(d).add(secici);
      }
      return;
    }
    const giris = eksiler && eksiler.length ? { secici, eksiler } : { secici };
    if (!alanlar || !alanlar.length) { this.genel.push(giris); return; }
    for (const d of alanlar) {
      if (!this.alan.has(d)) this.alan.set(d, []);
      this.alan.get(d).push(giris);
    }
  }

  seciciler(host) {
    if (!host) return [];
    const disla = new Set();
    for (const [kuralAlan, kume] of this.istisna) {
      if (!alanUyar(kuralAlan, host)) continue;
      for (const s of kume) disla.add(s);
    }
    const cikti = new Set();
    const kat = (liste) => {
      for (const k of liste) {
        if (disla.has(k.secici)) continue;
        if (k.eksiler && k.eksiler.some((d) => alanUyar(d, host))) continue;
        cikti.add(k.secici);
      }
    };
    kat(this.genel);
    for (const [kuralAlan, liste] of this.alan) {
      if (alanUyar(kuralAlan, host)) kat(liste);
    }
    return [...cikti];
  }

  disaAktar() {
    const nesne = {};
    for (const [k, v] of this.alan) nesne[k] = v.map((x) => (x.eksiler ? [x.secici, x.eksiler] : x.secici));
    const istisnaNesne = {};
    for (const [k, v] of this.istisna) istisnaNesne[k] = [...v];
    return {
      genel: this.genel.map((x) => (x.eksiler ? [x.secici, x.eksiler] : x.secici)),
      alan: nesne,
      istisna: istisnaNesne
    };
  }

  static iceAktar(veri) {
    const d = new ProsedurelDepo();
    if (!veri) return d;
    const coz = (v) => (v || []).map((x) => (Array.isArray(x) ? { secici: x[0], eksiler: x[1] } : { secici: x }));
    d.genel = coz(veri.genel);
    for (const [k, v] of Object.entries(veri.alan || {})) d.alan.set(k, coz(v));
    for (const [k, v] of Object.entries(veri.istisna || {})) d.istisna.set(k, new Set(v));
    return d;
  }

  birlestir(oteki) {
    this.genel.push(...oteki.genel);
    for (const [k, v] of oteki.alan) {
      if (!this.alan.has(k)) this.alan.set(k, []);
      this.alan.get(k).push(...v);
    }
    for (const [k, v] of oteki.istisna) {
      if (!this.istisna.has(k)) this.istisna.set(k, new Set());
      for (const s of v) this.istisna.get(k).add(s);
    }
  }
}

/*
 * YERLEŞİK yordamsal kurallar. Listelerden bağımsız, her zaman temel oluşturur.
 * Rastgele-sınıflı/dönüşümlü reklamları GÖRÜNÜR ETİKETİNDEN yakalar; kapsam dar
 * tutuldu (yanlış pozitifi azaltmak için: etiket TAM eşleşme + reklam-şekli).
 */
function yerlesikProsedurel() {
  const d = new ProsedurelDepo();
  // r10.net: yan banner konteyneri (.rPanel içinde .head "Reklam") - konteyneri gizle.
  d.ekle({ tip: 'gizle', alanlar: ['r10.net'], eksiler: [], secici: '.rPanel:has(> .head:contains(/^Reklam/)):upward(1)' });
  return d;
}

module.exports = { zincirle, prosedurelCoz, ProsedurelDepo, yerlesikProsedurel, DEGERLENDIRICI_KODU, degerlendiriciKodu, OPS };
