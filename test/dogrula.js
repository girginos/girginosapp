'use strict';

// Electron gerektirmeyen saf mantık testleri: node test/dogrula.js
const { resolveInput, search, prettyURL, SEARCH_ENGINES } = require('../src/urls');
const { Blocker, kokAlanAdi, hostAl } = require('../src/blocker');
const { LISTE } = require('../src/blocklist');

let gecen = 0;
const hatalar = [];

function esit(ad, bulunan, beklenen) {
  if (Object.is(bulunan, beklenen)) { gecen++; return; }
  hatalar.push(ad + '\n    bulunan:  ' + JSON.stringify(bulunan) + '\n    beklenen: ' + JSON.stringify(beklenen));
}

/* ---- adres çubuğu girdisi ---- */

const adresTestleri = [
  ['github.com', 'https://github.com'],
  ['www.trthaber.com/gundem', 'https://www.trthaber.com/gundem'],
  ['https://a.b/c?d=1', 'https://a.b/c?d=1'],
  ['http://ornek.com', 'http://ornek.com'],
  ['localhost', 'http://localhost'],
  ['localhost:3000', 'http://localhost:3000'],
  ['localhost:8080/api', 'http://localhost:8080/api'],
  ['127.0.0.1:5173', 'http://127.0.0.1:5173'],
  ['192.168.1.1', 'http://192.168.1.1'],
  ['ornek.com:8080/yol', 'https://ornek.com:8080/yol'],
  ['türkçe.com', 'https://türkçe.com'],
  ['mailto:biri@ornek.com', 'mailto:biri@ornek.com'],
  ['about:blank', 'about:blank'],
  ['view-source:https://a.b', 'view-source:https://a.b'],
  ['hava durumu ankara', 'https://duckduckgo.com/?q=hava%20durumu%20ankara'],
  ['2+2 nedir', 'https://duckduckgo.com/?q=2%2B2%20nedir'],
  ['javascript:alert(1)', 'https://duckduckgo.com/?q=javascript%3Aalert(1)'],
  ['data:text/html,<b>x', 'https://duckduckgo.com/?q=data%3Atext%2Fhtml%2C%3Cb%3Ex'],
  ['   ', null],
  ['', null]
];
for (const [girdi, beklenen] of adresTestleri) {
  esit('resolveInput(' + JSON.stringify(girdi) + ')', resolveInput(girdi), beklenen);
}

// Her arama motoru gerçekten sorguyu yerleştiriyor mu?
for (const [anahtar, motor] of Object.entries(SEARCH_ENGINES)) {
  const url = search('kızıl elma', anahtar);
  esit('search motoru ' + anahtar + ' %s bırakmamalı', url.includes('%s'), false);
  esit('search motoru ' + anahtar + ' sorguyu içermeli', url.includes('k%C4%B1z%C4%B1l%20elma'), true);
  esit('search motoru ' + anahtar + ' https olmalı', url.startsWith('https://'), true);
  esit('motor adı tanımlı olmalı: ' + anahtar, typeof motor.ad === 'string' && motor.ad.length > 0, true);
}

esit('prettyURL bozuk girdide çökmemeli', prettyURL('kırık girdi'), 'kırık girdi');
esit('prettyURL boşta boş dönmeli', prettyURL(''), '');

/* ---- kök alan adı ---- */

const kokTestleri = [
  ['a.b.doubleclick.net', 'doubleclick.net'],
  ['DoubleClick.NET', 'doubleclick.net'],
  ['doubleclick.net.', 'doubleclick.net'],
  ['x.y.com.tr', 'y.com.tr'],
  ['haber.com.tr', 'haber.com.tr'],
  ['a.b.foo.co.uk', 'foo.co.uk'],
  ['localhost', 'localhost'],
  ['', '']
];
for (const [girdi, beklenen] of kokTestleri) {
  esit('kokAlanAdi(' + JSON.stringify(girdi) + ')', kokAlanAdi(girdi), beklenen);
}

esit('hostAl geçerli adres', hostAl('https://Ornek.COM/yol'), 'ornek.com');
esit('hostAl geçersiz adres', hostAl('bu bir adres değil'), '');

/* ---- engelleyici kararları ---- */

function sahteStore(ek = {}) {
  return {
    ayarlar: { engelleyiciAcik: true, dntGonder: true, ...(ek.ayarlar || {}) },
    veri: { istatistik: { engellenen: 0 } },
    siteIzinliMi: (alan) => (ek.izinliler || []).includes(alan),
    engellendiSay() {},
    kaydet() {}
  };
}

{
  const b = new Blocker(sahteStore({ izinliler: ['izinli.com'] }));
  b.ustAlanAyarla(1, 'https://haber.com/yazi/1');
  b.ustAlanAyarla(2, 'https://izinli.com/');
  const dene = (url, tur, wc) => b.engellensinMi({ url, resourceType: tur, webContentsId: wc });

  const testler = [
    ['üçüncü taraf izleyici engellenir', dene('https://www.google-analytics.com/a.js', 'script', 1), true],
    ['alt alan adı da engellenir', dene('https://a.b.doubleclick.net/x.gif', 'image', 1), true],
    ['büyük harfli host engellenir', dene('https://WWW.CRITEO.COM/t', 'script', 1), true],
    ['birinci taraf hiç engellenmez', dene('https://haber.com/app.js', 'script', 1), false],
    ['aynı kökün alt alanı engellenmez', dene('https://cdn.haber.com/a.css', 'stylesheet', 1), false],
    ['ana çerçeve hiç engellenmez', dene('https://google-analytics.com/x', 'mainFrame', 1), false],
    ['site izinliyse engellenmez', dene('https://google-analytics.com/x', 'script', 2), false],
    ['listede olmayan alan geçer', dene('https://bilinmeyen-cdn.net/a.js', 'script', 1), false],
    ['geçersiz adres çökmez', dene('bu adres değil', 'script', 1), false],
    ['bilinmeyen sekme kimliği çökmez', dene('https://criteo.com/t', 'script', 99), true]
  ];
  for (const [ad, bulunan, beklenen] of testler) esit(ad, bulunan, beklenen);

  esit('engellenen istek sayaca yazılmaz (engellensinMi saf)', b.sayac(1), 0);
}

{
  const b = new Blocker(sahteStore({ ayarlar: { engelleyiciAcik: false } }));
  b.ustAlanAyarla(1, 'https://haber.com/');
  esit('engelleyici kapalıyken hiçbir şey engellenmez',
    b.engellensinMi({ url: 'https://doubleclick.net/x', resourceType: 'script', webContentsId: 1 }), false);
}

{
  const b = new Blocker(sahteStore());
  b.ustAlanAyarla(1, 'https://haber.com/');
  b.unut(1);
  esit('unut sonrası sayaç sıfır', b.sayac(1), 0);
  esit('üst alan unutulunca istek yine de engellenir',
    b.engellensinMi({ url: 'https://criteo.com/x', resourceType: 'script', webContentsId: 1 }), true);
}

/* ---- denetimde çıkan atlatma yolları (regresyon) ---- */

{
  const b = new Blocker(sahteStore());
  b.ustAlanAyarla(1, 'https://haber.com/');
  const dene = (url) => b.engellensinMi({ url, resourceType: 'script', webContentsId: 1 });

  esit('sondaki nokta engelleyiciyi atlatamaz', dene('https://www.google-analytics.com./collect'), true);
  esit('çift sondaki nokta da atlatamaz', dene('https://criteo.com../x'), true);
  esit('büyük harf ve sondaki nokta birlikte', dene('https://WWW.CRITEO.COM./t'), true);
}

esit('IP adresi kök alan adı olarak bölünmez', kokAlanAdi('142.250.185.14'), '142.250.185.14');
esit('farklı IP farklı kovaya düşer', kokAlanAdi('10.0.185.14'), '10.0.185.14');
esit('IPv6 host bozulmaz', kokAlanAdi('[2001:db8::1]'), '[2001:db8::1]');
esit('sondaki noktalar kök alan adından atılır', kokAlanAdi('example.com..'), 'example.com');

// Adres çubuğu sahteciliği: görünmez yön karakterleri ve kimlik bilgisi.
esit('yön değiştirme karakteri adres çubuğunda çözülmez',
  prettyURL('https://evil.com/%E2%80%AEmoc.knab-eruces//:sptth').includes('‮'), false);
esit('kontrol karakterleri adres çubuğunda çözülmez',
  /[\u0000-\u001F]/.test(prettyURL('https://evil.com/%00%0Dbank.com')), false);
esit('kimlik bilgisi adres çubuğunda gösterilmez',
  prettyURL('https://bank.com%2Elogin@evil.example/'), 'https://evil.example/');
esit('normal adres bozulmadan gösterilir',
  prettyURL('https://tr.wikipedia.org/wiki/Ana_Sayfa'), 'https://tr.wikipedia.org/wiki/Ana_Sayfa');

/* ---- ana menü yerleşimi ---- */

// Menü düğmenin SOL kenarına hizalanınca dar pencerede sağa taşıyordu.
// Sağ kenar hizalaması ve pencere içine sıkıştırma burada sınanıyor.
{
  const {
    genislikTahmini, olcumdenGenislik, xKonumu,
    KISAYOL_SUTUNU, DOLGU, EN_DAR, EN_GENIS, KENAR
  } = require('../src/menu-yerlesim');

  esit('boş menüde en dar genişlik', genislikTahmini([]), EN_DAR);
  esit('kısa etiketlerde en dar genişlik',
    genislikTahmini([{ label: 'Aç' }, { label: 'Kapat' }]), EN_DAR);
  esit('uzun etiket genişliği büyütür',
    genislikTahmini([{ label: 'x'.repeat(60) }]) > EN_DAR, true);
  esit('genişlik üst sınırı aşılmaz',
    genislikTahmini([{ label: 'x'.repeat(500) }]), EN_GENIS);

  // Ölçüm yolu: Windows'ta gerçek menü ölçülerek kalibre edildi.
  // 113px en geniş etiket -> 256px menü (gözlenen).
  esit('ölçülen etiketten menü genişliği', olcumdenGenislik(113), 113 + KISAYOL_SUTUNU + DOLGU);
  esit('kalibrasyon gözlenen genişliğe yakın',
    Math.abs(olcumdenGenislik(113) - 256) <= 4, true);
  esit('geçersiz ölçüm null döner', olcumdenGenislik(0), null);
  esit('sayı olmayan ölçüm null döner', olcumdenGenislik(NaN), null);
  esit('ölçüm de üst sınıra tabi', olcumdenGenislik(9999), EN_GENIS);

  // Geniş pencere: menü düğmenin sağ kenarıyla hizalanır.
  esit('geniş pencerede sağ kenara hizalanır', xKonumu(1200, 1400, 300), 900);
  // Düğme sağ kenara dayalı: hizalama pencereyi aşardı, sıkıştırma devreye girer.
  esit('sağ kenardaki düğmede içeri sıkışır', xKonumu(400, 400, 300), 400 - 300 - KENAR);
  // Sığdığı sürece hizalama bozulmaz.
  esit('sığan durumda hizalama korunur', xKonumu(380, 400, 300), 80);
  // Pencere menüden dar: sol kenara yaslanır.
  esit('menüden dar pencerede sola yaslanır', xKonumu(200, 220, 300), KENAR);
  // Düğme solda: negatif konum üretmez.
  esit('sol kenardaki düğmede negatif konum olmaz', xKonumu(40, 1400, 300), KENAR);
  esit('sonuç her zaman pencere içinde',
    [[1200, 1400, 300], [380, 400, 300], [200, 220, 300], [40, 1400, 300]]
      .every(([s, p, g]) => xKonumu(s, p, g) >= 0 && xKonumu(s, p, g) <= Math.max(0, p - 1)), true);
}

/* ---- sol kenara hizalanan menüler (kilit simgesi) ---- */

{
  const { xKonumuSol, KENAR } = require('../src/menu-yerlesim');

  esit('sol hizalama düğmenin solunda açar', xKonumuSol(120, 1400, 300), 120);
  esit('sağa taşacaksa içeri sıkışır', xKonumuSol(1300, 1400, 300), 1400 - 300 - KENAR);
  esit('negatif konum üretmez', xKonumuSol(-50, 1400, 300), KENAR);
  esit('menüden dar pencerede sola yaslanır', xKonumuSol(100, 220, 300), KENAR);
}

/* ---- sertifika özeti ---- */

{
  const { SertifikaDeposu, ozet, tarihMetni, EN_FAZLA_HOST } = require('../src/sertifikalar');

  const sahte = {
    issuer: { organizations: ['Let\'s Encrypt'], commonName: 'R11' },
    issuerName: 'R11',
    subject: { organizations: [], commonName: 'payx.gg' },
    subjectName: 'payx.gg',
    validStart: Date.parse('2026-06-01T00:00:00Z') / 1000,
    validExpiry: Date.parse('2026-08-30T00:00:00Z') / 1000,
    fingerprint: 'sha256/AAAA',
    serialNumber: '01ab'
  };

  const o = ozet(sahte, 'tr-TR');
  esit('kurum adı tercih edilir', o.veren, 'Let\'s Encrypt');
  esit('kurum boşsa ortak ada düşer', o.sahip, 'payx.gg');
  esit('parmak izi aktarılır', o.parmakIzi, 'sha256/AAAA');
  esit('başlangıç tarihi biçimlenir', o.baslangic.length > 0, true);
  esit('sertifikasız girdi null döner', ozet(null), null);
  esit('geçersiz tarih boş metin', tarihMetni(0), '');
  esit('bozuk tarih boş metin', tarihMetni(Number.NaN), '');

  const depo = new SertifikaDeposu();
  depo.kaydet('PayX.GG', sahte);
  esit('host küçük harfe indirgenir', depo.al('payx.gg') === sahte, true);
  esit('bilinmeyen host null', depo.al('yok.test'), null);
  esit('özet host üzerinden alınır', depo.ozetAl('payx.gg', 'tr-TR').veren, 'Let\'s Encrypt');
  esit('boş host çökmez', depo.al(''), null);

  // Önbellek sınırsız büyümemeli.
  for (let i = 0; i < EN_FAZLA_HOST + 20; i++) depo.kaydet('h' + i + '.test', sahte);
  esit('önbellek sınırı korunur', depo.kayit.size <= EN_FAZLA_HOST, true);
  depo.temizle();
  esit('temizleme boşaltır', depo.kayit.size, 0);
}

/* ---- engelleme listesi bütünlüğü ---- */

esit('listede yinelenen kayıt yok', LISTE.length, new Set(LISTE).size);
esit('tüm kayıtlar küçük harf', LISTE.every(d => d === d.toLowerCase()), true);
esit('kayıtlarda şema/eğik çizgi yok', LISTE.every(d => !d.includes('://')), true);
esit('kayıtlarda boşluk yok', LISTE.every(d => !/\s/.test(d)), true);
// Engelleyici yalnızca host karşılaştırır; yol içeren kayıt asla eşleşmez.
const ALAN_BICIMI = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;
esit('her kayıt geçerli alan adı biçiminde', LISTE.filter(d => !ALAN_BICIMI.test(d)).join(', '), '');

/* ---- sonuç ---- */

/* ---- site izin duvarı deposu ---- */
{
  const { Store } = require('../src/store');
  const os = require('node:os');
  const yol = require('node:path').join(os.tmpdir(), 'izin-deneme-' + process.pid + '.json');
  const d = new Store(yol);

  esit('kayıtsız site boş döner', Object.keys(d.izinlerOku('https://a.test')).length, 0);

  d.izinAyarla('https://a.test', 'geolocation', 'ret');
  d.izinAyarla('https://a.test', 'media', 'izin');
  esit('ret kaydedildi', d.izinOku('https://a.test', 'geolocation'), 'ret');
  esit('izin kaydedildi', d.izinOku('https://a.test', 'media'), 'izin');
  esit('site listede', d.izinliOriginler().includes('https://a.test'), true);

  // 'sor' kaydı siler: varsayılan sonradan değişirse site onu izlesin.
  d.izinAyarla('https://a.test', 'geolocation', 'sor');
  esit('sor kaydı siler', d.izinOku('https://a.test', 'geolocation'), undefined);
  esit('diğer izin duruyor', d.izinOku('https://a.test', 'media'), 'izin');

  // Son karar da silinince site kaydı tamamen kalkmalı.
  d.izinAyarla('https://a.test', 'media', 'sor');
  esit('boşalan site kaydı silinir', d.izinliOriginler().includes('https://a.test'), false);

  esit('geçersiz karar reddedilir', d.izinAyarla('https://b.test', 'media', 'belki'), false);
  esit('geçersiz karar yazılmaz', d.izinOku('https://b.test', 'media'), undefined);

  try { require('node:fs').unlinkSync(yol); } catch { /* olsun */ }
}

/* ---- kullanici araci ---- */
/*
 * uaTemizle() KALDIRILDI ve testleri de. Dizeden "Electron/x" ile uygulama
 * adini silmek, tipik gorunmek icin yapiliyordu; olcum tersini soyledi:
 * dokunulmamis UA ile blackhatworld.com acildi, temizlenmis UA Cloudflare
 * dogrulama dongusune girdi (iki kosuda da). Gerekce main.js icinde,
 * oturumKur()'un ustunde yazili.
 */

/* ---- Sec-CH-UA basliklari ---- */
/*
 * Beklenen degerler UYDURMA DEGIL: calisan Electron 44'te, https bir sayfada
 * navigator.userAgentData'dan okundu. Baslik tam olarak onu yansitmali;
 * ayrisirsa duzeltmeye calistigimiz tutarsizligi geri getiririz.
 */
{
  const { ipucuBasliklari } = require('../src/istemci-ipuclari');

  const OLCULEN = [
    { brand: 'Not?A_Brand', version: '24' },
    { brand: 'Chromium', version: '152' }
  ];

  const b = ipucuBasliklari(OLCULEN, false, 'Windows');
  esit('Sec-CH-UA olculeni yansitir', b['Sec-CH-UA'], '"Not?A_Brand";v="24", "Chromium";v="152"');
  esit('mobil degil', b['Sec-CH-UA-Mobile'], '?0');
  esit('platform tirnakli', b['Sec-CH-UA-Platform'], '"Windows"');

  esit('mobil bayragi', ipucuBasliklari(OLCULEN, true, 'Android')['Sec-CH-UA-Mobile'], '?1');

  // Marka adinda tirnak/ters bolu olursa kacirilmali, yoksa baslik bozulur.
  const kacis = ipucuBasliklari([{ brand: 'A"B\\C', version: '1' }], false, 'Windows');
  esit('tirnak ve ters bolu kacirilir', kacis['Sec-CH-UA'], '"A\\"B\\\\C";v="1"');

  // Uretilemeyen durumlarda null: eksik baslik, YANLIS baslıktan iyidir.
  esit('marka yoksa null', ipucuBasliklari([], false, 'Windows'), null);
  esit('dizi degilse null', ipucuBasliklari(null, false, 'Windows'), null);
  esit('bos markalar null', ipucuBasliklari([{}], false, 'Windows'), null);

  // Platform bilinmiyorsa o baslik hic eklenmez.
  esit('platformsuz baslik yok',
    Object.hasOwn(ipucuBasliklari(OLCULEN, false, ''), 'Sec-CH-UA-Platform'), false);
}

/* ---- akıllı çerez sistemi ---- */
{
  const {
    ucuncuTarafMi, cerezTasinsinMi, silinecekCerezler, cerezSilmeUrl
  } = require('../src/cerezler');
  const { basligiSil } = require('../src/blocker');

  esit('farklı kök üçüncü taraf', ucuncuTarafMi('izleyici.com', 'haber.com'), true);
  esit('aynı kök birinci taraf', ucuncuTarafMi('haber.com', 'haber.com'), false);
  // Üst alan bilinmiyorsa dokunmuyoruz: emin olmadan çerez kesmek oturum düşürür.
  esit('üst alan yoksa üçüncü taraf sayılmaz', ucuncuTarafMi('izleyici.com', ''), false);

  const ayar = (ek) => ({ istekKoku: 'izleyici.com', ustKok: 'haber.com', engelleAcik: true, istisna: false, ...ek });
  esit('üçüncü taraf çerez taşınmaz', cerezTasinsinMi(ayar({})), false);
  esit('ayar kapalıyken taşınır', cerezTasinsinMi(ayar({ engelleAcik: false })), true);
  esit('istisna verilmişse taşınır', cerezTasinsinMi(ayar({ istisna: true })), true);
  esit('birinci taraf her zaman taşınır', cerezTasinsinMi(ayar({ istekKoku: 'haber.com' })), true);

  // Başlık adı büyük/küçük harf duyarsız; tek yazımı silmek sessiz başarısızlık olurdu.
  const b1 = { cookie: 'a=1', Accept: '*/*' };
  esit('küçük harfli başlık silinir', basligiSil(b1, 'Cookie'), true);
  esit('silinince kalmaz', Object.hasOwn(b1, 'cookie'), false);
  esit('başka başlığa dokunulmaz', b1.Accept, '*/*');
  esit('yoksa false döner', basligiSil({ Accept: '*/*' }, 'Cookie'), false);

  // Blocker üzerinden: isteğin tarafları details'ten doğru çıkarılıyor mu?
  const sahteStore = {
    ayarlar: { engelleyiciAcik: true, ucuncuTarafCerez: true },
    cerezIstisnalari: [],
    cerezIstisnasiMi(kok) { return this.cerezIstisnalari.includes(kok); }
  };
  const bl = new Blocker(sahteStore);
  bl.ustAlanAyarla(7, 'https://haber.com/gundem');
  const istek = (ek) => ({ url: 'https://izleyici.com/px', resourceType: 'image', webContentsId: 7, ...ek });

  esit('üçüncü taraf istekte çerez kesilir', bl.cerezTasinirMi(istek({})), false);
  esit('birinci taraf istekte kesilmez',
    bl.cerezTasinirMi(istek({ url: 'https://cdn.haber.com/a.js' })), true);
  /*
   * ÜST SEVİYE GEZİNME: ustAlan haritası hâlâ ESKİ sayfayı gösterirken yeni
   * siteye gidiliyor. Burada çerez kesilseydi, adres çubuğundan girilen her
   * sitede oturum kapalı görünürdü.
   */
  esit('üst seviye gezinme muaf',
    bl.cerezTasinirMi(istek({ resourceType: 'mainFrame' })), true);
  // Alt çerçeve üçüncü taraftır; çerez asıl burada kesilmeli.
  esit('alt çerçevede kesilir',
    bl.cerezTasinirMi(istek({ resourceType: 'subFrame' })), false);

  sahteStore.cerezIstisnalari.push('haber.com');
  esit('site istisnası Blocker’a da işler', bl.cerezTasinirMi(istek({})), true);
  sahteStore.cerezIstisnalari.length = 0;

  // Sekmeye bağlanamayan istek: üst alan bilinmiyor, dokunmuyoruz.
  esit('sekmesiz istekte kesilmez',
    bl.cerezTasinirMi(istek({ webContentsId: undefined })), true);

  /* kapanışta silme */
  const cerezler = [
    { domain: '.banka.com', name: 'oturum', path: '/', secure: true },
    { domain: 'hesap.banka.com', name: 'x', path: '/', secure: true },
    { domain: 'izleyici.com', name: 'kimlik', path: '/', secure: false }
  ];
  const kalan = silinecekCerezler(cerezler, new Set(['banka.com']), kokAlanAdi);
  esit('korunan kökten hiçbiri silinmez', kalan.length, 1);
  esit('silinen doğru çerez', kalan[0].name, 'kimlik');
  esit('alan adı yoksa atlanır',
    silinecekCerezler([{ domain: '', name: 'y' }], new Set(), kokAlanAdi).length, 0);

  // Şema çerezin secure bayrağıyla uyuşmazsa Electron silmeyi sessizce atlar.
  esit('secure çerez https ile silinir',
    cerezSilmeUrl({ domain: '.banka.com', path: '/', secure: true }), 'https://banka.com/');
  esit('secure olmayan http ile',
    cerezSilmeUrl({ domain: 'izleyici.com', path: '/px', secure: false }), 'http://izleyici.com/px');
  esit('alan adsız çerez için url yok', cerezSilmeUrl({ domain: '' }), null);
}

/* ---- vekil sunucu ---- */
{
  const { adresCoz, adresGecerliMi, atlamaKurali, vekilKurallari, HEP_ATLANAN } = require('../src/vekil');

  const yaz = (a) => (a ? a.sema + '|' + a.host + '|' + a.port : null);
  esit('tam adres', yaz(adresCoz('socks5://127.0.0.1:9050')), 'socks5|127.0.0.1|9050');
  esit('http varsayilan port', yaz(adresCoz('http://vekil.ornek.com')), 'http|vekil.ornek.com|8080');
  esit('socks5 varsayilan port', yaz(adresCoz('socks5://localhost')), 'socks5|localhost|1080');
  // Kullanicilarin cogu semasiz yaziyor; reddetmek gereksiz surtunme olurdu.
  esit('semasiz adres http sayilir', yaz(adresCoz('192.168.1.10:3128')), 'http|192.168.1.10|3128');
  esit('IPv6 koseli parantezle', yaz(adresCoz('socks5://[::1]:9050')), 'socks5|[::1]|9050');

  /*
   * socks4 BILEREK reddediliyor: Chromium'da socks4 alan adini YEREL cozer,
   * yani gezilen her sitenin adi vekilden once DNS'e duser. Kullanici
   * korundugunu sanarken alan adlari sizardi.
   */
  esit('socks4 kabul edilmez', adresCoz('socks4://127.0.0.1:9050'), null);
  esit('bilinmeyen sema kabul edilmez', adresCoz('ftp://a.b:21'), null);
  esit('yol tasiyan adres kabul edilmez', adresCoz('http://a.b:8080/yol'), null);
  esit('kullanici adi kabul edilmez', adresCoz('http://ad@a.b:8080'), null);
  esit('gecersiz port', adresCoz('http://a.b:abc'), null);
  esit('sifir port', adresCoz('http://a.b:0'), null);
  esit('cok buyuk port', adresCoz('http://a.b:70000'), null);
  esit('bos adres', adresCoz(''), null);
  esit('null adres', adresCoz(null), null);
  esit('adresGecerliMi dogru', adresGecerliMi('socks5://127.0.0.1:9050'), true);
  esit('adresGecerliMi yanlis', adresGecerliMi('socks4://x'), false);

  // Yerel adresler vekile gonderilirse hem anlamsiz hem de Tor'da hata.
  const atla = atlamaKurali('ornek.com, 10.0.0.1');
  for (const y of HEP_ATLANAN) esit('yerel atlanir: ' + y, atla.split(',').includes(y), true);
  esit('kullanici girdisi eklenir', atla.split(',').includes('ornek.com'), true);
  esit('yerel adres iki kez yazilmaz',
    atlamaKurali('localhost').split(',').filter((x) => x === 'localhost').length, 1);
  esit('bos girdi cokmez', atlamaKurali('').includes('localhost'), true);

  esit('kapali kip dogrudan', vekilKurallari({ vekilKip: 'kapali' }).mode, 'direct');
  esit('ayar yoksa dogrudan', vekilKurallari({}).mode, 'direct');
  esit('sistem kipi', vekilKurallari({ vekilKip: 'sistem' }).mode, 'system');

  const elle = vekilKurallari({ vekilKip: 'elle', vekilAdres: 'socks5://127.0.0.1:9050', vekilAtla: '' });
  esit('elle kipi sabit sunucu', elle.mode, 'fixed_servers');
  esit('kural dizesi', elle.proxyRules, 'socks5://127.0.0.1:9050');
  esit('elle kipi gecerli', elle.gecerli, true);

  /*
   * Adres bozukken DOGRUDAN baglanmaya dusmuyoruz: yazim hatasi yapan biri
   * korundugunu sanarak gezmeye devam ederdi. Erisilemeyen bir kural istegi
   * basarisiz kilar - hata gorunur, sizinti gorunmez.
   */
  const bozuk = vekilKurallari({ vekilKip: 'elle', vekilAdres: 'socks4://x', vekilAtla: '' });
  esit('bozuk adres dogrudana dusmez', bozuk.mode, 'fixed_servers');
  esit('bozuk adres gecersiz isaretli', bozuk.gecerli, false);
  esit('bozuk adres erisilemez kural', bozuk.proxyRules, 'http://0.0.0.0:1');
  esit('bos adres de dogrudana dusmez',
    vekilKurallari({ vekilKip: 'elle', vekilAdres: '', vekilAtla: '' }).mode, 'fixed_servers');
}

/* ---- kozmetik filtreler ---- */
{
  const { KozmetikDepo, kuralCoz, alanUyar, DEMET } = require('../src/kozmetik');

  const coz = (s) => kuralCoz(s);
  esit('genel kural', JSON.stringify(coz('##.reklam')),
    JSON.stringify({ tip: 'gizle', alanlar: [], eksiler: [], secici: '.reklam' }));
  esit('alana özel kural', coz('ornek.com##.kutu').alanlar[0], 'ornek.com');
  esit('çoklu alan', coz('a.com,b.net##.x').alanlar.length, 2);
  esit('dışlanan alan', coz('a.com,~alt.a.com##.x').eksiler[0], 'alt.a.com');
  esit('istisna kuralı', coz('a.com#@#.x').tip, 'istisna');
  esit('seçicide boşluk korunur', coz('a.com##div > .y').secici, 'div > .y');

  // Yordamsal ve eklenti söz dizimi CSS'e çevrilemez; yarısını uygulamak
  // seçiciyi geçersiz kılıp yanındaki kuralları da düşürürdü.
  esit('yordamsal kural alınmaz', coz('a.com#?#div:has-text(reklam)'), null);
  esit('stil kuralı alınmaz', coz('a.com#$#body { x: y }'), null);
  esit('has-text alınmaz', coz('a.com##div:has-text(reklam)'), null);
  esit('xpath alınmaz', coz('a.com##:xpath(//div)'), null);
  // Süslü parantez enjekte edilen CSS'ten kaçıp kendi kuralını yazabilirdi.
  esit('süslü parantezli seçici alınmaz', coz('a.com##div{color:red}'), null);
  esit('ayraçsız satır kural değil', coz('||izleyici.com^'), null);
  // :has() artık gerçek CSS; atmak 152 sürümde çalışan kuralları kaybettirirdi.
  esit('yerel :has() kabul edilir', coz('a.com##div:has(> .ad)').secici, 'div:has(> .ad)');

  esit('tam eşleşme', alanUyar('ornek.com', 'ornek.com'), true);
  esit('alt alan adı', alanUyar('ornek.com', 'www.ornek.com'), true);
  esit('benzer ama başka alan', alanUyar('ornek.com', 'kotuornek.com'), false);
  esit('varlık biçimi .com', alanUyar('google.*', 'google.com'), true);
  esit('varlık biçimi iki seviyeli', alanUyar('google.*', 'www.google.co.uk'), true);
  /*
   * Saldırgan "google.com.kotu.com" alan adını alıp google için yazılmış
   * gizleme kurallarını kendi sayfasında çalıştırabilirdi.
   */
  esit('varlık biçimi sonda TLD ister', alanUyar('google.*', 'google.com.kotu.com'), false);

  const d = new KozmetikDepo();
  d.ekle(coz('##.genel-reklam'));
  d.ekle(coz('haber.com##.yan-kutu'));
  d.ekle(coz('haber.com#@#.genel-reklam'));
  d.ekle(coz('spor.com,~canli.spor.com##.afis'));

  esit('genel seçici her sitede', d.seciciler('baska.com').includes('.genel-reklam'), true);
  esit('alana özel seçici', d.seciciler('www.haber.com').includes('.yan-kutu'), true);
  esit('başka sitede alana özel yok', d.seciciler('baska.com').includes('.yan-kutu'), false);
  // İstisna, genel kuralı o site için kaldırır.
  esit('istisna genel kuralı kaldırır', d.seciciler('haber.com').includes('.genel-reklam'), false);
  esit('istisna başka siteyi etkilemez', d.seciciler('spor.com').includes('.genel-reklam'), true);
  esit('dışlanan alt alanda uygulanmaz', d.seciciler('canli.spor.com').includes('.afis'), false);
  esit('dışlama üst alanı etkilemez', d.seciciler('spor.com').includes('.afis'), true);
  esit('host yoksa seçici yok', d.seciciler('').length, 0);

  /*
   * Seçiciler demetlere bölünüyor: CSS'te tek bir geçersiz seçici, virgülle
   * bağlı demetin TAMAMINI düşürür. Tek demet kullansaydık listeye giren bozuk
   * bir seçici bütün kozmetik filtrelemeyi sessizce kapatırdı.
   */
  const cok = new KozmetikDepo();
  for (let i = 0; i < DEMET * 2 + 1; i++) cok.ekle(coz('##.k' + i));
  const satirlar = cok.css('ornek.com').split('\n');
  esit('demetlere bölünür', satirlar.length, 3);
  esit('demet boyu aşılmaz', satirlar[0].split('{')[0].split(',').length, DEMET);
  esit('kural gizleme kuralı', satirlar[0].endsWith('{display:none!important}'), true);
  esit('seçici yoksa boş CSS', new KozmetikDepo().css('ornek.com'), '');

  // Önbelleğe yazılıp geri okunduğunda kurallar aynı kalmalı.
  const geri = KozmetikDepo.iceAktar(d.disaAktar());
  esit('dışa/içe aktarım korur',
    JSON.stringify(geri.seciciler('haber.com').sort()), JSON.stringify(d.seciciler('haber.com').sort()));

  const oteki = new KozmetikDepo();
  oteki.ekle(coz('haber.com##.ikinci-liste'));
  geri.birlestir(oteki);
  esit('listeler birleşir', geri.seciciler('haber.com').includes('.ikinci-liste'), true);
}

if (hatalar.length) {
  console.error('\nBAŞARISIZ (' + hatalar.length + '):\n');
  for (const h of hatalar) console.error('  ✗ ' + h + '\n');
  console.error(gecen + ' test geçti, ' + hatalar.length + ' test kaldı.');
  process.exit(1);
}
console.log('✓ ' + gecen + ' testin hepsi geçti.');
