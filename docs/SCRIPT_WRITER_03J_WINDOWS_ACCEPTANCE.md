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


## Exact disposable-channel Windows walkthrough

This walkthrough requires an actual interactive Windows computer. **Documentation is
not a test result. GUI result remains NOT RUN until an operator completes it.**

1. Back up existing app-data and confirm a clean, disposable Windows test profile.
   In the app's existing channel/profile selector, create a uniquely named testing
   channel, for example \`Phase03J-Disposable-A\`. Do not replace a real channel.
2. On this source branch, in a Windows PowerShell terminal with prerequisites
   installed, run \`npm ci\` and \`npm run tauri dev\`. If the app's Studio is
   hidden in the standard dev mode, use the existing admin/development entry
   point \`npm run dev:admin\`; do not enable Studio in a production release.
   Record exact launch command, commit SHA, WebView2 version and time.
3. In Script Studio select the disposable channel. Save a custom reviewer
   prompt including “check continuity and unresolved names.” Configure
   audience and voice tone and a custom rubric with categories whose **integer
   maximum weights total 100**. Save and reopen the channel configuration.
4. Create a single-part immutable Studio plan (about 120 words), open the
   Execution Workspace, prepare its offline writing prompt, paste a manually
   written complete script, validate, explicitly commit and assemble.
   Confirm no Claude/browser requests are sent.
5. Create a separate eight-part plan in the same test channel. Set outline and
   continuity as required. Before Part 1 save a chronological outline and
   Script Bible with a repeated character name (e.g. “Amir”). Prepare and
   complete Parts 1–8 manually. After each completed part save continuity
   notes before preparing the next. Revise the note after Part 1 once to check
   **latest-saved-note precedence**. Assemble the completed eight-part script.
6. In Review Workspace, choose this exact assembled execution and create an
   immutable review. Record the saved execution ID, plan ID, content digest,
   source execution revision, reviewer version and score-weight total. Expand
   **Immutable saved continuity context**. Verify outline, Bible, part structure,
   latest Part 1 note, and note source digests are displayed; no invented facts.
7. Copy the exact offline review prompt. Verify “Part 1 revised note” and all
   in-budget context are present. If a source is listed as omitted because the
   96 KiB budget was reached, confirm it is marked **NOT PROVIDED TO REVIEW**;
   do not claim full continuity context was reviewed.
8. For each review section, inspect its 0-based byte range and SHA-256.
   Import a **manual/synthetic** JSON report with one \`key\` and numeric
   \`points\` entry for each configured rubric category. Example schema:
   \`{"scores":[{"key":"hook","points":12}],"findings":[{"severity":"warning","category":"hook","summary":"Opening lacks tension","recommendation":"Use a stronger first sentence"}],"summary":"Sample manual review"}\`.
   Replace the example score list with **ALL actual saved rubric keys and valid
   values**; never use a one-category example unless the rubric has only one.
9. Import an invalid JSON report in a fresh section/session (e.g. \`{oops\`).
   Confirm no score is invented; read the exact immutable raw response. Enter
   corrected JSON in the separate correction editor; verify validation,
   persisted score and the **unchanged original raw bytes**.
10. If a script produces more than one review section, import reports one
    section at a time. Verify “partial coverage” until every section has a
    validated manual report, even if an earlier section earned 100 points.
    Verify there is **no averaged holistic score** for multiple sections.
11. Select specific improvement goals. Generate and copy offline improvement
    instructions. Paste a revised script with changed hook, a preserved
    character name, Urdu, Korean and emoji text; include leading spaces and
    CRLF. Save as a separate revision. Compare version 0 and version 1 and
    re-read the original; byte counts, digests and original content must
    remain unchanged.
12. Start a fresh review on the new revision. Verify that the prior score and
    approval controls cannot approve the unreviewed revision. Import new valid
    responses for **every** section; inspect findings and coverage.
13. Confirm approval is rejected without completed coverage, when a part-only
    session is selected, when deterministic validation warnings remain or
    when the confirmation text is wrong. With the fully reviewed valid final
    revision, tick explicit confirmation and type \`APPROVE FINAL SCRIPT\`.
    Check that Rust reports a persisted checkpoint and stores exact
    version/digest/round/time, not just a frontend notification.
14. Close the native desktop app completely and reopen it. In the same
    channel, reopen historical reviews and raw imports, compare revisions and
    verify the same exact approval digest persists. If any record is corrupt
    or orphaned, verify the app **blocks unsafe recovery** without deletion.
15. Create another disposable profile \`Phase03J-Disposable-B\`. Attempt to
    access A's review ID through normal UI, then (in an isolated dev-only
    command harness) with B's saved seed. Expect Rust channel mismatch or
    not-found; no A text must be returned. Do not tamper with real app-data.
16. Check that production features still open and perform non-destructive
    smoke tests: Write with Claude controls (without sending), account/profile
    selection, Image Generator UI, Voiceover UI, Video Editor project loading,
    FFmpeg version/help in the normal app, and Make Video controls (without
    generating). Confirm **no review/approval action** sends content to them.
17. Record per-step PASS/FAIL/NOT RUN with screenshots, Windows version,
    exact commit, command, paths and operator name. Remove only the two
    disposable test channels through supported UI after exporting evidence;
    never delete unrelated app-data by hand.

### Acceptance record (to be filled only after actually performing the GUI run)

| Field | Value |
|---|---|
| Native Windows/WebView2 session | **NOT RUN** |
| Machine / Windows / WebView2 | Not recorded |
| Feature-branch commit tested | Not recorded |
| Operator, time and screenshots | Not recorded |
| One-part + eight-part scenario | **NOT RUN** |
| Review corrections, re-review, approval | **NOT RUN** |
| Restart and channel isolation | **NOT RUN** |
| Production UI smoke checks | **NOT RUN** |

Do not reinterpret automated GitHub Actions or a source-level screenshot as a
passing interactive Windows acceptance result.


### Additional FFmpeg version acceptance note

The current Phase 03J stabilization CI validates its Windows media tests
against pinned, real **FFmpeg 7.1.1**. The 2026 Windows runner with
**FFmpeg 9.0.2** demonstrated an **unresolved production media option
incompatibility** (\`-filter_complex_script\` is rejected), resulting
in 8 Rust test failures. This test discovery was not dismissed as an
environment-only fault. The production renderer was intentionally left
unchanged by Phase 03J. On the installed Windows acceptance machine,
record the **actual shipped sidecar version**, separately from CI's
7.1.1 binary, and do not mark renderer compatibility with FFmpeg 9 as
validated.
