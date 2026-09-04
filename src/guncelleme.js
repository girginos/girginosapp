'use strict';

const { SEBEPLER, manifestDogrula, ozetEslesiyor } = require('./guncelleme-dogrula');
const anahtarlar = require('./guncelleme-anahtar');

/*
 * Güncelleme akışı.
 *
 * electron-updater indirme/kurma işini yapar; biz önüne imzalı bir kapı
 * koyuyoruz. Sıra:
 *
 *   1. İmzalı manifesti çek, Ed25519 imzasını gömülü anahtarla doğrula.
 *   2. Sürüm, tarih, kanal ve geri-sürüm kontrollerinden geçir.
 *   3. electron-updater'a sor; bulduğu sürüm imzalı manifestteki ile aynı mı?
 *   4. İndirilen paketin sha512'si imzalı manifesttekiyle birebir aynı mı?
 *   5. Kullanıcı onaylayınca kur.
 *
 * Herhangi bir adım başarısızsa güncelleme yapılmaz (fail-closed).
 */

const MANIFEST_ADI = 'pusula-guncelleme.json';
const KONTROL_ARALIGI_MS = 6 * 60 * 60 * 1000;
const ILK_KONTROL_GECIKMESI_MS = 45 * 1000;   // açılışta ağa yüklenmeyelim
const EN_BUYUK_MANIFEST = 64 * 1024;

const DURUMLAR = {
  KAPALI: 'kapali',            // anahtar/adres yapılandırılmamış
  PAKETLENMEMIS: 'paketlenmemis',
  BOSTA: 'bosta',
  KONTROL: 'kontrol',
  GUNCEL: 'guncel',
  BULUNDU: 'bulundu',
  INIYOR: 'iniyor',
  HAZIR: 'hazir',
  HATA: 'hata'
};

class GuncellemeYoneticisi {
  /**
   * @param {object} p
   * @param {object} p.app          Electron app
   * @param {object} p.oturum       indirme için kullanılacak Session
   * @param {Function} p.degisti    durum değişince çağrılır
   * @param {Function} p.ayarOku    () => { otomatikKontrol, otomatikIndir, kanal }
   */
  constructor({ app, oturum, degisti, ayarOku }) {
    this.app = app;
    this.oturum = oturum;
    this.degisti = degisti || (() => {});
    this.ayarOku = ayarOku || (() => ({}));

    this.durum = DURUMLAR.BOSTA;
    this.sebep = '';
    this.bulunanSurum = '';
    this.notlar = '';
    this.ilerleme = 0;
    this.sonKontrol = 0;
    this._imzaliOzet = '';
    this._calisiyor = false;
    this._zamanlayici = null;
    this._ilkZamanlayici = null;

    this.autoUpdater = null;
    // Paketlenmemiş çalıştırmada electron-updater yüklü olmayabilir ve zaten
    // güncelleme uygulayamaz; eksikliği hata sayılmamalı.
    try {
      ({ autoUpdater: this.autoUpdater } = require('electron-updater'));
    } catch {
      this.autoUpdater = null;
    }

    if (!anahtarlar.yapilandirilmisMi()) this.durum = DURUMLAR.KAPALI;
    else if (!this.app.isPackaged || !this.autoUpdater) this.durum = DURUMLAR.PAKETLENMEMIS;

    if (this.autoUpdater) this._updaterKur();
  }

  get etkin() {
    return this.durum !== DURUMLAR.KAPALI && this.durum !== DURUMLAR.PAKETLENMEMIS;
  }

  _updaterKur() {
    const u = this.autoUpdater;
    u.autoDownload = false;            // indirme kararını biz veriyoruz
    u.autoInstallOnAppQuit = false;    // kurulum yalnızca kullanıcı isteyince
    u.allowDowngrade = false;          // geri sürüm saldırısına kapalı
    u.allowPrerelease = false;
    if (anahtarlar.YAYINCI_ADI) {
      // Windows: indirilen kurulum dosyasının kod imzası bu yayıncıya ait olmalı.
      u.verifyUpdateCodeSignature = true;
      u.publisherName = [anahtarlar.YAYINCI_ADI];
    }

    u.on('download-progress', (p) => {
      this.ilerleme = Math.round(p.percent || 0);
      this._durumaGec(DURUMLAR.INIYOR);
    });
    u.on('update-downloaded', (bilgi) => {
      // Son kapı: indirilen paketin özeti imzalı manifesttekiyle aynı olmalı.
      const inen = (bilgi.files && bilgi.files[0] && bilgi.files[0].sha512) || bilgi.sha512;
      if (!ozetEslesiyor(this._imzaliOzet, inen)) {
        this.sebep = 'ozetUyusmuyor';
        this._durumaGec(DURUMLAR.HATA);
        return;
      }
      this.ilerleme = 100;
      this._durumaGec(DURUMLAR.HAZIR);
    });
    u.on('error', (e) => {
      this.sebep = String((e && e.message) || e).slice(0, 200);
      this._durumaGec(DURUMLAR.HATA);
    });
  }

  _durumaGec(yeni) {
    this.durum = yeni;
    this.degisti();
  }

  bilgi() {
    return {
      durum: this.durum,
      sebep: this.sebep,
      surum: this.app.getVersion(),
      bulunanSurum: this.bulunanSurum,
      notlar: this.notlar,
      ilerleme: this.ilerleme,
      sonKontrol: this.sonKontrol,
      etkin: this.etkin
    };
  }

  _platformAnahtari() {
    return process.platform + '-' + process.arch;
  }

  async _manifestiCek() {
    const kok = anahtarlar.FEED_ADRESI.replace(/\/+$/, '');
    const cek = async (yol) => {
      const y = await this.oturum.fetch(kok + '/' + yol, {
        cache: 'no-cache',
        headers: { 'User-Agent': 'GirginosBrowser/' + this.app.getVersion() }
      });
      if (y.status !== 200) throw new Error('HTTP ' + y.status + ' (' + yol + ')');
      const metin = await y.text();
      if (metin.length > EN_BUYUK_MANIFEST) throw new Error('manifest çok büyük');
      return metin;
    };
    const [ham, imza] = await Promise.all([cek(MANIFEST_ADI), cek(MANIFEST_ADI + '.imza')]);
    return { ham, imza };
  }

  /** @param {boolean} elle Kullanıcı düğmeye bastıysa true. */
  async kontrolEt(elle = false) {
    if (!this.etkin || this._calisiyor) return this.bilgi();
    this._calisiyor = true;
    this.sebep = '';
    this._durumaGec(DURUMLAR.KONTROL);

    try {
      const ayar = this.ayarOku();
      const { ham, imza } = await this._manifestiCek();

      const sonuc = manifestDogrula({
        ham,
        imza,
        acikAnahtarlar: anahtarlar.ACIK_ANAHTARLAR,
        mevcutSurum: this.app.getVersion(),
        platform: this._platformAnahtari(),
        kanal: ayar.kanal || 'kararli'
      });

      this.sonKontrol = Date.now();

      if (!sonuc.uygun) {
        // "Zaten güncel" bir hata değil.
        if (sonuc.sebep === SEBEPLER.GUNCEL) {
          this._durumaGec(DURUMLAR.GUNCEL);
        } else {
          this.sebep = sonuc.sebep;
          this._durumaGec(DURUMLAR.HATA);
        }
        return this.bilgi();
      }

      this.bulunanSurum = sonuc.surum;
      this.notlar = sonuc.notlar;
      this._imzaliOzet = sonuc.dosya.sha512;

      // electron-updater ne diyor? İmzalı manifestle aynı sürümü görmeli.
      const bulunan = await this.autoUpdater.checkForUpdates();
      const bilgi = bulunan && bulunan.updateInfo;
      if (!bilgi || bilgi.version !== sonuc.surum) {
        this.sebep = 'surumUyusmuyor';
        this._durumaGec(DURUMLAR.HATA);
        return this.bilgi();
      }
      const beyanEdilen = (bilgi.files && bilgi.files[0] && bilgi.files[0].sha512) || bilgi.sha512;
      if (!ozetEslesiyor(this._imzaliOzet, beyanEdilen)) {
        this.sebep = 'ozetUyusmuyor';
        this._durumaGec(DURUMLAR.HATA);
        return this.bilgi();
      }

      this._durumaGec(DURUMLAR.BULUNDU);
      if (ayar.otomatikIndir && !elle) await this.indir();
    } catch (e) {
      this.sebep = String((e && e.message) || e).slice(0, 200);
      this._durumaGec(DURUMLAR.HATA);
    } finally {
      this._calisiyor = false;
    }
    return this.bilgi();
  }

  async indir() {
    if (this.durum !== DURUMLAR.BULUNDU) return this.bilgi();
    this.ilerleme = 0;
    this._durumaGec(DURUMLAR.INIYOR);
    try {
      await this.autoUpdater.downloadUpdate();
    } catch (e) {
      this.sebep = String((e && e.message) || e).slice(0, 200);
      this._durumaGec(DURUMLAR.HATA);
    }
    return this.bilgi();
  }

  kurVeYenidenBaslat() {
    if (this.durum !== DURUMLAR.HAZIR) return false;
    // isSilent=false: kurulum penceresi görünsün, kullanıcı ne olduğunu görsün.
    this.autoUpdater.quitAndInstall(false, true);
    return true;
  }

  baslat() {
    if (!this.etkin) return;
    this._ilkZamanlayici = setTimeout(() => this._zamanlanmisKontrol(), ILK_KONTROL_GECIKMESI_MS);
    this._zamanlayici = setInterval(() => this._zamanlanmisKontrol(), KONTROL_ARALIGI_MS);
    if (this._ilkZamanlayici.unref) this._ilkZamanlayici.unref();
    if (this._zamanlayici.unref) this._zamanlayici.unref();
  }

  _zamanlanmisKontrol() {
    const ayar = this.ayarOku();
    if (ayar.otomatikKontrol === false) return;
    if (this.durum === DURUMLAR.HAZIR || this.durum === DURUMLAR.INIYOR) return;
    this.kontrolEt(false).catch(() => {});
  }

  dur() {
    clearTimeout(this._ilkZamanlayici);
    clearInterval(this._zamanlayici);
  }
}

module.exports = { GuncellemeYoneticisi, DURUMLAR };
