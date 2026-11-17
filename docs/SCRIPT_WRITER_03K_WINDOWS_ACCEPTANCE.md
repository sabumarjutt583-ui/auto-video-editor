# Phase 03K — Windows Installed WebView2 & Visible Browser Acceptance

**Actual interactive GUI status: NOT RUN** until tested on a genuine Windows desktop.
Do not conflate successful CI/build/mock tests with real native WebView2 acceptance.

Preconditions: a disposable Windows user profile; backed-up existing app-data; a
development build of the \`feature/script-writer-provider-supervisor-v1\` branch;
working browser installation; two disposable saved channels A and B; signed-out
disposable browser profiles if sign-in needs examination. Record SHA, browser
versions and FFmpeg sidecar version before testing. No login secrets in evidence.

- [ ] Launch the development-only Script Writer Studio. Confirm the AI Workflow
  Control Center appears only in development and is absent in a production build.
- [ ] Select disposable Channel A; verify its exact channel ID, stored Claude
  writer ID and ChatGPT reviewer ID, named Skill, user-reported installation
  status, prompt version and custom saved 100-point rubric.
- [ ] Reuse an existing user-owned account profile; use *Open selected Claude
  window* and confirm the real installed Chrome/Edge/Chromium browser is
  visibly launched. Observe startup errors and connection readiness; opening
  a window must not be shown as a completed AI generation.
- [ ] Use *User-managed sign-in* where appropriate. Perform all CAPTCHA/2FA
  steps yourself. Close the window manually; reopen without clearing the
  profile. Record whether the authenticated session actually survived restart.
- [ ] Switch to the explicitly saved reviewer account. Check ChatGPT opens
  its own browser profile without switching the Claude writer silently.
  Missing/expired account must produce an actionable error.
- [ ] Manually create a one-part execution in the existing Execution Workspace.
  Create a supervisor task using Visible Browser Handoff and copy its exact
  saved prompt. Verify the user must submit manually and paste the actual text
  to the existing immutable execution store before it can be committed.
- [ ] Create eight-part plan: save outline, Script Bible, part objectives and
  user-authored continuity notes. Verify exact part preparation, complete
  fragments, candidate validation, acceptance of warnings, part commits and
  final assembled digest. Restart after Part 4; verify Part 5 resumes with no
  duplicate commit or re-generated profile.
- [ ] Confirm simulated \`local_mock\` output is clearly labeled synthetic.
  Exercise partial, error, connection-lost, too-large and submission-uncertain
  scenarios, then explicit manual import. No network request should occur.
- [ ] Create a real offline review from the immutable assembled script.
  Verify review account, section prompt, byte coverage and rubric. Import
  invalid raw response; enter explicit corrected JSON and ensure raw persists.
- [ ] Save improvement goals and an improved script version; re-review all
  sections; verify earlier approvals never silently transfer to new versions.
- [ ] Reject premature approval; then explicitly type \`APPROVE FINAL SCRIPT\`.
  Verify Rust checkpoint/digest and restart persistence.
- [ ] Test Pause, Resume, Cancel and Inspect. Cancellation must leave all
  source scripts, reviews, profile directories and project data intact.
- [ ] Select Channel B and try to reopen Channel A task/review by ID via the
  development Tauri boundary. Ensure Rust denies cross-channel access.
- [ ] Run non-destructive smoke tests for Write with Claude, Script Settings,
  Image Generator, voiceover, video editor, Make Video and account managers.
  Do not initiate actual provider sends or production media runs for this step.
- [ ] Confirm no review/control-center operation automatically hands content
  to video generation, changes browser rotation or performs silent account
  switching.
- [ ] Capture each step's PASS/FAIL/NOT RUN with screen recordings, exact
  commit, installed FFmpeg version and local timestamps.

CI executable Windows FFmpeg is pinned to **7.1.1**; FFmpeg 9 production
compatibility is an **open** separate issue. No FFmpeg renderer modification
is within Phase 03K.

| Acceptance area | Actual result |
|---|---|
| Installed WebView2 startup and visible browser | **NOT RUN** |
| Account profile login persistence | **NOT RUN** |
| Single/eight-part execution and restart | **NOT RUN** |
| Review and approval | **NOT RUN** |
| Cross-channel and existing production smoke tests | **NOT RUN** |
