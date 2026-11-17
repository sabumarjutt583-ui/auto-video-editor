# Phase 03K — Visible Browser & Durable Script Supervisor

Status: **development-only implementation; full mock acceptance required before Phase 03K can be called complete.** This module is layered on immutable Phase 03H plans, Phase 03I executions and Phase 03J reviews; no old schema is migrated or rewritten.

## Audit/reuse decision

- **Existing Claude browser**: \`commands/script.rs\` manages named account IDs, persistent per-account \`ScriptChat\` profiles, user-controlled sign-in/check, and \`script_open_live\` view-only browser windows. Its legacy production \`script_ask\` supports list-order rotation; Phase 03K intentionally does **not** invoke it.
- **Existing ChatGPT browser**: \`commands/chatgpt.rs\` manages independent profile directories, user sign-in and the view-only \`chatgpt_open_live\` window. No programmatic message submission or extraction is used.
- **CDP/browser**: \`imagegen/browser/locator.rs\` detects user-installed browsers (Chrome, Edge, Brave, Chromium); session and sign-in implementation remain unchanged. No new CDP injection, fingerprints or anti-verification techniques are added.
- **Accounts**: the Studio saved channel ID, not account email, owns immutable plan and job data. The supervisor snapshots plan-selected writer account, reviewer account and Skill references. No credential, cookie or browser profile data enters task JSON.
- **Skills**: names and installation status are local user-reported metadata. The supervisor refuses a Skill bound to a different Claude account. It never uploads or remotely activates Skills.
- **Existing execution/review**: the user-facing control center calls typed Phase 03I and 03J commands. After each operation, the supervisor separately fetches the saved Rust record and checks plan, channel, execution, revision and review ownership before recording progress.

## Provider boundaries

\`visible_browser\`: opens existing account-specific visible browser, strictly user-controlled sign-in/manual prompt exchange. A browser window opening is **not** successful login or generated output. Closing the window is user-controlled; disconnect is never used to close it, because disconnect can destroy profile data.

\`local_mock\`: deterministic offline responses and error variants. Test text must still be imported through the existing Rust execution/review checkpoints, and only verified evidence advances supervisor status. Delay/uncertainty is represented as explicit states, never a blind timer or network retry.

\`authorized_api\`: reserved typed capability. **Not implemented; fails closed.** No consumer-site automation, CAPTCHA solving or scraping.

## Immutable task, revisions and error recovery

The \`script_supervisor\` Rust store uses a single-writer cross-process lease, immutable per-revision \`state-000000.json\` checkpoints, SHA-256 previous-checkpoint chain, stable operation ID idempotency and expected revision CAS. The channel-specific \`su_...\` task snapshot retains the *entire validated immutable plan* and its digest, selected transport and provider/Skill metadata, exact source execution ID and progression evidence. Unexpected, malformed, symlink or orphan files block recovery without deleting any user data.

Modes: Created, Prompt Prepared, Browser Opening, Awaiting User Action, Awaiting Login, Submission Uncertain, Awaiting Response, Response Imported, Part Committed, Review Pending, Awaiting Approval, Completed, Paused and Cancelled, with additional reserved stage names. The supervisor **never** treats window readiness as provider response. Uncertain delivery requires human inspection, never automatic resubmission.

Phase 03K does not modify Rust approval logic. Approval remains explicit \`APPROVE FINAL SCRIPT\` in Phase 03J and the supervisor can only reflect a review that the Rust ReviewStore has validated on reopen.

## Unsupported/remaining

- No approved Claude/ChatGPT API adapter is configured. Automatic consumer-site submission or response extraction is unsupported; local mock is not real-provider evidence.
- App-managed closing of a live browser is not exposed by the legacy view-only interface. Users close the window manually; do not call disconnect as a substitute.
- Account session connected state is browser/service dependent; an opened window is not proof of provider authentication or Skill activation.
- FFmpeg production renderer unchanged. Windows CI still pins executable FFmpeg **7.1.1**. The FFmpeg **9** \`-filter_complex_script\` incompatibility remains unresolved.
- Actual installed Windows Tauri/WebView2 GUI acceptance: **NOT RUN**. GitHub Actions cannot substitute for GUI acceptance.

## Developer verification

\`cargo test --locked script_supervisor\` plus existing jobs/studio/execution/review Rust suites, both OS Rust builds, \`cargo check --locked --features admin\`, and full media-enabled Rust suites. TypeScript \`npm ci\`, \`npx tsc -b\`, \`npm run test:ts\`, \`npm run build\` run in Linux and Windows GitHub Actions. Local mock eight-part acceptance includes restart after Part 4, genuine immutable Phase 03I continuation and assembly, saved continuity context, Phase 03J corrected scores/revision/re-review, explicit approval, and channel isolation. A mock test pass must never be called live provider automation.
