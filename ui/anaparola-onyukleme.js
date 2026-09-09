'use strict';

/*
 * Ana parola penceresinin köprüsü. Yüzey kasıtlı olarak DAR: yalnız parolayı
 * ana sürece göndermek ve gösterilecek metni almak. Parola hiçbir yerde
 * saklanmıyor, yalnız ana sürece iletilip anahtar türetiliyor.
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('anaParola', {
  dinle: (geriCagirim) => { ipcRenderer.on('anaparola:icerik', (_e, veri) => geriCagirim(veri)); },
  hazir: () => ipcRenderer.send('anaparola:hazir'),
  gonder: (parola) => ipcRenderer.send('anaparola:gonder', parola),
  atla: () => ipcRenderer.send('anaparola:atla')
});
