//! Finding silences and planning which parts of the voice-over to keep.

use crate::project::TimeRange;

/// Reads FFmpeg's `silencedetect` lines from stderr. A silence that is still open at the end of
/// the file is closed at `duration`.
pub fn parse_silencedetect(stderr: &str, duration: f64) -> Vec<TimeRange> {
    let mut ranges = Vec::new();
    let mut open: Option<f64> = None;
    let value_after = |line: &str, key: &str| -> Option<f64> {
        let rest = &line[line.find(key)? + key.len()..];
        rest.split(|c: char| c.is_whitespace() || c == '|').find(|part| !part.is_empty())?.parse().ok()
    };
    for line in stderr.lines().filter(|l| l.contains("silencedetect")) {
        if let Some(start) = value_after(line, "silence_start:") {
            open = Some(start.max(0.0));
        } else if let Some(end) = value_after(line, "silence_end:") {
            let start = open.take().unwrap_or(0.0);
            let end = end.min(duration);
            if end > start {
                ranges.push(TimeRange { start, end });
            }
        }
    }
    if let Some(start) = open {
        if duration > start {
            ranges.push(TimeRange { start, end: duration });
        }
    }
    ranges
}

const EDGE: f64 = 0.001;
/// Cuts shorter than this are not worth making.
const MIN_CUT: f64 = 0.05;

/// The parts to remove: each silence of at least `min_silence` seconds, minus `padding` seconds
/// kept next to the speech on each side. Silence at the very start or end of the file keeps
/// padding only on the speech side.
pub fn plan_cuts(silences: &[TimeRange], duration: f64, min_silence: f64, padding: f64) -> Vec<TimeRange> {
    let mut cuts: Vec<TimeRange> = silences
        .iter()
        .filter(|s| s.end - s.start >= min_silence)
        .filter_map(|s| {
            let start = if s.start <= EDGE { 0.0 } else { s.start + padding };
            let end = if s.end >= duration - EDGE { duration } else { s.end - padding };
            (end - start >= MIN_CUT).then_some(TimeRange { start, end })
        })
        .collect();
    cuts.sort_by(|a, b| a.start.total_cmp(&b.start));

    let mut merged: Vec<TimeRange> = Vec::new();
    for cut in cuts {
        match merged.last_mut() {
            Some(last) if cut.start <= last.end => last.end = last.end.max(cut.end),
            _ => merged.push(cut),
        }
    }
    merged
}

/// The parts that stay: everything between the cuts.
pub fn keep_segments(cuts: &[TimeRange], duration: f64) -> Vec<TimeRange> {
    let mut keep = Vec::new();
    let mut position = 0.0;
    for cut in cuts {
        if cut.start > position {
            keep.push(TimeRange { start: position, end: cut.start });
        }
        position = position.max(cut.end);
    }
    if duration > position {
        keep.push(TimeRange { start: position, end: duration });
    }
    keep
}

pub fn total_length(ranges: &[TimeRange]) -> f64 {
    ranges.iter().map(|r| r.end - r.start).sum()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn range(start: f64, end: f64) -> TimeRange {
        TimeRange { start, end }
    }

    #[test]
    fn parses_silencedetect_output() {
        let text = "\
[silencedetect @ 0x55] silence_start: 1.5
[silencedetect @ 0x55] silence_end: 3.25 | silence_duration: 1.75
size=N/A time=00:00:10
[silencedetect @ 0x55] silence_start: 8.0
[silencedetect @ 0x55] silence_end: 9.5 | silence_duration: 1.5";
        assert_eq!(parse_silencedetect(text, 10.0), vec![range(1.5, 3.25), range(8.0, 9.5)]);
    }

    #[test]
    fn a_silence_open_at_the_end_is_closed_at_the_duration() {
        let text = "[silencedetect @ 0x1] silence_start: 8.5\n";
        assert_eq!(parse_silencedetect(text, 10.0), vec![range(8.5, 10.0)]);
    }

    #[test]
    fn a_silence_at_the_start_may_have_a_tiny_negative_start() {
        let text = "[silencedetect @ 0x1] silence_start: -0.0213\n[silencedetect @ 0x1] silence_end: 1.2 | silence_duration: 1.22";
        assert_eq!(parse_silencedetect(text, 5.0), vec![range(0.0, 1.2)]);
    }

    #[test]
    fn ignores_other_lines_and_junk() {
        assert!(parse_silencedetect("hello\nsilence_start: 1\n", 5.0).is_empty());
    }

    #[test]
    fn padding_is_kept_next_to_speech() {
        let cuts = plan_cuts(&[range(2.0, 4.0)], 10.0, 0.6, 0.15);
        assert_eq!(cuts.len(), 1);
        assert!((cuts[0].start - 2.15).abs() < 1e-9 && (cuts[0].end - 3.85).abs() < 1e-9);
    }

    #[test]
    fn short_silences_are_left_alone() {
        assert!(plan_cuts(&[range(2.0, 2.5)], 10.0, 0.6, 0.15).is_empty());
    }

    #[test]
    fn a_silence_only_a_little_longer_than_twice_the_padding_makes_no_cut() {
        assert!(plan_cuts(&[range(2.0, 2.62)], 10.0, 0.6, 0.3).is_empty());
    }

    #[test]
    fn silence_at_the_edges_keeps_padding_only_next_to_speech() {
        let cuts = plan_cuts(&[range(0.0, 2.0), range(8.0, 10.0)], 10.0, 0.6, 0.15);
        assert_eq!(cuts.len(), 2);
        assert_eq!(cuts[0].start, 0.0);
        assert!((cuts[0].end - 1.85).abs() < 1e-9);
        assert!((cuts[1].start - 8.15).abs() < 1e-9);
        assert_eq!(cuts[1].end, 10.0);
    }

    #[test]
    fn keep_segments_are_the_gaps_between_cuts() {
        let cuts = vec![range(2.0, 3.0), range(5.0, 6.0)];
        assert_eq!(keep_segments(&cuts, 10.0), vec![range(0.0, 2.0), range(3.0, 5.0), range(6.0, 10.0)]);
        assert_eq!(keep_segments(&[], 4.0), vec![range(0.0, 4.0)]);
        assert!(keep_segments(&[range(0.0, 4.0)], 4.0).is_empty());
    }

    #[test]
    fn kept_plus_cut_time_is_the_whole_file() {
        let cuts = plan_cuts(&[range(0.0, 1.0), range(3.0, 6.0), range(9.0, 12.0)], 12.0, 0.6, 0.2);
        let total = total_length(&cuts) + total_length(&keep_segments(&cuts, 12.0));
        assert!((total - 12.0).abs() < 1e-9);
    }
}
