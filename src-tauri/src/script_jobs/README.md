# Script Job Store — Phase 03C durability contract

The existing Phase 03B `job.json` is **schemaVersion 1** and remains the immutable initial snapshot. Valid prior records omit `appliedOperations` and have `preparedPrompt: null`. The Phase 03C reader defaults omitted `appliedOperations` to `[]` and keeps the same schema version; no migration or rewriting of existing jobs is performed. The original shared `job-v1.json` fixture must round-trip unchanged.

## Update protocol

- One OS-backed writer lease (`writer.lock`) is held for the service lifetime; a process mutex serializes calls within that process.
- Each successfully mutated state has a new monotonically increasing `stateRevision`. Serialize a complete record to `state-<revision padded to 20 digits>-<random>.tmp` (actual temporary name is `state-<random>.tmp`) in the **same job folder**, flush and `sync_all()`, then publish it to previously nonexistent `state-<revision padded to 20 digits>.json`.
- **Never delete or replace `job.json` or a committed `state-*.json`.** This deliberately avoids Windows overwrite/replace semantics. On Unix, also sync the directory. Windows directory sync and absolute hardware power-loss immunity are not guaranteed.
- In-process recovery scans contiguous state revisions from `job.json`, verifies the immutable request and exact operation-history prefix, and reports missing, corrupt, future-schema, unsafe or uncommitted files. The last good record is listed along with issues, but direct get/mutation fails closed until issues are reconciled; healthy neighboring jobs remain readable.
- A mutation acknowledgment occurs only after publishing the new checkpoint and applicable directory sync. A crash after publication but before response can be reconciled by the **same operation ID**, which returns the originally committed revision.
- Operations store IDs, SHA-256 action fingerprints, original expected revisions and resulting states. The complete operation history is included in every checkpoint, which enables durable idempotent replay even after subsequent updates.
- Historical operation retention is **bounded at 256**; on reaching the bound all further transitions are rejected. This is intentional: pruning would allow an old retry ID to be inadvertently applied again. Extending/migrating it requires a separately reviewed durable journal strategy.
- Prepared snapshots are exact text plus format version `script-prompt-v1`, request and channel IDs, master digest, content SHA-256 and Rust UTC timestamp. Rust verifies content integrity but **does not prove** the caller's prompt text was semantically produced by the TypeScript compiler. No provider/browser network activity is performed.

## Supported local transitions

`created → prepared`; `prepared/awaiting_user_action → copy_intent → copied`; `prepared/copied/copy_intent → awaiting_user_action`; `copied/awaiting_user_action → submission_intent → submission_uncertain`; before any external intent, local states may transition to `cancelled`.

These are **local bookkeeping states** only. `submission_intent` does not send a prompt, `copied` reflects an explicit external copy confirmation rather than clipboard activity by Rust, and `submission_uncertain` is terminal until a separately authorized reconciliation workflow exists. States like `submitted`, `approved` and `response_received` are reserved for decoding future data; no command can claim them.

## Security and compatibility

The record includes private channel master prompts and prepared text. Never log it, derive `Debug` for it, write it into diagnostic errors, or pass it to the old browser automation. JSON is **not encrypted**, and SHA-256 digests are not secrecy or authentication. The store validates filesystem IDs, rejects symlinked job records/paths, and is initialized at Tauri app data `script-writer/`. Test callers can supply a separate temporary root.

Tauri commands are registered for both normal and admin builds but are **not invoked by existing Script Writer UI, video pipeline or Claude calls**. Initialization failure creates an unavailable service with safe typed errors; no existing Tauri feature is disabled.

The Linux/Windows frontend and Rust CI uses a **non-executable placeholder FFmpeg sidecar** solely to compile/test the backend; it is neither runnable nor shipped. Installed Windows Tauri/WebView2 GUI tests and real power-loss tests remain outstanding.
