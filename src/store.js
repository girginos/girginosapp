'use strict';

const fs = require('node:fs');
const path = require('node:path');

const DEFAULTS = {
  ayarlar: {
    // 'sistem' -> işletim sisteminin diline göre seçilir
    dil: 'sistem',
    // 'sistem' | 'acik' | 'koyu' -> nativeTheme.themeSource'a aktarilir,
    // boylece ic sayfalar ve yerel menuler de birlikte doner.
    tema: 'sistem',
    aramaMotoru: 'duckduckgo',
    engelleyiciAcik: true,
    dntGonder: true,
    // Üçüncü taraf çerezleri siteler arası takibin ana taşıyıcısı; varsayılan
    // olarak taşınmıyorlar. Bozulan bir site çıkarsa adres çubuğundaki site
    // menüsünden o siteye özel istisna verilebilir.
    ucuncuTarafCerez: true,
    // Kapanışta çerezleri sil. Yer imlerindeki siteler korunur: onlar
    // kullanıcının bilerek sakladığı, oturumunu kaybetmek istemediği siteler.
    kapanistaCerezSil: false,
    // Vekil sunucu. 'kapali' | 'sistem' | 'elle'
    // Tor için: elle + socks5://127.0.0.1:9050
    vekilKip: 'sistem',
    vekilAdres: '',
    vekilAtla: '',
    gecmisiKaydet: true,
    anasayfa: '',
    yerImleriCubugu: true,
    // Yeni sekme sayfasındaki tanıtım/reklam alanı. Üçüncü taraf bir reklam
    // ağı KULLANILMIYOR: kartlar buradan okunur, sayfa dışarı istek atmaz.
    // Kendi kartlarınızı eklemek için pusula-veri.json içindeki bu diziyi
    // düzenleyin: { etiket, baslik, metin, url }.
    duyurular: [
      {
        etiket: 'Girginos Browser',
        baslik: 'İzleyici engelleyici çalışıyor',
        metin: 'EasyList ve EasyPrivacy listeleri arka planda güncelleniyor; bu sayfa hiçbir yere istek atmıyor.',
        url: ''
      }
    ],
    // Uygulama güncellemesi
    guncellemeKontrol: true,
    guncellemeIndir: true,
    guncellemeKanali: 'kararli',
    // İndirilen filtre listeleri (EasyList vb.)
    filtreListeleriAcik: true,
    otomatikGuncelle: true,
    ekListeler: [],          // [{ id, ad, url }]
    // İzin türü başına genel karar: 'sor' | 'izin' | 'ret'.
    // Gürültülü ve nadiren istenen izinler varsayılan olarak sessizce reddedilir;
    // kullanıcı Ayarlar'dan her birini "Sor"a çevirebilir.
    izinVarsayilan: {
      notifications: 'ret',
      geolocation: 'ret',
      midi: 'ret',
      midiSysex: 'ret',
      'clipboard-read': 'ret',
      'idle-detection': 'ret',
      pointerLock: 'ret',
      media: 'sor',
      'display-capture': 'sor',
      openExternal: 'sor',
      fullscreen: 'izin'
    }
  },
  gecmis: [],        // { url, baslik, zaman }
  yerImleri: [],     // { url, baslik, zaman }
  izinler: {},       // origin -> { [permission]: 'izin' | 'ret' }
  siteIzinleri: [],     // engelleyicinin devre dışı bırakıldığı alan adları
  cerezIstisnalari: [], // üçüncü taraf çereze izin verilen üst seviye kökler
  istatistik: { engellenen: 0 }
};

const MAX_GECMIS = 5000;

class Store {
  constructor(dosya) {
    this.dosya = dosya;
    this.veri = structuredClone(DEFAULTS);
    this._zamanlayici = null;
    this.yukle();
  }

  yukle() {
    try {
      const ham = fs.readFileSync(this.dosya, 'utf8');
      const kayit = JSON.parse(ham);
      this.veri = {
        ...structuredClone(DEFAULTS),
        ...kayit,
        ayarlar: { ...DEFAULTS.ayarlar, ...(kayit.ayarlar || {}) },
        istatistik: { ...DEFAULTS.istatistik, ...(kayit.istatistik || {}) }
      };
      // İç içe ayar: yeni sürümde eklenen izin türleri kaybolmasın.
      this.veri.ayarlar.izinVarsayilan = {
        ...DEFAULTS.ayarlar.izinVarsayilan,
        ...((kayit.ayarlar && kayit.ayarlar.izinVarsayilan) || {})
      };
      /*
       * DİZİ OLMASI GEREKEN ALANLAR ZORLANIYOR.
       *
       * Bu dosya elle düzenlenebiliyor (yeni sekme kartları için öyle
       * söylüyoruz). Bir dizi alanı yanlışlıkla nesne ya da metin olursa
       * .includes çağrısı fırlıyor; o çağrı webRequest işleyicisinin içinde
       * olduğu için tarayıcıda HİÇBİR istek tamamlanmıyordu. Ölçüldü.
       */
      for (const alan of ['gecmis', 'yerImleri', 'siteIzinleri', 'cerezIstisnalari']) {
        if (!Array.isArray(this.veri[alan])) this.veri[alan] = [];
      }
      if (!this.veri.izinler || typeof this.veri.izinler !== 'object' || Array.isArray(this.veri.izinler)) {
        this.veri.izinler = {};
      }
      if (!Array.isArray(this.veri.ayarlar.ekListeler)) this.veri.ayarlar.ekListeler = [];
    } catch {
      // İlk açılış ya da bozuk dosya: varsayılanlarla devam.
    }
  }

  // Geçici dosyaya yazıp yeniden adlandırıyoruz: yazma sırasındaki bir çökme
  // mevcut veriyi yarım bırakmasın.
  _diskeYaz() {
    try {
      fs.mkdirSync(path.dirname(this.dosya), { recursive: true });
      const gecici = this.dosya + '.tmp';
      fs.writeFileSync(gecici, JSON.stringify(this.veri, null, 2), 'utf8');
      fs.renameSync(gecici, this.dosya);
    } catch (e) {
      console.error('Ayarlar kaydedilemedi:', e.message);
    }
  }

  // Diske yazmayı topluca yap; her gezinmede senkron yazmak arayüzü takar.
  kaydet() {
    if (this._zamanlayici) return;
    this._zamanlayici = setTimeout(() => {
      this._zamanlayici = null;
      this._diskeYaz();
    }, 400);
  }

  hemenKaydet() {
    if (this._zamanlayici) {
      clearTimeout(this._zamanlayici);
      this._zamanlayici = null;
    }
    this._diskeYaz();
  }

  get ayarlar() { return this.veri.ayarlar; }

  ayarla(anahtar, deger) {
    this.veri.ayarlar[anahtar] = deger;
    this.kaydet();
    return this.veri.ayarlar;
  }

  gecmiseEkle(url, baslik) {
    if (!this.veri.ayarlar.gecmisiKaydet) return;
    // Yalnızca gerçek web adresleri: data:/blob:/view-source:/file: diske yazılmaz.
    if (!url || !/^https?:\/\//i.test(url)) return;
    const son = this.veri.gecmis[0];
    if (son && son.url === url) {
      // Başlık da değişmediyse diske yazmaya değmez; başlığını sürekli
      // güncelleyen siteler saniyede birkaç kez kayıt tetikliyordu.
      const ayni = son.baslik === (baslik || son.baslik);
      son.baslik = baslik || son.baslik;
      son.zaman = Date.now();
      if (ayni) return;
    } else {
      this.veri.gecmis.unshift({ url, baslik: baslik || url, zaman: Date.now() });
      if (this.veri.gecmis.length > MAX_GECMIS) this.veri.gecmis.length = MAX_GECMIS;
    }
    this.kaydet();
  }

  gecmisAra(sorgu, limit = 200) {
    const q = String(sorgu || '').toLowerCase().trim();
    const kaynak = this.veri.gecmis;
    if (!q) return kaynak.slice(0, limit);
    return kaynak.filter(k =>
      k.url.toLowerCase().includes(q) || (k.baslik || '').toLowerCase().includes(q)
    ).slice(0, limit);
  }

  // Yeni sekme sayfasındaki "Sık gidilenler" için: alan adı başına tekilleştirip
  // ziyaret sayısına, eşitlikte tazeliğe göre sıralar.
  sikGidilenler(limit = 8) {
    const kovalar = new Map();
    for (const k of this.veri.gecmis) {
      let host;
      try { host = new URL(k.url).hostname.replace(/^www\./, ''); } catch { continue; }
      if (!host) continue;
      const v = kovalar.get(host);
      if (v) {
        v.sayi++;
        if (k.zaman > v.zaman) { v.zaman = k.zaman; v.url = k.url; v.baslik = k.baslik; }
      } else {
        kovalar.set(host, { host, url: k.url, baslik: k.baslik || host, zaman: k.zaman, sayi: 1 });
      }
    }
    return [...kovalar.values()]
      .sort((a, b) => (b.sayi - a.sayi) || (b.zaman - a.zaman))
      .slice(0, limit)
      .map(v => ({ url: v.url, host: v.host, baslik: v.baslik, sayi: v.sayi }));
  }

  gecmisiTemizle() {
    this.veri.gecmis = [];
    this.hemenKaydet();
  }

  /*
   * Yer imi listesi her değiştiğinde artan sürüm. durum yayını yer imlerini
   * (favicon'larıyla ~6 KB) yalnızca bu sürüm değişince gönderiyor; sayfa
   * geçişi/yükleme gibi olaylarda boşuna tekrar tekrar yollamıyor.
   */
  get yerImiSurum() { return this._yerImiSurum || 0; }
  _yerImiDegisti() { this._yerImiSurum = (this._yerImiSurum || 0) + 1; }

  yerImiVarMi(url) {
    return this.veri.yerImleri.some(y => y.url === url);
  }

  yerImiDegistir(url, baslik) {
    const i = this.veri.yerImleri.findIndex(y => y.url === url);
    if (i >= 0) this.veri.yerImleri.splice(i, 1);
    else this.veri.yerImleri.unshift({ url, baslik: baslik || url, zaman: Date.now() });
    this._yerImiDegisti();
    this.kaydet();
    return i < 0;
  }

  yerImiSil(url) {
    const i = this.veri.yerImleri.findIndex(y => y.url === url);
    if (i >= 0) { this.veri.yerImleri.splice(i, 1); this._yerImiDegisti(); this.kaydet(); }
  }

  // Yer iminin adını ve/veya adresini değiştirir.
  yerImiGuncelle(eskiUrl, { ad, url }) {
    const y = this.veri.yerImleri.find(k => k.url === eskiUrl);
    if (!y) return false;
    if (typeof ad === 'string') y.baslik = ad.trim().slice(0, 200) || y.baslik;
    if (typeof url === 'string' && /^https?:\/\//i.test(url)) {
      // Aynı adrese ikinci bir kayıt oluşmasın.
      if (url !== eskiUrl && this.veri.yerImleri.some(k => k.url === url)) return false;
      y.url = url;
    }
    this._yerImiDegisti();
    this.kaydet();
    return true;
  }

  // Verilen adres sırasına göre yeniden dizer; listede olmayanlar sonda kalır.
  yerImiSirala(sirali) {
    if (!Array.isArray(sirali)) return false;
    const konum = new Map(sirali.map((u, i) => [u, i]));
    this.veri.yerImleri.sort((a, b) => {
      const x = konum.has(a.url) ? konum.get(a.url) : Number.MAX_SAFE_INTEGER;
      const y = konum.has(b.url) ? konum.get(b.url) : Number.MAX_SAFE_INTEGER;
      return x - y;
    });
    this._yerImiDegisti();
    this.kaydet();
    return true;
  }

  engellendiSay(adet = 1) {
    this.veri.istatistik.engellenen += adet;
    this.kaydet();
  }

  siteIzinliMi(alanAdi) {
    return this.veri.siteIzinleri.includes(alanAdi);
  }

  siteIzniDegistir(alanAdi) {
    const i = this.veri.siteIzinleri.indexOf(alanAdi);
    if (i >= 0) this.veri.siteIzinleri.splice(i, 1);
    else this.veri.siteIzinleri.push(alanAdi);
    this.kaydet();
    return i < 0;
  }

  /*
   * Üçüncü taraf çerez istisnası. Anahtar, isteğin değil SEKMEDEKİ sayfanın
   * kökü: kullanıcı "şu sitede çerezler çalışsın" diyor, "şu izleyici her
   * yerde çalışsın" demiyor.
   */
  cerezIstisnasiMi(kok) {
    return this.veri.cerezIstisnalari.includes(kok);
  }

  cerezIstisnasiDegistir(kok) {
    if (!kok) return false;
    const i = this.veri.cerezIstisnalari.indexOf(kok);
    if (i >= 0) this.veri.cerezIstisnalari.splice(i, 1);
    else this.veri.cerezIstisnalari.push(kok);
    this.kaydet();
    return i < 0;
  }

  /*
   * Kapanışta silinmeyecek kökler: yer imleri. Ayrı bir "korunan siteler"
   * listesi tutmuyoruz; kullanıcının zaten bilerek işaretlediği siteler bu
   * soruya yeterince iyi cevap veriyor ve doldurulmayı bekleyen boş bir liste
   * bırakmıyor.
   */
  korunanCerezKokleri(kokBul) {
    const kokler = new Set();
    for (const y of this.veri.yerImleri) {
      let host;
      try { host = new URL(y.url).hostname; } catch { continue; }
      const kok = kokBul(host);
      if (kok) kokler.add(kok);
    }
    return kokler;
  }

  izinKaydet(origin, izinAdi, karar) {
    if (!this.veri.izinler[origin]) this.veri.izinler[origin] = {};
    this.veri.izinler[origin][izinAdi] = karar;
    this.kaydet();
  }

  izinOku(origin, izinAdi) {
    return this.veri.izinler[origin] && this.veri.izinler[origin][izinAdi];
  }

  /*
   * Site izin duvarı için üç durumlu ayar. 'sor' kaydı SİLER: kayıt yokluğu
   * zaten "genel varsayılana dön" demek. Ayrı bir 'sor' değeri saklamak,
   * varsayılan sonradan değişince kullanıcının hiç vermediği bir kararı
   * dondurmuş olurdu.
   */
  izinAyarla(origin, izinAdi, karar) {
    if (karar === 'sor') {
      if (this.veri.izinler[origin]) {
        delete this.veri.izinler[origin][izinAdi];
        if (!Object.keys(this.veri.izinler[origin]).length) delete this.veri.izinler[origin];
        this.kaydet();
      }
      return true;
    }
    if (karar !== 'izin' && karar !== 'ret') return false;
    this.izinKaydet(origin, izinAdi, karar);
    return true;
  }

  // Bir sitenin hatırlanan bütün kararları.
  izinlerOku(origin) {
    return { ...(this.veri.izinler[origin] || {}) };
  }

  // Kayıtlı kararı olan siteler; izin duvarı listesinde gösteriliyor.
  izinliOriginler() {
    return Object.keys(this.veri.izinler).sort();
  }

  izinVarsayilanAyarla(izinAdi, karar) {
    this.veri.ayarlar.izinVarsayilan[izinAdi] = karar;
    this.kaydet();
    return this.veri.ayarlar.izinVarsayilan;
  }

  // Tek bir sitenin hatırlanan izin kararlarını siler.
  izinSil(origin) {
    if (!this.veri.izinler[origin]) return false;
    delete this.veri.izinler[origin];
    this.kaydet();
    return true;
  }

  izinleriTemizle() {
    this.veri.izinler = {};
    this.veri.siteIzinleri = [];
    this.veri.cerezIstisnalari = [];
    this.hemenKaydet();
  }
}

module.exports = { Store, DEFAULTS };
