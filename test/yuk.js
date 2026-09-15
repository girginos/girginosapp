'use strict';

/*
 * YÜK KAPISI.
 *
 * Neden burası: uBO ağ motoru (SNFE) HER isteğin önünde duruyor
 * (blocker.js webRequest yolu). Yavaşlarsa kullanıcı "tarayıcı ağır" der,
 * ama hiçbir doğruluk testi kırmızıya dönmez - yavaşlama sessizdir. Bu yüzden
 * ölçülüp bir tabana bağlanıyor.
 *
 * Taban BİLEREK gevşek: CI makineleri değişken hızda. Amaç mikro-saniye
 * kovalamak değil, bir değişikliğin motoru büyüklük sırası yavaşlatmasını
 * yakalamak (ör. her istekte listeyi yeniden derlemek).
 *
 * Ayrıca bellek: motor kurulduktan sonra 10 bin eşleşme yapmak yığını
 * sürekli büyütmemeli - büyütüyorsa her istekte nesne biriktiriyoruz demektir.
 */

const { UboMotor } = require('../src/ubo-motor');

const TABAN_EPS = 2000;        // saniyede en az bu kadar eşleşme (çok gevşek taban)
const ORNEK = 20000;           // ölçüm için eşleşme sayısı
const BELLEK_TAVANI_MB = 64;   // eşleşme döngüsünün büyütebileceği yığın üst sınırı

/*
 * Gerçekçi bir liste: uBO söz dizimi, karışık kural tipleri. Küçük tutuluyor
 * ki test ağdan liste indirmesin (CI'da ağ olmayabilir, olsa da kırılgan olur).
 */
const LISTE_METNI = [
  '||doubleclick.net^',
  '||googlesyndication.com^',
  '||adservice.google.com^$script',
  '||facebook.net^$third-party',
  '||analytics.example^$script,third-party',
  '/ads/*$image',
  '/track?*',
  '||cdn.example^$~script',
  '@@||example.com/ads/izinli.js$script',
  '||metrics.example^$xmlhttprequest',
].join('\n');

const ISTEKLER = [
  ['https://haber.example/', 'https://doubleclick.net/x.js', 'script'],
  ['https://haber.example/', 'https://haber.example/main.js', 'script'],
  ['https://haber.example/', 'https://cdn.example/stil.css', 'stylesheet'],
  ['https://example.com/', 'https://example.com/ads/izinli.js', 'script'],
  ['https://a.example/', 'https://b.example/ads/banner.png', 'image'],
  ['https://a.example/', 'https://metrics.example/olc', 'xmlhttprequest'],
  ['https://a.example/', 'https://facebook.net/sdk.js', 'script'],
  ['https://a.example/', 'https://a.example/track?u=1', 'xmlhttprequest'],
];

const sonuc = [];
function bak(ad, gecti, detay) {
  sonuc.push(gecti);
  console.log((gecti ? '  ok   ' : '  HATA ') + ad + (detay ? ' -> ' + detay : ''));
}

(async () => {
  const motor = new UboMotor();
  const t0 = process.hrtime.bigint();
  // listelerdenKur {name, raw} bekliyor; düz metin verilince motor BOŞ kurulur
  // ve her isteğe 0 döner (bu test ilk yazıldığında tam olarak bu oldu).
  await motor.listelerdenKur([{ name: 'yuk-testi', raw: LISTE_METNI }]);
  const kurmaMs = Number(process.hrtime.bigint() - t0) / 1e6;
  bak('motor kuruldu', true, kurmaMs.toFixed(0) + ' ms');

  // Isınma: ilk çağrılar JIT yüzünden yanıltıcı.
  for (let i = 0; i < 2000; i++) {
    const r = ISTEKLER[i % ISTEKLER.length];
    motor.eslesme(r[0], r[1], r[2]);
  }

  if (global.gc) global.gc();
  const bellekOnce = process.memoryUsage().heapUsed;

  const b0 = process.hrtime.bigint();
  let engellenen = 0;
  for (let i = 0; i < ORNEK; i++) {
    const r = ISTEKLER[i % ISTEKLER.length];
    if (motor.eslesme(r[0], r[1], r[2]) === 1) engellenen++;
  }
  const gecenMs = Number(process.hrtime.bigint() - b0) / 1e6;
  const eps = Math.round(ORNEK / (gecenMs / 1000));

  if (global.gc) global.gc();
  const bellekMb = (process.memoryUsage().heapUsed - bellekOnce) / 1048576;

  bak('eşleşme hızı tabanın üstünde', eps >= TABAN_EPS,
    eps.toLocaleString('tr-TR') + ' eşleşme/sn (taban ' + TABAN_EPS.toLocaleString('tr-TR') + ')');

  // Motor gerçekten çalışıyor mu? Hız testi hep 0 dönen bir motorla da hızlı
  // olurdu; engellenen oranı beklenen aralıkta olmalı.
  const oran = engellenen / ORNEK;
  bak('motor gerçekten eşleştiriyor', oran > 0.3 && oran < 0.9,
    (oran * 100).toFixed(1) + '% engellendi');

  bak('eşleşme döngüsü bellek biriktirmiyor', bellekMb < BELLEK_TAVANI_MB,
    bellekMb.toFixed(1) + ' MB (tavan ' + BELLEK_TAVANI_MB + ' MB)');

  const kalan = sonuc.filter((x) => !x).length;
  console.log('\n' + (sonuc.length - kalan) + '/' + sonuc.length + ' yük kontrolü geçti.');
  if (kalan) process.exit(1);
})().catch((e) => {
  console.error('yük testi hata verdi:', e && e.stack || e);
  process.exit(1);
});
