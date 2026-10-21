//! Crash-safe files. A file that exists under its final name is always complete: data is written
//! next to it, flushed to disk, then renamed over the target. JSON files also keep the previous good
//! copy as `<name>.bak`, which is read when the main file is damaged.

use std::fs::{self, File, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};

use serde::de::DeserializeOwned;
use serde::Serialize;

fn sibling(path: &Path, suffix: &str) -> PathBuf {
    let mut name = path.file_name().map(|n| n.to_os_string()).unwrap_or_default();
    name.push(suffix);
    path.with_file_name(name)
}

/// Writes `data` to `path` so that it is either not there or whole, even after a power cut.
pub fn write_durable(path: &Path, data: &[u8]) -> io::Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let part = sibling(path, ".part");
    {
        let mut file = OpenOptions::new().write(true).create(true).truncate(true).open(&part)?;
        file.write_all(data)?;
        file.sync_all()?;
    }
    fs::rename(&part, path).or_else(|first| {
        // Windows can refuse to rename over a file an antivirus is looking at for a moment.
        std::thread::sleep(std::time::Duration::from_millis(60));
        fs::rename(&part, path).map_err(|_| first)
    })?;
    sync_parent(path);
    Ok(())
}

/// Makes the rename itself durable (Unix). A no-op where folders cannot be opened.
fn sync_parent(path: &Path) {
    if let Some(parent) = path.parent() {
        if let Ok(dir) = File::open(parent) {
            let _ = dir.sync_all();
        }
    }
}

/// Saves a value as JSON, keeping the previous file as `<name>.bak`.
pub fn save_json<T: Serialize>(path: &Path, value: &T) -> io::Result<()> {
    let text = serde_json::to_vec_pretty(value).map_err(io::Error::other)?;
    if path.exists() {
        let _ = fs::copy(path, sibling(path, ".bak"));
    }
    write_durable(path, &text)
}

fn read_json<T: DeserializeOwned>(path: &Path) -> Option<T> {
    let text = fs::read_to_string(path).ok()?;
    serde_json::from_str(text.trim_start_matches('\u{feff}')).ok()
}

/// Reads a JSON file, or its `.bak` when the file is missing or damaged. `None` when neither works.
pub fn load_json<T: DeserializeOwned>(path: &Path) -> Option<T> {
    read_json(path).or_else(|| read_json(&sibling(path, ".bak")))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde::Deserialize;

    #[derive(Debug, PartialEq, Serialize, Deserialize)]
    struct Sample {
        n: u32,
    }

    fn temp(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("ave-imagegen-store-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn durable_writes_leave_no_part_file_and_replace_the_old_content() {
        let dir = temp("write");
        let file = dir.join("a.bin");
        write_durable(&file, b"one").unwrap();
        write_durable(&file, b"two").unwrap();
        assert_eq!(fs::read(&file).unwrap(), b"two");
        assert!(!dir.join("a.bin.part").exists());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn json_comes_back_and_a_damaged_file_falls_back_to_the_backup() {
        let dir = temp("json");
        let file = dir.join("s.json");
        assert_eq!(load_json::<Sample>(&file), None);
        save_json(&file, &Sample { n: 1 }).unwrap();
        save_json(&file, &Sample { n: 2 }).unwrap();
        assert_eq!(load_json::<Sample>(&file), Some(Sample { n: 2 }));
        fs::write(&file, b"{ torn").unwrap();
        assert_eq!(load_json::<Sample>(&file), Some(Sample { n: 1 }), "the previous good copy is used");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn parent_folders_are_created() {
        let dir = temp("parent");
        let file = dir.join("deep/er/x.json");
        save_json(&file, &Sample { n: 7 }).unwrap();
        assert_eq!(load_json::<Sample>(&file), Some(Sample { n: 7 }));
        let _ = fs::remove_dir_all(&dir);
    }
}
