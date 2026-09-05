'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { IKI_SEVIYELI } = require('./blocker');
const { KozmetikDepo, kuralCoz } = require('./kozmetik');
const { BetikDepo, betikCoz, yerleşikDepo } = require('./betikler');

/*
 * Filtre listesi yöneticisi.
 *
 * Girginos Browser engelleyicisi ağ tarafında yalnızca "şu ana makineye giden
 * üçüncü taraf istekleri kes" diyebiliyor. Adblock Plus söz diziminin geri
 * kalanı (yol kalıpları, kaynak türü kısıtları, $domain= bağlamı) bizde
 * karşılıksız. Bu yüzden ayrıştırıcı SADECE anlamını birebir koruyabildiğimiz
 * kuralları alır; gerisini sessizce atar. Yanlış çevrilen bir kural,
 * engellenmeyen bir izleyiciden daha kötüdür: sayfayı bozar.
 *
 * Kozmetik kurallar (##, #@#) artık atılmıyor; src/kozmetik.js çözüyor ve
 * sayfaya CSS olarak uygulanıyorlar.
 */

/*
 * Varsayılan listeler uBlock Origin'in etkinleştirdiği çekirdek kümeyi
 * yansıtıyor. EasyList/EasyPrivacy ağ + kozmetik tarafını taşıyor; uBO'nun kendi
 * listeleri asıl SCRIPTLET gücünü (anti-adblock, YouTube, reklam scriptleri -
 * ~3000 kural) ve gelişmiş kozmetikleri getiriyor. AdGuard Türkçe, r10.net gibi
 * yerel siteleri kapsıyor. uBO listeleri "güvenilir": trusted-* scriptlet'ler
 * (yanıt gövdesini yeniden yazan) yalnızca bunlardan çalışır.
 */
const VARSAYILAN_LISTELER = [
  { id: 'easylist', ad: 'EasyList', aciklama: 'Reklamlar', url: 'https://easylist.to/easylist/easylist.txt' },
  { id: 'easyprivacy', ad: 'EasyPrivacy', aciklama: 'İzleyiciler', url: 'https://easylist.to/easylist/easyprivacy.txt' },
  { id: 'ublock-filters', ad: 'uBlock filtreleri — Reklamlar', aciklama: 'Scriptlet + kozmetik', url: 'https://ublockorigin.github.io/uAssets/filters/filters.txt' },
  { id: 'ublock-privacy', ad: 'uBlock filtreleri — Gizlilik', aciklama: 'İzleyici scriptletleri', url: 'https://ublockorigin.github.io/uAssets/filters/privacy.txt' },
  { id: 'ublock-badware', ad: 'uBlock filtreleri — Zararlı', aciklama: 'Kötü amaçlı siteler', url: 'https://ublockorigin.github.io/uAssets/filters/badware.txt' },
  { id: 'ublock-quickfixes', ad: 'uBlock filtreleri — Hızlı düzeltmeler', aciklama: 'YouTube dahil güncel yamalar', url: 'https://ublockorigin.github.io/uAssets/filters/quick-fixes.txt' },
  { id: 'ublock-resourceabuse', ad: 'uBlock filtreleri — Kaynak istismarı', aciklama: 'Anti-adblock, madenciler', url: 'https://ublockorigin.github.io/uAssets/filters/resource-abuse.txt' },
  { id: 'ublock-unbreak', ad: 'uBlock filtreleri — Onarım', aciklama: 'Aşırı engellemeyi düzeltir', url: 'https://ublockorigin.github.io/uAssets/filters/unbreak.txt' },
  { id: 'adguard-turkce', ad: 'AdGuard Türkçe', aciklama: 'Türk siteleri (r10.net vb.)', url: 'https://filters.adtidy.org/extension/ublock/filters/13.txt' }
];

const EN_BUYUK_BAYT = 16 * 1024 * 1024;
const VARSAYILAN_GECERLILIK_SAAT = 96;      // listede "! Expires" yoksa
const EN_AZ_GECERLILIK_SAAT = 6;
const KONTROL_ARALIGI_MS = 6 * 60 * 60 * 1000;
const ILK_KONTROL_GECIKMESI_MS = 15 * 1000; // açılışı yavaşlatmamak için
const EN_AZ_KURAL = 20;                     // bundan azı "liste bozuk" sayılır

/*
 * Onbellek bicimi. Kozmetik kurallar 2. bicimle geldi, 3. bicimde kural yapisi degisti; eski bir dosyada o alan
 * hic yok ve ham metin saklanmadigi icin sonradan uretilemiyor. Numara
 * artirilinca eski onbellekler yok sayilir ve liste yeniden indirilir.
 */
const BICIM = 4;
const CSS_ONBELLEK_SINIRI = 500;

// Yalnızca tek bir ana makine adı: joker, yol, port yok.
const ALAN_BICIMI = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

// Kuralın anlamını daraltmayan (ya da bizim zaten uyguladığımız) seçenekler.
// Kaynak türü kısıtları ($script, $image, ...) listede YOK: onları kabul etmek
// "yalnızca script'i engelle" kuralını "her şeyi engelle"ye çevirirdi.
const ZARARSIZ_SECENEKLER = new Set(['third-party', '3p', 'all', 'important']);

const HOSTS_SATIRI = /^(?:0\.0\.0\.0|127\.0\.0\.1|::1?)\s+(\S+)/;
const YOKSAYILAN_HOST = new Set(['localhost', 'localhost.localdomain', 'local', 'broadcasthost', 'ip6-localhost', 'ip6-loopback']);

// Tek bir ana makine adı mı, ve altındaki her siteyi kesecek kadar genel değil mi?
function gecerliAlan(host) {
  if (!ALAN_BICIMI.test(host)) return false;
  if (YOKSAYILAN_HOST.has(host)) return false;
  // "co.uk" gibi genel bir son ek listeye girerse altındaki her siteyi keser.
  // Bugünkü listelerde yok, ama bozuk bir kaynak eklenirse tarayıcı çökmesin.
  if (IKI_SEVIYELI.has(host)) return false;
  return true;
}

function secenekleriKabulEt(secenekMetni) {
  if (!secenekMetni) return true;
  for (const ham of secenekMetni.split(',')) {
    const s = ham.trim().toLowerCase();
    if (!s) continue;
    if (!ZARARSIZ_SECENEKLER.has(s)) return false;   // ~third-party, domain=, script ...
  }
  return true;
}

// "||alan.com^$third-party" -> "alan.com" | anlamı korunamıyorsa null
function alanCapasiCoz(govde) {
  const dolarda = govde.indexOf('$');
  const kalip = dolarda === -1 ? govde : govde.slice(0, dolarda);
  const secenekler = dolarda === -1 ? '' : govde.slice(dolarda + 1);
  if (!secenekleriKabulEt(secenekler)) return null;

  let host = kalip;
  if (host.endsWith('^')) host = host.slice(0, -1);
  else if (host.endsWith('|')) host = host.slice(0, -1);
  // Geriye yol, joker ya da ayraç kaldıysa kural alan adından fazlasını söylüyor.
  if (/[/*^|]/.test(host)) return null;

  host = host.toLowerCase().replace(/\.+$/, '');
  return gecerliAlan(host) ? host : null;
}

/**
 * Bir filtre listesi metnini ayrıştırır.
 * Adblock Plus, hosts ve düz alan adı biçimlerini tanır.
 */
function ayristir(metin, guvenilir = false) {
  const alanlar = new Set();
  const istisnalar = new Set();
  const kozmetik = new KozmetikDepo();
  const betik = new BetikDepo();
  const meta = { baslik: '', surum: '', gecerlilikSaat: VARSAYILAN_GECERLILIK_SAAT };
  let toplamKural = 0;
  let atlanan = 0;

  for (const ham of String(metin).split(/\r?\n/)) {
    const satir = ham.trim();
    if (!satir) continue;

    // Üst bilgi ve yorumlar
    if (satir[0] === '!' || satir[0] === '[') {
      const baslik = /^!\s*Title\s*:\s*(.+)$/i.exec(satir);
      if (baslik) meta.baslik = baslik[1].trim();
      const surum = /^!\s*Version\s*:\s*(\S+)/i.exec(satir);
      if (surum) meta.surum = surum[1];
      const sure = /^!\s*Expires\s*:\s*(\d+)\s*(day|days|hour|hours)/i.exec(satir);
      if (sure) {
        const n = Number(sure[1]);
        const saat = /hour/i.test(sure[2]) ? n : n * 24;
        meta.gecerlilikSaat = Math.max(EN_AZ_GECERLILIK_SAAT, Math.min(saat, 24 * 30));
      }
      continue;
    }
    /*
     * Kozmetik filtreler: gizlenecek kutular. Söz dizimi src/kozmetik.js'te.
     *
     * YORUM DENETİMİNDEN ÖNCE geliyor. Genel kurallar "##.reklam" diye "#" ile
     * BAŞLIYOR; aşağıdaki yorum denetimi onları yorum sanıp atıyordu, yani
     * kozmetik filtrelerin en kalabalık kümesi (13 binden fazla kural) hiç
     * uygulanmıyordu. Ölçünce çıktı.
     */
    if (satir.includes('##') || satir.includes('#@#') || satir.includes('#?#') || satir.includes('#$#')) {
      /*
       * Scriptlet kuralları ("##+js(...)") ayrı motora gidiyor: kozmetik CSS
       * değil, sayfaya enjekte edilen JS. Kozmetik ayrıştırıcı bunları zaten
       * reddediyordu; artık kaybolmuyorlar. "+js(" içermeyen kozmetik kurallar
       * eskisi gibi kuralCoz'a gidiyor.
       */
      if (satir.includes('+js(')) {
        const b = betikCoz(satir);
        if (b) { betik.ekle(b, guvenilir); toplamKural++; continue; }
      } else {
        const k = kuralCoz(satir);
        if (k) { kozmetik.ekle(k); toplamKural++; continue; }
      }
      // Tanınmadıysa yorum ya da hosts satırı olabilir; aşağıya düşsün.
    }

    if (satir[0] === '#') {
      const h = HOSTS_SATIRI.exec(satir);   // yorum satırı, hosts değil
      if (!h) continue;
    }

    toplamKural++;

    if (satir.startsWith('@@||')) {
      const host = alanCapasiCoz(satir.slice(4));
      if (host) istisnalar.add(host); else atlanan++;
      continue;
    }
    if (satir.startsWith('@@')) { atlanan++; continue; }

    if (satir.startsWith('||')) {
      const host = alanCapasiCoz(satir.slice(2));
      if (host) alanlar.add(host); else atlanan++;
      continue;
    }

    const hosts = HOSTS_SATIRI.exec(satir);
    if (hosts) {
      const host = hosts[1].toLowerCase().replace(/\.+$/, '');
      if (gecerliAlan(host)) alanlar.add(host);
      else atlanan++;
      continue;
    }

    // Düz alan adı listeleri (her satırda bir alan adı)
    const duz = satir.toLowerCase().replace(/\.+$/, '');
    if (gecerliAlan(duz)) {
      alanlar.add(duz);
      continue;
    }

    atlanan++;   // yol kalıpları, joker kurallar, $domain= bağlamı...
  }

  // İstisna aynı alanı hem engelliyor hem serbest bırakıyorsa serbest bırakma kazanır.
  for (const h of istisnalar) alanlar.delete(h);

  return {
    alanlar: [...alanlar],
    istisnalar: [...istisnalar],
    kozmetik: kozmetik.disaAktar(),
    betik: betik.disaAktar(),
    meta,
    toplamKural,
    atlanan
  };
}

// Ana makine ya da üst alan adlarından biri kümede mi?
function kumedeMi(kume, host) {
  if (!kume || kume.size === 0 || !host) return false;
  if (kume.has(host)) return true;
  let i = host.indexOf('.');
  while (i !== -1) {
    if (kume.has(host.slice(i + 1))) return true;
    i = host.indexOf('.', i + 1);
  }
  return false;
}

// ayristir()'in döndürdüğü düz kozmetik nesnesindeki kural sayısı.
function kozmetikSayisi(k) {
  if (!k) return 0;
  let n = (k.genel || []).length;
  for (const liste of Object.values(k.alan || {})) n += liste.length;
  return n;
}

function urlKimligi(url) {
  return 'ozel-' + crypto.createHash('sha1').update(url).digest('hex').slice(0, 10);
}

class ListeYoneticisi {
  /**
   * @param {object} p
   * @param {object} p.store        Store örneği
   * @param {string} p.veriDizini   app.getPath('userData')
   * @param {Function} p.getir      async (url, headers) => { durum, metin, etag, sonDegisiklik }
   * @param {Function} [p.degisti]  liste içeriği değişince çağrılır
   */
  constructor({ store, veriDizini, getir, degisti }) {
    this.store = store;
    this.dizin = path.join(veriDizini, 'listeler');
    this.getir = getir;
    this.degisti = degisti || (() => {});
    this.kayitlar = new Map();     // id -> { tanim, alanlar:Set, istisnalar:Set, kozmetik, betik, ustBilgi }
    this.alanlar = new Set();
    this.istisnalar = new Set();
    this.kozmetik = new KozmetikDepo();
    this.betik = new BetikDepo();
    this._cssOnbellek = new Map();  // host -> hazırlanmış CSS
    this._zamanlayici = null;
    this._ilkZamanlayici = null;
    this._calisiyor = false;
  }

  get acik() { return this.store.ayarlar.filtreListeleriAcik !== false; }

  tanimlar() {
    const ozel = (this.store.ayarlar.ekListeler || []).map(l => ({ ...l, ozel: true }));
    return [...VARSAYILAN_LISTELER, ...ozel];
  }

  _dosya(id) { return path.join(this.dizin, id + '.json'); }

  async yukle() {
    for (const tanim of this.tanimlar()) {
      try {
        const ham = await fsp.readFile(this._dosya(tanim.id), 'utf8');
        const k = JSON.parse(ham);
        /*
         * Önbellek biçimi eskiyse kullanılmıyor. Kozmetik kurallar ham metinden
         * üretiliyor ve ham metni saklamıyoruz; eski bir önbelleği kabul etmek,
         * liste "güncel" göründüğü hâlde kozmetik filtrelerin GÜNLERCE boş
         * kalması demek olurdu. Kayıt yoksa bir sonraki denetim indiriyor.
         */
        if (k.bicim !== BICIM) continue;
        this.kayitlar.set(tanim.id, {
          tanim,
          alanlar: new Set(k.alanlar || []),
          istisnalar: new Set(k.istisnalar || []),
          kozmetik: KozmetikDepo.iceAktar(k.kozmetik),
          betik: BetikDepo.iceAktar(k.betik),
          ustBilgi: k.ustBilgi || {}
        });
      } catch {
        // Henüz indirilmemiş ya da bozuk önbellek: yerleşik listeyle devam.
      }
    }
    this._birlestir();
  }

  _birlestir() {
    const a = new Set();
    const i = new Set();
    const kz = new KozmetikDepo();
    // Yerleşik anti-adblock scriptlet'leri her zaman temel oluşturur; listeler
    // üstüne yığılır. Aynı kural iki kez gelirse eslesenler() tekrarı eliyor.
    const bt = yerleşikDepo();
    if (this.acik) {
      for (const k of this.kayitlar.values()) {
        for (const h of k.alanlar) a.add(h);
        for (const h of k.istisnalar) i.add(h);
        if (k.kozmetik) kz.birlestir(k.kozmetik);
        if (k.betik) bt.birlestir(k.betik);
      }
    }
    this.alanlar = a;
    this.istisnalar = i;
    this.kozmetik = kz;
    this.betik = bt;
    this._cssOnbellek.clear();
    this.degisti();
  }

  /**
   * Sayfaya (preload üzerinden) enjekte edilecek scriptlet'lerin derlenmiş
   * hâli. Engelleyici kapalıysa boş: hiçbir scriptlet çalışmaz.
   */
  betikVeri() {
    if (!this.acik) return { genel: [], alan: {}, istisna: {}, genelIstisna: [] };
    return this.betik.disaAktar();
  }

  /**
   * Sayfaya enjekte edilecek kozmetik CSS.
   *
   * Sonuç ana makine adı başına önbelleğe alınıyor: aynı siteyi her açışta
   * 13 binlik seçici kümesini yeniden taramak, gezinme başına ölçülebilir bir
   * gecikme demekti.
   */
  kozmetikCss(host) {
    if (!this.acik || !host) return '';
    const hazir = this._cssOnbellek.get(host);
    if (hazir !== undefined) return hazir;
    const css = this.kozmetik.css(host);
    // Önbellek sınırsız büyümesin; site sayısı bir oturumda binleri bulabilir.
    if (this._cssOnbellek.size > CSS_ONBELLEK_SINIRI) this._cssOnbellek.clear();
    this._cssOnbellek.set(host, css);
    return css;
  }

  // Listeler açılıp kapatıldığında birleşik kümeyi yeniden kurar.
  tazele() { this._birlestir(); }

  engelleniyorMu(host) {
    if (!this.acik) return false;
    if (kumedeMi(this.istisnalar, host)) return false;
    return kumedeMi(this.alanlar, host);
  }

  durum() {
    return this.tanimlar().map(tanim => {
      const k = this.kayitlar.get(tanim.id);
      const u = (k && k.ustBilgi) || {};
      return {
        id: tanim.id,
        ad: u.baslik || tanim.ad || tanim.url,
        aciklama: tanim.aciklama || '',
        url: tanim.url,
        ozel: !!tanim.ozel,
        // Kozmetik kurallar da sayılıyor: artık uygulanıyorlar, sayıdan
        // düşürmek listeyi olduğundan küçük gösterirdi.
        kural: k ? k.alanlar.size + (k.kozmetik ? k.kozmetik.sayi : 0) + (k.betik ? k.betik.sayı : 0) : 0,
        istisna: k ? k.istisnalar.size : 0,
        indirilme: u.indirilme || 0,
        surum: u.surum || '',
        hata: u.hata || ''
      };
    });
  }

  _bayatMi(tanim) {
    const k = this.kayitlar.get(tanim.id);
    if (!k || !k.ustBilgi.indirilme) return true;
    const saat = k.ustBilgi.gecerlilikSaat || VARSAYILAN_GECERLILIK_SAAT;
    return Date.now() - k.ustBilgi.indirilme > saat * 3600 * 1000;
  }

  async guncelle({ zorla = false } = {}) {
    if (this._calisiyor) return { calisiyor: true };
    this._calisiyor = true;
    let degisen = 0;
    try {
      for (const tanim of this.tanimlar()) {
        if (!zorla && !this._bayatMi(tanim)) continue;
        const oldu = await this._tekListeyiCek(tanim);
        if (oldu) degisen++;
      }
    } finally {
      this._calisiyor = false;
    }
    if (degisen) this._birlestir();
    return { degisen };
  }

  async _tekListeyiCek(tanim) {
    const mevcut = this.kayitlar.get(tanim.id);
    const ustBilgi = (mevcut && mevcut.ustBilgi) || {};
    const basliklar = {};
    if (ustBilgi.etag) basliklar['If-None-Match'] = ustBilgi.etag;
    else if (ustBilgi.sonDegisiklik) basliklar['If-Modified-Since'] = ustBilgi.sonDegisiklik;

    try {
      const y = await this.getir(tanim.url, basliklar);

      if (y.durum === 304 && mevcut) {
        // İçerik aynı: yalnızca "en son ne zaman baktık" bilgisini tazele.
        ustBilgi.indirilme = Date.now();
        ustBilgi.hata = '';
        mevcut.ustBilgi = ustBilgi;
        await this._yaz(tanim.id, mevcut);
        return false;
      }
      if (y.durum !== 200) throw new Error('HTTP ' + y.durum);
      if (y.metin.length > EN_BUYUK_BAYT) throw new Error('liste çok büyük');

      // Varsayılan listeler güvenilir; kullanıcının eklediği (ozel) listeler değil.
      // trusted-* scriptlet'ler yalnızca güvenilir listelerden çalışır.
      const c = ayristir(y.metin, !tanim.ozel);
      /*
       * "Liste tanındı mı" sınavı kozmetik kuralları da sayıyor. Yalnızca ağ
       * kurallarına bakmak, tamamı kozmetik olan listeleri (bunlar yaygın)
       * "boş" sayıp reddederdi - kullanıcı listeyi ekler, hiçbir hata görmez,
       * hiçbir şey de olmaz.
       */
      if (c.alanlar.length + kozmetikSayisi(c.kozmetik) < EN_AZ_KURAL) {
        throw new Error('liste tanınmadı ya da boş');
      }

      const kayit = {
        tanim,
        alanlar: new Set(c.alanlar),
        istisnalar: new Set(c.istisnalar),
        kozmetik: KozmetikDepo.iceAktar(c.kozmetik),
        betik: BetikDepo.iceAktar(c.betik),
        ustBilgi: {
          baslik: c.meta.baslik,
          surum: c.meta.surum,
          gecerlilikSaat: c.meta.gecerlilikSaat,
          etag: y.etag || '',
          sonDegisiklik: y.sonDegisiklik || '',
          indirilme: Date.now(),
          hata: ''
        }
      };
      this.kayitlar.set(tanim.id, kayit);
      await this._yaz(tanim.id, kayit);
      return true;
    } catch (e) {
      // Ağ yoksa ya da liste bozuksa elimizdeki son iyi kopya kullanılmaya devam eder.
      const kayit = mevcut
        || { tanim, alanlar: new Set(), istisnalar: new Set(), kozmetik: new KozmetikDepo(), betik: new BetikDepo(), ustBilgi: {} };
      kayit.ustBilgi = { ...kayit.ustBilgi, hata: String(e.message || e).slice(0, 200) };
      this.kayitlar.set(tanim.id, kayit);
      return false;
    }
  }

  async _yaz(id, kayit) {
    try {
      await fsp.mkdir(this.dizin, { recursive: true });
      const gecici = this._dosya(id) + '.tmp';
      await fsp.writeFile(gecici, JSON.stringify({
        bicim: BICIM,
        url: kayit.tanim.url,
        ustBilgi: kayit.ustBilgi,
        alanlar: [...kayit.alanlar],
        istisnalar: [...kayit.istisnalar],
        kozmetik: (kayit.kozmetik || new KozmetikDepo()).disaAktar(),
        betik: (kayit.betik || new BetikDepo()).disaAktar()
      }), 'utf8');
      await fsp.rename(gecici, this._dosya(id));
    } catch (e) {
      console.error('Liste önbelleği yazılamadı:', e.message);
    }
  }

  listeEkle(url) {
    const temiz = String(url || '').trim();
    if (!/^https:\/\/\S+$/i.test(temiz)) return { hata: 'Yalnızca https:// adresleri eklenebilir.' };
    const id = urlKimligi(temiz);
    const ek = this.store.ayarlar.ekListeler || [];
    if (ek.some(l => l.id === id) || VARSAYILAN_LISTELER.some(l => l.url === temiz)) {
      return { hata: 'Bu liste zaten ekli.' };
    }
    let ad = temiz;
    try { ad = decodeURIComponent(new URL(temiz).pathname.split('/').pop()) || temiz; } catch { /* url zaten doğrulandı */ }
    this.store.ayarla('ekListeler', [...ek, { id, ad, url: temiz }]);
    return { id };
  }

  listeSil(id) {
    const ek = this.store.ayarlar.ekListeler || [];
    if (!ek.some(l => l.id === id)) return false;
    this.store.ayarla('ekListeler', ek.filter(l => l.id !== id));
    this.kayitlar.delete(id);
    fs.rm(this._dosya(id), { force: true }, () => {});
    this._birlestir();
    return true;
  }

  async baslat() {
    await this.yukle();
    this._ilkZamanlayici = setTimeout(() => this._kontrol(), ILK_KONTROL_GECIKMESI_MS);
    this._zamanlayici = setInterval(() => this._kontrol(), KONTROL_ARALIGI_MS);
    if (this._ilkZamanlayici.unref) this._ilkZamanlayici.unref();
    if (this._zamanlayici.unref) this._zamanlayici.unref();
  }

  _kontrol() {
    if (this.store.ayarlar.otomatikGuncelle === false) return;
    this.guncelle().catch(() => {});
  }

  dur() {
    clearTimeout(this._ilkZamanlayici);
    clearInterval(this._zamanlayici);
  }
}

module.exports = { ListeYoneticisi, ayristir, kumedeMi, VARSAYILAN_LISTELER };
