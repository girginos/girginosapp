'use strict';

/*
 * Saldırgan girdilerle güvenlik regresyon testleri: node test/guvenlik.js
 *
 * Her blok, 2025-2026'da gerçek tarayıcılarda kapatılan bir açık sınıfına
 * karşılık geliyor. Amaç "bu kod güvenli" demek değil; bir kez kapatılan
 * kapının yeniden açılmasını engellemek.
 */

const {
  sayfadanGezilebilir, disSemaIzinli, indirmeAdiNormalle,
  calistirilabilirMi, icSayfaDenetleyici
} = require('../src/guvenlik');
const { resolveInput, prettyURL } = require('../src/urls');
const { Blocker, kokAlanAdi, hostAl } = require('../src/blocker');

let gecen = 0;
const hatalar = [];

function esit(ad, bulunan, beklenen) {
  if (Object.is(bulunan, beklenen)) { gecen++; return; }
  hatalar.push(ad + '\n    bulunan:  ' + JSON.stringify(bulunan) + '\n    beklenen: ' + JSON.stringify(beklenen));
}

/* ================================================================
   1) Adres çubuğu sahteciliği
   Chrome 2026: CVE-2026-11666, -13988, -84356 (omnibox / tam ekran
   UI misrepresentation). Adres çubuğu bir tarayıcının tek gerçek
   güvenlik göstergesi; okunanla gidilen aynı olmalı.
   ================================================================ */

// Yön değiştirme karakteri çözülürse "evil.com/‮moc.knab" banka gibi okunur.
esit('RLO adres çubuğunda çözülmez',
  prettyURL('https://evil.com/%E2%80%AEmoc.knab-eruces//:sptth').includes('\u202E'), false);
esit('LRO çözülmez',
  prettyURL('https://evil.com/%E2%80%AD').includes('\u202D'), false);
esit('yön yalıtımı çözülmez',
  prettyURL('https://evil.com/%E2%81%A6').includes('\u2066'), false);

// Kontrol karakterleri satır kırıp adresi kesik gösterebilir.
esit('CR/LF çözülmez',
  /[\r\n]/.test(prettyURL('https://evil.com/%0D%0Abank.com')), false);
esit('NUL çözülmez',
  prettyURL('https://evil.com/%00bank.com').includes('\u0000'), false);
esit('sekme çözülmez',
  prettyURL('https://evil.com/%09bank.com').includes('\t'), false);

// Boşluk doldurma: gerçek alan adını görünürden kaydırma.
esit('boşluk kodlu kalır',
  prettyURL('https://evil.com/' + '%20'.repeat(30) + 'bank.com').includes('  '), false);

// Kimlik bilgisi kısmı "bank.com@evil.com" tuzağı kurar.
esit('userinfo gizlenir',
  prettyURL('https://bank.com%2Elogin@evil.example/'), 'https://evil.example/');
esit('userinfo + port gizlenir',
  prettyURL('https://bank.com:443@evil.example:8443/'), 'https://evil.example:8443/');

// IDN homograf: Kiril "а" ile apple.com. Punycode görünür kalmalı.
esit('IDN homograf punycode olarak gösterilir',
  prettyURL('https://\u0430pple.com/').includes('xn--'), true);

// Alt alan adı doldurmasında kayıtlanabilir alan doğru bulunmalı;
// arayüz bu değeri koyu yazarak gerçek sahibi öne çıkarıyor.
esit('alt alan doldurmasında gerçek sahip bulunur',
  kokAlanAdi(hostAl('https://accounts.google.com.giris.evil.com/x')), 'evil.com');
esit('normal adreste sahip doğru', kokAlanAdi(hostAl('https://mail.google.com/x')), 'google.com');

esit('normal adres bozulmadan gösterilir',
  prettyURL('https://tr.wikipedia.org/wiki/Ana_Sayfa'), 'https://tr.wikipedia.org/wiki/Ana_Sayfa');

/* ================================================================
   2) Dahili sayfa kimliğine bürünme
   İndirilen bir "newtab.html" dahili sayfa sanılırsa adres çubuğu
   boşalır ve saldırgan sahte bir tarayıcı arayüzü çizebilir.
   ================================================================ */

const IC = [
  'file:///C:/Program%20Files/Pusula/ui/newtab.html',
  'file:///C:/Program%20Files/Pusula/ui/error.html'
];
const icSayfaMi = icSayfaDenetleyici(IC);

esit('gerçek dahili sayfa tanınır', icSayfaMi(IC[0]), true);
esit('sorgu parametresi kimliği bozmaz', icSayfaMi(IC[0] + '?motor=google'), true);
esit('indirilen newtab.html dahili sayılmaz',
  icSayfaMi('file:///C:/Users/kurban/Downloads/newtab.html'), false);
esit('sorgudaki ad kandırmaz',
  icSayfaMi('file:///C:/kotu/x.html?q=newtab.html'), false);
esit('benzer ad kandırmaz',
  icSayfaMi('file:///C:/kotu/error.html.exe.html'), false);
esit('uzak adres dahili sayılmaz', icSayfaMi('https://evil.com/newtab.html'), false);

/* ================================================================
   3) Şema geçişleri
   Chrome 2026: CVE-2026-84354 (FileSystem'de hatalı yetkilendirme).
   Sayfa kaynaklı gezinme yerel dosyaya ulaşamamalı.
   ================================================================ */

const sayfadanIzinli = [
  'https://ornek.com/a', 'http://ornek.com/a', 'view-source:https://ornek.com/a'
];
const sayfadanYasak = [
  'file:///C:/Windows/win.ini',
  'file://///sunucu/paylasim/x',
  'chrome://settings',
  'devtools://devtools/bundled/x.html',
  'javascript:alert(1)',
  'data:text/html,<b>x',
  'blob:https://evil.com/1234',
  'view-source:file:///C:/Windows/win.ini',
  'ms-msdt:/id',
  'search-ms:query=x'
];
for (const u of sayfadanIzinli) esit('sayfadan izinli: ' + u, sayfadanGezilebilir(u), true);
for (const u of sayfadanYasak) esit('sayfadan yasak: ' + u, sayfadanGezilebilir(u), false);

// Harici uygulamaya devir dar bir listeyle sınırlı.
esit('mailto devredilir', disSemaIzinli('mailto:a@b.com'), true);
esit('tel devredilir', disSemaIzinli('tel:+905550000000'), true);
esit('ms-msdt devredilmez', disSemaIzinli('ms-msdt:/id PCWDiagnostic'), false);
esit('search-ms devredilmez', disSemaIzinli('search-ms:query=x&crumb=location:\\\\1.2.3.4\\pay'), false);
esit('ms-appinstaller devredilmez', disSemaIzinli('ms-appinstaller://?source=https://evil/x'), false);
esit('file devredilmez', disSemaIzinli('file:///C:/Windows/win.ini'), false);
esit('bozuk adres devredilmez', disSemaIzinli('bu adres değil'), false);

// Adres çubuğuna yazılan tehlikeli şemalar aramaya düşer.
for (const s of ['javascript:alert(1)', 'data:text/html,<b>x', 'blob:https://e/1']) {
  esit('adres çubuğunda etkisiz: ' + s,
    String(resolveInput(s)).startsWith('https://duckduckgo.com/'), true);
}
esit('JaVaScRiPt büyük harfle de etkisiz',
  String(resolveInput('JaVaScRiPt:alert(1)')).startsWith('https://duckduckgo.com/'), true);

/* ================================================================
   4) İndirmeler
   Windows yol çözümlemesinde sondaki nokta/boşluk atılır; "evil.exe "
   diskte .exe olarak çalışır. Görünmez karakterler uzantıyı ters
   gösterir. İkisi de uyarıyı atlatmamalı.
   ================================================================ */

const calistirilabilirler = [
  'kurulum.exe', 'evil.EXE', 'evil.exe ', 'evil.exe.', 'evil.exe...   ',
  'evil.lnk', 'evil.msi', 'evil.ps1', 'evil.cmd', 'evil.hta', 'evil.scr',
  'guncelleme.png.exe', 'arsiv.jar', 'kayit.reg', 'kisayol.url'
];
const zararsizlar = [
  'fatura.pdf', 'rapor.png', 'sunum.pptx', 'evil.exe.png', 'notlar.txt', 'arsiv.zip'
];
for (const a of calistirilabilirler) esit('çalıştırılabilir: ' + JSON.stringify(a), calistirilabilirMi(a), true);
for (const a of zararsizlar) esit('zararsız: ' + JSON.stringify(a), calistirilabilirMi(a), false);

// RLO ile gizlenen uzantı hem temizlenmeli hem yakalanmalı.
esit('RLO dosya adı temizlenir', indirmeAdiNormalle('fatura\u202Egnp.exe'), 'faturagnp.exe');
esit('RLO ile gizlenen exe yakalanır', calistirilabilirMi('fatura\u202Egnp.exe'), true);
esit('yol ayırıcı ada karışmaz', indirmeAdiNormalle('a/b\\c.pdf'), 'a_b_c.pdf');
esit('boş ad yedeğe düşer', indirmeAdiNormalle('   '), 'dosya');
esit('sadece nokta yedeğe düşer', indirmeAdiNormalle('...'), 'dosya');

/* ================================================================
   5) İzleyici engelleyici atlatma
   ================================================================ */

{
  const sahteStore = {
    ayarlar: { engelleyiciAcik: true, dntGonder: true },
    veri: { istatistik: { engellenen: 0 } },
    siteIzinliMi: () => false,
    engellendiSay() {},
    kaydet() {}
  };
  const b = new Blocker(sahteStore);
  b.ustAlanAyarla(1, 'https://haber.com/');
  const dene = (url) => b.engellensinMi({ url, resourceType: 'script', webContentsId: 1 });

  esit('sondaki nokta atlatamaz', dene('https://www.google-analytics.com./x'), true);
  esit('büyük harf atlatamaz', dene('https://WWW.CRITEO.COM/x'), true);
  esit('birinci taraf kesilmez', dene('https://cdn.haber.com/app.js'), false);
  esit('ana çerçeve kesilmez',
    b.engellensinMi({ url: 'https://criteo.com/x', resourceType: 'mainFrame', webContentsId: 1 }), false);
}

/* ---- izin kapıları bağlı mı ---- */
/*
 * Bu üç kapı uzun süre HİÇ bağlanmamıştı ve bağlanmadıklarında Electron'un
 * varsayılanı sessizce devreye giriyor: setPermissionCheckHandler yoksa her
 * denetim TRUE döner, yani site "izinliyim" cevabı alır. Kaybolmaları hata
 * vermediği için mekanik olarak denetleniyor.
 */
{
  const fs = require('node:fs');
  const path = require('node:path');
  const kaynak = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  for (const kapi of [
    'setPermissionRequestHandler',
    'setPermissionCheckHandler',
    'setDevicePermissionHandler',
    'setDisplayMediaRequestHandler'
  ]) {
    esit(kapi + ' bağlı', kaynak.includes('ses.' + kapi + '('), true);
  }
}

/* ---- sonuç ---- */

if (hatalar.length) {
  console.error('\nGÜVENLİK REGRESYONU (' + hatalar.length + '):\n');
  for (const h of hatalar) console.error('  ✗ ' + h + '\n');
  process.exit(1);
}

console.log('✓ güvenlik: ' + gecen + ' saldırı vektörünün hepsi karşılandı.');
