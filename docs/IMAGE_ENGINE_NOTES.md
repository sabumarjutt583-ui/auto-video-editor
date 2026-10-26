# Image engine notes (study of the reference tool)

Source studied: `vendor/sahil-image-generator/src` (Electron + playwright-core, about 3,900 lines of JavaScript, written by the owner's brother, reused with his permission). The folder `vendor/` is git-ignored and is never shipped. These notes say how it works and what we keep, change or drop in Auto Editor.

## 1. Idea in one paragraph

Gemini has a shared "Canvas" app that draws images with `gemini-3.1-flash-image` using the **viewer's own Google account**. The reference tool opens that shared page in the user's installed Chrome/Edge (own profile folder, signed in by the user), types prompts into the page's own form, reads the finished `data:image/...;base64` pictures out of the page, and saves them. Everything else (queue, accounts, retries, crash recovery, safe saving) is ordinary application code around that.

## 2. Browser launch and profile handling (`browser/*`)

- `browserLocator`: looks for Chrome, then Edge, Brave, Chromium in the usual Windows (`Program Files`, `Program Files (x86)`, `LocalAppData`), macOS (`/Applications/...`) and Linux (`/usr/bin/...`) paths. A browser the user picked wins. Electron's own browser is never used because Google refuses sign-in from embedded browsers.
- One profile folder per account: `<data>/profiles/<account-id>/`, passed as `--user-data-dir`. Cookies stay in that folder, so sign-in survives restarts and accounts never share state. The app never sees a password.
- `browserSession` (automation browser): starts the browser with `--remote-debugging-port=0` (Chrome picks a free port and writes it into `<profile>/DevToolsActivePort`), plus `--no-first-run --no-default-browser-check` and three flags that stop Chrome from throttling a background or hidden tab (`--disable-background-timer-throttling`, `--disable-backgrounding-occluded-windows`, `--disable-renderer-backgrounding`, `--disable-features=CalculateNativeWinOcclusion`). Default is `--headless=new --window-size=1400,1000` ("hidden" mode). It then attaches over CDP. If a browser from an earlier crashed session is still running on that profile, it re-attaches to it (the port file is probed with `/json/version`).
- Nothing is disguised: no user-agent change, no `navigator.webdriver` patch, no automation-hiding flags. Headless Chrome announces itself as HeadlessChrome. We keep it that way.
- One work tab per account. Extra tabs are closed. `peek()` takes a JPEG screenshot of the work tab for the "show background browser" view without touching the page. `show()` brings the window to the front. Minimize and restore go through `Browser.setWindowBounds`.
- Stop: `Browser.close` over CDP, then wait up to 4 s for the process, then kill.
- `sessionPool`: lazy start, hold/release counters (a browser used by a job is never closed), idle close after 10 minutes, startup clean-up of orphan automation browsers and orphan profile folders, profile deletion when an account is removed.

## 3. Sign-in flow (`browser/signInBrowser`, `shared/sharedToolConnect`)

1. Close the automation browser of that profile (a profile can only be open once).
2. Open a **plain** browser window on that profile at Google's normal sign-in page (`accounts.google.com/ServiceLogin?continue=<gemini home>`). Command line is only `--user-data-dir`, `--no-first-run`, `--no-default-browser-check`, URL. No debugging port, no automation. The user signs in and finishes 2-step verification.
3. On Windows the window title is read (`tasklist /v`) every 1.5 s. When it says "Gemini" (and not "Sign in/Verify/Choose an account") for 3 s, the window is closed gracefully (`taskkill` without `/F`, or SIGTERM) so Chrome writes the cookies. On other systems the user closes the window or clicks "I've signed in". A window that exits within 2.5 s means the profile was already open elsewhere: error message.
4. Verify: open the tool page in the background browser. It must show a signed-in account and the tool iframe. Nothing is generated. If Google does not accept the session in headless mode but does in a minimized window, the mode switches to `window` and the user is told why. A fresh sign-in tries `hidden` again.
5. Optional test image: one real generation with a fixed banana prompt.

## 4. The shared tool page (`shared/sharedToolPage`, `sharedToolConfig`)

Flow, in order:
1. `goto(toolUrl)` (a `share.gemini.google/...` link that redirects to `gemini.google.com/share/...`).
2. `sessionState`: account button `a[aria-label^="Google Account"]` present = signed in (presence, not visibility); a visible sign-in link and no account button = signed out. Signed out for more than 4 s throws `auth`. The email is read from the button's aria-label.
3. Gemini may show "This app was created by another person" with a **Continue** button (`mat-dialog-container button` whose text is "Continue"). It is clicked once per page load. No other notice is dismissed.
4. The tool runs in a sandboxed iframe (`scf.usercontent.goog`, a different site, so a separate process). `findToolFrame` returns the frame that contains `#addQueueAndGenBtn`.
5. `prepare`: `#parallelRange` (slider 1 to 8, filled with the wanted number) and `.ratio-btn[data-ratio="16:9|1:1|9:16"]`. Values already set in that frame are remembered and not set again.
6. `submit`: show the "All" filter and clear the search box, open `#tabPrompts`, fill `#rawPromptsInput` with one line `Prompt N: <text on one line>`, click `#addQueueAndGenBtn`, then wait up to 10 s until `#cntTotal` grows. The tool numbers prompts itself (count + 1). That tool number links a result card to our job.
7. `poll`: read every `#resultsGrid > div` card: the number from "Prompt N", status text (QUEUED, GENERATING, COMPLETED, FAILED), the error line (`div.truncate`), and whether an `img[src^="data:image/"]` exists.
8. `readImage`: take the card's `data:` URL, decode base64, sniff PNG/JPEG/WebP from the first bytes, reject anything under 100 bytes.
9. `clear`: the "Clear batch" button, only when nothing is queued or generating, and after 30 finished prompts, to protect the tab's memory.

Selectors, timings and error texts all live in `sharedToolConfig.defaultConfig()`. That is the part we move to `resources/image-engine/config.json`.

## 5. Error classification

The card error text maps to a kind: `API Error 429` rate_limit, `API Error 401/403` auth (if the page still shows the account as signed in it becomes `access`, meaning "this account cannot use the model"), `404` access, `400` bad_request, `5xx` server, "No image data returned" no_image, "Failed to fetch/NetworkError" network. Browser failures (closed, crashed, `net::ERR_*`, timeouts, navigation) map to session, network, timeout, no_image. `GenerationError` also defines `flagged` (Google blocked the account for unusual activity), `blocked` and `aborted`, but the reference page code never produces `flagged` or `blocked`. We add detection for Google's captcha, "unusual traffic" and "verify it's you" pages (see section 11).

## 6. Job queue and state machine (`queue/jobQueue`)

States: `queued -> generating -> completed`, `generating -> queued` (requeue), `generating -> failed`, `failed -> queued` (retry). One job per prompt; `number` never changes. `claimNext` is synchronous and gives every claim a new random **lease**. `complete`, `requeue` and `fail` only work for the lease that is current, so a late answer from a job that was retried, cleared or claimed again is thrown away. That is the guarantee that one prompt is never generated twice at the same time. `requeue` can count an attempt and give a delay; with `maxAttempts` reached it becomes `failed`. Duplicate numbers are skipped in `addPrompts`. Each completed job also has a download state `pending -> done` (or `error -> done`).

## 7. Scheduler (`queue/scheduler`, `shared/sharedToolScheduler`)

- A heartbeat every second plus a `tick` after every change. `_dispatch` loops round-robin over accounts (start index moves by one each round) and claims jobs while the app-wide concurrency limit and each account's capacity allow. `hasCapacity` is false when the account is disabled, signed out, flagged, unverified, in a phase (signing in/checking), cooling down or full.
- `_run`: acquire slot, call the generator with prompt, number, timeout and an AbortController, check the lease, save the image, `complete`. Always release the slot and tick again.
- Error policy: `rate_limit` cools the account down (the worker raises the wait 1, 2, 4 ... 30 minutes while limits repeat) and requeues without using an attempt; `auth` marks the account signed out and requeues; `session` cools 3 s and requeues; `network` cools down with backoff 5 s to 5 min and requeues; `aborted` requeues; `blocked` and `bad_request` fail the job at once (never retried); everything else (timeout, server, no_image) retries with delay `3 s * 2^(attempt-1)` up to 60 s until `maxAttempts` (default 3). `access` in hidden mode switches to a minimized window once before blaming the account.
- Messages for the user are produced from the state (offline, download folder missing, all accounts cooling, waiting for sign-in).

## 8. Worker (`shared/sharedToolWorker`)

One worker per account: one tab, one tool page, an exclusive lock around typing and submitting, a `tickets` map (tool number -> pending job), and **one poller** (every 1.5 s) that reads all cards. A completed card with an image settles its ticket; a failed card is classified; a card that disappears for 15 s (page reloaded, list cleared) settles as `session` so the job is requeued without using an attempt; a ticket past its deadline settles as `timeout`. If the frame is lost, all tickets fail with `session`. The tool keeps its list in memory only, so a reload loses prompts it was working on and the app submits them again.

## 9. Crash recovery and persistence (`recovery/recovery`, `persistence/jsonStore`)

- `JsonStore`: write to `.tmp`, fsync, keep the old file as `.bak`, rename over the target; load falls back to `.bak`; saves are debounced (300 to 400 ms), `flush()` on shutdown and before risky steps.
- `recoverJobs` at startup: a job left `generating` whose image file already exists becomes `completed` (not generated again); other `generating` jobs go back to `queued` without using an attempt; a `completed` job whose file is missing and was never downloaded goes back to `queued`; failed jobs can be requeued with a fresh budget (content refusals excepted); old retry delays are cleared.
- `cleanupOrphans` closes automation browsers left running and removes profile folders of accounts that no longer exist. Plain sign-in windows have no debug port and are never touched.
- Single instance lock so two copies never share data files or a profile.

## 10. Image saving and the auto-downloader (`storage/imageStore`, `downloads/autoDownloader`)

- Every image is converted to PNG, written to `<name>.part`, fsync'd, renamed. A file with its final name is always whole.
- The reference keeps finished images in a holding area and copies them to a download folder: never twice (a job marked `done` is never copied again), identical bytes already there are just marked done, a **different** file with that name is never overwritten (it becomes a download error), "downloaded" is persisted before the held copy is deleted, folder problems (missing, read-only, disk full) pause new generation and retry every 15 s, and an image lost before delivery is generated again.
- Auto Editor changes this: the target is the project's `media` folder and the name is the timecode name, so the holding area and the second copy step are not needed (see section 12).
- Aspect handling: `centerCropRect` crops to the wanted ratio when the picture is more than 2 % off.

## 11. Prompt parser (`shared/promptParser.js`)

Parses blocks `Prompt N: text` (multi-line allowed, optional quotes or bullets, separators `: . ) - – —`), keeps the user's numbers, warns about missing, empty and duplicate numbers. Auto Editor does not need it: scenes already are the prompt list. Our "prompt-to-job mapping" is one job per scene.

## 12. What we do differently in Auto Editor

| Topic | Reference | Auto Editor |
|---|---|---|
| Runtime | Electron main process + playwright-core | Rust (Tauri) engine, see `docs/IMAGE_ENGINE_DESIGN.md` |
| Job key | prompt number | scene id (`S01`) plus the timecode name |
| Output | `Prompt N.png` in a download folder | `S01_000.0-005.1.png` in the project `media` folder, then `scene.matchedFile` is set |
| Accounts | one account | any number, round-robin |
| Config | constants in JS | `resources/image-engine/config.json`, updated by the library package system |
| Consent | none | one-time dialog before the free engine is used |
| Google pages that need a human | `auth`/`access` messages | also captcha, "unusual traffic", terms pages: shown to the user, account paused, never worked around |
| API fallback | none | REMOVED: the Gemini image API and Cloudflare Workers AI fallback engines were removed — do not re-add them from this old row. Only Google-account web pages are used now (see `docs/IMAGE_ENGINE_DESIGN.md`). |

## 13. Hard rules we keep from the reference

Nothing that disguises automation, solves or bypasses captchas, rotates IPs or evades Google's checks. A sign-in prompt, terms page, captcha or "unusual activity" message goes to the user and that account is paused.
