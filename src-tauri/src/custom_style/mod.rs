//! Custom styles made from reference pictures: the pictures are prepared (shrunk to JPEG), an AI looks at them and
//! writes a style profile, and the profile is kept together with its pictures so it can be analyzed again later.
//! A style can also travel as one `.avstyle` file (a zip with the profile and the pictures).

pub mod analyze;
pub mod package;
pub mod refs;
pub mod service;

use std::collections::HashSet;

/// "custom_my_style", or "custom_my_style_2" when taken. The same rule as `newCustomId` in the frontend.
pub fn new_id(name: &str, taken: &HashSet<String>) -> String {
    let mut slug = String::new();
    for c in name.chars().flat_map(char::to_lowercase) {
        if c.is_ascii_alphanumeric() {
            slug.push(c);
        } else if !slug.ends_with('_') {
            slug.push('_');
        }
    }
    let slug: String = slug.trim_matches('_').chars().take(40).collect();
    let slug = slug.trim_matches('_');
    let base = format!("custom_{}", if slug.is_empty() { "style" } else { slug });
    if !taken.contains(&base) {
        return base;
    }
    (2..).map(|n| format!("{base}_{n}")).find(|id| !taken.contains(id)).unwrap_or(base)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ids_are_lowercase_snake_case_and_unique() {
        let mut taken = HashSet::new();
        assert_eq!(new_id("My  Soft Look!", &taken), "custom_my_soft_look");
        taken.insert("custom_my_soft_look".to_string());
        assert_eq!(new_id("My Soft Look", &taken), "custom_my_soft_look_2");
        assert_eq!(new_id("日本語", &taken), "custom_style");
        assert!(crate::styles::valid_id(&new_id(&"x".repeat(200), &taken)));
    }
}
