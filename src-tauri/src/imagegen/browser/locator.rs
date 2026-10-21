//! Finds an installed Chromium-based browser: Chrome first, then Edge, Brave, Chromium. A browser the
//! user picked in Settings wins. The app's own web view is never used: Google refuses sign-in there.

use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Os {
    Windows,
    Mac,
    Linux,
}

pub fn current_os() -> Os {
    if cfg!(windows) {
        Os::Windows
    } else if cfg!(target_os = "macos") {
        Os::Mac
    } else {
        Os::Linux
    }
}

/// Where each browser usually lives. `env` reads an environment variable (a closure, so tests can fake it).
pub fn candidates(os: Os, env: &dyn Fn(&str) -> Option<String>) -> Vec<PathBuf> {
    let mut list: Vec<PathBuf> = Vec::new();
    match os {
        Os::Windows => {
            let roots: Vec<String> = ["PROGRAMFILES", "PROGRAMFILES(X86)", "LOCALAPPDATA"].iter().filter_map(|k| env(k)).collect();
            let relative = [
                r"Google\Chrome\Application\chrome.exe",
                r"Microsoft\Edge\Application\msedge.exe",
                r"BraveSoftware\Brave-Browser\Application\brave.exe",
                r"Chromium\Application\chrome.exe",
            ];
            for relative in relative {
                for root in &roots {
                    list.push(Path::new(root).join(relative));
                }
            }
        }
        Os::Mac => {
            for app in [
                "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
                "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
                "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
                "/Applications/Chromium.app/Contents/MacOS/Chromium",
            ] {
                list.push(PathBuf::from(app));
                if let Some(home) = env("HOME") {
                    list.push(Path::new(&home).join(app.trim_start_matches('/')));
                }
            }
        }
        Os::Linux => {
            for path in [
                "/usr/bin/google-chrome",
                "/usr/bin/google-chrome-stable",
                "/opt/google/chrome/chrome",
                "/usr/bin/microsoft-edge",
                "/usr/bin/microsoft-edge-stable",
                "/usr/bin/brave-browser",
                "/usr/bin/chromium",
                "/usr/bin/chromium-browser",
                "/snap/bin/chromium",
            ] {
                list.push(PathBuf::from(path));
            }
        }
    }
    list
}

/// The browser to use: the user's choice when it exists, otherwise the first installed candidate.
pub fn find(chosen: Option<&str>) -> Option<PathBuf> {
    find_with(chosen, current_os(), &|key| std::env::var(key).ok(), &|path| path.is_file())
}

pub fn find_with(chosen: Option<&str>, os: Os, env: &dyn Fn(&str) -> Option<String>, exists: &dyn Fn(&Path) -> bool) -> Option<PathBuf> {
    if let Some(path) = chosen.map(str::trim).filter(|p| !p.is_empty()).map(PathBuf::from) {
        if exists(&path) {
            return Some(path);
        }
    }
    candidates(os, env).into_iter().find(|p| exists(p))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn env(key: &str) -> Option<String> {
        match key {
            "PROGRAMFILES" => Some(r"C:\Program Files".into()),
            "LOCALAPPDATA" => Some(r"C:\Users\me\AppData\Local".into()),
            "HOME" => Some("/Users/me".into()),
            _ => None,
        }
    }

    #[test]
    fn chrome_comes_before_edge_on_windows_and_missing_variables_are_skipped() {
        let list = candidates(Os::Windows, &env);
        assert!(list[0].to_string_lossy().contains("Chrome"));
        assert!(list.iter().any(|p| p.to_string_lossy().contains("msedge.exe")));
        assert!(list.iter().all(|p| !p.to_string_lossy().contains("x86")));
    }

    #[test]
    fn the_first_installed_browser_is_used() {
        let found = find_with(None, Os::Linux, &env, &|p| p.ends_with("microsoft-edge") || p.ends_with("chromium"));
        assert_eq!(found, Some(PathBuf::from("/usr/bin/microsoft-edge")));
    }

    #[test]
    fn the_users_choice_wins_but_only_when_it_exists() {
        let exists = |p: &Path| p.ends_with("my-browser") || p.ends_with("google-chrome");
        assert_eq!(find_with(Some("/opt/my-browser"), Os::Linux, &env, &exists), Some(PathBuf::from("/opt/my-browser")));
        assert_eq!(find_with(Some("/opt/gone"), Os::Linux, &env, &exists), Some(PathBuf::from("/usr/bin/google-chrome")));
        assert_eq!(find_with(None, Os::Linux, &env, &|_| false), None);
    }

    #[test]
    fn mac_also_looks_in_the_users_applications_folder() {
        assert!(candidates(Os::Mac, &env).iter().any(|p| p.starts_with("/Users/me/Applications")));
    }
}
