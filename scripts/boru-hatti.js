'use strict';

/*
 * BORU HATTI KOŞUCUSU.
 *
 * Commit → Lint → Statik → Race → Birim → Bütünleşme → CVE/SCA → Derleme →
 * E2E → Duman → Yük
 *
 * Aynı sıra CI'da da çalışıyor (.github/workflows/boru-hatti.yml). Bu betik
 * onun yerel karşılığı: aynı kapıları aynı sırayla, ama makinenin elindeki
 * araçlarla. CI'da olup burada olmayan bir şey varsa (ör. Go kurulu değilse)
 * kapı ATLANDI diye işaretlenir - sessizce geçmiş sayılmaz.
 *
 * SIRA ÖNEMLİ: ucuz ve kesin olan önce. Sızıntı taraması saniyenin altında
 * ve geri alınamaz bir hatayı (herkese açık depoya sır göndermek) engelliyor,
 * o yüzden en başta. Derleme dakikalar sürüyor, o yüzden ucuz kapılardan sonra.
 *
 * Kullanım:
 *   npm run boru-hatti                 tam zincir (derleme hariç)
 *   npm run boru-hatti -- --derleme    derlemeyi de çalıştır (yavaş)
 *   npm run boru-hatti -- --hizli      yalnızca ucuz kapılar
 */

const { spawnSync } = require('node:child_process');
const path = require('node:path');

const KOK = path.join(__dirname, '..');
const bayrak = (a) => process.argv.includes(a);
const DERLEME = bayrak('--derleme');
const HIZLI = bayrak('--hizli');

const nodeCalistir = (...args) => ({ komut: process.execPath, args });

/*
 * Go kapıları makinede Go varsa çalışır. `sunucu/` yayın altyapısı (VPN proxy)
 * ve orada gerçek eşzamanlılık var; -race o yüzden ayrı bir kapı.
 */
function goVarMi() {
  const y = spawnSync('go', ['version'], { encoding: 'utf8', shell: process.platform === 'win32' });
  return y.status === 0;
}

const KAPILAR = [
  {
    ad: 'Commit  · sır sızıntısı',
    ...nodeCalistir('scripts/sizinti-tara.js'),
    neden: 'Depo herkese açık; sızan anahtar geri alınamaz.',
  },
  {
    ad: 'Lint',
    komut: process.execPath,
    args: [path.join('node_modules', 'eslint', 'bin', 'eslint.js'), '.'],
    neden: 'Tanımsız değişken / ölü kod. İlk kurulduğunda gerçek bir hata buldu.',
  },
  {
    ad: 'Statik   · arayüz-ana süreç sözleşmesi',
    ...nodeCalistir('test/sozlesme.js'),
    neden: 'IPC kanalı, DOM kimliği, CSS sınıfı eşleşmeleri.',
  },
  {
    ad: 'Race     · Go sunucusu',
    komut: 'go',
    args: ['test', '-race', '-count=2', '-timeout', '240s', './...'],
    cwd: path.join(KOK, 'sunucu'),
    kabuk: true,
    atlaEger: () => (goVarMi() ? null : 'Go kurulu değil'),
    neden: 'Kovalar ve gizli anahtar eşzamanlı kullanılıyor.',
  },
  {
    ad: 'Birim',
    npmKomutu: 'test',
    neden: '420+ saf test; Electron gerektirmez.',
  },
  {
    ad: 'CVE/SCA',
    ...nodeCalistir('scripts/cve-tara.js'),
    neden: 'npm audit + OSV (Go, dolaylı bağımlılıklar dahil).',
  },
  {
    ad: 'Yük      · engelleyici motoru',
    ...nodeCalistir('test/yuk.js'),
    neden: 'Motor her isteğin önünde; yavaşlaması sessizdir.',
  },
  {
    ad: 'Bütünleşme + E2E · Electron',
    npmKomutu: 'test-electron',
    agir: true,
    neden: 'Gerçek Electron; modüller ve gerçek uygulama.',
  },
  {
    ad: 'Derleme  · kurulum paketi',
    npmKomutu: 'paket',
    yalnizcaDerleme: true,
    neden: 'electron-builder + signtool.',
  },
  {
    ad: 'Duman    · canlı besleme',
    ...nodeCalistir('scripts/canli-dogrula.js'),
    agir: true,
    neden: 'Yayındaki manifest/imza/paket gerçekten tutarlı mı.',
  },
];

function calistir(k) {
  if (k.yalnizcaDerleme && !DERLEME) return { durum: 'atlandi', not: '--derleme verilmedi' };
  if (k.agir && HIZLI) return { durum: 'atlandi', not: '--hizli' };
  if (k.atlaEger) {
    const sebep = k.atlaEger();
    if (sebep) return { durum: 'atlandi', not: sebep };
  }
  const t0 = Date.now();
  let y;
  if (k.npmKomutu) {
    /*
     * Kabuk üzerinden sabit komut. execFileSync('npm.cmd') Node 24'te
     * Windows'ta EINVAL veriyor, npm de yerel bir node_module değil (global
     * kurulu), bu yüzden node ile doğrudan çağrılamıyor. Komut adı sabit
     * listeden geliyor, kullanıcı girdisi enterpole edilmiyor.
     */
    y = spawnSync('npm run ' + k.npmKomutu, {
      cwd: KOK, encoding: 'utf8', shell: true, stdio: ['ignore', 'pipe', 'pipe'],
    });
  } else {
    y = spawnSync(k.komut, k.args, {
      cwd: k.cwd || KOK, encoding: 'utf8',
      shell: k.kabuk === true && process.platform === 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  }
  const sn = ((Date.now() - t0) / 1000).toFixed(1);
  const cikti = ((y.stdout || '') + (y.stderr || '')).trim();
  if (y.status === 0) return { durum: 'gecti', sn, cikti };
  return { durum: 'kaldi', sn, cikti, kod: y.status };
}

console.log('BORU HATTI' + (DERLEME ? ' (derleme dahil)' : '') + (HIZLI ? ' (hızlı)' : ''));
console.log('='.repeat(72));

const ozet = [];
let kirmizi = 0;

for (const k of KAPILAR) {
  process.stdout.write(k.ad.padEnd(38));
  const s = calistir(k);
  ozet.push({ ad: k.ad, ...s });
  if (s.durum === 'gecti') {
    console.log('GEÇTİ  ' + s.sn + 's');
  } else if (s.durum === 'atlandi') {
    console.log('ATLANDI (' + s.not + ')');
  } else {
    kirmizi++;
    console.log('KALDI  ' + s.sn + 's  (çıkış ' + s.kod + ')');
    console.log('-'.repeat(72));
    console.log(String(s.cikti).split('\n').slice(-25).join('\n'));
    console.log('-'.repeat(72));
    break; // ilk kırmızıda dur: sonraki kapılar bozuk zemine bakar
  }
}

console.log('='.repeat(72));
const gecen = ozet.filter((o) => o.durum === 'gecti').length;
const atlanan = ozet.filter((o) => o.durum === 'atlandi');
console.log(gecen + ' kapı geçti, ' + kirmizi + ' kaldı, ' + atlanan.length + ' atlandı.');
for (const a of atlanan) console.log('  atlandı: ' + a.ad.trim() + ' (' + a.not + ')');
process.exit(kirmizi ? 1 : 0);
