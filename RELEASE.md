# Releasing Auto Video Editor

This page is for the person who publishes the app. Everything is automatic: you type one command, GitHub builds the installers for **Windows, macOS and Linux**, and puts them in a **public releases repository**. Your source code stays in your **private** repository.

```
private source repo  --(tag v1.2.3)-->  GitHub Actions builds 3 systems  -->  public releases repo
(code, secrets)                                                              (installers only)
                                                                                    |
                                                  website buttons and the in-app "Update now" read from here
```

There are three things you can publish:

1. **A new app version** (this page, sections 1 to 6).
2. **A new sound-effects package** (section 7, no new app version needed).
3. **A new styles package** (section 7, no new app version needed; it can carry the style thumbnails).

## 1. One-time setup checklist

Do these once. Replace `myname` with your GitHub name.

1. **Create the public releases repository.** On GitHub: New repository, name it for example `autoeditor-releases`, choose **Public**, tick "Add a README". It must contain **no source code**, only that README. The releases will appear in it.
2. **Create the token that may publish to it.** GitHub → your profile → Settings → Developer settings → Personal access tokens → **Fine-grained tokens** → Generate new token.
   - Repository access: **Only select repositories** → `autoeditor-releases` (only this one).
   - Permissions → Repository permissions → **Contents: Read and write**.
   - Choose a long expiry (the workflow stops working when the token expires; put the date in your calendar). Copy the token.
3. **Add the token as a secret** in the **source (private)** repository: Settings → Secrets and variables → Actions → **Secrets** → New repository secret. Name: `RELEASES_TOKEN`. Value: the token.
4. **Add the variable that names the releases repository.** Same page → **Variables** tab → New repository variable. Name: `RELEASES_REPO`. Value: `myname/autoeditor-releases`.
5. **Updater signing keys.** The app only installs updates that are signed with your private key; the matching public key is inside the app.
   - If you were given a key pair with this project, use it. To make a new pair (then step 6 is needed as well):

     ```bash
     npx tauri signer generate -w ~/.tauri/auto-editor-updater.key
     ```

     It asks for a password and prints the **public key**. The private key is the file you named with `-w`.
   - Add two **Secrets** to the source repository: `TAURI_SIGNING_PRIVATE_KEY` (the **whole text inside** the `.key` file) and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` (the password).
   - **BACK UP THE PRIVATE KEY AND ITS PASSWORD in a safe place** (a password manager and one offline copy). **If they are lost, apps that are already installed can never be updated again** - users would have to download and install the app by hand. Never put the key in the repository, in an email or in a chat. The repository ignores `*.key` and `.tauri-keys/` so it is not committed by accident.
6. **Only if you made a new key pair:** put the new **public key** (the text inside the `.key.pub` file) into `src-tauri/tauri.conf.json` → `plugins.updater.pubkey`, and commit it before the first release.
7. **Replace `<RELEASES_REPO>`** with `myname/autoeditor-releases` in these two places:
   - `src-tauri/tauri.conf.json` → `plugins.updater.endpoints` (the release workflow also does this by itself while building, from the variable `RELEASES_REPO`, so the app that people download always has the right address; replace it in the file as well so a local build works too).
   - `website/download-buttons.html` (use "Replace all": it appears in the five links and in the script).
8. **Check:** Settings → Secrets and variables → Actions should now show the secrets `RELEASES_TOKEN`, `TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` and the variable `RELEASES_REPO`.

If a setting is missing, the workflow stops in its first minute with a message that says exactly what to set. It never publishes anything to the source repository.

## 2. How to publish a new version

On your computer, in the source repository, on the `main` branch with everything committed:

```bash
npm run release -- patch      # 0.1.0 -> 0.1.1   (small fixes)
npm run release -- minor      # 0.1.0 -> 0.2.0   (new features)
npm run release -- major      # 0.1.0 -> 1.0.0   (big changes)
```

The command:

1. checks that the working tree is clean and that you are on `main`,
2. writes the new version into `package.json`, `package-lock.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml` and `src-tauri/Cargo.lock`,
3. asks you for the release notes (one line per change, an empty line to finish). If you write nothing, it uses the notes under "Unreleased" in `CHANGELOG.md`, and if there are none, the commit messages since the last tag,
4. adds the section to `CHANGELOG.md`, commits `Release vX.Y.Z` and creates the tag `vX.Y.Z`,
5. pushes the commit and the tag.

The tag starts the workflow. Open the **Actions** tab of the source repository and watch **Release**. It takes about **10 to 20 minutes** (the very first run is longer, about 40 minutes, because FFmpeg for the Mac is built once and then kept in the cache).

What the workflow does:

| Job | What it does |
| --- | --- |
| Check settings | Tests the variable, the secrets, that the releases repo is public and that tag and version agree |
| FFmpeg for macOS | Builds a static LGPL FFmpeg for Apple Silicon and for Intel (cached) |
| Build Windows / Linux | Downloads the LGPL FFmpeg, builds the `.exe`, `.msi`, `.AppImage` and `.deb`, and signs the update files |
| Build macOS | Makes one universal app (Intel + Apple Silicon): `.dmg` and the update bundle |
| Publish the release | **Only if all builds worked:** creates a hidden draft in the releases repo, uploads every installer and the five fixed-name copies, uploads `latest.json` **last**, then publishes it as the latest release |

If any build fails, nothing is published. A manual run is also possible: Actions → Release → **Run workflow** (it releases the version that is in the files).

When it is done, the release is at `https://github.com/myname/autoeditor-releases/releases`, the download links below give the new version, and installed apps show the update banner the next time they check.

## 3. The five fixed download links

These names never change, and always give the newest version. Put `RELEASES_REPO` (for example `myname/autoeditor-releases`) in place of `<RELEASES_REPO>`:

| System | Link |
| --- | --- |
| Windows installer | `https://github.com/<RELEASES_REPO>/releases/latest/download/AutoEditor-windows-x64-setup.exe` |
| Windows MSI | `https://github.com/<RELEASES_REPO>/releases/latest/download/AutoEditor-windows-x64.msi` |
| Mac | `https://github.com/<RELEASES_REPO>/releases/latest/download/AutoEditor-macos-universal.dmg` |
| Linux AppImage | `https://github.com/<RELEASES_REPO>/releases/latest/download/AutoEditor-linux-x64.AppImage` |
| Linux .deb | `https://github.com/<RELEASES_REPO>/releases/latest/download/AutoEditor-linux-x64.deb` |

`website/download-buttons.html` is a small block you paste into your website: three buttons (it highlights the visitor's system), the install notes and the latest version number.

The updater address inside the app is `https://github.com/<RELEASES_REPO>/releases/latest/download/latest.json`.

## 4. Warnings without paid code-signing certificates

The installers are **not** signed with a paid certificate, so the operating systems show a warning the first time. This is normal and the website snippet already explains it to visitors:

- **Windows** shows "Windows protected your PC" (SmartScreen). Click **More info**, then **Run anyway**.
- **macOS** says the app cannot be opened (Gatekeeper). Right-click the app, choose **Open**, then **Open** again. (Or: System Settings → Privacy & Security → "Open Anyway".)
- **Linux** has no such warning. Make the AppImage executable (right-click → Properties → Allow executing) or install the `.deb`.

These warnings are only about the first install. App **updates** made by the in-app button are checked with your signing key and do not show them again.

Paid certificates remove the warnings later: a Windows code-signing certificate (or Azure Trusted Signing) and an Apple Developer account (99 USD a year, for signing and notarizing). When you have them, add their secrets to the workflow; nothing else changes.

## 5. Troubleshooting

- **"The variable RELEASES_REPO is not set" / "secret ... is not set"**: add it as described in section 1, then run the workflow again (Actions → the failed run → Re-run all jobs).
- **"The token RELEASES_TOKEN cannot see ..."**: the token has the wrong repository, no "Contents: read and write", or it expired. Make a new token (section 1, step 2) and replace the secret.
- **The releases repository is private**: make it public (its Settings → Danger zone → Change visibility). Nobody can download from a private repository.
- **One platform failed**: open the failed job and read the red step. Nothing was published. Fix the problem (or just re-run the failed job: "Re-run failed jobs"), and the publish job runs after all three have worked. Typical causes: a network problem while downloading FFmpeg (re-run), or a Rust/TypeScript error (fix, commit, make a new tag).
- **"The tag is vX but the files say version Y"**: the tag and the version files disagree. Use `npm run release` instead of tagging by hand.
- **"already has a published release vX"**: that version was already published. Use a new version number.
- **macOS FFmpeg step fails**: it is built from source by `scripts/ci/build-ffmpeg-macos.sh`. The log shows which library failed. Fix the script (the versions are at the top) and push; the result is cached by the script's content.
- **The update banner does not appear in an installed app**: (1) the new version must be higher than the installed one; (2) the app checks at most once a day, so press **Settings → Updates → Check for updates**; (3) check that `https://github.com/<RELEASES_REPO>/releases/latest/download/latest.json` opens in a browser; (4) the app that is installed must have been built by this workflow (a development build has the placeholder address and skips the check); (5) if the signing key was changed, apps made with the old key cannot accept updates.
- **"The update could not be trusted (its signature does not match)"**: the release was signed with a different key than the app contains. Use the original key.
- **Delete a wrong release**: delete the release and its tag in the releases repository, then release again with a new version number.

## 6. Building by hand (not needed normally)

On a computer of the system you want (Windows, for example), with Node, Rust and the C++ build tools:

```bash
npm install
npm run setup:ffmpeg
# private key text or path, and its password
export TAURI_SIGNING_PRIVATE_KEY="$(cat ~/.tauri/auto-editor-updater.key)"
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="..."
npm run tauri build
```

The installers are in `src-tauri/target/release/bundle/`. The installer includes FFmpeg/FFprobe, the fonts, the built-in styles and the base sound effects, so a clean PC needs nothing else. Projects are stored outside the app folder, so an update never touches them. A hand-built app has the `<RELEASES_REPO>` placeholder as its update address (unless you replaced it), so it does not look for updates.

Version numbers: `node scripts/set-version.mjs 0.2.0` changes all files at once (the release command does this for you).

## 7. Releasing new sounds or styles (no new app version)

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

## 8. Test before you publish (clean PC)

On a Windows PC that has no Node, Rust, Python or FFmpeg:

1. Install the `-setup.exe`. The Start menu entry opens the app; the first-run screens appear.
2. New project → voice → timing (Groq key, or an SRT) → scenes → prompts (Gemini key) → import media → render. A finished MP4 appears in the project's `exports` folder.
3. Settings → Updates → **Check for updates** shows "You have the latest version" (or the banner at the top, if you published a newer one).
4. Settings → Help and logs → **Export logs** creates a text file with no API keys in it.
