'use strict';

// Electron gerektirmeyen SNFE (uBlock Origin ağ motoru) entegrasyon testi.
// Sentetik listeyle çalışır (ağ yok): gerçek blocker.js karar akışını doğrular.
// node test/ubo-motor.js
const { UboMotor, TIP_ESLEME } = require('../src/ubo-motor');
const { Blocker } = require('../src/blocker');
const { LISTE } = require('../src/blocklist');

let gecen = 0;
const hatalar = [];
function esit(ad, bulunan, beklenen) {
  if (Object.is(bulunan, beklenen)) { gecen++; return; }
  hatalar.push(ad + '\n    bulunan:  ' + JSON.stringify(bulunan) + '\n    beklenen: ' + JSON.stringify(beklenen));
}

// --- Bölüm 1: motor sınıfı (SNFE oluşturmadan) ---
esit('TIP_ESLEME: xhr -> xmlhttprequest', TIP_ESLEME.xhr, 'xmlhttprequest');
esit('TIP_ESLEME: subFrame -> sub_frame', TIP_ESLEME.subFrame, 'sub_frame');
esit('hazır değilken eşleşme 0 döner', new UboMotor().eslesme('https://a.example/', 'https://b.example/x', 'script'), 0);

// --- Bölüm 2: gerçek Blocker + tek SNFE örneği, sentetik liste ---
const SENTETIK = [
  '||snfe-only.example^$script',      // yalnız script
  '||snfe-path.example/reklam/*',     // yol kalıbı
  '||her-tur.example^',               // her tür
  '||adhost.example^',                // her tür engel...
  '@@||adhost.example^$image'         // ...ama image istisna
].join('\n');

let izinliDomain = null;
const store = {
  ayarlar: { engelleyiciAcik: true, uboMotorAcik: true, ucuncuTarafCerez: true },
  siteIzinliMi: (kok) => kok === izinliDomain,
  cerezIstisnasiMi: () => false,
  engellendiSay: () => {}
};
const listeler = { acik: true, hamListeler: () => [{ name: 'sentetik', raw: SENTETIK }], engelleniyorMu: () => false };
const D = (url, resourceType, webContentsId) => ({ url, resourceType, webContentsId });

(async () => {
  const blocker = new Blocker(store);
  blocker.listeleriBagla(listeler);
  await blocker.uboyuKur();
  esit('SNFE hazır', blocker.ubo.hazir, true);

  blocker.ustAlanAyarla(1, 'https://ana.example/');   // nötr birinci taraf

  // SNFE izole (LISTE/fallback dışı hostlar)
  esit('snfe-only [script] engel', blocker.engellensinMi(D('https://snfe-only.example/t.js', 'script', 1)), true);
  esit('snfe-only [stylesheet] geç (tür-duyarlı)', blocker.engellensinMi(D('https://snfe-only.example/t.css', 'stylesheet', 1)), false);
  esit('snfe-path /reklam/ engel', blocker.engellensinMi(D('https://snfe-path.example/reklam/x.gif', 'image', 1)), true);
  esit('snfe-path /normal/ geç', blocker.engellensinMi(D('https://snfe-path.example/normal/x.gif', 'image', 1)), false);
  esit('her-tur engel', blocker.engellensinMi(D('https://her-tur.example/x', 'image', 1)), true);

  // İstisna (@@): adhost image serbest, script engelli
  esit('adhost [image] istisna -> geç', blocker.engellensinMi(D('https://adhost.example/a.png', 'image', 1)), false);
  esit('adhost [script] engel', blocker.engellensinMi(D('https://adhost.example/a.js', 'script', 1)), true);

  // Birinci taraf / mainFrame hiç engellenmez
  esit('birinci taraf geç', blocker.engellensinMi(D('https://ana.example/app.js', 'script', 1)), false);
  esit('mainFrame geç', blocker.engellensinMi(D('https://snfe-only.example/t.js', 'mainFrame', 1)), false);

  // Yerleşik LISTE her zaman kazanır (SNFE'den önce)
  const listeHost = [...LISTE][0];
  esit('yerleşik LISTE host engel', blocker.engellensinMi(D('https://' + listeHost + '/t.js', 'script', 1)), true);

  // Site izin listesi
  izinliDomain = 'ana.example';
  esit('izinli sitede SNFE isteği geçer', blocker.engellensinMi(D('https://snfe-only.example/t.js', 'script', 1)), false);
  izinliDomain = null;

  // Motor kapatma anahtarı
  store.ayarlar.uboMotorAcik = false;
  esit('uboMotorAcik=false -> SNFE atlanır', blocker.engellensinMi(D('https://snfe-only.example/t.js', 'script', 1)), false);
  store.ayarlar.uboMotorAcik = true;
  esit('tekrar açık -> yine engel', blocker.engellensinMi(D('https://snfe-only.example/t.js', 'script', 1)), true);

  // Genel engelleyici kapalı
  store.ayarlar.engelleyiciAcik = false;
  esit('engelleyici kapalı -> engel yok', blocker.engellensinMi(D('https://snfe-only.example/t.js', 'script', 1)), false);
  store.ayarlar.engelleyiciAcik = true;

  if (hatalar.length) {
    console.error('\nBAŞARISIZ (' + hatalar.length + '):\n');
    for (const h of hatalar) console.error('  ✗ ' + h + '\n');
    console.error(gecen + ' test geçti, ' + hatalar.length + ' test kaldı.');
    process.exit(1);
  }
  console.log('✓ ' + gecen + ' testin hepsi geçti.');
})().catch(e => { console.error('HATA:', e); process.exit(1); });
