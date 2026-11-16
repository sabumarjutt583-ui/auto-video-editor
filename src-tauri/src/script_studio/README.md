# Phase 03H — Offline Channel Script Studio Store

This independent **Rust-owned** service under `app_data_dir()/script-writer/studio` is *not* the legacy channel profile store, the durable `script-writer/jobs` store, Claude/ChatGPT account store, browser profile, or production video pipeline.

## Storage

    script-writer/
      studio/
        writer.lock
        channels/
          <existing-channel-id>/
            config-000001.json
            config-000002.json
            ...
            plans/
              sp_<uuid>.json

- The channel ID is the **existing** `ChannelProfile.id`, validated in Rust against the authoritative saved channel profiles before creating/editing config and plans. A duplicate/imported profile gets its own new profile ID through the existing frontend `duplicateProfile`/`importProfile` APIs. No second channel registry is created.
- Opening an unsaved Studio channel returns a read-only **ephemeral** schema-v1 config seeded from the saved legacy `script.masterPrompt`, language and Claude account choice. Reading never creates channel config or edits the legacy profile.
- Saving one edit appends `config-<revision>.json` (1–256). Each committed config includes its prior snapshot SHA-256, its edit operation ID/digest, selected immutable prompt/reviewer versions, local Skills, account references, rubric and planning. The store rechecks all previous configs for gaps, corruption, immutable version-prefix changes and unexpected artifacts. A conflicting/stale edit fails; stable identical operation-ID retries return the recorded snapshot. Old checkpoints never get replaced/deleted.
- Plans are separate immutable `sp_<id>.json` records. Each contains the **full exact config snapshot** and digest, planning inputs/effective targets, prompt/reviewer versions, Skill/account references and warnings. A reused plan ID with changed content fails. No plan implies AI submission or an approved script.
- Under its own OS-native cross-process writer lease and mutex, every publication uses a unique same-directory temp file, flush, `sync_all`, and rename to an **unused** destination, avoiding Windows in-place replacement. Directory fsync is used where supported on Unix; no universal disk/power-loss guarantee is claimed. Temporary/corrupt/unsupported-future artifacts are preserved and block unsafe edits. No silent overwrite, repair or automatic cleanup of historical data.
- Channel configuration, plans, and account references live separately from existing Script Job state and project.json. Renaming a channel preserves stable ID; deleting its legacy profile never deletes the channel's stored Studio files, though creation/edit commands require an existing saved channel profile.

## Versioned configuration

`ChannelStudioConfigV1` uses `schemaVersion:1`, channel ID, monotonic configuration revision, timestamps, previous snapshot digest and operation identity. Master Prompt and reviewer prompt versions are immutable content+SHA-256 records with explicit channel owner, version ID, createdAt and optional structured planning preferences. Selecting an older version changes only the new configuration snapshot, not previous prompt content.

Writing instruction modes:
- `master_prompt` — selected prompt version.
- `claude_skill` — locally registered user Skill name/account (does **not** activate a remote Skill or bypass legacy Script Job validation).
- `master_plus_skill` — both references, with explicit warning remote Skill activation is unverified.

A Skill has channel-scoped ID, display/exact name, Claude account ID, description, local registration/user-attested/attention status, timestamp and optional structured part defaults. **User-confirmed installed != provider-verified installed.** Names are allowed across different channels; changing/removing accounts does not change channel ownership. No passwords, cookies, bearer tokens, API keys or browser paths are stored.

Account refs read the **existing** Claude and ChatGPT account managers. A new edit/import referencing a missing account is rejected; existing saved records remain readable so a deleted account does not destroy private data. `strict_selected` and `automatic_permitted` are configuration metadata only: this phase performs no rotation, switching, browser requests or provider selection.

Custom reviewer prompt history and distinct single/part/final instructions are channel-specific. Rubrics are editable and must total exactly 100 points. No AI scoring is performed. Existing rule-based validation/revisions/approval records are not rewritten.

## Deterministic planning

App mode `single` requests one part; `multi_part` requests 1–40 parts, at least 50 words each, and 50–200,000 requested words total. The total is divided using base + one word for the first `total % partCount` parts, producing deterministic integer targets. Explicit individual overrides must be present for every part and sum to total. These are **targets**, not guarantees of output word count.

Effective precedence:
1. Explicit per-plan fields.
2. Selected Skill structured planning overrides (when Skill mode enabled).
3. Selected Master Prompt version's structured planning overrides.
4. Channel default planning fields.
5. Application defaults.

Do not infer part counts from arbitrary prompt prose; warn about textual conflicts rather than guessing. Skill-only planning does not alter existing production prompt compiler or Script Job requirements.

`studio_preview_plan` is pure and non-sending, compiling local writing and review previews with JSON-encoded title/topic/part data. Prompt boundaries reduce accidental mixing but cannot guarantee prompt-injection immunity. No AI account/Skill verification, generation, provider requests, or video pipeline handoff occurs.

## Backup/import

`studio_export` returns JSON with user-owned Studio text and account references, not credentials. JSON contains private prompts and should be protected by the user. `studio_import` requires an explicit target **existing** channel with no saved Studio configuration; rebinding rewrites only the **new imported snapshot's** channel-owned IDs, resets Skill confirmations to locally registered, validates all account refs, and rejects overwrite. It never mutates source channel data or existing jobs. Distinct channel names do not establish identity.

## Limits and pending validation

- 256 config snapshots/channel; 64 Master Prompt versions, 64 reviewer versions, 64 registered Skills, 256 plans/channel; <=64 KiB per prompt; cap 1 MiB serialized config/plan files.
- Existing Script Job limits unchanged: 64 script revisions, 256 durable operations and 2 MiB per imported text; 128 KiB / 400-line local comparison limit.
- No new crate/dependency, provider integration, production UI, job schema migration, or Google Docs synchronization.
- The user must complete Windows WebView2 GUI acceptance in `docs/SCRIPT_WRITER_03H_WINDOWS_ACCEPTANCE.md`; passing headless CI is **not** equivalent to GUI acceptance.
