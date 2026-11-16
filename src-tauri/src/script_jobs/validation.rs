//! Offline deterministic technical checks. Never claim AI-assessed quality.
use super::model::{
    ScriptRevisionRef, ScriptValidationFinding, ScriptValidationReport, ValidationSeverity,
};
pub const VALIDATION_VERSION: &str = "script-rules-v1";

fn finding(code: &str, severity: ValidationSeverity, message: &str) -> ScriptValidationFinding {
    ScriptValidationFinding { code: code.into(), severity, message: message.into() }
}

/// Reproducible for identical immutable response bytes, revision, and word target.
/// Word count uses Unicode whitespace-delimited tokens, not language-specific
/// morphological segmentation; Korean/Urdu counts may differ from human counts.
pub fn analyze(text: &str, reference: &ScriptRevisionRef, requested: Option<u32>) -> ScriptValidationReport {
    let words = text.split_whitespace().count() as u32;
    let mut findings = Vec::new();
    if text.trim().is_empty() {
        findings.push(finding("empty_script", ValidationSeverity::Error, "The imported script is empty."));
    }
    if words < 30 && !text.trim().is_empty() {
        findings.push(finding("very_short", ValidationSeverity::Warning, "Script has fewer than 30 whitespace-separated words; check that it is complete."));
    }
    if let Some(target) = requested {
        if words.saturating_mul(100) < target.saturating_mul(80) {
            findings.push(finding("below_requested_length", ValidationSeverity::Warning, "Word count is more than 20% below the requested target."));
        } else if words.saturating_mul(100) > target.saturating_mul(120) {
            findings.push(finding("above_requested_length", ValidationSeverity::Warning, "Word count is more than 20% above the requested target."));
        }
    }
    let lowered = text.to_lowercase();
    if ["[insert", "[placeholder", "lorem ipsum", "[todo", "[tbd", "{{placeholder", "<placeholder>"]
        .iter().any(|pattern| lowered.contains(pattern)) {
        findings.push(finding("placeholder_marker", ValidationSeverity::Warning, "Possible placeholder text needs human review."));
    }
    if text.lines().any(|line| {
        let line = line.trim_start();
        line.starts_with("# ") || line.starts_with("## ") || line.starts_with("### ")
            || line.as_bytes().starts_with(&[96, 96, 96]) || line.starts_with("**")
    }) {
        findings.push(finding("narration_formatting", ValidationSeverity::Warning, "Markdown-style headings or formatting may not suit spoken narration."));
    }
    let ending = text.trim_end();
    if ending.ends_with("...") || ending.ends_with('…')
        || lowered.trim_end().ends_with("to be continued")
        || lowered.trim_end().ends_with("continued in part") {
        findings.push(finding("possible_incomplete_ending", ValidationSeverity::Warning, "Ending appears unfinished; review the final paragraph."));
    }
    ScriptValidationReport {
        validation_version: VALIDATION_VERSION.into(),
        revision_id: reference.revision_id.clone(),
        content_digest: reference.content_digest.clone(),
        actual_word_count: words,
        requested_word_count: requested,
        findings,
    }
}
pub fn has_technical_errors(report: &ScriptValidationReport) -> bool {
    report.findings.iter().any(|finding| finding.severity == ValidationSeverity::Error)
}
