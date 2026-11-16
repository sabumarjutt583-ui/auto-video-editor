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


## Phase 03D: manual confirmation and immutable imported response

Schema **stays version 1**. The initial Phase 03B `job.json` and Phase 03C state files continue to deserialize unchanged: `submissionEvidence` is optional/omitted, and all existing `revisions` arrays were empty. Phase 03D reuses `revisions` for typed `{revisionId, contentDigest, byteLength, createdAt, source:"manual_import"}` references. No project schema or migration is changed.

Manual workflow states do **not** prove provider acknowledgment. `ConfirmSubmitted` is an explicitly user-confirmed transition from `submission_intent` or `submission_uncertain` and stores `submissionEvidence:"user_confirmed"`. `ConfirmNotSubmitted` records `user_confirmed_not_submitted` and allows the user to return to a safe copied state. Merely copying or recording submission intent never sets `submitted`.

A locally imported response is accepted from a prepared or manual submission state, **not** from a cancelled/created/already-imported job. The complete exact UTF-8 text must be nonempty after whitespace checking, contain no NUL, and be <= 2,097,152 bytes. No trimming or normalization is applied to what is saved.

1. Under the existing OS-held store writer lease and process mutex, create a deterministic (operation-ID-based) filesystem-safe revision ID.
2. Create `revisions/revision-<random>.tmp` with `create_new`, write exact UTF-8 bytes, flush, `sync_all`, and publish to a never-before-existing `revisions/rev_<64hex>.txt`. Never replace committed text.
3. Persist the next append-only `state-<revision>.json` checkpoint, referencing its SHA-256 digest, byte count, timestamp and `manual_import` origin. Return success **only after** both publications finish successfully.
4. On every read/recover, validate referenced response content against the metadata and inspect unexpected, symlinked, partial and orphaned revision artifacts. A corrupted/imported revision never silently becomes approved; the prior valid state is retained with a recovery issue and mutation blocked.
5. A crash after publishing text but before the state reference leaves an **orphan**; preserve the text and report `orphan_revision` for manual reconciliation. A crash after state publication but before acknowledgement is resolved with the same durable operation ID and returns the already committed outcome.

Revision text files are local plaintext; SHA-256 is for accidental corruption detection, not encryption/authentication. Human-driven copy uses an explicit durably committed `copy_intent` *before* clipboard access; `copied` is committed only after a real clipboard success or an explicit user's manual-copy attestation. A failed clipboard operation leaves the job safe for a user decision.

No script quality validation, approval, external AI submission, browser automation, project handoff, or voice/image/video action is implemented. The minimal manual panel is Vite-development-only and only opens through an explicit user action. Windows GUI/WebView2 runtime validation is still pending. Windows directory synchronization, adversarial filesystem races, hardware power-loss guarantees, and orphan reconciliation UI remain outside this phase.

## Phase 03E: deterministic validation, durable review and explicit approval

Existing schemaVersion 1 remains unchanged. reviewReport and approvalRecord are optional additive fields omitted in Phase 03B/C/D records; old fixtures round-trip without migration. The immutable source response is not edited or overwritten.

Rust-only legal review transitions: response_received -> validating (no report yet) -> draft_saved (rule-based report committed) -> review_pending (await human) -> approved (explicit user action only). Each step uses a distinct stable operation ID, expected stateRevision, immutable channel/request/job IDs and exact script revision ID/digest. Approval additionally requires the exact validation version. Repeated committed operations replay their original checkpoint after restart; stale or conflicting operations fail closed.

Validation rules version script-rules-v1 are pure and deterministic for the same saved text and requested word count. Verification reads the immutable UTF-8 response and checks its SHA-256 hash and byte length, then counts Unicode whitespace-delimited words, compares the count with the requested target (warning outside +/-20%), flags very short content, placeholder markers, Markdown-like formatting, and endings that appear incomplete. Empty text is a technical error. Warnings are advisory and do not establish factual accuracy, originality, storytelling quality, or virality. Languages with word boundaries not represented by whitespace may have misleading counts.

The complete technical/warning report, version, original revision ID, digest and actual word count are stored in append-only state checkpoints. Restart recovery recomputes the exact report from the immutable saved response; altered report metadata, corrupt text or missing revision files block future mutation while preserving the previous recoverable state. No provider or network is consulted.

The separate script_job_approve command accepts only a direct explicit user action. It requires review_pending, the exact validated revision/digest/rule version, no technical errors, an expected state revision and operation ID. It stores source=user_confirmed with an approval timestamp and the approvedRevisionId. No provider confirmation, automatic approval, script rewrite, voiceover, video/image integration or project handoff is implied.

UI is development-only in the existing Manual Script Job panel. The user can read the full imported text, run/finish validation with recoverable checkpoints, view persistent findings, open review, and explicitly approve the saved revision. Existing production Write with Claude and Make Video handlers remain untouched.

The local store still uses plaintext JSON, authenticated OS user access is assumed and SHA-256 is not encryption. Windows directory sync and universal hardware power-failure protection are not claimed. Running the installed Windows Tauri/WebView2 UI must be tested separately; CI Rust compilation does not establish runtime UX acceptance.

## Phase 03F: immutable manual revision history and reapproval

Schema remains version 1, additive and non-migrating. Phase 03B–03E records are never rewritten on read. Older jobs omit selectedRevisionId; their sole original revision is selected implicitly. Optional validationHistory, approvalHistory, and originRevisionId are omitted from older serialized records. A 64-revision limit and 256-operation durable idempotency limit are enforced.

- Create manually: require committed parent revision and explicit request/channel/job identity, stable operation ID and expected state revision. Exact UTF-8 up to 2 MiB; no trimming, rewriting, normalization, deletions or provider calls. A new unique rev_<hash> file is flushed and synchronized before publishing the new append-only state checkpoint. The parent ID, digest, timestamp and manual_import provenance are preserved.
- Select version: choose any previously committed revision without modifying its bytes or order. Creating or reselecting any revision clears current validation and approval; even historically approved revisions must be freshly validated, reviewed and explicitly approved.
- Historical evidence: prior validation reports and superseded approvals are recorded in append-only history arrays, with exact revision ID, digest, rule version, user-confirmed source and approval timestamp. approvedRevisionId and approvalRecord indicate only the active current approval; historical proof is not active authorization.
- Revision-specific validation: Rust always recomputes findings from the selected revision's integrity-verified text; it never silently reuses a prior revision's report. The existing script-rules-v1 lifecycle and explicit approval boundary remain unchanged.
- Offline comparison: ownership and SHA-256 validated for both selected IDs. Deterministic line LCS is bounded to 128 KiB and 400 lines per revision. Larger scripts remain separately readable but comparison returns comparison_too_large. Word counts are Unicode whitespace tokens, not morphology-aware.
- Recovery: lifetime OS writer lease, in-process mutex, append-only checkpoints, same-directory temporary persistence, fsync and unique new file publication. Interrupted temporary files/orphaned revisions/corruption are reported without erasing user content. Fail-closed recovery and durable operation replay survive restart. No universal power-loss, Windows directory-fsync, or encryption guarantee.

The opt-in Vite-development-only UI can list/read/compare versions, paste manual edits, select prior versions, inspect historical approvals/findings, and explicitly reapprove the current selected revision. Nothing is sent to Claude/ChatGPT or video production. Existing Write with Claude, Make Video, browser/CDP, accounts, image, voice, renderer, and project JSON remain unchanged.

Installed Windows Tauri/WebView2 GUI acceptance, full unfiltered Rust suite, and real hardware power-loss behavior are not established by PR-only CI.


## Phase 03G: read-only recovery diagnostics and orphan inspection

The durable job record remains **schemaVersion 1**. This phase introduces only Rust-owned read-only commands and typed diagnostics. No job fields or project JSON are migrated or rewritten; no new provider integration, browser interaction or AI generation occurs.

### What can be proven

- The last contiguous, valid, immutable state checkpoint can establish a job/channel/request owner and its selected revision, validation report and approval history up to that checkpoint.
- Committed revisions remain subject to byte-length and SHA-256 verification.
- New recovery artifact scans identify orphan `rev_<64hex>.txt` files, incomplete `revision-<32hex>.tmp` files, symlinks, unsafe entries, and case-ambiguous names. Existing checkpoint scanning also reports interrupted state files, missing/corrupt records, unsupported future versions and inconsistent history.
- An explicit user action may inspect valid UTF-8 orphan text **read-only** (max 2 MiB). The response contains only its basename, bytes, current SHA-256 digest and exact text. Ordinary diagnostics and logs contain no script content.

### What cannot be proven, and why no reattachment command exists

The earlier revision ID is derived from the job ID and operation ID, not a committed pre-publication intent record. Even when an orphan file lives under a known job folder, its exact originating request contents, parent revision, operation ID and intended state revision are not authenticated by that orphan alone. Its digest is a consistency fingerprint, not proof of authorization, provenance or identity.

Consequently `reconciliationSupported=false` for every Phase 03G inspection. **No state mutation, orphan reattachment, approval, historical timestamp rewrite or cleanup is offered.** Blocked jobs remain blocked, healthy neighboring jobs remain readable. Reconciliation would need a separately authorized protocol with a durable intent and explicit proof or a safe user-export/re-import design on a new identity; neither is implemented in this phase. Do not manually alter or delete application job files to clear warnings.

### Storage and UI limits

- 64 immutable revisions per job.
- 256 durable operation IDs/state checkpoints; when full, further mutations fail closed until a separately approved migration.
- 2,097,152-byte exact UTF-8 script limit per revision, with no trimming/normalization.
- Offline line comparison is limited to 131,072 bytes and 400 lines **per compared revision**. Multi-part manuscripts may exceed those bounds; use individual verified reads instead of pretending full comparison succeeded.

The development-only UI can reopen a blocked job's last verified checkpoint for inspection. Standard write, validation and approval controls are disabled for that blocked job. The UI requires explicit acknowledgment before showing orphan text. It is not enabled in production Vite builds.

### Verified and unverified assumptions

The store retains an OS writer lease and in-process operation mutex. The new inspector checks job/channel/request identity, rejects arbitrary paths, disallows reading committed files as orphans, verifies file size, and uses no-follow flags for final-component file opening (Unix and Windows). A process with adversarial filesystem write privileges may still race parent-directory replacement; these operations are intended for an application-owned local data directory and do **not** claim an adversarial sandbox security boundary.

Normal process crash/restart and fault injection can be tested on Linux/Windows. Directory syncing varies by OS and universal power-loss protection is **not** claimed. The full unfiltered Rust suite, installed Tauri/WebView2 GUI validation and human workflow acceptance must be reported separately from CI. Follow the precise Windows checklist in `docs/SCRIPT_WRITER_03G_WINDOWS_ACCEPTANCE.md`.
