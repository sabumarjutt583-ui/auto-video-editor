# Phase 03J Windows Installed GUI Acceptance — MANUAL, NOT RUN

**Status: NOT RUN.** This is a test procedure, not evidence of a successful
Windows installation or GUI acceptance. Phase 03I PR #12 remains unmerged.

## Preconditions

- Use a Windows Tauri 2/WebView2 build with the Phase 03J feature branch.
- Retain a backup of real app-data. Prefer disposable test channel profiles.
- Use a completed **one-part** script and a completed **eight-part** script with
  a saved immutable plan; do not write to production projects.
- Use manual reviewer output only; do not sign into or call an AI provider.

## Required manual checklist

- [ ] Open Script Writer Studio in DEV. Confirm Review Workspace is absent in
      production/release UI and present only when development-only Studio is shown.
- [ ] Choose an eight-part completed execution and its assembled final script.
      Confirm exact review channel, plan, execution and source digest.
- [ ] Confirm reviewer provider/account preference, immutable review prompt
      version and exactly 100 rubric points. Change Studio settings after
      creation; verify the open review keeps the original snapshot.
- [ ] Preview exact review section prompts. Large scripts display explicit
      section count and **partial coverage**, never silently truncated or
      described as fully reviewed.
- [ ] Import a real (or explicitly labeled synthetic) manual JSON report
      including all rubric categories. Verify score arithmetic and findings.
- [ ] Import invalid JSON/invalid score/severity into a separate session;
      verify original bytes remain accessible and score stays unset. Add an
      explicit corrected structured report and confirm raw remains unchanged.
- [ ] Set improvement goals, copy offline improvement prompt, paste revised
      UTF-8 script with Urdu, Korean, emoji, spaces and CRLF. Confirm original
      bytes and digest are unchanged.
- [ ] Compare revisions, verify no new draft was automatically approved;
      create a new review bound to the improved digest and manually import a
      new valid report for every section.
- [ ] Confirm approval is disabled for partial review, missing re-review,
      part-only session, validation warnings or missing explicit confirmation.
- [ ] Enter APPROVE FINAL SCRIPT and confirm the active exact version only.
      Confirm previous approvals remain visible as history when revising.
- [ ] Restart WebView2 app. Verify imported raw, corrected reports, prompts,
      revision compare, immutable versions and approval history persist.
- [ ] Switch to a second saved channel and try to open first channel's review
      by ID. Verify Rust rejects cross-channel access, including read/apply.
- [ ] Verify one-part script review, score, improvement and approval.
- [ ] Verify nothing was forwarded to Claude, ChatGPT, voiceover, Image
      Generator, video rendering, Make Video or account rotation.
- [ ] Stress-test a 40-part execution and continuation recovery; test a
      deliberately orphaned object in an isolated disposable test directory.
- [ ] Check Windows package startup, WebView2 lifecycle, UTF-8/CRLF copy,
      filesystem permissions and crash/restart persistence on installed build.

## Automated testing versus manual testing

GitHub Actions runs TS typecheck/tests/build on Linux and Windows, focused
Rust regression suites on Linux and Windows, and a real FFmpeg-dependent
unfiltered Rust suite on Linux when the workflow is enabled. These checks
do NOT constitute installed Windows WebView2 GUI validation.

Record the actual Windows build/version, machine, operator, timestamps,
pass/fail evidence and bug reports only after performing this checklist.
