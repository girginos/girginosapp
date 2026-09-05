'use strict';

// Arayüz ile ana süreç arasındaki sözleşmeyi mekanik olarak doğrular:
// her IPC kanalının iki tarafı, her DOM kimliğinin HTML karşılığı var mı?
// node test/sozlesme.js

const fs = require('node:fs');
const path = require('node:path');

const kok = path.join(__dirname, '..');
const oku = (f) => fs.readFileSync(path.join(kok, f), 'utf8');

const preload = oku('preload.js');
// Katman görünümünün ayrı ve dar bir köprüsü var; 'katman:*' kanalları
// preload.js'te değil burada karşılanıyor.
const katmanOnyukleme = oku('ui/katman-onyukleme.js');
const main = oku('main.js');
const app = oku('ui/app.js');
const html = oku('ui/index.html');

function topla(metin, kalip) {
  const bulunan = new Set();
  let m;
  const re = new RegExp(kalip.source, kalip.flags);
  while ((m = re.exec(metin)) !== null) bulunan.add(m[1]);
  return bulunan;
}

const fark = (a, b) => [...a].filter((x) => !b.has(x));

const preSend = new Set([
  ...topla(preload, /ipcRenderer\.send\('([^']+)'/g),
  ...topla(katmanOnyukleme, /ipcRenderer\.send\('([^']+)'/g)
]);
const preInvoke = topla(preload, /ipcRenderer\.invoke\('([^']+)'/g);
const preDinle = new Set([
  ...topla(preload, /dinle\('([^']+)'\)/g),
  // katman-onyukleme.js dinlemeyi doğrudan ipcRenderer.on ile kuruyor
  ...topla(katmanOnyukleme, /ipcRenderer\.on\('([^']+)'/g)
]);
const preApi = topla(preload, /^ {2}([A-Za-z][A-Za-z0-9]*):/gm);

// main.js kanalları ya ipcMain.on/handle ile ya da gönderen doğrulaması yapan
// yerel on()/handle() sarmalayıcılarıyla kaydediliyor.
const mainOn = new Set([
  ...topla(main, /ipcMain\.on\('([^']+)'/g),
  ...topla(main, /(?:^|[^.\w])on\('([^']+)'/gm),
  ...topla(main, /katmanOn\('([^']+)'/g)
]);
const mainHandle = new Set([
  ...topla(main, /ipcMain\.handle\('([^']+)'/g),
  ...topla(main, /(?:^|[^.\w])handle\('([^']+)'/gm)
]);
// Menü kısayolları kanalı doğrudan değil, uiye() sarmalayıcısıyla gönderiyor.
const mainSend = new Set([
  ...topla(main, /webContents\.send\('([^']+)'/g),
  ...topla(main, /uiye\('([^']+)'/g),
  // Ana sürecin arayüze gönderdiği kanalların çoğu bu sarmalayıcıdan geçiyor;
  // desende yoktu, yani bu denetim uzun süre kanalların yalnızca bir kısmını
  // görmüş. uiye() bunun kısaltması olduğu için ikisi de taranıyor.
  ...topla(main, /uiyeGonder\('([^']+)'/g)
]);

const appCagri = topla(app, /window\.pusula\.([A-Za-z0-9]+)/g);
const appId = topla(app, /\$\('([^']+)'\)/g);
const htmlId = topla(html, /id="([^"]+)"/g);

/*
 * Katman ayrı bir WebContentsView; mesajları arayüz penceresinin ana
 * çerçevesinden gelmez. Arayüz kapısına (on) bağlanan bir 'katman:' kanalı
 * çalışma anında SESSİZCE düşer - kutu hiç açılmaz ve hata da vermez.
 * Bu yüzden hangi kanalın hangi kapıda olduğu teste bağlı.
 */
const katmanOnKanallar = topla(main, /katmanOn\('([^']+)'/g);
const duzOnKanallar = topla(main, /(?:^|[^.\w])on\('([^']+)'/gm);

const denetimler = [
  ['katman kanalı arayüz kapısında (sessizce düşer)',
    [...duzOnKanallar].filter((k) => k.startsWith('katman:'))],
  ['katman:* kanalı katmanOn ile kayıtlı değil',
    [...preSend].filter((k) => k.startsWith('katman:') && !katmanOnKanallar.has(k))],
  ['katman kapısında katman dışı kanal',
    [...katmanOnKanallar].filter((k) => !k.startsWith('katman:'))],
  ['preload.send -> main.on', fark(preSend, mainOn)],
  ['preload.invoke -> main.handle', fark(preInvoke, mainHandle)],
  ['main.send -> preload.dinle', fark(mainSend, preDinle)],
  ['app cagrisi -> preload API', fark(appCagri, preApi)],
  ['app DOM kimligi -> index.html', fark(appId, htmlId)],
  ['invoke kanali yanlislikla ipcMain.on ile', [...preInvoke].filter((x) => mainOn.has(x))],
  ['send kanali yanlislikla ipcMain.handle ile', [...preSend].filter((x) => mainHandle.has(x))]
];

// Diller: her dil dosyası Türkçe referans anahtar kümesini birebir taşımalı.
const { DILLER } = require('../src/diller');
const referans = Object.keys(DILLER.tr.metin);
for (const [kod, d] of Object.entries(DILLER)) {
  const k = Object.keys(d.metin);
  const eksik = referans.filter((x) => !Object.hasOwn(d.metin, x));
  const fazla = k.filter((x) => !referans.includes(x));
  const bos = k.filter((x) => !String(d.metin[x]).trim());
  denetimler.push(['dil ' + kod + ' anahtarlari', [...eksik, ...fazla, ...bos]]);
}

// Arayüzde cev() ile istenen her anahtarın tabloda karşılığı olmalı.
// cev('izin.' + izin) gibi dinamik çağrılarda yakalanan parça noktayla biter;
// onlar için "bu önekte en az bir anahtar var mı" diye bakıyoruz.
const kullanilan = new Set([
  ...topla(app, /\bcev\('([^']+)'/g),
  ...topla(main, /\bcev\('([^']+)'/g)
]);
const anahtarlar = Object.keys(DILLER.tr.metin);
denetimler.push(['cev() anahtarlari -> diller/tr.js',
  [...kullanilan].filter((x) => (x.endsWith('.')
    ? !anahtarlar.some((k) => k.startsWith(x))
    : !anahtarlar.includes(x)))]);

/*
 * style.css bütünlüğü. Bir kuralın kapanış parantezi düşerse tarayıcı hata
 * vermez; sadece o noktadan sonraki TÜM kuralları sessizce yok sayar. Bir
 * kez başımıza geldi (396. satırdaki .ayar kuralı), arayüzün yarısı hiç
 * uygulanmadı ve gözle fark edilmedi.
 */
const css = oku('ui/style.css');
let derinlik = 0;
const cssTemiz = css.replace(/\/\*[\s\S]*?\*\//g, '');
for (const c of cssTemiz) {
  if (c === '{') derinlik++;
  else if (c === '}') derinlik--;
}
denetimler.push(['style.css süslü parantez dengesi', derinlik === 0 ? [] : ['derinlik ' + derinlik]]);

// Dosyanın sonundaki kuralların gerçekten ayrıştığından emin olmak için
// her bölümden bir seçici arıyoruz.
const beklenenSeciciler = [
  '.sekme', '.liste-kart', '.rozet-img', '.yerimi', '.ilerleme',
  '#btnIndirmeler', '.ayar-grup', '.istatistik', '#adresGoster', '[dir="rtl"]'
];
denetimler.push(['style.css bölümleri yerinde',
  beklenenSeciciler.filter((s) => !cssTemiz.includes(s))]);

let hata = 0;
for (const [ad, eksik] of denetimler) {
  if (eksik.length) {
    hata++;
    console.error('  x ' + ad + ' -> ' + eksik.join(', '));
  } else {
    console.log('  ok ' + ad);
  }
}

console.log('');
console.log('  kanallar: send=' + preSend.size + ' invoke=' + preInvoke.size +
  ' | main.on=' + mainOn.size + ' main.handle=' + mainHandle.size + ' main.send=' + mainSend.size);
console.log('  preload API=' + preApi.size + ' | app cagri=' + appCagri.size +
  ' | app id=' + appId.size + ' | html id=' + htmlId.size);

if (hata) {
  console.error('\nSÖZLEŞME UYUŞMAZLIĞI: ' + hata);
  process.exit(1);
}
console.log('\n✓ arayüz/ana süreç sözleşmesi tutarlı.');
