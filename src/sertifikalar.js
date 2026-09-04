'use strict';

/*
 * Sunucu sertifikası önbelleği.
 *
 * Electron, yüklü bir sayfanın sertifikasını sorgulanabilir biçimde
 * sunmuyor. Tek erişim noktası session.setCertificateVerifyProc: doğrulama
 * sırasında sertifika elimize geçiyor. Orada verificationResult olarak -3
 * dönüyoruz — "Chromium'un kendi sonucunu kullan" demek. Yani doğrulamaya
 * KARIŞMIYORUZ, yalnızca izliyoruz.
 *
 * Buraya 0 dönmek doğrulamayı başarılı saymak (ve Certificate Transparency
 * denetimini kapatmak) olurdu; hatalı sertifikalar sessizce kabul edilirdi.
 */

const EN_FAZLA_HOST = 200;

function tarihMetni(saniye, yerel) {
  if (!saniye) return '';
  const d = new Date(saniye * 1000);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(yerel || 'tr-TR', { year: 'numeric', month: 'short', day: 'numeric' });
}

// Sertifika alanları kimi sunucularda boş geliyor; ad seçerken sırayla
// deneyip ilk doluyu alıyoruz.
function ad(kisi, yedek) {
  if (!kisi) return yedek || '';
  return kisi.organizations && kisi.organizations[0]
    ? kisi.organizations[0]
    : (kisi.commonName || yedek || '');
}

/** Menüde gösterilecek sadeleştirilmiş özet. */
function ozet(sertifika, yerel) {
  if (!sertifika) return null;
  return {
    veren: ad(sertifika.issuer, sertifika.issuerName),
    sahip: ad(sertifika.subject, sertifika.subjectName),
    baslangic: tarihMetni(sertifika.validStart, yerel),
    bitis: tarihMetni(sertifika.validExpiry, yerel),
    parmakIzi: sertifika.fingerprint || '',
    seriNo: sertifika.serialNumber || ''
  };
}

class SertifikaDeposu {
  constructor() {
    this.kayit = new Map();   // host -> Certificate
  }

  kaydet(host, sertifika) {
    if (!host || !sertifika) return;
    // Basit sınır: en eski kaydı düşür, önbellek sınırsız büyümesin.
    if (this.kayit.size >= EN_FAZLA_HOST && !this.kayit.has(host)) {
      this.kayit.delete(this.kayit.keys().next().value);
    }
    this.kayit.set(String(host).toLowerCase(), sertifika);
  }

  al(host) {
    return this.kayit.get(String(host || '').toLowerCase()) || null;
  }

  ozetAl(host, yerel) {
    return ozet(this.al(host), yerel);
  }

  temizle() {
    this.kayit.clear();
  }
}

module.exports = { SertifikaDeposu, ozet, tarihMetni, EN_FAZLA_HOST };
