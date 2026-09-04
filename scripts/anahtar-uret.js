'use strict';

/*
 * Yayın imzalama anahtar çifti üretir (Ed25519).
 *
 *   node scripts/anahtar-uret.js [ozel-anahtar-yolu]
 *
 * Açık anahtarı ekrana basar; src/guncelleme-anahtar.js içindeki
 * ACIK_ANAHTARLAR dizisine eklemeniz gerekir. Özel anahtar dosyası proje
 * dizininin DIŞINA yazılır ve 0600 izniyle oluşturulur.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const varsayilan = path.join(os.homedir(), 'pusula-yayin-anahtari.pem');
const hedef = path.resolve(process.argv[2] || varsayilan);

if (fs.existsSync(hedef)) {
  console.error('Bu dosya zaten var, üzerine yazılmadı:\n  ' + hedef);
  console.error('Anahtarı yenilemek istiyorsanız önce dosyayı taşıyın.');
  process.exit(1);
}

const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');

const ozelPem = privateKey.export({ type: 'pkcs8', format: 'pem' });
const acikPem = publicKey.export({ type: 'spki', format: 'pem' });

fs.mkdirSync(path.dirname(hedef), { recursive: true });
fs.writeFileSync(hedef, ozelPem, { mode: 0o600 });
try { fs.chmodSync(hedef, 0o600); } catch { /* Windows'ta yok sayılır */ }

console.log('Özel anahtar yazıldı:');
console.log('  ' + hedef);
console.log('');
console.log('Bu dosyayı depoya EKLEMEYİN. Yedeğini çevrimdışı saklayın:');
console.log('kaybederseniz mevcut kurulumlara bir daha güncelleme gönderemezsiniz.');
console.log('');
console.log('src/guncelleme-anahtar.js icindeki ACIK_ANAHTARLAR dizisine ekleyin:');
console.log('');
console.log('  ' + JSON.stringify(acikPem));
console.log('');
