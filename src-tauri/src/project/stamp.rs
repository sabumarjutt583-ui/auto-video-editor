//! Project ids and timestamps, made without extra crates.

use std::collections::hash_map::RandomState;
use std::hash::{BuildHasher, Hasher};
use std::time::{SystemTime, UNIX_EPOCH};

const MAX_ID_LENGTH: usize = 64;

/// A new, hard-to-guess folder name for a project, e.g. `prj_19a3f2b1c4d5e6f7a8b9`.
pub fn new_id() -> String {
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    let random = RandomState::new().build_hasher().finish();
    format!("prj_{millis:x}{:08x}", random as u32)
}

/// Ids become folder names, so only plain letters, digits, `_` and `-` are allowed.
/// This is what stops a request like `../../something` from leaving the projects folder.
pub fn is_valid_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= MAX_ID_LENGTH
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
}

/// The current time as `2026-10-18T12:34:56.789Z` (UTC, fixed width, sorts correctly as text).
pub fn now_iso() -> String {
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    format_iso(u64::try_from(millis).unwrap_or(0))
}

pub fn format_iso(unix_millis: u64) -> String {
    let seconds = unix_millis / 1000;
    let millis = unix_millis % 1000;
    let (year, month, day) = civil_from_days(i64::try_from(seconds / 86_400).unwrap_or(0));
    let rest = seconds % 86_400;
    format!(
        "{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}.{millis:03}Z",
        rest / 3600,
        rest % 3600 / 60,
        rest % 60
    )
}

/// Days since 1970-01-01 to a calendar date (Howard Hinnant's algorithm).
fn civil_from_days(days: i64) -> (i64, i64, i64) {
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let day_of_era = z.rem_euclid(146_097);
    let year_of_era =
        (day_of_era - day_of_era / 1460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let month_part = (5 * day_of_year + 2) / 153;
    let day = day_of_year - (153 * month_part + 2) / 5 + 1;
    let month = if month_part < 10 { month_part + 3 } else { month_part - 9 };
    let year = year_of_era + era * 400 + i64::from(month <= 2);
    (year, month, day)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn formats_known_moments() {
        assert_eq!(format_iso(0), "1970-01-01T00:00:00.000Z");
        assert_eq!(format_iso(1_700_000_000_123), "2023-11-14T22:13:20.123Z");
        assert_eq!(format_iso(951_782_400_000), "2000-02-29T00:00:00.000Z");
        assert_eq!(format_iso(4_102_444_799_999), "2099-12-31T23:59:59.999Z");
    }

    #[test]
    fn timestamps_sort_as_text() {
        assert!(format_iso(1_000_000_000_000) < format_iso(1_700_000_000_000));
        assert_eq!(now_iso().len(), 24);
    }

    #[test]
    fn new_ids_are_valid_and_different() {
        let a = new_id();
        let b = new_id();
        assert!(is_valid_id(&a));
        assert_ne!(a, b);
    }

    #[test]
    fn ids_cannot_escape_the_projects_folder() {
        for bad in ["", "..", "../x", "a/b", "a\\b", "a b", ".hidden", "C:\\x", "x\0"] {
            assert!(!is_valid_id(bad), "{bad:?} should be refused");
        }
        assert!(!is_valid_id(&"a".repeat(65)));
        assert!(is_valid_id("prj_abc-123"));
    }
}
