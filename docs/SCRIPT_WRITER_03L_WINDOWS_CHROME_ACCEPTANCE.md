# Script Writer Phase 03L — Visible Chrome Operator: architecture and Windows acceptance

## Scope and non-claims

This is a **development-only** user-assisted workflow. No Anthropic/OpenAI API requests,
consumer-site message injection, automated response extraction, hidden account rotation,
credential access, cookie copying, CAPTCHA bypass, or automatic handoff to media tools.
Chrome's process status does **not** prove the browser window rendered, that sign-in is
current, or that Claude or ChatGPT returned any answer. External submission and copying
responses back into the application remain manual.

### Existing browser architecture audit (Phase 03K baseline)

* \`imagegen/browser/locator.rs\`: supports explicit Settings browser executable, then
  installed Chrome, Edge, Brave, Chromium; Chrome is first in automatic discovery.
  It does not use the app's WebView2 for Claude/ChatGPT login.
* \`commands/script.rs\`: \`ScriptAccounts\` account 1 preserves legacy
  \`app_data/claude/profile\`; other accounts use
  \`app_data/claude/profiles/<account-id>/profile\`; account metadata persists as IDs/names.
  \`script_open_live\` calls \`ScriptChat::show_conversation\` and is intentionally unchanged.
  \`script_account_sign_in\` uses user-managed PlainWindow and a later account check.
* \`commands/chatgpt.rs\`: independent \`app_data/chatgpt/profiles/<id>/profile\`;
  \`chatgpt_open_live\` opens a PlainWindow and drops its handle immediately.
  Existing sign-in and production style workflows are unchanged.
* \`imagegen/browser/signin.rs\`: plain visible Chromium command with separate
  \`--user-data-dir\`, no headless/CDP flags. \`PlainWindow::state\` can distinguish a running
  spawned process from immediate exit, but **cannot prove a rendered window or focus it**.
  A Chrome singleton profile handoff may exit the new process immediately.
* \`imagegen/browser/session.rs\`: existing CDP-based production background browser.
  It is **not** reused for reading or automating consumer sites in this phase.
* Phase 03K Rust Supervisor owns per-channel immutable task/account snapshots,
  revision/operation idempotency, integrity checks, source execution and review evidence.
  It did not own visible window process handles or reliably know window close status.
* \`AiWorkflowControlCenter\`: already handled plan selection, exact stored part prompts,
  manual fragments, multi-part continuity, assembly, review versions and explicit approval.
  Browser status was previously just account metadata and an optimistic void launch command.

### Phase 03L implementation

* \`commands/script_chrome.rs\` uses an app-owned transient \`ChromeWorkspace\` process
  registry keyed by (provider, account ID). A repeated open on a tracked running process
  reuses status and does not spawn a duplicate. An untracked process after restart cannot
  be assumed closed; a second Chrome attempt may hand off to an already open profile.
* Rust loads the *actual saved channel identity*, verifies the task from the Phase 03K
  Supervisor store, checks \`visible_browser\`, exact provider/account binding and
  registered account existence **before launch**. The source plan/supervisor snapshot
  remains authoritative; the UI cannot substitute account IDs.
* Opens through the existing \`PlainWindow::open\` with the provider's existing
  configured HTTPS site and unchanged account profile. The URL origin is allowlisted.
  Browser availability comes from the existing locator; no second browser engine.
* Status returns display name, account ID, provider-specific logical profile identity,
  last account-manager reported connection, sign-in flag, errors and observable
  running/closed/immediate-exit process condition. No full path, cookie or token is returned.
* No destructive close or profile disconnect is exposed. Window focus and safe app
  close are explicitly unsupported; user closes or raises the window manually.
* Dashboard now gives a ten-step overview, selected channel/plan configuration,
  selected accounts and skills with local verification disclaimers, Chrome status cards,
  manual sign-in, explicit clipboard paste, raw pre-commit preview, Unicode/CRLF byte
  and word counts, local duplicate fragment guard, part continuity/recovery,
  reviewer section scores/findings, improvement prompt and explicit approval.
* Writing and reviewing still use Phase 03I/03J source-owned stores and Phase 03K
  Supervisor to verify durable checkpoints. There is **no separate script state store**.
* Local mock remains available for deterministic automated acceptance, **not** a live
  Claude/ChatGPT interaction.

## Reproducible native Windows 11 operator execution

Use a local Windows 10/11 machine with a supported Chrome installation, WebView2,
Node 22, Rust stable/MSVC build tools and a working existing account setup. Run in
**PowerShell from the existing repository clone**, with no destructive profile reset.
This is the development-only dashboard; do not use a release build to test it.

```powershell
git fetch origin feature/script-writer-visible-chrome-studio-v1
git switch feature/script-writer-visible-chrome-studio-v1
git pull --ff-only origin feature/script-writer-visible-chrome-studio-v1
git rev-parse HEAD
npm ci
npm run tauri -- dev
```

The `pretauri` script may fetch the app's supported FFmpeg binary if missing.
Do not install arbitrary FFmpeg 9 replacements for compatibility testing.

In the running app, open **Channels → Script Studio**, select the existing saved
channel, expand the development-only Studio panel and create or resume a saved
execution with **Visible browser — user action**. Record the commit, Chrome
version, exact account IDs, observed process status, human-visible window outcome,
manual sign-in outcome and local draft/review checkpoint evidence. Never include
cookies, passwords, session tokens, profile filesystem contents or private chats
in screenshots or logs. Choose your own test accounts; the CorpCipher/Mr. Creepwake
ID pairings below are illustrative, not an assertion about saved user accounts.

The control labelled **Open** may return a `process_running_window_not_verified`
or `ended_at_once` status. Visually inspect Chrome yourself. A reused tracked
process does not imply a newly focused window. On app restart, the open session
may be reported as `not_observed_after_app_restart`, even if Chrome remained
open. Always use **Refresh process status** before repeating a launch.

## Required native installed Windows tests — NOT RUN in CI

These tests must be performed on the user's Windows computer with actual Chrome
installed. GitHub Actions Rust/TypeScript jobs (even windows-latest) are not a desktop
Chrome GUI acceptance test. Test in **debug build**; release keeps this panel disabled.

1. Run the Tauri development app and open Script Studio, selecting a real saved CorpCipher
   channel, saved plan, and supervised \`visible_browser\` task.
2. Verify installed Chrome path and account profile identity; verify a missing browser
   produces a non-destructive diagnostic and a corrected Settings selection works.
3. Open writer Claude Account 1. Verify the correct visible page and profile manually.
   Record outcome separately from the process status; sign in by hand if required.
4. Open Claude Account 2 on a different channel/task. Check that sessions/cookies and
   profile directories stay independent. Open a saved ChatGPT reviewer profile separately.
5. Test repeated open on tracked running process; verify no duplicate process is created.
   Close Chrome manually, refresh status and observe closed state. Then reopen.
6. Leave Chrome open while restarting Tauri. Confirm \`not_observed_after_app_restart\`
   is shown and no false open/login claim is made; profile handoff should be explained.
7. Test existing account sign-in flow; distinguish reported connected from current
   provider authorization. Repeat for expired sign-in.
8. Prepare and copy a real saved part prompt; submit manually in Claude.
   Confirm copying alone never marks submission or produces fabricated text.
9. User-triggered clipboard paste a Unicode, emoji, CRLF/whitespace response.
   Inspect original raw preview, import immutable fragment and check digest;
   attempt duplicate import and verify local guard.
10. Complete a Single Script. Then complete an eight-part task (using valid responses
    or clearly labeled local mock test fixtures), restart after Part 4, recover 1–4,
    continue through Part 8 and assemble exact saved version.
11. Open reviewer ChatGPT/Claude account, copy exact rubric/section prompt, submit by hand,
    paste review report, resolve invalid JSON, review all sections, save improved revision,
    re-review and explicitly approve exact final digest.
12. Test wrong account/channel IDs, missing account, paused/cancelled task and browser
    startup errors. Confirm source histories remain unchanged.
13. Regression-check Production Write with Claude, account rotation, ChatGPT custom
    styles, images, voice, FFmpeg and Make Video. **Do not connect script to media**.

### Evidence log for native operator

For each test record: Windows/Chrome version, profile IDs (never secrets), app commit,
steps, visible GUI screenshots or operator notes, expected/observed window results,
whether interactive login was tested, manual exchange results and error/recovery outcome.

## CI and limits

Run \`npm ci\`, \`npx tsc -b\`, \`npm run test:ts\`, \`npm run build\`,
focused Rust job/studio/execution/review/supervisor/**script_chrome** tests,
\`cargo build --locked\`, \`cargo check --locked --features admin\`,
and full \`cargo test --locked\` on both Linux and Windows.
Windows CI retains the pinned FFmpeg **7.1.1** baseline. FFmpeg 9 compatibility
is out of scope; tests intentionally ignored at baseline are not counted as passed.
Production main and earlier stacked PRs stay untouched. No API work was performed.
