'use strict';

const crypto = require('node:crypto');

/*
 * Güncelleme manifestinin doğrulanması. Electron'a bağımlı değil, bu yüzden
 * tamamı test edilebilir.
 *
 * Tehdit modeli: güncelleme sunucusu ya da CDN ele geçirilmiş olabilir.
 * electron-updater'ın kendi latest.yml dosyası imzalı DEĞİL; saldırgan onu ve
 * kurulum dosyasını birlikte değiştirirse (kod imzalama sertifikası yoksa)
 * fark edilmez. Bu yüzden yayın bilgisini ayrıca Ed25519 ile imzalıyoruz ve
 * özel anahtar hiçbir zaman sunucuda durmuyor.
 *
 * Doğrulama sırası bilinçli: önce imza, sonra içerik. İmzasız veriye hiçbir
 * anlam yüklenmiyor.
 */

const SEBEPLER = {
  IMZA: 'imza',                    // imza geçersiz ya da anahtar uyuşmuyor
  BICIM: 'bicim',                  // manifest okunamadı / alanlar eksik
  SURESI_GECMIS: 'suresiGecmis',   // eski bir manifest sonsuza dek servis ediliyor
  GUNCEL: 'guncel',                // zaten en yeni sürüm
  GERI_SURUM: 'geriSurum',         // sunucu daha eski bir sürüm göstermeye çalışıyor
  ARA_SURUM: 'araSurum',           // önce bir ara sürüme geçilmeli
  PLATFORM_YOK: 'platformYok',     // bu işletim sistemi için dosya yok
  GUVENSIZ_ADRES: 'guvensizAdres', // indirme adresi https değil
  OZET_YOK: 'ozetYok'              // sha512 alanı yok ya da biçimsiz
};

const SHA512_BICIMI = /^[A-Za-z0-9+/]{86}==$/;   // base64, 64 bayt

/* ---------------------------------------------------------------- */
/* Sürüm karşılaştırma (semver alt kümesi)                           */
/* ---------------------------------------------------------------- */

function parcala(surum) {
  const m = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(String(surum || '').trim());
  if (!m) return null;
  return {
    sayilar: [Number(m[1]), Number(m[2]), Number(m[3])],
    onSurum: m[4] ? m[4].split('.') : null
  };
}

// a > b ise 1, a < b ise -1, eşitse 0. Geçersiz sürümde null.
function surumKarsilastir(a, b) {
  const x = parcala(a);
  const y = parcala(b);
  if (!x || !y) return null;

  for (let i = 0; i < 3; i++) {
    if (x.sayilar[i] !== y.sayilar[i]) return x.sayilar[i] > y.sayilar[i] ? 1 : -1;
  }
  // 1.0.0 > 1.0.0-beta: ön sürüm her zaman daha düşüktür.
  if (!x.onSurum && !y.onSurum) return 0;
  if (!x.onSurum) return 1;
  if (!y.onSurum) return -1;

  const n = Math.max(x.onSurum.length, y.onSurum.length);
  for (let i = 0; i < n; i++) {
    const p = x.onSurum[i];
    const q = y.onSurum[i];
    if (p === undefined) return -1;
    if (q === undefined) return 1;
    const pSayi = /^\d+$/.test(p);
    const qSayi = /^\d+$/.test(q);
    if (pSayi && qSayi) {
      if (Number(p) !== Number(q)) return Number(p) > Number(q) ? 1 : -1;
    } else if (pSayi !== qSayi) {
      return pSayi ? -1 : 1;       // sayısal tanımlayıcı, metinden düşüktür
    } else if (p !== q) {
      return p > q ? 1 : -1;
    }
  }
  return 0;
}

/* ---------------------------------------------------------------- */
/* İmza                                                              */
/* ---------------------------------------------------------------- */

// İmza, manifest dosyasının HAM baytları üzerinde. Yeniden serileştirip
// imzalamak, JSON anahtar sırası/boşluk farklarında sessizce bozulurdu.
function imzaDogru(hamBaytlar, imzaBase64, acikAnahtarPem) {
  try {
    const imza = Buffer.from(String(imzaBase64).trim(), 'base64');
    if (imza.length !== 64) return false;   // Ed25519 imzası 64 bayt
    const anahtar = crypto.createPublicKey(acikAnahtarPem);
    if (anahtar.asymmetricKeyType !== 'ed25519') return false;
    return crypto.verify(null, Buffer.from(hamBaytlar), anahtar, imza);
  } catch {
    return false;
  }
}

/* ---------------------------------------------------------------- */
/* Manifest doğrulama                                                */
/* ---------------------------------------------------------------- */

/**
 * @param {object} p
 * @param {string|Buffer} p.ham          manifest dosyasının ham içeriği
 * @param {string} p.imza                base64 Ed25519 imzası
 * @param {string} [p.acikAnahtar]       tek açık anahtar (PEM)
 * @param {string[]} [p.acikAnahtarlar]  anahtar değişimi için birden fazla anahtar
 * @param {string} p.mevcutSurum         çalışan sürüm
 * @param {string} p.platform            'win32-x64' gibi
 * @param {number} [p.simdi]             zaman damgası (test için)
 * @param {string} [p.kanal]             'kararli' | 'beta'
 */
function manifestDogrula({
  ham, imza, acikAnahtar, acikAnahtarlar, mevcutSurum, platform,
  simdi = Date.now(), kanal = 'kararli'
}) {
  // Anahtar değişimi sırasında eski ve yeni anahtar bir süre birlikte geçerli.
  const anahtarlar = (acikAnahtarlar && acikAnahtarlar.length ? acikAnahtarlar : [acikAnahtar])
    .filter(Boolean);
  if (!anahtarlar.length) return { uygun: false, sebep: SEBEPLER.IMZA };
  if (!anahtarlar.some((a) => imzaDogru(ham, imza, a))) {
    return { uygun: false, sebep: SEBEPLER.IMZA };
  }

  let m;
  try {
    m = JSON.parse(Buffer.from(ham).toString('utf8'));
  } catch {
    return { uygun: false, sebep: SEBEPLER.BICIM };
  }
  if (!m || typeof m !== 'object' || !parcala(m.surum)) {
    return { uygun: false, sebep: SEBEPLER.BICIM };
  }

  // Dondurma saldırısı: saldırgan eski ama geçerli imzalı bir manifesti sonsuza
  // dek servis ederek güvenlik güncellemesini engelleyebilir. Manifest kendi
  // son kullanma tarihini taşıyor.
  const bitis = Date.parse(m.gecerlilikBitisi || '');
  if (!Number.isFinite(bitis)) return { uygun: false, sebep: SEBEPLER.BICIM };
  if (bitis < simdi) return { uygun: false, sebep: SEBEPLER.SURESI_GECMIS };

  if (m.kanal && m.kanal !== kanal) return { uygun: false, sebep: SEBEPLER.GUNCEL };

  const fark = surumKarsilastir(m.surum, mevcutSurum);
  if (fark === null) return { uygun: false, sebep: SEBEPLER.BICIM };
  if (fark === 0) return { uygun: false, sebep: SEBEPLER.GUNCEL };
  // Geri sürüm saldırısı: eski ve açığı bilinen bir sürüme düşürme.
  if (fark < 0) return { uygun: false, sebep: SEBEPLER.GERI_SURUM };

  // Bazı yayınlar doğrudan atlanamaz (ör. veri biçimi göçü gerektiren sürümler).
  if (m.enDusukSurum) {
    const yeter = surumKarsilastir(mevcutSurum, m.enDusukSurum);
    if (yeter === null) return { uygun: false, sebep: SEBEPLER.BICIM };
    if (yeter < 0) return { uygun: false, sebep: SEBEPLER.ARA_SURUM };
  }

  const dosya = m.dosyalar && m.dosyalar[platform];
  if (!dosya || typeof dosya !== 'object' || !dosya.url) {
    return { uygun: false, sebep: SEBEPLER.PLATFORM_YOK };
  }
  if (!/^https:\/\//i.test(String(dosya.url))) {
    return { uygun: false, sebep: SEBEPLER.GUVENSIZ_ADRES };
  }
  if (!SHA512_BICIMI.test(String(dosya.sha512 || ''))) {
    return { uygun: false, sebep: SEBEPLER.OZET_YOK };
  }

  return {
    uygun: true,
    surum: m.surum,
    notlar: typeof m.notlar === 'string' ? m.notlar : '',
    yayinTarihi: m.yayinTarihi || '',
    dosya: { url: dosya.url, sha512: dosya.sha512, boyut: Number(dosya.boyut) || 0 }
  };
}

// electron-updater'ın bildirdiği paket özeti, imzalı manifestteki ile aynı mı?
// Sunucu ele geçirilse bile indirilen dosya imzalı özetten sapamaz.
function ozetEslesiyor(imzaliSha512, indirilenSha512) {
  const a = Buffer.from(String(imzaliSha512 || ''), 'base64');
  const b = Buffer.from(String(indirilenSha512 || ''), 'base64');
  if (a.length !== 64 || b.length !== 64) return false;
  return crypto.timingSafeEqual(a, b);
}

module.exports = { SEBEPLER, surumKarsilastir, imzaDogru, manifestDogrula, ozetEslesiyor };
