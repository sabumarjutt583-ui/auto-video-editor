//! Pure bounded line comparison of two verified immutable script revisions.
use serde::Serialize;

use super::model::ScriptRevisionRef;

pub const MAX_COMPARISON_TEXT_BYTES: usize = 131_072;
pub const MAX_COMPARISON_LINES: usize = 400;

#[derive(Serialize)]
#[serde(rename_all = "snake_case")]
pub enum DiffKind { Unchanged, Added, Removed }

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RevisionDiffLine {
    pub kind: DiffKind,
    /// Exact line contents (including newline), never modified or normalized.
    pub text: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScriptRevisionComparison {
    pub revision_a: ScriptRevisionRef,
    pub revision_b: ScriptRevisionRef,
    pub word_count_a: u32,
    pub word_count_b: u32,
    pub lines: Vec<RevisionDiffLine>,
}

/// Long scripts are still readable individually; a compare that exceeds these
/// bounds fails explicitly rather than consuming unbounded memory or freezing UI.
pub fn compare(
    a: &str, b: &str, revision_a: ScriptRevisionRef, revision_b: ScriptRevisionRef,
) -> Option<ScriptRevisionComparison> {
    if a.len() > MAX_COMPARISON_TEXT_BYTES || b.len() > MAX_COMPARISON_TEXT_BYTES {
        return None;
    }
    let aa: Vec<&str> = a.split_inclusive('\n').collect();
    let bb: Vec<&str> = b.split_inclusive('\n').collect();
    if aa.len() > MAX_COMPARISON_LINES || bb.len() > MAX_COMPARISON_LINES {
        return None;
    }
    let n = aa.len();
    let m = bb.len();
    let mut dp = vec![0usize; (n+1)*(m+1)];
    for i in (0..n).rev() {
        for j in (0..m).rev() {
            dp[i*(m+1)+j] = if aa[i] == bb[j] {
                1 + dp[(i+1)*(m+1)+j+1]
            } else {
                dp[(i+1)*(m+1)+j].max(dp[i*(m+1)+j+1])
            };
        }
    }
    let mut lines = Vec::new();
    let mut i=0; let mut j=0;
    while i<n || j<m {
        if i<n && j<m && aa[i]==bb[j] {
            lines.push(RevisionDiffLine { kind: DiffKind::Unchanged, text: aa[i].into() });
            i+=1; j+=1;
        } else if j<m && (i==n || dp[i*(m+1)+j+1] > dp[(i+1)*(m+1)+j]) {
            lines.push(RevisionDiffLine { kind: DiffKind::Added, text: bb[j].into() });
            j+=1;
        } else {
            lines.push(RevisionDiffLine { kind: DiffKind::Removed, text: aa[i].into() });
            i+=1;
        }
    }
    Some(ScriptRevisionComparison {
        revision_a, revision_b,
        word_count_a: a.split_whitespace().count() as u32,
        word_count_b: b.split_whitespace().count() as u32,
        lines,
    })
}
