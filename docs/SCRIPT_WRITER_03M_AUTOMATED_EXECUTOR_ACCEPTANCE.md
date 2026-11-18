# Script Writer Phase 03M — Automatic Execution Audit and Acceptance

## Status and scope

Development only. Stacked draft PR targets \`feature/script-writer-visible-chrome-studio-v1\`.
All automatically dispatched text in this phase comes from a **deterministic local MOCK adapter**.
No live Claude.ai or ChatGPT consumer-site prompt submission, output extraction, sign-in
automation or paid API has been enabled. The Phase 03L visible-browser manual fallback
remains separate and unchanged.

**Three modes are conceptually separated**:
- LOCAL FIXTURE: automatic dispatch, continuation, saved parts, review, revision,
  fresh re-review, immutable evidence, human final approval; every generated response is MOCK.
- AUTHORIZED BROWSER: blocked before creating a job: required provider authorization is
  absent. A local consent checkbox, authenticated Chrome profile or CDP session does NOT
  establish permission.
- PHASE 03L MANUAL: user-managed browser prompt/response handoff, not automatic.

Consumer terms to re-check before any future adapter work:
- Anthropic Consumer Terms: https://www.anthropic.com/legal/consumer-terms
- OpenAI consumer Terms: https://openai.com/policies/terms-of-use/

## Legacy Chrome/CDP code audit (no new browser engine)

| Existing source | Verified behavior | Reuse / restriction |
| --- | --- | --- |
| \`imagegen/browser/locator.rs\` | Selects configured Chromium executable, or discovers Chrome/Edge/Brave/Chromium | Phase 03L only; no Phase 03M consumer dispatch |
| \`imagegen/browser/session.rs::Session::open\` | Reuses a running DevToolsActivePort session or launches one; on profile handoff, may close existing profile-owned browsers via stale recovery | NOT safe to assume non-destructive standalone browser reattachment in the operator's live profile |
| \`Session::open_tab\`, \`navigate_tab\`, \`close_tab\` | Owns an extra CDP target and navigation within an existing Chromium profile | Tested as legacy browser infrastructure, not as authorized consumer integration |
| \`Session::show\`, \`Session::stop\` | Shows active page/window; stop can close browser and kill child after timeout | Do not call on shared operator browser as automatic cleanup |
| \`browser/cdp.rs::Cdp::call/evaluate\` | Low-level CDP websocket request/response operations | Not provider authorization or stable website contract |
| \`imagegen/script_chat.rs::ScriptChat::ask_tracked\` | Uses cached sign-in and usage-limit state, account turn mutex, profile-based Session, signed-in page probe, retained conversation; returns response and thread URL when successful | Legacy operation; live consumer-site permission absent; no Phase 03M invocation |
| \`imagegen/chatgpt.rs::ChatGptChat::ask_with_images\` | Checks sign-in and limits, opens per-account CDP session/tab, calls chat full, stops its session | Legacy operation; no durable 03M request evidence or demonstrated live authorization |
| \`imagegen/chat.rs::ask_thread_lifecycle\` | CDP input insertion, send, generation-polling, DOM answer read, sign-in/rate-limit diagnostics | No consumer-site automation activated in Phase 03M |
| \`commands/script.rs\` and \`commands/chatgpt.rs\` | Maintain per-account profile roots and legacy account rotation choices | Strict auto task validation never selects another account |
| \`commands/script_chrome.rs\` | 03L transient visible Chrome profile launches and status, manual user interaction | Maintained as separate fallback |
| \`script_studio\`, \`script_execution\`, \`script_review\`, \`script_supervisor\` | Rust-owned immutable plans, SHA256 fragments, review versions, checkpoints, stage transitions, explicit approval | Reused; no second source-of-truth for script text or review reports |

No live installed Windows GUI, real authenticated browser session or provider account
was available to the development environment. Tests against mocks do not establish
a live browser workflow.

## Automatic engine architecture

\`script_automation::ProviderAdapter\` is the explicit capability and execution boundary.
\`FixtureProvider\` checks exact immutable prompt digests before returning tagged MOCK
writing/revision responses and rubric-bound structured reviewer reports. It cannot
call a consumer website or paid API. Unsupported browser mode is rejected **before**
saving a new plan/execution/supervisor task.

\`script_automation::Coordinator\` advances one Rust-owned saved checkpoint at a time:
outline and Script Bible, exact prepared part prompt, immutable response fragment,
continuation prompt and continuation fragment, technical validation, part commit,
versioned continuity note, next part, final assembly, review section JSON, improvement
prompt/revision, fresh review, and **awaiting final human approval**.

The existing \`ExecutionStore\`, \`ReviewStore\` and \`SupervisorStore\` remain the durable
sources. The automatic policy file binds task, channel, execution, plan digest,
fixture mode, threshold and revision cap, with no credentials/cookies. Rust handles
restart recovery only for safely replayable LOCAL MOCK jobs; no uncertain remote
delivery is retried. Failed checkpoint operations pause the task with an explicit
warning and preserve prior records.

The review store now distinguishes fixture imports and fixture revision source
labels from manual review evidence. The direct manual Tauri review command rejects
fixture-specific action variants. An automatic score is a test fixture score, not
a qualitative assessment of the resulting script.

## Regression scenarios and expected evidence

### Scenario A — ten-part fictional horror test (MOCK)

1. Save an immutable 10-part plan, Master Prompt / registered Skill references,
   selected test-account IDs and a target rubric.
2. Automatic worker creates outline/Bible, writes two deterministic fragments
   per part, prepares continuation, validates without auto-overriding warnings,
   commits each part, and saves versioned continuity notes.
3. After Part 4, drop/reopen Rust stores and run the same coordinator: previously
   committed response hashes remain unchanged and Parts 5–10 complete.
4. Review the assembled content using the saved rubric, save each section raw
   JSON, prepare a new revision, run a fresh review and stop before approval.
5. Confirm no user copy/paste, no live AI connection and no automatic approval.

### Scenario B — 1,800-word single documentary test (MOCK)

1. One part produces a deliberately short first fragment, then an exact
   saved continuation. Verify original fragments and assembled output digests.
2. Structured mock reviewer results and a new improved script version remain
   immutable, with a new review round and explicit final-approval gate.

### Scenario C — blocked or failed provider

1. Selecting browser automation returns capability \`automatic=false\`,
   \`authorized=false\` and does not create a plan or task.
2. A corrupted response digest is rejected **before** immutable import.
3. Wrong channel/plan/account pairing is rejected.
4. Pause/cancel stops future steps and preserves sources; resume proceeds only
   from validated local checkpoints.
5. Duplicate imported fragments are rejected by Rust. A previously completed
   part is never resubmitted after restart.

Run automated validation in both Linux and Windows CI using \`npm ci\`,
\`npx tsc -b\`, \`npm run test:ts\`, \`npm run build\`,
the focused \`cargo test --locked script_automation\` plus the existing
script job/studio/execution/review/supervisor/chrome suites, admin feature check,
backend build and full \`cargo test --locked\`.
Record **ignored tests separately**.

## Native Windows acceptance — NOT RUN in CI

Requires a user's interactive Windows desktop with the Tauri **development**
application and existing unmodified browser profiles. Launch from repository clone:

\`\`\`powershell
git fetch origin feature/script-writer-automated-executor-v1
git switch feature/script-writer-automated-executor-v1
git pull --ff-only origin feature/script-writer-automated-executor-v1
npm ci
npm run tauri -- dev
\`\`\`

Select a saved channel. Ensure its Studio has a Master Prompt, selected writer and
reviewer account, and review rubric; then use **Automatic Script Production**
to choose a title, mode, target words/parts, **LOCAL FIXTURE (MOCK)** and click
**Generate Full Script**. Observe actual saved part and review events; pause,
resume and cancel an independent fixture run; restart the app during a run;
inspect saved script and evidence; explicitly approve only the current reviewed
version. Verify Phase 03L manual Chrome fallback remains present and existing
Image Generator/video/voiceover functionality is unaffected.

**DO NOT claim these local GUI checks have passed** until recorded with real
Windows app observations. **DO NOT claim real Claude/ChatGPT success** until explicit
provider authorization, a supported adapter and separate authenticated acceptance
are verified.

## Remaining limitations

- A fixture is not an LLM; scripted output is repetitive and not suitable for
  publication. The genuine authorized AI channel is absent.
- A local Ollama or other permitted AI runtime adapter was not installed/tested
  in this phase.
- Browser profile focus and safe close remain 03L manual limitations.
- Operational approval is always explicit. Never automatically approve.
- No image/video pipeline handoff or public release.
