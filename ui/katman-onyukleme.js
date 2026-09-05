'use strict';

/*
 * Katman görünümünün köprüsü. Sekme içerikleri preload ALMAZ; bu preload
 * yalnızca bizim yazdığımız yerel katman sayfasına yüklenir ve yüzeyi
 * kasıtlı olarak dar tutulur: yalnızca kutunun yapabilmesi gereken işler.
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('katman', {
  // Ana süreç ne çizileceğini buradan bildirir.
  dinle: (geriCagirim) => {
    ipcRenderer.on('katman:icerik', (_e, veri) => geriCagirim(veri));
  },
  hazir: () => ipcRenderer.send('katman:hazir'),
  kapat: () => ipcRenderer.send('katman:kapat'),

  // İndirilenler kutusu
  indirmeAc: (id) => ipcRenderer.send('katman:indirme-ac', id),
  indirmeKlasor: (id) => ipcRenderer.send('katman:indirme-klasor', id),
  tumunuGoster: () => ipcRenderer.send('katman:tumunu-goster'),

  // İzin kutusu. Karar tek seferlik; ana süreç kutuyu kapatır.
  izinKarar: (izinVer, hatirla) => ipcRenderer.send('katman:izin', { izinVer, hatirla })
});
