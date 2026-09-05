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

/*
 * Test dosyalarında sonuç kontrolünden SONRA kalan iddialar sessizce
 * yok sayılır: hatalar dizisine yazarlar ama dizi çoktan kontrol edilmiştir,
 * yani başarısız olsalar bile özet "hepsi geçti" der. Bu tuzağa üç kez
 * düşüldü; artık mekanik olarak denetleniyor.
 */
const testDosyalari = ['test/dogrula.js', 'test/guvenlik.js', 'test/guncelleme.js'];
/*
 * Electron testleri ayni tuzagi tasiyor ama baska bir bicimde: iddia islevi
 * esit() degil bak(), ozet de hatalar dizisi degil sonuc dizisi uzerinden
 * hesaplaniyor. Denetim bunlari kapsamiyordu; ozetten SONRA eklenmis bir
 * iddianin sessizce yutuldugu olcum yapilarak dogrulandi.
 */
const electronTestleri = ['test/electron-cerez.js', 'test/electron-kozmetik.js', 'test/electron-vekil.js'];
const olusuzIddialar = [];
for (const t of testDosyalari) {
  const metin = oku(t);
  const i = metin.indexOf('if (hatalar.length)');
  if (i < 0) { olusuzIddialar.push(t + ' (sonuç kontrolü bulunamadı)'); continue; }
  const sonrasi = metin.slice(i);
  const sayi = (sonrasi.match(/esit\(/g) || []).length;
  if (sayi > 0) olusuzIddialar.push(t + ' (' + sayi + ' iddia sonuç kontrolünden sonra)');
}
for (const t of electronTestleri) {
  const metin = oku(t);
  const i = metin.indexOf('const hata = sonuc.filter');
  if (i < 0) { olusuzIddialar.push(t + ' (sonuç kontrolü bulunamadı)'); continue; }
  const sayi = (metin.slice(i).match(/bak\(/g) || []).length;
  if (sayi > 0) olusuzIddialar.push(t + ' (' + sayi + ' iddia sonuç kontrolünden sonra)');
}

/*
 * Electron testleri firlatan bir regresyonda ASILMAMALI.
 *
 * Olculdu: main sureçte bir istisna yalnizca UnhandledPromiseRejectionWarning
 * basiyor, ozet hic yazilmiyor, app.exit() hic cagrilmiyor ve surec sonsuza
 * kadar bekliyor. "npm run test-electron" boyle bir regresyonda basarisiz
 * olmuyor, CI'i durduruyor. Her testin kendi yakalayicisi olmali.
 */
const yakalayicisiz = [];
for (const t of electronTestleri) {
  const metin = oku(t);
  if (!metin.includes("process.on('unhandledRejection'")) yakalayicisiz.push(t + ' -> unhandledRejection');
  if (!metin.includes("process.on('uncaughtException'")) yakalayicisiz.push(t + ' -> uncaughtException');
}

// Ham kontrol karakteri kaynakta durmamalı: grep dosyayı ikili sayıyor,
// editörler sessizce siliyor.
const hamKontrol = [];
for (const t of [...testDosyalari, ...electronTestleri, 'main.js', 'ui/app.js',
  'src/blocker.js', 'src/kozmetik.js', 'src/vekil.js', 'src/cerezler.js', 'src/listeler.js', 'src/store.js']) {
  const say = [...oku(t)].filter((c) => {
    const k = c.codePointAt(0);
    return k < 9 || (k > 13 && k < 32);
  }).length;
  if (say) hamKontrol.push(t + ' (' + say + ')');
}

/*
 * Tanimsiz SCREAMING_CASE sabitleri. ui/app.js'te INDIRME_DURUMU boyle
 * kalmisti: node --check gecer, dosya yuklenir, ama satir CALISINCA
 * ReferenceError atar ve panel kalici olarak bos kalir. Yayina cikti.
 */
function koduSadelestir(metin) {
  // Yorumlar ve dize/sablon icerikleri cikariliyor: oralardaki buyuk harfli
  // kelimeler (HTML, CVE, SONRA...) tanimlayici degil.
  return metin
    // Duzenli ifade govdesindeki buyuk harfli kelimeler tanimlayici degil;
    // main.js'teki bir /^DIRECT/ bu yuzden "tanimsiz sabit" diye raporlanmisti.
    // Bolme islemiyle karismasin diye yalnizca bir isleci izleyen egik cizgi
    // duzenli ifade sayiliyor.
    .replace(/(^|[=(,:!&|?{};\s])\/(?![*/])(?:\\.|\[(?:\\.|[^\]\\])*\]|[^/\\\n])+\/[gimsuy]*/g, '$1/x/')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ')
    .replace(/'(?:[^'\\\n]|\\.)*'/g, "''")
    .replace(/"(?:[^"\\\n]|\\.)*"/g, '""')
    .replace(/`(?:[^`\\]|\\.)*`/g, '``');
}

const TANINAN_GLOBAL = new Set(['JSON', 'URL', 'NaN', 'Infinity', 'Math', 'Intl', 'DOM']);

const tanimsizSabitler = [];
for (const t of ['ui/app.js', 'ui/katman.js', 'ui/newtab.js', 'ui/error.js', 'main.js']) {
  const kod = koduSadelestir(oku(t));
  const kullanilan = new Set([...kod.matchAll(/\b([A-Z][A-Z0-9_]{2,})\b/g)].map((m) => m[1]));
  for (const ad of kullanilan) {
    if (TANINAN_GLOBAL.has(ad)) continue;
    // require({ A, B: C }) ile içeri alınanlar da tanımlı sayılır.
    const tanimli = new RegExp('(?:const|let|var|function|class)\\s+' + ad + '\\b').test(kod)
      || new RegExp('\\b' + ad + '\\s*[:=][^=]').test(kod)
      || new RegExp('[{,]\\s*' + ad + '\\s*[,}]').test(kod)
      || new RegExp(':\\s*' + ad + '\\s*[,}]').test(kod);
    if (!tanimli) tanimsizSabitler.push(t + ' -> ' + ad);
  }
}

/*
 * Uretilen ama CSS kurali olmayan sinif adlari. Bu sinif iki kez yasandi:
 * .ilerleme (ilerleme cubugu gorunmezdi) ve .liste-bos. Ogenin kurali yoksa
 * hata da olmaz, sadece hicbir sey gorunmez.
 */
const cssMetin = oku('ui/style.css') + oku('ui/katman.css');
const kuralsizSiniflar = [];
for (const t of ['ui/app.js', 'ui/katman.js']) {
  const metin = oku(t);
  const adlar = new Set();
  for (const m of metin.matchAll(/className = '([^']+)'/g)) {
    for (const p of m[1].split(/\s+/)) if (p) adlar.add(p);
  }
  for (const m of metin.matchAll(/classList\.(?:add|toggle)\('([^']+)'/g)) adlar.add(m[1]);
  for (const ad of adlar) {
    if (!cssMetin.includes('.' + ad)) kuralsizSiniflar.push(t + ' -> .' + ad);
  }
}

/*
 * Kullanici aracisi dizesi ELLE AYARLANMAMALI.
 *
 * Bir sure "Electron/x" ve uygulama adi UA'dan siliniyordu. Olculdu:
 * dokunulmamis UA ile blackhatworld.com acildi, temizlenmis UA Cloudflare
 * dogrulama dongusune girdi. Kod okunarak fark edilebilecek bir sey degil;
 * ileride "biraz daha tipik gorunelim" diye geri gelmesi cok kolay.
 * Gerekce main.js icinde oturumKur()'un ustunde yazili.
 */
const uaAyari = [];
for (const t of ['main.js']) {
  const kod = oku(t);
  if (/\.setUserAgent\s*\(/.test(kod)) uaAyari.push(t + ' -> setUserAgent(');
  if (/userAgentFallback\s*=/.test(kod)) uaAyari.push(t + ' -> app.userAgentFallback =');
}

/*
 * VEKILDEN KACAN OTURUM.
 *
 * Bir vekil ya her yere uygulanir ya da hicbir ise yaramaz. Yeni bir oturum
 * eklemek tek satirlik bir is; onu VEKIL_OTURUMLARI'na yazmayi unutmak da
 * oyle. Sonuc gorunmez: sekmeler vekilden cikar, o oturum dogrudan cikar ve
 * kullanici korundugunu sanir. Bu yuzden kaynakta gecen her fromPartition adi
 * listeye karsi denetleniyor.
 */
const vekilKacaklari = [];
{
  const kod = oku('main.js');
  // vekilOturumlari() listenin KENDISI uzerinde donuyor; oradaki degisken adi
  // yeni bir oturum degil.
  const taranan = kod.replace(/function vekilOturumlari\(\)[\s\S]*?\n}/, '');

  const listeEsleme = /const VEKIL_OTURUMLARI = \[([^\]]*)\]/.exec(kod);
  const sabitDeger = (ad) => {
    const m = new RegExp("const " + ad + " = '([^']+)'").exec(kod);
    return m ? m[1] : null;
  };
  const coz = (ham) => {
    const t = ham.trim();
    const dize = /^'([^']*)'$/.exec(t);
    return dize ? dize[1] : sabitDeger(t);
  };

  const listede = new Set();
  if (!listeEsleme) vekilKacaklari.push('main.js -> VEKIL_OTURUMLARI bulunamadi');
  else for (const p of listeEsleme[1].split(',')) {
    const d = coz(p);
    if (d) listede.add(d);
  }

  for (const m of taranan.matchAll(/fromPartition\(\s*([^,)]+)/g)) {
    const ad = coz(m[1]);
    if (ad === null) vekilKacaklari.push('main.js -> fromPartition(' + m[1].trim() + ') cozulemedi');
    else if (!listede.has(ad)) vekilKacaklari.push('main.js -> ' + ad);
  }

  // electron-updater kendi bolumunden istek atiyor; adi kaynaktan okunuyor ki
  // surum yukseltmesiyle degisirse burada patlasin, sessizce sizmasin.
  try {
    const u = fs.readFileSync(
      path.join(kok, 'node_modules/electron-updater/out/electronHttpExecutor.js'), 'utf8');
    const m = /NET_SESSION_NAME = "([^"]+)"/.exec(u);
    if (m && !listede.has(m[1])) vekilKacaklari.push('electron-updater -> ' + m[1]);
  } catch { /* paket yoksa denetlenecek bir sey de yok */ }
}

const denetimler = [
  ['vekilden kacan oturum', vekilKacaklari],
  ['kullanici aracisi elle ayarlanmis', uaAyari],
  ['tanimsiz sabit (calisinca ReferenceError)', tanimsizSabitler],
  ['CSS kurali olmayan sinif', kuralsizSiniflar],
  ['sonuç kontrolünden sonra iddia', olusuzIddialar],
  ['Electron testinde hata yakalayıcı yok (asılır)', yakalayicisiz],
  ['kaynakta ham kontrol karakteri', hamKontrol],
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
