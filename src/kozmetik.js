'use strict';

/*
 * Kozmetik filtreler: ağdan gelen ama gizlenmesi gereken kutular.
 *
 * Engelleyici yalnızca isteği kesebiliyor. Reklam alanının kendisi sayfanın
 * KENDİ alan adından geliyorsa istek kesilemez; geriye boş bir çerçeve, "reklam
 * engelleyicinizi kapatın" şeridi ya da kocaman bir boşluk kalır. EasyList'in
 * bunun için ayrı bir söz dizimi var.
 *
 * NE DESTEKLENİYOR
 *   ##secici              her yerde gizle
 *   alan.com##secici      yalnızca o alan adında (ve alt alan adlarında)
 *   alan.*##secici        alan adının TLD'si serbest (google.com, google.de)
 *   a.com,~b.a.com##sec   b.a.com dışında
 *   alan.com#@#secici     o alan adında bu seçiciyi UYGULAMA
 *   secici:has(...)       ARTIK DESTEKLENİYOR - Chromium 152 :has()'ı yerel
 *                         çözüyor, doğrudan CSS olarak enjekte ediliyor.
 *   secici:style(decl)    display:none yerine keyfi stil uygula (AdGuard).
 *
 * NE DESTEKLENMİYOR (yordamsal - bir CSS motoruyla değil, sayfayı tarayan bir
 * çalışma zamanıyla uygulanır; henüz yok, güvenle REDDEDİLİYOR ki yanındaki
 * kuralları düşürmesin):
 *   :has-text()/:contains(), :matches-css(), :xpath(), :upward(), :remove(),
 *   :nth-ancestor(), :-abp-*, :if()/:if-not() ...
 */

/*
 * CSS'in tanımadığı YORDAMSAL eklenti söz dizimi -> geçersiz seçici üretir,
 * reddedilir. DİKKAT: ':has(' ve ':style(' BURADA YOK - ilki yerel CSS
 * (Chromium 152), ikincisi aşağıda özel olarak işleniyor. ':contains(' burada:
 * yerel CSS değil ve eskiden kaçıp kendi 20'li demetini zehirliyordu.
 */
const UZANTI_SOZDIZIMI =
  /:(?:has-text|contains|matches-css|matches-css-before|matches-css-after|matches-media|matches-path|matches-attr|xpath|upward|remove|nth-ancestor|watch-attr|min-text-length|others|if|if-not)\(|:-abp-|:remove$/i;

const DEMET = 20;

/*
 * :style() bildirimi güvenli mi? Stil bloğu enjekte edilen stil sayfasından
 * KAÇAMAMALI: süslü parantez, açıklama ya da etiket kapatma denemesi reddedilir.
 */
function stilGuvenliMi(decl) {
  if (!decl) return false;
  if (/[{}<>]/.test(decl)) return false;
  if (decl.includes('/*') || decl.includes('*/')) return false;
  return /:/.test(decl);   // en az bir "prop: value"
}

/*
 * Seçici, enjekte edilen stil sayfasından KAÇAMAMALI. (Süslü parantez, açıklama,
 * dengesiz parantez/köşeli parantez -> kalan seçicileri de yutar.)
 */
function seciciGuvenliMi(secici) {
  if (/[{}]/.test(secici)) return false;
  if (secici.includes('/*') || secici.includes('*/')) return false;

  let parantez = 0;
  let kose = 0;
  for (const k of secici) {
    if (k === '(') parantez++;
    else if (k === ')') parantez--;
    else if (k === '[') kose++;
    else if (k === ']') kose--;
    if (parantez < 0 || kose < 0) return false;
  }
  return parantez === 0 && kose === 0;
}

/**
 * Tek bir kozmetik filtre satırını çözer.
 * @returns {{tip:'gizle'|'istisna', alanlar:string[], eksiler:string[], secici:string, stil?:string}|null}
 */
function kuralCoz(satir) {
  let yer = -1;
  let tip = null;
  for (const a of ['#@#', '#?#', '#$#', '##']) {
    const i = satir.indexOf(a);
    if (i !== -1 && (yer === -1 || i < yer)) { yer = i; tip = a; }
  }
  if (yer === -1) return null;
  if (tip === '#?#' || tip === '#$#') return null;

  let secici = satir.slice(yer + tip.length).trim();
  if (!secici) return null;

  // Scriptlet ("##+js(...)") ve scriptlet imleri kozmetik değil.
  if (secici.startsWith('+js(') || satir.includes('#%#') || satir.includes('#$#')) return null;

  /*
   * :style(...) SONEKİ. "secici:style(prop:value)" -> gizleme yerine o stili
   * uygular. Sondan çözülüyor; kalan seçici normal doğrulamadan geçiyor.
   * İstisna (#@#) kuralında stil olmaz.
   */
  let stil = null;
  if (tip !== '#@#') {
    const m = /:style\(\s*([\s\S]*?)\s*\)\s*$/.exec(secici);
    if (m) {
      stil = m[1].trim();
      secici = secici.slice(0, m.index).trim();
      if (!secici || !stilGuvenliMi(stil)) return null;
    }
  }

  // Kalan seçici yerel CSS olmalı (yordamsal eklenti içermemeli).
  if (UZANTI_SOZDIZIMI.test(secici) || !seciciGuvenliMi(secici)) return null;

  const alanBolumu = satir.slice(0, yer);
  if (alanBolumu && !/^[a-z0-9.,~*_-]+$/i.test(alanBolumu)) return null;

  const alanlar = [];
  const eksiler = [];
  for (const ham of alanBolumu.split(',')) {
    const d = ham.trim().toLowerCase();
    if (!d) continue;
    if (d[0] === '~') { if (d.length > 1) eksiler.push(d.slice(1)); }
    else alanlar.push(d);
  }

  const kural = { tip: tip === '#@#' ? 'istisna' : 'gizle', alanlar, eksiler, secici };
  if (stil) kural.stil = stil;
  return kural;
}

const VARLIK_DESENI = new Map();

function varlikDeseni(kok) {
  let d = VARLIK_DESENI.get(kok);
  if (!d) {
    const kacis = kok.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    d = new RegExp('(^|\\.)' + kacis + '\\.[a-z]{2,}(\\.[a-z]{2,})?$');
    VARLIK_DESENI.set(kok, d);
  }
  return d;
}

function alanUyar(kuralAlan, host) {
  if (kuralAlan.endsWith('.*')) return varlikDeseni(kuralAlan.slice(0, -2)).test(host);
  return host === kuralAlan || host.endsWith('.' + kuralAlan);
}

class KozmetikDepo {
  constructor() {
    this.genel = [];               // [{ secici, eksiler?, stil? }]
    this.alan = new Map();         // kuralAlan -> [{ secici, eksiler?, stil? }]
    this.istisna = new Map();      // kuralAlan -> Set(secici)
    this.genelIstisna = new Set();
  }

  get sayi() {
    let n = this.genel.length;
    for (const k of this.alan.values()) n += k.length;
    return n;
  }

  ekle(kural) {
    if (!kural) return;
    const { tip, alanlar, eksiler, secici, stil } = kural;

    if (tip === 'istisna') {
      if (!alanlar.length) { this.genelIstisna.add(secici); return; }
      for (const d of alanlar) {
        if (!this.istisna.has(d)) this.istisna.set(d, new Set());
        this.istisna.get(d).add(secici);
      }
      return;
    }

    const giris = { secici };
    if (eksiler && eksiler.length) giris.eksiler = eksiler;
    if (stil) giris.stil = stil;
    if (!alanlar.length) { this.genel.push(giris); return; }
    for (const d of alanlar) {
      if (!this.alan.has(d)) this.alan.set(d, []);
      this.alan.get(d).push(giris);
    }
  }

  // Düz nesne olarak dışa aktarım. Biçim: stil varsa [secici, eksiler, stil];
  // yalnız eksiler varsa [secici, eksiler]; sade ise "secici".
  disaAktar() {
    const kurallar = (liste) => liste.map((k) => {
      if (k.stil) return [k.secici, k.eksiler || [], k.stil];
      if (k.eksiler) return [k.secici, k.eksiler];
      return k.secici;
    });
    const nesne = {};
    for (const [k, v] of this.alan) nesne[k] = kurallar(v);
    const istisnaNesne = {};
    for (const [k, v] of this.istisna) istisnaNesne[k] = [...v];
    return {
      genel: kurallar(this.genel),
      alan: nesne,
      istisna: istisnaNesne,
      genelIstisna: [...this.genelIstisna]
    };
  }

  static iceAktar(veri) {
    const d = new KozmetikDepo();
    if (!veri) return d;
    const coz = (liste) => (liste || []).map((k) => {
      if (!Array.isArray(k)) return { secici: k };
      if (k.length >= 3) return { secici: k[0], eksiler: k[1], stil: k[2] };
      return { secici: k[0], eksiler: k[1] };
    });
    d.genel = coz(veri.genel);
    for (const [k, v] of Object.entries(veri.alan || {})) d.alan.set(k, coz(v));
    for (const [k, v] of Object.entries(veri.istisna || {})) d.istisna.set(k, new Set(v));
    for (const s of veri.genelIstisna || []) d.genelIstisna.add(s);
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
    for (const s of oteki.genelIstisna) this.genelIstisna.add(s);
  }

  /*
   * Bu ana makine adı için uygulanacak kurallar (gizleme + stil), dışlamalar
   * uygulanmış hâlde.
   * @returns {{secici:string, stil?:string}[]}
   */
  _uygulanan(host) {
    if (!host) return [];

    const disla = new Set(this.genelIstisna);
    for (const [kuralAlan, kume] of this.istisna) {
      if (!alanUyar(kuralAlan, host)) continue;
      for (const s of kume) disla.add(s);
    }

    const cikti = [];
    const gorulen = new Set();
    const kat = (liste) => {
      for (const k of liste) {
        if (disla.has(k.secici)) continue;
        if (k.eksiler && k.eksiler.some((d) => alanUyar(d, host))) continue;
        const anahtar = k.secici + ' ' + (k.stil || '');
        if (gorulen.has(anahtar)) continue;
        gorulen.add(anahtar);
        cikti.push(k.stil ? { secici: k.secici, stil: k.stil } : { secici: k.secici });
      }
    };

    kat(this.genel);
    for (const [kuralAlan, liste] of this.alan) {
      if (alanUyar(kuralAlan, host)) kat(liste);
    }
    return cikti;
  }

  /**
   * Bu ana makine adı için gizlenecek seçiciler (stil kuralları hariç).
   * @param {string} host
   */
  seciciler(host) {
    return this._uygulanan(host).filter((k) => !k.stil).map((k) => k.secici);
  }

  /**
   * Sayfaya enjekte edilecek CSS. Gizleme kuralları 20'li demetlerde
   * display:none ile; :style() kuralları kendi bildirimleriyle ayrı ayrı.
   */
  css(host) {
    const kurallar = this._uygulanan(host);
    if (!kurallar.length) return '';
    const gizle = kurallar.filter((k) => !k.stil).map((k) => k.secici);
    const stiller = kurallar.filter((k) => k.stil);
    const parcalar = [];
    for (let i = 0; i < gizle.length; i += DEMET) {
      parcalar.push(gizle.slice(i, i + DEMET).join(',') + '{display:none!important}');
    }
    for (const k of stiller) parcalar.push(k.secici + '{' + k.stil + '}');
    return parcalar.join('\n');
  }

  suz(gecerliMi) {
    const suzListe = (liste) => liste.filter((k) => gecerliMi(k.secici));
    let atilan = this.genel.length;
    this.genel = suzListe(this.genel);
    atilan -= this.genel.length;
    for (const [k, v] of this.alan) {
      const yeni = suzListe(v);
      atilan += v.length - yeni.length;
      if (yeni.length) this.alan.set(k, yeni);
      else this.alan.delete(k);
    }
    return atilan;
  }
}

/*
 * YERLEŞİK GENEL çok-dilli reklam seçicileri. Liste kurallarından bağımsız,
 * HER sitede geçerli. Yerel CSS olduğu için yeni eklenen ögelere de kendiliğinden
 * uygulanır (dinamik). Yalnızca AYIRT EDİCİ sözcükler (yanlış pozitif düşük):
 * farklı dillerde "reklam", + adsbygoogle. İngilizce "ad/ads" gibi yüksek-yanlış-
 * pozitifli sözcükler BURADA YOK - onları EasyList/uBlock sözcük-sınırıyla veriyor.
 */
function yerlesikKozmetik() {
  const d = new KozmetikDepo();
  const seciciler = [
    // Türkçe
    '[class*="reklam" i]', '[id*="reklam" i]',
    // Almanca
    '[class*="werbung" i]', '[id*="werbung" i]',
    // İspanyolca
    '[class*="publicidad" i]', '[id*="publicidad" i]',
    // Fransızca
    '[class*="publicite" i]', '[class*="publicité" i]', '[id*="publicite" i]',
    // Portekizce
    '[class*="publicidade" i]', '[id*="publicidade" i]',
    // İtalyanca
    '[class*="pubblicita" i]', '[class*="pubblicità" i]',
    // Rusça
    '[class*="реклама"]', '[id*="реклама"]',
    // İngilizce (ayırt edici tam sözcükler)
    '[class*="advertisement" i]', '[class*="advertising" i]', '.adsbygoogle'
  ];
  for (const s of seciciler) d.ekle({ tip: 'gizle', alanlar: [], eksiler: [], secici: s });

  /*
   * YouTube in-feed reklamları: iç reklamı değil, onu SARAN ızgara hücresini
   * gizle - yoksa hücre yerini koruyup BOŞLUK bırakıyor. Chromium 152 :has()'ı
   * yerel çözüyor. EasyList'in kuralları tam `>` iç içeliğe dayanıyor (YouTube
   * sık değiştiriyor); bunlar torun `:has()` ile daha dayanıklı.
   */
  const ytSarmalayici = [
    'ytd-rich-item-renderer:has(ytd-ad-slot-renderer)',
    'ytd-rich-item-renderer:has(ytd-in-feed-ad-layout-renderer)',
    'ytd-rich-item-renderer:has(.ytd-display-ad-renderer)',
    'ytd-rich-section-renderer:has(ytd-ad-slot-renderer)',
    'ytd-item-section-renderer:has(> #contents > ytd-ad-slot-renderer)',
    'ytd-ad-slot-renderer',
    'ytd-in-feed-ad-layout-renderer',
    'ytd-banner-promo-renderer',
    'ytd-statement-banner-renderer',
    '#masthead-ad'
  ];
  for (const s of ytSarmalayici) d.ekle({ tip: 'gizle', alanlar: ['youtube.com'], eksiler: [], secici: s });
  return d;
}

module.exports = { KozmetikDepo, kuralCoz, alanUyar, seciciGuvenliMi, stilGuvenliMi, yerlesikKozmetik, UZANTI_SOZDIZIMI, DEMET };
