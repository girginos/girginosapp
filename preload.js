'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const dinle = (kanal) => (geriCagirim) => {
  const sarmal = (_e, veri) => geriCagirim(veri);
  ipcRenderer.on(kanal, sarmal);
  return () => ipcRenderer.removeListener(kanal, sarmal);
};

contextBridge.exposeInMainWorld('pusula', {
  // Pencere denetimlerinin hangi kenarda durduğunu bilmek için gerekiyor.
  platform: process.platform,

  // Ana süreçten gelen olaylar
  durumDinle: dinle('durum'),
  bulmaSonucuDinle: dinle('bulma-sonucu'),
  adresOdakDinle: dinle('adres-odak'),
  bulmaAcDinle: dinle('bulma-ac'),
  panelAcDinle: dinle('panel-ac'),
  yerImiKisayolDinle: dinle('yer-imi-degistir'),

  // Arayüz durumu
  hazir: () => ipcRenderer.send('ui:hazir'),
  yukseklikBildir: (px) => ipcRenderer.send('ui:yukseklik', px),
  panelBildir: (acik) => ipcRenderer.send('ui:panel', acik),
  olcuBildir: (o) => ipcRenderer.send('ui:olcu', o),

  // Sekmeler
  yeniSekme: (url) => ipcRenderer.send('sekme:yeni', url),
  sekmeKapat: (id) => ipcRenderer.send('sekme:kapat', id),
  sekmeSec: (id) => ipcRenderer.send('sekme:sec', id),

  // Gezinme
  git: (girdi) => ipcRenderer.send('gez:git', girdi),
  geri: () => ipcRenderer.send('gez:geri'),
  ileri: () => ipcRenderer.send('gez:ileri'),
  yenile: () => ipcRenderer.send('gez:yenile'),
  dur: () => ipcRenderer.send('gez:dur'),
  anasayfa: () => ipcRenderer.send('gez:anasayfa'),
  yakinlastir: (yon) => ipcRenderer.send('yakinlastir', yon),

  // Sayfada bul
  bul: (metin, ileri, sonraki) => ipcRenderer.send('bul:ara', { metin, ileri, sonraki }),
  bulmaKapat: () => ipcRenderer.send('bul:kapat'),

  // Veri
  gecmisListele: (sorgu) => ipcRenderer.invoke('gecmis:listele', sorgu),
  gecmisTemizle: () => ipcRenderer.invoke('gecmis:temizle'),
  veriTemizle: () => ipcRenderer.invoke('veri:temizle'),
  onbellekTemizle: () => ipcRenderer.invoke('onbellek:temizle'),
  izinTemizle: () => ipcRenderer.invoke('izin:temizle'),
  izinVarsayilanAyarla: (izin, karar) => ipcRenderer.invoke('izin:varsayilan', { izin, karar }),
  izinSiteOku: (origin) => ipcRenderer.invoke('izin:site', origin),
  izinSiteAyarla: (origin, izin, karar) => ipcRenderer.invoke('izin:siteAyarla', { origin, izin, karar }),
  yerImiDegistir: () => ipcRenderer.invoke('yerimi:degistir'),
  yerImiSil: (url) => ipcRenderer.invoke('yerimi:sil', url),
  yerImiGuncelle: (eskiUrl, ad, url) => ipcRenderer.invoke('yerimi:guncelle', { eskiUrl, ad, url }),
  yerImiSirala: (sirali) => ipcRenderer.invoke('yerimi:sirala', sirali),
  yerImiMenu: (url) => ipcRenderer.send('yerimi:menu', url),
  anaMenu: (konum) => ipcRenderer.send('menu:ana', konum),
  indirmeMenu: (konum) => ipcRenderer.send('indirme:menu', konum),
  siteMenu: (konum) => ipcRenderer.send('site:menu', konum),
  yerImiDuzenleDinle: dinle('yerimi-duzenle'),
  siteIzinleriDinle: dinle('site-izinleri'),
  ayarDegistir: (anahtar, deger) => ipcRenderer.invoke('ayar:degistir', { anahtar, deger }),
  siteEngelleyici: () => ipcRenderer.invoke('site:engelleyici'),

  // Uygulama güncellemesi
  guncellemeKontrol: () => ipcRenderer.invoke('guncelleme:kontrol'),
  guncellemeIndir: () => ipcRenderer.invoke('guncelleme:indir'),
  guncellemeKur: () => ipcRenderer.invoke('guncelleme:kur'),

  // Filtre listeleri
  listeGuncelle: () => ipcRenderer.invoke('liste:guncelle'),
  listeEkle: (url) => ipcRenderer.invoke('liste:ekle', url),
  listeSil: (id) => ipcRenderer.invoke('liste:sil', id),

  // İndirmeler — dosya yolu değil, ana süreçteki kaydın kimliği gönderilir.
  indirmeKlasor: (id) => ipcRenderer.send('indirme:klasor', id),
  indirmeAc: (id) => ipcRenderer.send('indirme:ac', id),
  disAc: (url) => ipcRenderer.send('dis:ac', url)
});
