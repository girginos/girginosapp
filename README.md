# Girginos Browser

A privacy-focused desktop web browser. Interface available in 11 languages.

*[Türkçe README](README.tr.md)*

The rendering engine is **Chromium** (via Electron); the browser itself — tab
management, address bar, filter-list infrastructure, history, bookmarks,
downloads, permission flow and the entire interface — is written in the code in
this repository.

Download for Windows: <https://girginos.app>

## Running it

```bash
npm install
npm start
```

Tests (no Electron required, they take seconds):

```bash
npm test
```

`test/dogrula.js` covers URL resolution and blocker logic; `test/guvenlik.js`
covers security regressions against hostile input; `test/guncelleme.js` covers
update signature/version/digest verification; `test/sozlesme.js` covers the
renderer–main IPC/DOM contract and the key integrity of the 11 language files.

## What's in it

| Area | Status |
| --- | --- |
| Tabs | Open/close/switch, middle-click close, favicon, loading indicator |
| Address bar | URL/search disambiguation, history suggestions, keyboard navigation |
| Search engines | DuckDuckGo (default), Google, Yandex, Bing, Startpage, Brave |
| Blocker | 213 built-in domains + EasyList & EasyPrivacy (~96,000 domains) |
| Filter lists | Automatic updates, custom lists, offline cache |
| Privacy | DNT + Sec-GPC, per-permission global default, data and permission clearing |
| New tab | Search, most-visited sites, shortcuts, announcement area |
| History | Search, day headings, one-click clearing (recording can be disabled) |
| Bookmarks | Ctrl+D, bookmarks bar, panel |
| Downloads | Last-10-downloads menu in the toolbar, executable-file warning |
| Find in page | Ctrl+F, forward/backward, match counter |
| Site icons | Downloaded once and served from a local cache, no remote requests |
| Updates | Ed25519-signed release manifest, automatic checks, channel selection |
| Appearance | Light / dark / follow-system, applied to the UI, built-in pages and native menus |
| Languages | Türkçe, English, Deutsch, Français, Español, Italiano, Português, Русский, العربية (RTL), 简体中文, 日本語 |

## Keyboard shortcuts

`Ctrl+T` new tab · `Ctrl+W` close tab · `Ctrl+Tab` switch tab · `Ctrl+1..9` go to tab
`Ctrl+L` address bar · `Ctrl+F` find in page · `Ctrl+R` reload · `Alt+←/→` back/forward
`Ctrl+D` bookmark · `Ctrl+H` history · `Ctrl+J` downloads · `Ctrl+Shift+B` bookmarks bar
`Ctrl+,` settings · `Ctrl+ +/-/0` zoom · `F11` fullscreen · `Ctrl+Shift+I` developer tools

## File layout

Source files keep their Turkish names; the project is developed in Turkish and
renaming them would only add churn.

```
main.js              main process: window, tabs, menus, session, IPC
preload.js           the secure bridge between renderer and main process
src/urls.js          turning address-bar input into a URL or a search
src/store.js         settings, history, bookmarks, permissions (JSON)
src/blocker.js       request blocking decisions and counters
src/blocklist.js     built-in ad/tracking domains
src/listeler.js      filter list download, parsing, cache, scheduling
src/diller/          translation tables for 11 languages (tr is the reference)
src/faviconlar.js    site icon cache and the pusula-favicon:// scheme
src/sertifikalar.js  TLS certificate store and summaries for the site panel
src/guncelleme.js    update flow (via electron-updater)
src/guncelleme-dogrula.js  signature/version/digest verification (pure, tested)
src/guncelleme-anahtar.js  embedded public key and feed address
src/guvenlik.js      the shell's security decisions (scheme, filename, internal pages)
src/menu-yerlesim.js native menu geometry (pure, tested)
scripts/             key generation, manifest signing and release verification
ui/index.html        browser interface (tab strip, toolbar, panels)
ui/app.js            interface logic
ui/style.css         light/dark theme, RTL
ui/newtab.html|js    new tab / home page
ui/error.html|js     error page
test/dogrula.js      pure logic tests
test/guvenlik.js     attack-vector regressions
test/guncelleme.js   update verification tests
test/sozlesme.js     IPC/DOM contract + language key audit
```

## Filter lists

The default subscriptions are **EasyList** (ads) and **EasyPrivacy** (trackers).
Lists are checked roughly 15 seconds after first launch and then every 6 hours,
and refreshed according to the list's own `! Expires` directive (usually 4
days). Downloads happen from a separate, non-persistent session, so no cookies
are kept. The parsed form is cached under
`%APPDATA%/Girginos Browser/listeler/*.json`; if the network is unavailable the
last good copy stays in use. You can add your own list from Settings (an https
address in Adblock Plus, hosts, or plain domain format).

**The parser is deliberately selective:** only rules whose meaning can be
preserved exactly are accepted — `||domain.com^` and `||domain.com^$third-party`.
Path patterns, resource-type constraints (`$script` and friends), `$domain=`
context and cosmetic filters are skipped, because turning them into "block
everything" breaks pages. About 85% of today's lists pass through this filter.

## Architecture and security notes

- Every tab is a separate `WebContentsView`; page content runs with
  `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false` and
  **receives no preload**.
- The interface window also runs with `sandbox: true` and in the **same session**
  as the tabs, so favicon requests go through the blocker and DNT headers too.
- IPC channels are only accepted from the interface window's main frame; setting
  writes go through key/type validation.
- Downloads are addressed by ID — a raw file path coming from the renderer is
  never opened. Invisible directional characters are stripped from filenames,
  and executable extensions raise a warning before opening.
- Page-initiated navigation is limited to `http(s)` and `view-source:http(s)`;
  `file:`/`chrome:` open only if the user types them into the address bar.
- Handing off to external applications is limited to a narrow scheme list
  (`mailto:`, `tel:`, `sms:`, `magnet:`, `ftp(s):`, `webcal:`) and only one
  confirmation dialog can be open at a time.
- Permission requests are accepted only from the active tab; opaque origins such
  as `data:`/`about:` (whose origin is `"null"`) are always denied. Notification,
  geolocation, MIDI, clipboard and idle-detection permissions are silently denied
  by default — each can be changed to "Ask / Allow / Deny" in Settings.
- The address bar does not decode directional or control characters, and does not
  display the username/password portion of a URL.
- New-tab and error pages run sandboxed and without preload; everything they
  display (including translated strings) is passed via URL parameters, and the
  page makes no outbound requests.
- Site icons are never loaded from a remote address in the interface: they are
  downloaded once from the browsing session, written to disk and served over the
  local `pusula-favicon://` scheme. This keeps the interface window's CSP as
  narrow as `img-src data: pusula-favicon:` — no attacker-controlled image is
  decoded in the privileged process.
- Spellchecking is disabled: Chromium downloads its dictionaries from a Google
  server.
- The page view is drawn as a native layer above the interface. Because of this,
  dropdowns, the downloads menu and the find bar cannot overlay the page; they
  sit in the interface flow and push the page down when opened.
- Data is stored under `%APPDATA%/Girginos Browser/pusula-veri.json`, written
  atomically via a temporary file plus rename.

## New tab announcement area

**No third-party ad network is used** — our own blocker would cut it anyway, and
it would contradict the privacy promise. Cards are read from the
`ayarlar.duyurular` array inside `pusula-veri.json`:
`{ etiket, baslik, metin, url }`. The page reads this locally and makes no
outbound requests.

## Update system

An installed version updates itself; users do not have to download a new
installer every time. The threat model assumes **the update server may be
compromised**.

electron-updater performs the download and installation, but a signed gate sits
in front of it:

1. `pusula-guncelleme.json` and the neighbouring `.imza` file are fetched.
2. The signature is verified over the manifest's **raw bytes** using the
   **Ed25519** public key embedded in the application. If it fails, no field is
   read.
3. Version checks: downgrades are rejected; a manifest past its own expiry date
   is rejected (defending against a freeze attack that serves an old manifest
   forever); an intermediate version can be made mandatory; the download address
   must be https.
4. The version and package digest that electron-updater finds must match the
   signed manifest exactly.
5. Once the download finishes, the package's sha512 is compared against the
   signed digest in constant time.
6. Installation starts only with user approval.

If any step fails, no update is performed. The private key never sits on the
server; even if the server is compromised, an attacker cannot produce a valid
manifest.

This repository ships with the release **public** key and feed address already
configured in `src/guncelleme-anahtar.js`. The private key is deliberately not in
the repository. In a fork with no key configured the system is **fail-closed**:
updates are simply off.

### Setting it up in a fork

```bash
npm run anahtar-uret                 # generates an Ed25519 pair
# add the public key to the ACIK_ANAHTARLAR array in src/guncelleme-anahtar.js
# set FEED_ADRESI and package.json > build.publish.url to your own https address
```

Cutting a release:

```bash
npm run paket                        # installers under dagitim/
npm run manifest-imzala -- --anahtar ~/pusula-yayin-anahtari.pem --indirme https://browserapp.girginos.app/pusula
npm run yayin-dogrula -- ~/pusula-yayin-anahtari.pem   # final check before upload
npm run canli-dogrula                # after upload: verify against the live server
```

`yayin-dogrula` runs the application's update gate end to end against the real
build output: the package's actual on-disk sha512, `latest.yml` and the signed
manifest pointing at the same package, signature validity, rejection of a
tampered manifest and of a modified download address, and the downgrade and
expired-manifest gates. Run a release through this before putting it on the
server.

`canli-dogrula` then repeats the verification against the **live feed**, using
the bytes actually served over the network — this catches upload corruption and
misconfigured caching that local checks cannot see.

Upload the contents of `dagitim/` (installers, `latest.yml`,
`pusula-guncelleme.json`, `pusula-guncelleme.json.imza`) to the feed address.

The installer is **not code-signed**: Windows SmartScreen shows a warning on
first run. This is expected until a certificate is obtained.

If you have a Windows code signing certificate, fill in the `YAYINCI_ADI` field
in `src/guncelleme-anahtar.js`: electron-updater will then also verify the
downloaded installer's code signature against that publisher.

### Key rotation

`ACIK_ANAHTARLAR` is an array. Add the new key to the list and publish a release
signed with the **old** key; once users have moved to that release, remove the
old key from the list.

## Security review

A browser's attack surface splits in two, and the two halves behave very
differently.

**The engine (Chromium/V8/Skia).** In 2026 dozens of memory-safety bugs were
fixed in Chrome, including six zero-days exploited in the wild. We do not write
this code and cannot fix it — **the only defence is keeping the engine current.**
Hence the rule: *Girginos Browser is never released on an end-of-life Electron
version.* Electron supports only the latest three major versions; the version pin
in `package.json` must be checked before every release.

Currently: **Electron 44.2.0 · Chromium 152.0.7977.76**.

**The shell (the code in this repository).** Address bar, permission flow,
downloads, scheme transitions, internal pages — the same class of issues as the
UI spoofing and download protection bugs Chrome and Firefox fixed in 2026.
`test/guvenlik.js` exercises these with hostile input:

| Class | Example vector | Response |
| --- | --- | --- |
| Address bar spoofing | RLO/bidi, CR-LF, NUL, space padding, `bank.com@evil.com`, IDN homographs | Invisible characters and spaces stay encoded, credentials are hidden, punycode is shown |
| Domain hiding | `accounts.google.com.login.evil.com` | The address bar renders the registrable domain in full colour and the rest dimmed |
| Internal page impersonation | A downloaded `newtab.html` | Exact URL match; no substring search |
| Fullscreen UI spoofing | A page goes fullscreen and draws a fake toolbar | The page view is never expanded over the chrome; the real address bar stays on screen |
| Scheme transition | `file:`, `chrome:`, `blob:`, `view-source:file:` | Page-initiated navigation is `http(s)` only |
| External application | `ms-msdt:`, `search-ms:`, `ms-appinstaller:` | Narrow allowlist; a single confirmation dialog |
| Download protection | `evil.exe ` / `evil.exe.` (Windows strips trailing dots and spaces), extension hidden with RLO | Normalisation before the extension check; the decision is made from the real on-disk name |
| Blocker evasion | `tracker.com.` (trailing dot) | Host normalisation |

The **remaining gaps** on the shell side, stated honestly:

- **No Mark-of-the-Web.** `Zone.Identifier` is not written to downloaded files, so
  Windows SmartScreen does not engage for them. There is a warning dialog, but no
  operating-system layer.
- **No code signing certificate.** The installer's code signature cannot be
  verified; the signed manifest closes this gap for *updates*, but a certificate
  is still needed for the *first install*.
- **No Public Suffix List.** On hosting domains such as `github.io`, both site
  exceptions and address-bar emphasis cover more than they should.
- **Certificate error flow is Chromium's default.** No custom "continue anyway"
  screen was written; on a bad certificate the page simply does not open.

## Known limitations

- Single window: tab state is bound to one window, so there is no "New window"
  menu entry.
- Root domain derivation does not use a full Public Suffix List; on hosting
  domains such as `github.io` or `vercel.app`, site exceptions cover more than
  they should.
- Blocking is domain-level only: trackers hidden behind CNAMEs and first-party
  ads are not caught, and no cosmetic filtering is applied.
- Engine currency is tracked manually: the Electron version must be checked
  before every release (see Security review).
- No browser extension (WebExtension) support.
- Tabs cannot be reordered by dragging, and there is no private window.

## License

MIT. See [LICENSE](LICENSE).

Chromium and Electron are under their own licenses; the `LICENSES.chromium.html`
file in the installer carries the license texts for those components.
