# Script Writer Phase 03H — Windows desktop acceptance (NOT RUN)

**Scope:** offline per-channel Script Studio configuration, user-registered Skills, account metadata, custom reviewer prompts/rubric, deterministic single/multi-part plans and configuration backup. This is a checklist, **not a passed WebView2 GUI test**. Do not sign in or send any Claude/ChatGPT requests in this phase.

## Requirements and launch

- Windows 10/11, WebView2 runtime, Node.js 22, Rust stable MSVC toolchain and Tauri 2 build prerequisites. Install the existing repo requirements in TESTING.md; do not use the compile-only CI FFmpeg placeholder as a working binary.
- Work exclusively in a disposable channel/profile with sample prompts and topics. **Do not corrupt or manually edit real user job/config records.**
- PowerShell:

    git fetch origin
    git switch feature/script-writer-channel-studio-v1
    git pull --ff-only
    npm ci
    npx tsc -b
    npm run test:ts
    npm run build
    npm run tauri dev

- In the running **development** application open **Dashboard → Step 0 — Script Writing → Script Writer Studio — Development Only · Offline**. Expand the panel.

## Functional acceptance workflow (record PASS/FAIL for each)

1. Create a disposable Channel A using the existing Channels screen; save the channel profile. Confirm the Studio channel dropdown displays its exact existing ID and name.
2. Open Channel A. A saved legacy `script.masterPrompt` appears as an exact, read-only initial Studio version. Opening the panel must not rewrite the legacy channel profile.
3. Add a **new** exact Master Prompt containing Unicode/newlines/quotes. Set structured preferred part count if desired. Save Studio configuration and note revision and SHA-256.
4. Change Master Prompt text, save again, then select the prior version. Confirm old content and digest are unchanged and that selection creates a new configuration checkpoint.
5. In Settings add or locate Claude Account 1 and ChatGPT Account 2. Return to Studio; choose the Claude writer and ChatGPT reviewer independently. If an account has been deleted, ensure saving reports a missing-account error rather than silently choosing another.
6. Register a local Skill for Channel A: exact name, display name, Claude Account 1, description and optional preferred part count. First status must be **Registered locally**. Selecting **User reports installed** is an explicit local attestation, not verified provider installation. No Skill upload or activation occurs.
7. Select writing modes: Master Prompt, Skill-only, and Master Prompt + Skill. A Skill-only Studio plan may be prepared without a master prompt, but this must NOT bypass old durable-job requirements or activate production writing.
8. Configure a custom reviewer prompt for Channel A, save and select a version, then edit and save another reviewer prompt. Earlier reviewer content must be readable.
9. Edit a niche-specific rubric, first set total to 101 and confirm a clear save error. Then set weights to exactly 100 and save. Configure separate per-part and full-script review instructions.
10. Select Multi-Part mode and explicitly override to **12,000 words / 8 parts**. Preview. Verify exactly eight ordered targets of 1,500 words. Set 12,003 to verify deterministic remainder allocation (first three targets 1,501, last five 1,500).
11. Add a part title/objective, preview, confirm they are included. Test all explicit per-part word overrides and verify Rust rejects a non-12,000 sum.
12. Inspect writing and review previews: selected channel ID/name, prompt version/digest, Skill name/account reference, reviewer account/prompt and rubric, title/topic JSON data, mode, part list and warnings. No provider request or script generation occurs.
13. Save immutable plan; close the app fully and restart. Reopen Channel A, select the previously saved plan, confirm its exact snapshot (prompt/reviewer digest, Skill ID, account refs, titles, part targets, rubric and config revision) remains unchanged after editing the current Studio settings.
14. Export Channel A configuration to JSON. Protect it (contains private prompt text, but must NOT contain cookies, password, API keys or session tokens).
15. Create disposable Channel B with its own ID (same display name is fine). Verify it starts with independent Studio data; assigning Claude Account 1 and ChatGPT Account 2 must not copy Channel A's prompts, Skills, plans or review history.
16. Import the exported configuration into B **only after explicit ownership/account rebinding**, and only if B has no saved Studio configuration. Confirm versions now belong to B; Skill installation confirmations are reset to **Registered locally**; a second import cannot overwrite B's existing config.
17. Rename Channel A in the existing Channel Settings and verify that its stable ID, historical plans and script jobs do not change. Save Studio settings to update the snapshot display name when appropriate.
18. Use the existing development-only Manual Script Job/Revision panel to reopen an old Phase 03G job. Verify immutable revisions, approval history and recovery diagnostics continue to behave as before.
19. Verify existing production Write with Claude and Make Video buttons still render and behave as before **without actually pressing them or submitting provider requests**.
20. Run `npm run build`. Confirm Studio UI is behind `import.meta.env.DEV`; this alone does **not** prove installed production GUI behavior. A separate signed Windows installer acceptance is required.

## Recovery and concurrency (isolated Rust tests only)

From the project root:

    cd src-tauri
    cargo test --locked script_studio
    cargo test --locked script_jobs

These tests create their own temporary roots. They simulate stale revisions, conflicting operation IDs, future schema records, corrupt records, interrupted temporary files and OS writer contention. Do not manually corrupt application data under AppData.

**Do not mark GUI checks PASS unless a Windows Tauri/WebView2 window was actually launched and interacted with.** Save redacted screenshots and terminal logs including Git SHA, Windows/WebView2 versions and each failed step, but never include private prompts or account credentials.

## Design constraints and future gates

- Configuration history is capped at 256 append-only checkpoints; master/reviewer versions at 64 each, Skills at 64, plans at 256 per channel, and planned script parts at 40.
- Each planned part is at least 50 requested words; total target is 50–200,000 words. Legacy production script-writing remains limited by its separate contract and is not switched to this Studio.
- Local Skill registration, account policies and prompts are reference metadata. They do not verify remote installation, execute automation or guarantee AI output.
- Physical power-loss guarantees, installed Windows GUI acceptance and unfiltered Rust test coverage must be reported separately from CI compilation.
