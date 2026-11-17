# Phase 03I — Offline Script Execution (development-only)

Phase 03I consumes immutable Phase 03H Studio plans. It never edits the plan, and never shares the legacy Script Jobs 64-revision / 256-operation limits. No Claude, browser, image generator, voiceover, FFmpeg, video editor or production pipeline integration.

## Storage and identity

App data directory: script-writer/executions/writer.lock, channels/<channel-id>/<execution-id>/state-000000.json (append-only revision checkpoints), and objects/object-<revision>-<kind>.txt (immutable imported content, notes, prompts, final assembly and review packet).

The separate Rust-owned store holds its own OS-native exclusive writer lease. Each mutation requires an expected revision and stable operation ID. Replays of the exact request are idempotent; collisions and stale revisions fail. Each checkpoint has previous-state SHA-256, operation ID/digest, channel/plan/config identity, object references and progress. No large part text is copied into checkpoints.

All local reads verify state checkpoint chain and all referenced source files' SHA-256/byte sizes. Unexpected, temporary, orphaned, corrupt, missing and unsafe symlink artifacts block mutation without silent deletion. Written data syncs to files, and parent directories where supported; no guarantee of hard-power-loss immunity is made.

Command boundaries verify the channel against actual saved profiles, while the execution store binds the channel, plan, config digest and immutable plan SHA-256. Provider accounts are never authorization identifiers.

## Execution and controls

Single mode needs one response; multi-part runs in order up to 40 planned parts. Required outline confirmation and previous-part continuity notes block prepare-next when missing. Plans and prompt/Skill versions remain fixed even if current Studio settings change. Skill references are local metadata, not confirmation of a remote skill launch.

Prompt builder uses saved master prompt, Skill reference, target words, part objective, the latest Outline and Script Bible versions, stored explicit prior continuity notes and user instructions. If constructed instructions exceed 256 KiB, it errors instead of silently truncating. No AI facts, summaries or fake reviews are synthesized.

An imported fragment is immutable exact UTF-8 with leading/trailing spaces and CRLF retained. A candidate is built by joining fragments with a single LF (no trimming), reviewed explicitly, and committed separately. Part validation uses rule-based whitespace token estimates, target deviations, placeholder flags, unfinished ending, repeated passages, and adjacent continuation overlap. Validation is not AI quality or fact verification.

After all parts commit, assembly verifies source references and joins exact saved part texts using TWO LF characters. Single-part assembly inserts no separator. The final output is immutable, independent of the original part files. The offline review packet records references, rubric, settings and part warnings, and explicitly states not reviewed and not approved.

Limits: 512 append-only revisions per execution; 2 MiB per metadata checkpoint; max 16 imported fragments and 16 continuation prompts per part; 8 MiB part content, 64 MiB final assembly, 64 KiB note, 256 KiB prompt. Large high-fragment plans may hit the checkpoint cap even within the Phase 03H 200,000-word target; no hidden rollover or deletion is performed.

## Verification

Run cargo test --locked script_jobs, cargo test --locked script_studio, cargo test --locked script_execution, Linux/Windows frontend TS tests and builds, Rust builds and admin-feature checks. Attempt full cargo test --locked where feasible. Real Windows WebView2 GUI acceptance is separately documented in docs/SCRIPT_WRITER_03I_WINDOWS_ACCEPTANCE.md. CI FFmpeg placeholders are compile-only.
