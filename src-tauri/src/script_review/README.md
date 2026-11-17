# Phase 03J — Offline Script Review Store

This independent Rust-owned store is located under the Tauri app-data directory at
script-writer/reviews/channels/<channel-id>/<review-id>. It does not modify Studio,
Script Jobs, the source multipart execution, or any production media project.

## Source of truth

The caller must supply a saved, validated Studio plan and a matching Phase 03I
execution. Rust checks channel, execution, plan ID, saved plan digest, exact committed
part or assembled artifact SHA-256 and byte count before copying exact UTF-8 bytes
to an immutable review-version object. Frontend parameters cannot select another
channel because every Tauri review command first resolves the saved channel profile.

The original source is never rewritten. A human-improved script becomes a second,
third, etc. immutable object. All reviews and approvals bind to the exact digest.
Review policy (selected custom prompt version, digest, provider/account reference,
audience, tone, language, and the custom 100-point rubric) is captured from the
immutable saved plan and never follows later Studio settings changes.

## Durable operations and recovery

A separate native, exclusive process writer lease, in-process mutex, immutable
object objects, append-only digest-linked state checkpoints, expected revisions and
operation-id+payload replay protection guard writes. Reads verify every referenced
file and block if files are corrupt, symlinked or orphaned. Interrupted object
publication intentionally leaves a visible orphan and blocks unsafe continuation
until the saved files are inspected. Nothing is automatically deleted. There is
no silent truncation or repair.

Review requests are offline prompt artifacts and are NOT provider invocations.
The system splits large scripts at valid UTF-8 boundaries into 48 KiB sections.
Every section needs its own manually imported, schema-valid report for full coverage.
A section score is not automatically represented as a complete-script score.
Maximum 64 MiB source, 2 MiB original raw response per section, 256 KiB prompt,
1400 sections, 512 checkpoints, 2 MiB state JSON. Overflow fails closed.
Large complete-script improvement prompts exceeding 256 KiB are blocked;
review/improve smaller individual parts instead.

## Structured manual review response

JSON requires exactly one entry per rubric key, point values within each category's
maximum, a nonempty summary, and 0–200 findings with valid info/warning/error
severity. Rust sums points; there is no invented score and no audience/viral
performance guarantee. Non-JSON or invalid original responses are preserved in
raw immutable objects and may be supplemented by an explicit corrected, validated
structured report, never replacing the raw.

A review round binds one script version and includes exact coverage. Improvements
require a completed review and explicit goal choices; a manual revised script is
saved as a new version. New versions require a new completed review. Final approval
requires a fully covered final/single-script round, a script without unresolved
technical warnings, exact user confirmation text, and matching digest/version.
Part-only sessions cannot approve global scripts. Approvals remain historical
and are never forwarded to any voiceover, image, video or Make Video pipeline.

## Intentional limitations

No external AI provider is contacted. Reviewer source is user-reported/manual.
Scoring is editorial, not objective proof or factual verification. No OCR or
unofficial browser extraction. The model supports a full section-by-section
review workflow, but it cannot claim that a single 48 KiB section represents
a larger text. On-disk revisions are immutable; no automatic orphan cleanup.
The Windows WebView2 installed application requires manual human acceptance.


## Phase 03J stabilization — immutable continuity and approval validation

New sessions bind a provenance-preserving snapshot of the exact source execution
revision, saved outline, Script Bible, latest manually entered continuity note
per completed part and saved plan part objectives/previous/next relationships.
All sources must match the Rust execution store's SHA-256 and byte counts.
Absent or stale required continuity causes review creation to **fail closed**.
A bounded **96 KiB** context inclusion budget preserves individual note text
exactly or omits the entire note, recording its complete digest, size and
**NOT SUPPLIED** warning. There is no silent truncation or invented summary.
Large custom reviewer instructions may still exceed 256 KiB prompts and fail
explicitly. New policy snapshots keep a separate optional \`continuity\` field;
missing optional fields on older sessions remain absent on serialization to
retain the exact stored checkpoint hashes and avoid historical migrations.

New review rounds store immutable section byte offsets, SHA-256 hashes and
lengths. Section splitting prefers sentence/paragraph boundaries but falls
back to an exact UTF-8 codepoint boundary without dropping text. Historical
sections without the optional coverage field remain readable. Section reports
can establish *complete sectional coverage*, not a holistic single-score
judgment. The UI never averages scores across unrelated sections.

On every review reopen, Rust rechecks category scores against the exact saved
100-point rubric, validates each round's section coverage and text digest,
recomputes saved approval proof and verifies that approval is bound to a
fully covered, valid final/single/improvement review and exact script version.
Append-only transitions reject deleted/altered earlier approvals or script
objects. A manual new revision never inherits a prior approval. These checks
are backend-owned; frontend buttons are advisory.

Source execution records, previous reviews and video/media production remain
unchanged. The Tauri app must still be interactively tested on installed
Windows/WebView2; GitHub CI is not GUI acceptance.


### Windows FFmpeg 9 compatibility finding (stabilization)

A full Windows Rust suite under Chocolatey FFmpeg **9.0.2** produced
**726 passes, 8 failures, 5 ignored**. The common error is
\`Unrecognized option 'filter_complex_script'\` in production audio/render
command builders; one cancellation assertion then fails downstream.
This is an **actual unsupported FFmpeg major-version compatibility issue**,
not proof of an invalid test runner or a Phase 03J review defect.
The FFmpeg project deprecated that CLI option and removed it in FFmpeg 9.

For deterministic Phase 03J regression verification, GitHub Actions uses
the real, explicitly version-pinned **Windows FFmpeg 7.1.1** binary and
fails if the required command option is absent. The CI binary is not a
shipped artifact; no production audio/render logic is changed. The Windows
FFmpeg 9 finding remains **unresolved** and should be handled in a
separate scoped compatibility change before any FFmpeg 9 upgrade. The new
CI green result (if achieved) establishes compatibility with 7.1.1 only.
