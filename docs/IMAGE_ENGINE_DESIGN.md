# Image engine design

How the Image Generator page makes pictures. Study of the reference tool: `docs/IMAGE_ENGINE_NOTES.md`.

## Engines

- **Free**: the shared Gemini image tool, opened in the person's own Chrome/Edge/Brave/Chromium with their own Google account (one browser profile per account). The app types one prompt per request and reads the finished `data:image` out of the page.
- The API engines (Gemini image key, Cloudflare FLUX) and the fallback were removed: Google accounts are the only engine.
- **Only images mode**: jobs can also live in any folder (`imagegen_start_folder`, ids `I001`, files `Image 001.png`, saved to `<folder>/media`), without a project.

## Browser control: the path chosen

`chromiumoxide` was tried first. It cannot drive the tool: the tool runs in a cross-site sandboxed iframe (`scf.usercontent.goog`), which Chrome puts in its own process, and chromiumoxide 0.7 only sees the main frame (`page.frames()` returned 1 frame in a spike). A Node sidecar with playwright would work but adds about 90 MB to every installer.

So the app has its **own small DevTools-protocol client in Rust** (`src-tauri/src/imagegen/browser/`): a hand-written WebSocket (`ws.rs`, on the tokio `net` feature that was already a dependency), flattened sessions (`cdp.rs`), cross-site frames found as `iframe` targets (`Target.getTargets` + `attachToTarget flatten:true`) with `Page.createIsolatedWorld` for same-process frames (`locator.rs`). No new crates.

Everything is tested against a local fake Gemini page + fake tool page in a real Chromium (`browser_tests.rs`, `engine_tests.rs`). It could not be tested against real Gemini from the build sandbox: use **Test free engine** (Admin) or **Test image** (account row) once.

## Honesty rules

No user-agent or `navigator.webdriver` masking. The sign-in window is a plain browser without a debug port. Captcha, "unusual activity", terms or verify pages become an error that pauses the account and shows the text to the person. Nothing tries to get around them.

## Queue and scheduler (`src-tauri/src/imagegen/`)

- `queue.rs`: jobs per project in `<project>/imagegen/jobs.json` (fsync, `.bak`). `queued -> generating -> completed | failed`. Every claim has a lease; answers for an old lease are thrown away. A completed scene is never queued again unless `regenerate` is set.
- `recovery.rs`: at start a `generating` job whose file exists becomes `completed`; the others return to `queued` without using an attempt.
- `engine.rs` + `accounts.rs`: round-robin over accounts; global parallel 1 to 8 (also the per-account limit); a 429 pauses only that account (1, 2, 4, 8, 16, 30 minutes); other errors back off 5 s to 5 min; timeout/no-image/server retry after `3 s * 2^(n-1)` (max 60 s) until `maxAttempts`; blocked and bad requests fail at once.
- `save.rs`: PNG, `.part` file, fsync, rename. Name = `S01_000.0-005.1.png` in the project `media` folder. A different file with that name is never overwritten (the new picture becomes `name (2).png`); the same bytes are not saved twice. Wrong aspect (more than 2 % off) is cropped.
- The frontend owns `project.json`: Rust saves the picture and emits `imagegen-image`; `src/lib/imagegen/register.ts` adds it to `editor.media`, `mediaMap` and `scene.matchedFile`, so the Auto Editor timeline fills. On opening the page, finished pictures missing from the project are registered again.

## Config

`resources/image-engine/config.json` (version `major.minor`): tool address, selectors, timings, error texts, human-check patterns. It is a library package kind (`image_engine`), so it can be updated without a new app version. The Admin build edits and tests it (Engine config card). A new major version asks for the one-time notice again.
