'use strict';

/*
 * Kozmetik filtreler: ağdan gelen ama gizlenmesi gereken kutular.
 *
 * Engelleyici yalnızca isteği kesebiliyor. Reklam alanının kendisi sayfanın
 * KENDİ alan adından geliyorsa istek kesilemez; geriye boş bir çerçeve, "reklam
 * engelleyicinizi kapatın" şeridi ya da kocaman bir boşluk kalır. EasyList'in
 * bunun için ayrı bir söz dizimi var ve bugüne kadar tamamını atıyorduk:
 * 24.580 satır, yani listelerin görünür etkisinin büyük kısmı.
 *
 * NE DESTEKLENİYOR
 *   ##secici              her yerde gizle
 *   alan.com##secici      yalnızca o alan adında (ve alt alan adlarında)
 *   alan.*##secici        alan adının TLD'si serbest (google.com, google.de)
 *   a.com,~b.a.com##sec   b.a.com dışında
 *   alan.com#@#secici     o alan adında bu seçiciyi UYGULAMA
 *
 * NE DESTEKLENMİYOR
 *   #?# ve #$#  - uBlock/ABP'nin yordamsal söz dizimi (289 satır)
 *   :has-text(), :matches-css(), :xpath(), :style() gibi eklentiler (11 satır)
 * Bunlar bir CSS motoruyla değil, sayfayı tarayan bir çalışma zamanıyla
 * uygulanır. Yarısını uygulamak, seçiciyi geçersiz kılıp YANINDAKİ kuralları da
 * düşürürdü.
 */

// CSS'in tanımadığı eklenti söz dizimi. Bunlar geçersiz seçici üretir.
const UZANTI_SOZDIZIMI =
  /:(?:has-text|matches-css|matches-css-before|matches-css-after|matches-media|matches-path|matches-attr|xpath|upward|remove|nth-ancestor|watch-attr|min-text-length|others|style)\(|:-abp-|:remove$/i;

/*
 * Tek bir seçici demetindeki GEÇERSİZ bir seçici, CSS kurallarına göre
 * demetin TAMAMINI düşürür. 13 binlik tek bir demet kursaydık, listeye giren
 * tek bozuk seçici bütün kozmetik filtrelemeyi sessizce kapatırdı. Bu yüzden
 * seçiciler küçük demetlere bölünüyor: hasar bir demetle sınırlı kalıyor.
 */
const DEMET = 20;

/**
 * Tek bir kozmetik filtre satırını çözer.
 * @returns {{tip:'gizle'|'istisna', alanlar:string[], eksiler:string[], secici:string}|null}
 */
function kuralCoz(satir) {
  // En erken ayraç kazanır: "a.com#@#x" içinde "##" yok ama "#$#" olabilir.
  let yer = -1;
  let tip = null;
  for (const a of ['#@#', '#?#', '#$#', '##']) {
    const i = satir.indexOf(a);
    if (i !== -1 && (yer === -1 || i < yer)) { yer = i; tip = a; }
  }
  if (yer === -1) return null;
  if (tip === '#?#' || tip === '#$#') return null;

  const secici = satir.slice(yer + tip.length).trim();
  if (!secici || UZANTI_SOZDIZIMI.test(secici)) return null;
  // Süslü parantez ya da açıklama kapatma dizisi, enjekte edilen CSS'ten
  // kaçıp kendi kuralını yazabilirdi.
  if (/[{}]/.test(secici) || secici.includes('*/')) return null;

  /*
   * Ayraçtan önceki kısım bir alan adı listesi olmalı. Hosts dosyalarındaki
   * "# şurada ## geçiyor" gibi bir yorum satırı yoksa kozmetik kural sanılır
   * ve uydurma bir alan adı listeye girerdi.
   */
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

  return { tip: tip === '#@#' ? 'istisna' : 'gizle', alanlar, eksiler, secici };
}

/*
 * "alan.*" biçimi için desen önbelleği. Her çağrıda RegExp kurmak, seçici
 * taramasının en sıcak döngüsünde gereksiz iş demek.
 */
const VARLIK_DESENI = new Map();

function varlikDeseni(kok) {
  let d = VARLIK_DESENI.get(kok);
  if (!d) {
    const kacis = kok.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    /*
     * Üst düzey alan adı SONDA olmalı. Basit bir "google. ile başlıyor mu"
     * kontrolü "google.com.kotu-site.com" adresini de tutardı: saldırgan,
     * google için yazılmış gizleme kurallarını kendi sayfasında çalıştırabilirdi.
     */
    d = new RegExp('(^|\\.)' + kacis + '\\.[a-z]{2,}(\\.[a-z]{2,})?$');
    VARLIK_DESENI.set(kok, d);
  }
  return d;
}

/*
 * Kural alan adı sayfanın alan adına uyuyor mu?
 * "alan.com" -> alan.com ve altındaki her şey.
 * "alan.*"   -> alan adının TLD'si serbest (google.com, google.co.uk).
 */
function alanUyar(kuralAlan, host) {
  if (kuralAlan.endsWith('.*')) return varlikDeseni(kuralAlan.slice(0, -2)).test(host);
  return host === kuralAlan || host.endsWith('.' + kuralAlan);
}

class KozmetikDepo {
  constructor() {
    this.genel = new Set();            // her yerde uygulanan seçiciler
    this.alan = new Map();             // kuralAlan -> Set(secici)
    this.istisna = new Map();          // kuralAlan -> Set(secici)
    this.eksi = new Map();             // secici -> Set(kuralAlan) ("~" ile dışlananlar)
  }

  get sayi() {
    let n = this.genel.size;
    for (const s of this.alan.values()) n += s.size;
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

    for (const d of eksiler) {
      if (!this.eksi.has(secici)) this.eksi.set(secici, new Set());
      this.eksi.get(secici).add(d);
    }

    if (!alanlar.length) { this.genel.add(secici); return; }
    for (const d of alanlar) {
      if (!this.alan.has(d)) this.alan.set(d, new Set());
      this.alan.get(d).add(secici);
    }
  }

  // Düz nesne olarak dışa aktarım (önbelleğe yazmak için).
  disaAktar() {
    const nesne = (harita) => {
      const o = {};
      for (const [k, v] of harita) o[k] = [...v];
      return o;
    };
    return {
      genel: [...this.genel],
      alan: nesne(this.alan),
      istisna: nesne(this.istisna),
      eksi: nesne(this.eksi)
    };
  }

  static iceAktar(veri) {
    const d = new KozmetikDepo();
    if (!veri) return d;
    for (const s of veri.genel || []) d.genel.add(s);
    const harita = (o, hedef) => {
      for (const [k, v] of Object.entries(o || {})) hedef.set(k, new Set(v));
    };
    harita(veri.alan, d.alan);
    harita(veri.istisna, d.istisna);
    harita(veri.eksi, d.eksi);
    return d;
  }

  // Başka bir deponun kurallarını üstüne yığar (birden çok liste için).
  birlestir(oteki) {
    for (const s of oteki.genel) this.genel.add(s);
    const kat = (kaynak, hedef) => {
      for (const [k, v] of kaynak) {
        if (!hedef.has(k)) hedef.set(k, new Set());
        for (const s of v) hedef.get(k).add(s);
      }
    };
    kat(oteki.alan, this.alan);
    kat(oteki.istisna, this.istisna);
    kat(oteki.eksi, this.eksi);
  }

  /**
   * Bu ana makine adı için uygulanacak seçiciler.
   * @param {string} host  sayfanın ana makine adı (küçük harf)
   */
  seciciler(host) {
    if (!host) return [];

    const disla = new Set();
    for (const [kuralAlan, kume] of this.istisna) {
      if (!alanUyar(kuralAlan, host)) continue;
      for (const s of kume) disla.add(s);
    }

    const cikti = new Set();
    const uygunMu = (s) => {
      if (disla.has(s)) return false;
      const eksiler = this.eksi.get(s);
      if (eksiler) for (const d of eksiler) if (alanUyar(d, host)) return false;
      return true;
    };

    for (const s of this.genel) if (uygunMu(s)) cikti.add(s);
    for (const [kuralAlan, kume] of this.alan) {
      if (!alanUyar(kuralAlan, host)) continue;
      for (const s of kume) if (uygunMu(s)) cikti.add(s);
    }
    return [...cikti];
  }

  /**
   * Sayfaya enjekte edilecek CSS.
   * @returns {string} boşsa '' (insertCSS boş metinle çağrılmasın)
   */
  css(host) {
    const s = this.seciciler(host);
    if (!s.length) return '';
    const parcalar = [];
    for (let i = 0; i < s.length; i += DEMET) {
      parcalar.push(s.slice(i, i + DEMET).join(',') + '{display:none!important}');
    }
    return parcalar.join('\n');
  }
}

module.exports = { KozmetikDepo, kuralCoz, alanUyar, UZANTI_SOZDIZIMI, DEMET };
