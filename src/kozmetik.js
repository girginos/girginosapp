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

/*
 * Seçici, enjekte edilen stil sayfasından KAÇAMAMALI.
 *
 * Bir seçicinin kendi demetini bozması kabul edilebilir; asıl tehlike, kalan
 * seçicileri de yutması. Ölçüldü: tek bir "/*" bütün kozmetik filtrelemeyi
 * kapatıyor, çünkü açılan CSS açıklaması stil sayfasının SONUNA kadar sürüyor
 * ve demetlere bölmenin sağladığı sınırlama tamamen devre dışı kalıyor. Kapanış
 * dizisi de reddedildiği için o açıklama hiçbir yerde kapanamıyor. Aynısı
 * kapanmamış parantez ve köşeli parantez için de geçerli.
 *
 * Süslü parantez, blok içeriğini yazmaya çalışan bir kuralın işareti.
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
  if (!secici || UZANTI_SOZDIZIMI.test(secici) || !seciciGuvenliMi(secici)) return null;

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
  /*
   * DIŞLAMALAR KURALIN KENDİSİNE BAĞLI, SEÇİCİYE DEĞİL.
   *
   * Önce "secici -> dışlanan alanlar" diye tek bir harita vardı. Ölçüldü,
   * yanlıştı: bir kuralın dışlaması, AYNI seçiciyi kullanan başka her kuralı da
   * bastırıyordu. Gerçek listelerde ".ad" ve ".banner" gibi seçiciler yüzlerce
   * kuralda geçiyor, yani birleştirilen listelerde sessiz eksik-engelleme.
   * Şimdi her kural kendi dışlamalarını taşıyor.
   */
  constructor() {
    this.genel = [];              // [{ secici, eksiler }] - her yerde geçerli
    this.alan = new Map();        // kuralAlan -> [{ secici, eksiler }]
    this.istisna = new Map();     // kuralAlan -> Set(secici)
    this.genelIstisna = new Set(); // alan adı yazılmamış "#@#" kuralları
  }

  get sayi() {
    let n = this.genel.length;
    for (const k of this.alan.values()) n += k.length;
    return n;
  }

  ekle(kural) {
    if (!kural) return;
    const { tip, alanlar, eksiler, secici } = kural;

    if (tip === 'istisna') {
      /*
       * Alan adı yazılmamış "#@#" kuralı ATILMIYORDU ama hiçbir yere de
       * konmuyordu: sayılıyor, listede görünüyor, hiçbir şey yapmıyordu.
       * "Bozulan siteyi düzelt" listeleri tam olarak bunu kullanıyor.
       */
      if (!alanlar.length) { this.genelIstisna.add(secici); return; }
      for (const d of alanlar) {
        if (!this.istisna.has(d)) this.istisna.set(d, new Set());
        this.istisna.get(d).add(secici);
      }
      return;
    }

    const giris = eksiler.length ? { secici, eksiler } : { secici };
    if (!alanlar.length) { this.genel.push(giris); return; }
    for (const d of alanlar) {
      if (!this.alan.has(d)) this.alan.set(d, []);
      this.alan.get(d).push(giris);
    }
  }

  // Düz nesne olarak dışa aktarım (önbelleğe yazmak için).
  disaAktar() {
    const kurallar = (liste) => liste.map((k) => (k.eksiler ? [k.secici, k.eksiler] : k.secici));
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
    const coz = (liste) => (liste || []).map(
      (k) => (Array.isArray(k) ? { secici: k[0], eksiler: k[1] } : { secici: k })
    );
    d.genel = coz(veri.genel);
    for (const [k, v] of Object.entries(veri.alan || {})) d.alan.set(k, coz(v));
    for (const [k, v] of Object.entries(veri.istisna || {})) d.istisna.set(k, new Set(v));
    for (const s of veri.genelIstisna || []) d.genelIstisna.add(s);
    return d;
  }

  // Başka bir deponun kurallarını üstüne yığar (birden çok liste için).
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

  /**
   * Bu ana makine adı için uygulanacak seçiciler.
   * @param {string} host  sayfanın ana makine adı (küçük harf)
   */
  seciciler(host) {
    if (!host) return [];

    const disla = new Set(this.genelIstisna);
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

  /*
   * Geçersiz seçicileri atar. Denetleyici bir işlev alıyor çünkü CSS'i gerçekten
   * ayrıştırabilen tek yer bir oluşturucu (renderer); burada saf kalıyoruz.
   * Karakter denetimi bilinen kaçış yollarını kapatır, bu ise geriye kalan
   * her şeyi: gerçek ayrıştırıcının reddettiği seçici hiç yazılmaz.
   */
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

module.exports = { KozmetikDepo, kuralCoz, alanUyar, seciciGuvenliMi, UZANTI_SOZDIZIMI, DEMET };
