'use strict';

// Electron gerektirmeyen saf mantık testi: node test/kararlilik.js
// chrome.webstorePrivate körleme stub'ını sahte bir window üzerinde çalıştırıp
// çökme yüzeyi olan metotların gerçekten noop'a çevrildiğini doğrular.
const vm = require('node:vm');
const { WEBSTORE_STUB_KODU, kararlilikPreloadKaynagi } = require('../src/kararlilik');

let gecen = 0;
const hatalar = [];
function esit(ad, bulunan, beklenen) {
  if (Object.is(bulunan, beklenen)) { gecen++; return; }
  hatalar.push(ad + '\n    bulunan:  ' + JSON.stringify(bulunan) + '\n    beklenen: ' + JSON.stringify(beklenen));
}

// Sahte bir sayfa ortamı: gerçek getReferrerChain çağrılırsa sayaç artar (çökmeyi temsil eder).
function ortamKur() {
  let gercekCagri = 0;
  const win = {
    chrome: {
      webstorePrivate: {
        getReferrerChain: function () { gercekCagri++; return 'GERCEK-ZINCIR'; },
        install: function () { gercekCagri++; },
        getWebGLStatus: function () { gercekCagri++; }
      }
    }
  };
  const ctx = { window: win, Object, console };
  vm.createContext(ctx);
  vm.runInContext(WEBSTORE_STUB_KODU, ctx);
  return { win, sayac: () => gercekCagri };
}

// 1) getReferrerChain noop'a döndü: dönüş undefined, gerçek gövde çalışmadı, callback [] ile çağrıldı.
{
  const { win, sayac } = ortamKur();
  let cb = 'ÇAĞRILMADI';
  const r = win.chrome.webstorePrivate.getReferrerChain(function (v) { cb = v; });
  esit('getReferrerChain undefined döner', r, undefined);
  esit('getReferrerChain gerçek gövdeyi çalıştırmaz', sayac(), 0);
  esit('getReferrerChain callback\'i [] ile çağırır', JSON.stringify(cb), '[]');
  esit('stub işareti kondu', win.__pusulaWebstoreStub, 1);
}

// 2) Diğer webstorePrivate metotları da noop.
{
  const { win, sayac } = ortamKur();
  win.chrome.webstorePrivate.install();
  win.chrome.webstorePrivate.getWebGLStatus();
  esit('diğer metotlar da noop', sayac(), 0);
}

// 3) chrome GEÇ atanırsa (set tuzağı) yeni webstorePrivate de körlenir.
{
  const { win } = ortamKur();
  win.chrome = { webstorePrivate: { getReferrerChain: function () { throw new Error('çökme!'); } } };
  let patladi = false;
  try { win.chrome.webstorePrivate.getReferrerChain(function () {}); }
  catch (e) { patladi = true; }
  esit('geç atanan chrome.webstorePrivate de körlenir', patladi, false);
}

// 4) webstorePrivate hiç yoksa stub sessizce geçer, işareti yine kor.
{
  const win = { chrome: {} };
  const ctx = { window: win, Object, console };
  vm.createContext(ctx);
  let patladi = false;
  try { vm.runInContext(WEBSTORE_STUB_KODU, ctx); } catch (e) { patladi = true; }
  esit('webstorePrivate yokken patlamaz', patladi, false);
  esit('işaret yine kondu', win.__pusulaWebstoreStub, 1);
}

// 5) Preload kaynağı geçerli JS ve stub'ı içeriyor.
{
  const src = kararlilikPreloadKaynagi();
  let parseOk = true;
  try { vm.compileFunction(src); } catch (e) { parseOk = false; }
  esit('preload geçerli JS', parseOk, true);
  esit('preload http/https ile sınırlı', src.includes('/^https?:$/'), true);
  esit('preload stub kodunu gömüyor', src.includes('__pusulaWebstoreStub'), true);
  esit('preload ana dünyaya enjekte ediyor (false)', /executeJavaScript\([^]*, false\)/.test(src), true);
}

if (hatalar.length) {
  console.error('\nBAŞARISIZ (' + hatalar.length + '):\n');
  for (const h of hatalar) console.error('  ✗ ' + h + '\n');
  console.error(gecen + ' test geçti, ' + hatalar.length + ' test kaldı.');
  process.exit(1);
}
console.log('✓ ' + gecen + ' testin hepsi geçti.');
