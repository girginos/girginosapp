'use strict';

/*
 * LINT KAPISI.
 *
 * Amaç biçim değil HATA yakalamak: yazım yanlışı yüzünden tanımsız değişken,
 * kullanılmayan kod, erişilemeyen dal, yanlış karşılaştırma. Biçim kuralları
 * (tırnak, noktalı virgül, girinti) BİLEREK yok - mevcut 11 bin satırı yeniden
 * biçimlendirmek tek bir gerçek hata bulmaz, sadece diff üretir.
 *
 * Bu kapı kurulduğu ilk çalıştırmada gerçek bir hata buldu: main.js'te
 * `p.anahtar === anaParolaAcik` (string olmalıyken çıplak tanımlayıcı). Strict
 * modda ReferenceError fırlatıyordu, ipcMain.handle sarmalayıcısı yakalamıyor,
 * yani her ayar değişikliğinde işleyici o satırda ölüyordu: `durumGonder()`
 * hiç çalışmıyor, sonraki dal (dil değiştirme) hiç uygulanmıyordu.
 *
 * Süreçler farklı küreseller görüyor: ana süreç Node, arayüz tarayıcı, sayfaya
 * enjekte edilen modüller ikisini birden. Her birine kendi ortamını veriyoruz
 * ki no-undef tasarımı değil gerçek hatayı işaretlesin. Sıra ÖNEMLİ: flat
 * config'de sonraki blok öncekini ezer, bu yüzden özel gruplar en sonda.
 */

const globals = require('globals');

const ORTAK = {
  'no-undef': 'error',
  // caughtErrors 'none': `catch (e)` içinde e'yi kullanmamak bilerek yapılan
  // bir şey ("hata olursa yut"), hata değil.
  'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none', varsIgnorePattern: '^_' }],
  'no-unreachable': 'error',
  'no-dupe-keys': 'error',
  'no-dupe-args': 'error',
  'no-duplicate-case': 'error',
  'no-func-assign': 'error',
  'no-cond-assign': 'error',
  'no-constant-condition': ['error', { checkLoops: false }],
  'no-self-compare': 'error',
  'no-unsafe-negation': 'error',
  'no-unsafe-optional-chaining': 'error',
  'use-isnan': 'error',
  'valid-typeof': 'error',
  'no-fallthrough': 'error',
  'no-empty': ['error', { allowEmptyCatch: true }],
  'no-async-promise-executor': 'error',
  /*
   * require-atomic-updates BİLEREK kapalı: bu kodda tek iş parçacığı var,
   * kural `await` sonrası her alan atamasını yarış sanıyor. Denendi, 12
   * bulgunun 12'si de yanlış pozitifti; gerçek eşzamanlılık Go tarafında ve
   * orası `go test -race` ile ölçülüyor.
   */
};

module.exports = [
  {
    ignores: ['dagitim/**', 'node_modules/**'],
  },
  {
    // Ana süreç, modüller, testler, betikler: Node.
    files: ['main.js', 'preload.js', 'src/**/*.js', 'test/**/*.js', 'scripts/**/*.js', 'eslint.config.js'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'commonjs',
      globals: { ...globals.node },
    },
    rules: ORTAK,
  },
  {
    // Arayüz: tarayıcı ortamı; ana sürece yalnızca köprüyle ulaşır.
    files: ['ui/**/*.js'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'script',
      globals: { ...globals.browser },
    },
    rules: ORTAK,
  },
  {
    /*
     * SAYFAYA ENJEKTE EDİLEN KOD. Node'da require ediliyorlar ama gövdelerinin
     * bir kısmı sayfanın içinde çalışıyor (scriptlet'ler, anti-adblock karşı
     * önlemleri, kararlılık yamaları). İkisini birden görürler.
     */
    files: ['src/betikler.js', 'src/anti-adblock.js', 'src/prosedurel.js', 'src/kararlilik.js', 'src/kozmetik.js'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'commonjs',
      globals: { ...globals.node, ...globals.browser },
    },
    rules: ORTAK,
  },
  {
    // Önyükleme betikleri: contextBridge burada, iki dünyanın arası.
    files: ['preload.js', 'ui/*-onyukleme.js'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'commonjs',
      globals: { ...globals.node, ...globals.browser },
    },
    rules: ORTAK,
  },
];
