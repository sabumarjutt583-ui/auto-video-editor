//! The date and time as text, without a date library.

use std::time::{SystemTime, UNIX_EPOCH};

/// Days since 1970-01-01 to "YYYY-MM-DD".
pub fn civil_date(days: i64) -> String {
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = yoe + era * 400 + i64::from(month <= 2);
    format!("{year:04}-{month:02}-{day:02}")
}

fn now_seconds() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_secs() as i64)
}

/// Today (UTC) as "2026-10-18".
#[cfg(any(feature = "admin", test))]
pub fn today() -> String {
    civil_date(now_seconds() / 86_400)
}

/// Now (UTC) as "2026-10-18 10:11:12".
pub fn timestamp() -> String {
    let seconds = now_seconds();
    let in_day = seconds.rem_euclid(86_400);
    format!("{} {:02}:{:02}:{:02}", civil_date(seconds.div_euclid(86_400)), in_day / 3600, in_day % 3600 / 60, in_day % 60)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dates_are_right() {
        assert_eq!(civil_date(0), "1970-01-01");
        assert_eq!(civil_date(20_000), "2024-10-04");
        assert_eq!(civil_date(11_016), "2000-02-29");
        assert_eq!(civil_date(-1), "1969-12-31");
        assert_eq!(today().len(), 10);
        assert_eq!(timestamp().len(), 19);
    }
}
