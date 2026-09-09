'use strict';

// Electron gerektirmeyen yordamsal kozmetik testi: node test/prosedurel.js
const vm = require('node:vm');
const P = require('../src/prosedurel');
const { yerlesikKozmetik } = require('../src/kozmetik');

let gecen = 0;
const hatalar = [];
function esit(ad, bulunan, beklenen) {
  if (Object.is(bulunan, beklenen)) { gecen++; return; }
  hatalar.push(ad + '\n    bulunan:  ' + JSON.stringify(bulunan) + '\n    beklenen: ' + JSON.stringify(beklenen));
}

// 1) zincirle ayrıştırma
const z = P.zincirle('.rPanel:has(> .head:contains(/^Reklam/)):upward(1)');
esit('zincir uzunluğu', z && z.length, 3);
esit('taban css', z && z[0].arg, '.rPanel');
esit('has op', z && z[1].op, 'has');
esit('upward op+arg', z && (z[2].op + ':' + z[2].arg), 'upward:1');
esit('düz css yordamsal değil', P.zincirle('.footerSponsors'), null);
esit('desteklenmeyen op düşer', P.zincirle('div:xpath(//a)'), null);

// 2) KRİTİK: enjekte edilen kod KENDİ İÇİNDE KAPALI mı? (OPS kapsam hatası
//    yalnızca sayfada patlıyordu; Node modül kapsamı gizliyordu.)
{
  const win = {};
  const ctx = {
    window: win,
    document: { querySelectorAll: () => [], documentElement: {} },
    MutationObserver: function () { this.observe = () => {}; },
    setTimeout: (f) => { try { f(); } catch (e) {} return 0; },
    getComputedStyle: () => ({ getPropertyValue: () => '' })
  };
  vm.createContext(ctx);
  let patladi = false;
  try { vm.runInContext(P.DEGERLENDIRICI_KODU, ctx); } catch (e) { patladi = true; }
  esit('enjekte kod bare sandbox\'ta çalışır', patladi, false);
  esit('__pusulaZincirle tanımlı', typeof win.__pusulaZincirle, 'function');
  const arg = win.__pusulaZincirle && win.__pusulaZincirle('> .head:contains(/^Reklam $/)');
  esit('sayfada zincirle çalışır (OPS kapsamı gömülü)', Array.isArray(arg) && arg.length, 2);
  esit('__pusulaProsedurel tanımlı', typeof win.__pusulaProsedurel, 'function');
}

// 3) prosedurelCoz
const g = P.prosedurelCoz('r10.net##.rPanel:has(> .head:contains(/^Reklam $/))');
esit('yordamsal kural kabul (alan)', g && g.alanlar[0], 'r10.net');
esit('düz css satırı yordamsal değil', P.prosedurelCoz('r10.net##.footerSponsors'), null);
esit('alan-adısız yordamsal reddedilir', P.prosedurelCoz('##.x:has-text(ad)'), null);
esit('süslü parantez reddedilir', P.prosedurelCoz('r10.net##.x:has(a){}'), null);

// 4) ProsedurelDepo seciciler + tur atışı
{
  const d = new P.ProsedurelDepo();
  d.ekle({ tip: 'gizle', alanlar: ['r10.net'], eksiler: [], secici: '.a:has(> .b:contains(x))' });
  d.ekle({ tip: 'gizle', alanlar: [], eksiler: [], secici: '.genel:has(> .ad)' });   // genel
  d.ekle({ tip: 'istisna', alanlar: ['r10.net'], eksiler: [], secici: '.a:has(> .b:contains(x))' });
  esit('istisna kuralı bastırır', d.seciciler('www.r10.net').includes('.a:has(> .b:contains(x))'), false);
  esit('genel kural her yerde', d.seciciler('baska.com').includes('.genel:has(> .ad)'), true);
  const geri = P.ProsedurelDepo.iceAktar(d.disaAktar());
  esit('iceAktar genel korur', geri.seciciler('baska.com').includes('.genel:has(> .ad)'), true);
}

// 5) yerleşik kurallar
esit('yerleşik yordamsal r10 kuralı var', P.yerlesikProsedurel().seciciler('www.r10.net').length >= 1, true);
{
  const yk = yerlesikKozmetik();
  esit('yerleşik kozmetik reklam seçicisi üretir', yk.css('herhangi.com').includes('reklam'), true);
  esit('yerleşik kozmetik werbung içerir', yk.css('x.de').includes('werbung'), true);
}

if (hatalar.length) {
  console.error('\nBAŞARISIZ (' + hatalar.length + '):\n');
  for (const h of hatalar) console.error('  ✗ ' + h + '\n');
  console.error(gecen + ' test geçti, ' + hatalar.length + ' test kaldı.');
  process.exit(1);
}
console.log('✓ ' + gecen + ' testin hepsi geçti.');
