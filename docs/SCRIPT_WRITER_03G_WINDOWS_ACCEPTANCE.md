# Script Writer Phase 03G — Windows desktop acceptance (NOT RUN)

This is a **manual acceptance protocol**, not evidence of a completed Windows GUI test. GitHub Actions compiles the frontend/Rust backend on Windows but does not exercise the installed WebView2 application. Use only **disposable** channel data and script text. Never alter or delete actual application data, or inject damaged records into an existing user's real Script Writer store.

## Prerequisites

- Windows 10/11 with WebView2 runtime
- Node.js 22 and npm (run `node --version`)
- Rust stable toolchain and MSVC C++ build tools for Tauri 2 (`rustc --version`)
- Repository checkout; no Claude account, API key, Chrome login or real AI request
- The repository's normal Tauri development prerequisites (see README and TESTING.md)

## Launch

```powershell
git fetch origin
git switch feature/script-writer-recovery-v1
git pull --ff-only
npm ci
npx tsc -b
npm run test:ts
npm run build
npm run tauri dev
```

The development-only controls are under Dashboard → Step 0 → Manual Script Job. If the application does not compile, capture terminal output and `rustc --version`, `node --version`; do not guess that GUI acceptance has passed.

## Acceptance cases (record PASS/FAIL with screenshots or sanitized diagnostics)

1. Launch the actual Tauri/WebView2 window. Confirm the Step 0 channel chooser and existing production controls still render; **do not click Write with Claude or initiate video generation**.
2. Choose a disposable channel with a local master prompt. Enter a test title/topic and create a **local** durable job.
3. Inspect the saved prompt (no provider request). Paste a locally authored sample script and import the original response.
4. Read back exact saved bytes, including emoji, Urdu/Korean, leading/trailing newlines. Check the SHA-256 metadata.
5. Run deterministic validation, inspect actual word count and warnings; manually enter review.
6. Explicitly approve Revision 1. Confirm its user-confirmed approval timestamp and digest appear.
7. Create Revision 2 containing changed text. Read Revision 1 again and confirm it was not overwritten.
8. Compare the two versions. Inspect added, removed and unchanged lines and per-version word counts.
9. Confirm Revision 2 is **not** approved. Verify Revision 1 approval is present under **historical**, not active.
10. Run fresh validation/review of Revision 2 and approve only if desired. Confirm no video/voice/image production starts.
11. Close the Tauri window fully, restart with `npm run tauri dev`, and reopen the saved channel/job. Read both versions and check historical approvals remain unchanged.
12. Click **Inspect this job for recovery issues**. A healthy job should show no blocking issues. The diagnostic call must not change job status or revision counters.
13. Test the corrupted/orphan case **only through the isolated Rust test suite** below; never manually create fake orphans or corrupt existing user job files:
    ```powershell
    cd src-tauri
    cargo test --locked script_jobs::state_tests::sw_03g_03_published_orphan -- --nocapture
    cargo test --locked script_jobs::state_tests::sw_03g_06_incomplete_temporary -- --nocapture
    cargo test --locked script_jobs::state_tests::sw_03g_10_corrupted_approval -- --nocapture
    ```
    These tests generate disposable temporary roots, preserve evidence while running, and clean up only their own temporary test roots afterward. They are **not** a GUI test of the orphan panel.
14. Confirm production Vite builds do not show the development-only panel. `npm run build` by itself does not launch the installed production GUI. Do not imply a real release test.
15. Save screenshots (redact script text/channel prompts and any sensitive directory paths), console/terminal errors, checkboxes for each result, OS version, WebView2 version and git SHA. No credentials or private scripts in bug reports.

## Expected safety behavior

- Read-only diagnostics may display an unverified orphan after explicit acknowledgment, with bounded byte length and SHA-256. **No reattachment or approval button exists.**
- Corrupted/missing content, symlink paths, ambiguous identities and uncommitted state checkpoints **block mutations** and preserve original evidence.
- Phase 03F orphan filenames cannot prove their originating request/operation or approval. No user-confirmation override authorizes attaching them to the job.
- Only the user's local context can confirm visual behavior. Native CI test success does not establish clipboard, focus, WebView2 or production-installer correctness.
- Limits remain 64 revisions, 256 durable operations, 2 MiB per response and 128 KiB / 400 lines per comparison input.
