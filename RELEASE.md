# Releasing Auto Video Editor

This page is for the person who publishes the app. There are three things you can publish:

1. **A new app version** (installer + signed update).
2. **A new sound-effects package** (no new app version needed).
3. **A new styles package** (no new app version needed).

## 1. One-time set-up: the signing keys for app updates

App updates are signed. The app only installs an update whose signature matches the **public key** inside the app.

```bash
npx tauri signer generate -w ~/.tauri/auto-video-editor.key
```

- The command prints a **public key** and writes a **private key** to `~/.tauri/auto-video-editor.key`.
- **Keep the private key outside the repository** (it is never committed) and **back it up**. If you lose it (or its password), already-installed apps can never be updated again.
- Put the public key in `src-tauri/tauri.conf.json` → `plugins.updater.pubkey`.
- Put the address of your update file in `plugins.updater.endpoints` (for GitHub: `https://github.com/<you>/<repo>/releases/latest/download/latest.json`).

> The `pubkey` and the `OWNER/REPO` address that come in the repository are **placeholders made for development**. Replace both before the first public release. (A user can also override the address in Settings → App updates.)

## 2. Releasing a new app version

1. Choose the version and write it everywhere:

   ```bash
   node scripts/set-version.mjs 0.2.0
   cd src-tauri && cargo check   # lets Cargo.lock follow
   ```

2. On a **Windows** computer (the installers are built on the system they are for), with Node, Rust and the C++ build tools:

   ```powershell
   npm install
   npm run setup:ffmpeg
   $env:TAURI_SIGNING_PRIVATE_KEY = "C:\Users\you\.tauri\auto-video-editor.key"     # path to the private key file
   $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = "..."                                  # only if you set a password
   npm run tauri build
   ```

3. The results are in `src-tauri\target\release\bundle\`:

   | File | What it is |
   | --- | --- |
   | `nsis\Auto Video Editor_<version>_x64-setup.exe` | the installer to give to people (per-user install, no admin rights needed) |
   | `msi\Auto Video Editor_<version>_x64_en-US.msi` | the same app as an MSI, for managed computers |
   | `nsis\...-setup.exe.sig` | the signature of the update file |

   The installer includes FFmpeg/FFprobe, the fonts, the built-in styles and the base sound effects, so a clean PC needs nothing else (no Node, Rust, Python or FFmpeg). WebView2 comes with Windows 10/11; the installer also carries the small WebView2 bootstrapper for older systems.

4. Publish the update. Upload the `-setup.exe` to your release and create `latest.json` next to it:

   ```json
   {
     "version": "0.2.0",
     "notes": "What is new, in one or two sentences.",
     "pub_date": "2026-10-18T10:00:00Z",
     "platforms": {
       "windows-x86_64": {
         "signature": "<the text inside the .sig file>",
         "url": "https://github.com/<you>/<repo>/releases/download/v0.2.0/Auto.Video.Editor_0.2.0_x64-setup.exe"
       }
     }
   }
   ```

   Running apps look at `latest.json` when they start (and when the person presses **Check for app update**). If `version` is higher than the installed one, a banner appears: **Update now**. The update is downloaded, its signature is checked, and the installer runs in passive mode (a small progress window, no questions). Projects are stored outside the app folder, so an update never touches them.

5. Optional but recommended for public releases: sign the installer with a Windows **code-signing certificate**, otherwise Windows SmartScreen may show a warning for new apps.

### Installer size

The installer is mostly FFmpeg + FFprobe (about 70 to 140 MB each, depending on the build) and the CJK fonts (about 37 MB). NSIS uses LZMA compression. To make it smaller, you can ship fewer fonts (remove the ones you do not need from `resources/fonts` and from the font list in the app) or use a smaller FFmpeg build.

## 3. Releasing new sounds or styles (no new app version)

Use the **Admin Edition**, which is a separate build that is never given to users:

```bash
npm run dev:admin      # to try it
npm run build:admin    # to make the admin installer (does not need the signing key)
```

In the Admin page:

1. Save your Freesound API key (it goes to the operating-system keychain of that computer).
2. **Start from the current library** (first time only), then search Freesound. Only CC0 sounds are listed. Listen, choose a category and tags, and press **Download and normalize** (the sound is trimmed, brought to -16 LUFS and given 10 ms fades).
3. Add or change styles in the **Style profiles** box (paste the style JSON; the id must not start with `custom_`).
4. Press **Build library package** for sounds and/or styles. In the packages folder shown on the page you get:
   - `sfx-library-<version>.zip` and `manifest.json`
   - `styles-package-<version>.zip` and `styles-manifest.json`

   The version number goes up by itself. `manifest.json` holds `version`, `sha256`, `count` and `date`.
5. Upload these files to one web folder (for example the assets of a GitHub release called "library", or any HTTPS folder). The folder address is what users type in **Settings → Library updates → Update address**; it can also be built into the app with the `AVE_LIBRARY_URL` environment variable when building.

What users see: when the app starts (or when they press **Check for library update** on the SFX Library page), it downloads the small manifest. If its version is newer, the zip is downloaded, its SHA-256 is checked, and only then is it installed. The previous version stays on disk and **Go back to the version before** restores it. A damaged or incomplete download never replaces anything.

A styles package **replaces the whole list of built-in styles**, so always build it from the complete list (the Admin page does this for you).

## 4. Test before you publish (clean PC)

On a Windows PC that has no Node, Rust, Python or FFmpeg:

1. Install the `-setup.exe`. The Start menu entry opens the app; the first-run screens appear.
2. New project → voice → timing (Groq key, or an SRT) → scenes → prompts (Gemini key) → import media → render. A finished MP4 appears in the project's `exports` folder.
3. Settings → App updates → **Check for app update** shows "You have the newest version" (or the banner, if you published a newer one).
4. Settings → Help and logs → **Export logs** creates a text file with no API keys in it.
