# Claude script jobs: implementation contract

## Product requirements

- A channel can use one instruction or an ordered instruction set. Each instruction has a stable ID, a name, text, and an output purpose: context, script part, description, or final script. Context and clarification responses must never be spoken as narration.
- A project freezes its selected channel, instruction-set version, Claude account, and input title/script when its job starts. Later channel edits do not silently change an active job.
- Each project has one Claude conversation URL and one Google document ID/URL, with Open Claude Chat and Open Document actions.
- Google Docs is the primary script record. Do not retain another permanent full local script archive by default. Keep only small job checkpoints locally. Existing projects and their scripts must not be removed during migration.
- Voice/timing generation still needs the approved script text. Fetch the approved document revision when needed and use temporary processing data; never claim that the workflow runs without local processing.

## Execution and recovery

1. Create the project job and verify that the selected Claude account and Google Docs authorization are usable. If Google Docs is unavailable, pause with a clear reason instead of silently falling back to a local-only archive.
2. Create a separate Google document for the project and persist its ID before sending an instruction.
3. Acquire a lock shared by all requests for the selected Claude account. Start conservatively with one active script job; jobs for the same account remain queued and do not interleave conversations. A future worker limit must not weaken the account lock.
4. Open or reuse one visible, app-owned Claude tab for the project. Avoid a separate login-check tab and duplicate navigation. Reopening the saved conversation must not resend an instruction automatically.
5. On first load, wait for the message input to be usable, then a cancellable 25-second preparation delay. This is a user-requested pacing setting, not a verification-avoidance mechanism.
6. Send one instruction and record its state. Wait for the complete response. Validate it for its declared output purpose before advancing. Clarification, refusal, empty output, truncation, or an incomplete script requires attention.
7. Save each completed response to the project's Google document under its stable instruction ID. Confirm the save before advancing the local checkpoint. Retrying a save must update that section rather than append a duplicate.
8. Wait a cancellable three seconds between instructions. Pause stops new instructions after the current response/save finishes. Continue resumes at the first unfinished instruction.
9. If delivery of an instruction is uncertain, inspect/reconcile the conversation or request user review. Do not blindly resend after a timeout, restart, or cancellation.
10. When the final script is ready, wait for the user's explicit approval. Pin the approved document revision or content hash for voice generation. Later document changes require reapproval.
11. Keep the Claude tab open while awaiting approval. Only after approval, start a cancellable 210-second close timer for that app-owned tab. Never close unrelated tabs or the user's whole browser. Manual closure is allowed; retain the conversation URL for reopening.

Human verification or sign-in pauses the job and leaves the normal browser visible. The user completes verification manually. Do not mask automation, bypass a challenge, switch accounts to escape a limit, or loop requests while blocked.

## Saved metadata and dashboard

Persist job ID, project/channel/account IDs, instruction-set version, conversation URL, document ID/URL, current instruction ID/index, completed instruction IDs, approval revision/hash, and timestamps. Do not persist account credentials in project records.

States: queued, opening browser, preparing, sending, awaiting answer, validating, saving document, waiting between instructions, waiting for user, awaiting approval, paused, failed, completed. Track an uncertain send separately so it cannot be retried as an ordinary unsent instruction.

Show completed/total instructions, current instruction name, elapsed time, waiting reason, and last error. Progress represents confirmed completed instructions, not fabricated time-based progress.

Actions: Open Claude Chat, Show/Hide Live Claude, Open Document, Pause, Continue, Stop, Approve Script. Stop retains checkpoints and links; it does not delete the document. Hide only changes visibility and never destroys the session.

## Google Docs integration boundary

Use an authorized Google connection for document creation, read, and update. Request only the access needed by the chosen implementation. Do not ask the user to paste passwords or tokens into chat. A chat connector is not automatically authorization for the standalone desktop application's runtime.

Record the document ID as soon as it is created to avoid duplicate documents after recovery. Keep a document-write revision/checkpoint. If the application cannot safely prove which write succeeded, reconcile the existing sections before retrying.

## Delivery order and acceptance checks

1. One-tab session lifecycle, saved chat URL, manual verification handoff, and approval-aware tab retention. Verify one prompt produces one send and that unrelated tabs remain open.
2. Instruction-set editor, versioned job records, account serialization, and recoverable sequential execution. Verify two same-account jobs cannot send concurrently, pause/resume does not duplicate a send, and an uncertain send cannot auto-retry.
3. Google Docs connection, per-project document, idempotent section writes, approved revision reads, and dashboard links. Verify a save failure blocks the next instruction and reconnection does not duplicate content.
4. End-to-end short real-account test, then a multi-part script test. Verify narration contains only approved script output and the tab survives until approval, then closes after the requested grace period.

This file records the agreed design. It does not imply that Google Docs or the new job runner is already implemented or live-tested.
