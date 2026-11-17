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
