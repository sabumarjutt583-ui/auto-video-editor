//! The reference pictures of a custom style: checking, shrinking (max 1024 px JPEG with the bundled FFmpeg) and keeping
//! them in `<styles folder>/refs/<style id>/` next to a small `meta.json`.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tokio::time::timeout;

use crate::commands::error::AppError;

pub const MIN_IMAGES: usize = 3;
pub const MAX_IMAGES: usize = 4;
pub const MAX_BYTES: u64 = 10 * 1024 * 1024;
pub const MAX_SIDE: u32 = 1024;
const TIMEOUT: Duration = Duration::from_secs(60);
const META_FILE: &str = "meta.json";
const FOLDER: &str = "refs";
const STALE_AFTER: Duration = Duration::from_secs(24 * 3600);

/// A picture ready to be sent to an AI: a JPEG of at most 1024 px on its longest side.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreparedImage {
    pub path: String,
    /// The name of the file the person chose (shown on the thumbnail).
    pub name: String,
}

/// What is kept next to the pictures.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct Meta {
    /// The words the person wrote about the look.
    pub description: String,
    /// "gemini", "openai" or "chat": what analyzed the pictures last.
    pub engine: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StyleRefs {
    pub images: Vec<PreparedImage>,
    pub description: String,
    pub engine: String,
}

pub fn refs_root(custom_dir: &Path) -> PathBuf {
    custom_dir.join(FOLDER)
}

pub fn refs_dir(custom_dir: &Path, id: &str) -> PathBuf {
    refs_root(custom_dir).join(id)
}

/// True when `path` is a file inside `dir` (after resolving `..` and links).
pub fn is_inside(dir: &Path, path: &Path) -> bool {
    match (fs::canonicalize(dir), fs::canonicalize(path)) {
        (Ok(dir), Ok(path)) => path.starts_with(dir) && path.is_file(),
        _ => false,
    }
}

fn is_allowed_extension(path: &Path) -> bool {
    path.extension().and_then(|e| e.to_str()).is_some_and(|e| ["png", "jpg", "jpeg", "webp"].contains(&e.to_ascii_lowercase().as_str()))
}

fn shown_name(path: &Path) -> String {
    path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default()
}

/// Checks a picture the person chose: PNG, JPG or WebP, not empty, at most 10 MB.
pub fn check_source(path: &Path) -> Result<(), AppError> {
    let name = shown_name(path);
    if !is_allowed_extension(path) {
        return Err(AppError::new(format!("“{name}” is not a PNG, JPG or WebP picture."), format!("extension of {}", path.display())));
    }
    let size = fs::metadata(path).map_err(|e| AppError::new(format!("“{name}” could not be read."), format!("{e} ({})", path.display())))?.len();
    if size == 0 {
        return Err(AppError::new(format!("“{name}” is empty."), "0 bytes"));
    }
    if size > MAX_BYTES {
        return Err(AppError::new(format!("“{name}” is bigger than 10 MB. Please choose a smaller picture."), format!("{size} bytes")));
    }
    Ok(())
}

/// FFmpeg options: shrink to fit 1024x1024 (never enlarge), one JPEG frame.
pub fn ffmpeg_args(input: &Path, output: &Path) -> Vec<String> {
    let filter = format!("scale=w='min({MAX_SIDE},iw)':h='min({MAX_SIDE},ih)':force_original_aspect_ratio=decrease,format=yuvj420p");
    ["-y", "-v", "error", "-i"].iter().map(|s| (*s).to_string()).chain([
        input.to_string_lossy().into_owned(),
        "-vf".into(),
        filter,
        "-frames:v".into(),
        "1".into(),
        "-q:v".into(),
        "3".into(),
        output.to_string_lossy().into_owned(),
    ]).collect()
}

fn unique_name() -> String {
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let nanos = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_nanos());
    format!("ref_{nanos}_{}.jpg", COUNTER.fetch_add(1, Ordering::SeqCst))
}

/// Removes prepared pictures that are more than a day old (people close the window without saving).
pub fn clean_stale(prep_dir: &Path) {
    let Ok(entries) = fs::read_dir(prep_dir) else { return };
    for entry in entries.flatten() {
        let old = entry.metadata().and_then(|m| m.modified()).ok().and_then(|t| t.elapsed().ok()).is_some_and(|age| age > STALE_AFTER);
        if old {
            let _ = fs::remove_file(entry.path());
        }
    }
}

/// Checks one picture and writes a shrunk JPEG copy into `prep_dir`.
pub async fn prepare(mut cmd: tokio::process::Command, input: &Path, prep_dir: &Path) -> Result<PreparedImage, AppError> {
    check_source(input)?;
    let name = shown_name(input);
    fs::create_dir_all(prep_dir).map_err(|e| AppError::new("The picture folder could not be created.", format!("{e} ({})", prep_dir.display())))?;
    clean_stale(prep_dir);
    let output = prep_dir.join(unique_name());
    cmd.args(ffmpeg_args(input, &output));
    let out = timeout(TIMEOUT, cmd.output())
        .await
        .map_err(|_| AppError::new(format!("“{name}” took too long to prepare."), input.display().to_string()))?
        .map_err(|e| AppError::new("The video engine (FFmpeg) could not start.", e.to_string()))?;
    if !out.status.success() || !output.is_file() {
        let _ = fs::remove_file(&output);
        return Err(AppError::new(format!("“{name}” could not be read as a picture. It may be damaged."), String::from_utf8_lossy(&out.stderr).trim().to_string()));
    }
    Ok(PreparedImage { path: output.to_string_lossy().into_owned(), name })
}

/// Keeps `sources` (prepared pictures) as the references of style `id`, replacing earlier ones. All pictures are read
/// first, so a source may be one of the style's own current pictures.
pub fn store(custom_dir: &Path, id: &str, sources: &[PathBuf], meta: &Meta) -> Result<Vec<PathBuf>, AppError> {
    if sources.is_empty() || sources.len() > MAX_IMAGES {
        return Err(AppError::new(format!("A style keeps 1 to {MAX_IMAGES} reference pictures."), format!("{} pictures", sources.len())));
    }
    let mut data = Vec::new();
    for source in sources {
        data.push(fs::read(source).map_err(|e| AppError::new("A reference picture could not be read.", format!("{e} ({})", source.display())))?);
    }
    let target = refs_dir(custom_dir, id);
    let temp = refs_root(custom_dir).join(format!("{id}.tmp"));
    let _ = fs::remove_dir_all(&temp);
    fs::create_dir_all(&temp).map_err(|e| AppError::new("The reference folder could not be created.", format!("{e} ({})", temp.display())))?;
    for (index, bytes) in data.iter().enumerate() {
        fs::write(temp.join(format!("ref{}.jpg", index + 1)), bytes).map_err(|e| AppError::new("A reference picture could not be saved.", e.to_string()))?;
    }
    let text = serde_json::to_string_pretty(meta).map_err(|e| AppError::new("The style notes could not be saved.", e.to_string()))?;
    fs::write(temp.join(META_FILE), text + "\n").map_err(|e| AppError::new("The style notes could not be saved.", e.to_string()))?;
    let _ = fs::remove_dir_all(&target);
    fs::rename(&temp, &target).map_err(|e| AppError::new("The reference pictures could not be saved.", format!("{e} ({})", target.display())))?;
    Ok((1..=data.len()).map(|n| target.join(format!("ref{n}.jpg"))).collect())
}

/// The pictures and notes of a style, or None when it has none.
pub fn load(custom_dir: &Path, id: &str) -> Option<StyleRefs> {
    let dir = refs_dir(custom_dir, id);
    let mut files: Vec<PathBuf> = fs::read_dir(&dir).ok()?.flatten().map(|e| e.path()).filter(|p| p.extension().is_some_and(|e| e == "jpg")).collect();
    files.sort_by_key(|p| p.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default());
    if files.is_empty() {
        return None;
    }
    let meta: Meta = fs::read_to_string(dir.join(META_FILE)).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default();
    let images = files.iter().map(|p| PreparedImage { path: p.to_string_lossy().into_owned(), name: shown_name(p) }).collect();
    Some(StyleRefs { images, description: meta.description, engine: meta.engine })
}

pub fn remove(custom_dir: &Path, id: &str) {
    let _ = fs::remove_dir_all(refs_dir(custom_dir, id));
}

/// Copies the pictures and notes of one style to another (Duplicate).
pub fn copy(custom_dir: &Path, from: &str, to: &str) -> Result<(), AppError> {
    let Some(refs) = load(custom_dir, from) else { return Ok(()) };
    let sources: Vec<PathBuf> = refs.images.iter().map(|i| PathBuf::from(&i.path)).collect();
    store(custom_dir, to, &sources, &Meta { description: refs.description, engine: refs.engine }).map(|_| ())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("ave-refs-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn pictures_must_be_png_jpg_or_webp_and_at_most_10_mb() {
        let dir = temp("check");
        let good = dir.join("a.PNG");
        fs::write(&good, b"x").unwrap();
        assert!(check_source(&good).is_ok());
        let gif = dir.join("a.gif");
        fs::write(&gif, b"x").unwrap();
        assert!(check_source(&gif).unwrap_err().message.contains("PNG, JPG or WebP"));
        let empty = dir.join("e.jpg");
        fs::write(&empty, b"").unwrap();
        assert!(check_source(&empty).unwrap_err().message.contains("empty"));
        let big = dir.join("big.jpg");
        fs::write(&big, vec![0u8; (MAX_BYTES + 1) as usize]).unwrap();
        assert!(check_source(&big).unwrap_err().message.contains("10 MB"));
        assert!(check_source(&dir.join("missing.jpg")).is_err());
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn the_shrink_options_never_enlarge_and_make_a_jpeg() {
        let args = ffmpeg_args(Path::new("in.webp"), Path::new("out.jpg"));
        let filter = args.iter().find(|a| a.starts_with("scale=")).unwrap();
        assert!(filter.contains("min(1024,iw)") && filter.contains("min(1024,ih)") && filter.contains("decrease"));
        assert_eq!(args.last().map(String::as_str), Some("out.jpg"));
    }

    #[test]
    fn references_are_stored_loaded_replaced_copied_and_removed() {
        let dir = temp("store");
        let sources: Vec<PathBuf> = (1..=3)
            .map(|n| {
                let p = dir.join(format!("src{n}.jpg"));
                fs::write(&p, format!("picture {n}")).unwrap();
                p
            })
            .collect();
        assert!(load(&dir, "custom_a").is_none());
        let kept = store(&dir, "custom_a", &sources, &Meta { description: "soft".into(), engine: "gemini".into() }).unwrap();
        assert_eq!(kept.len(), 3);
        let loaded = load(&dir, "custom_a").unwrap();
        assert_eq!((loaded.images.len(), loaded.description.as_str(), loaded.engine.as_str()), (3, "soft", "gemini"));
        assert_eq!(fs::read_to_string(&loaded.images[1].path).unwrap(), "picture 2");
        assert!(is_inside(&refs_dir(&dir, "custom_a"), Path::new(&loaded.images[0].path)));
        assert!(!is_inside(&refs_dir(&dir, "custom_a"), &sources[0]));

        // A source may be one of the style's own pictures (Edit then Save).
        let own: Vec<PathBuf> = loaded.images.iter().take(2).map(|i| PathBuf::from(&i.path)).collect();
        store(&dir, "custom_a", &own, &Meta::default()).unwrap();
        assert_eq!(load(&dir, "custom_a").unwrap().images.len(), 2);

        copy(&dir, "custom_a", "custom_b").unwrap();
        assert_eq!(load(&dir, "custom_b").unwrap().images.len(), 2);
        remove(&dir, "custom_a");
        assert!(load(&dir, "custom_a").is_none());
        assert!(load(&dir, "custom_b").is_some());
        assert!(store(&dir, "custom_c", &[], &Meta::default()).is_err());
        assert!(store(&dir, "custom_c", &vec![sources[0].clone(); 5], &Meta::default()).is_err());
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn a_path_outside_the_folder_is_not_inside_even_with_dots() {
        let dir = temp("inside");
        let sub = dir.join("sub");
        fs::create_dir_all(&sub).unwrap();
        let outside = dir.join("o.jpg");
        fs::write(&outside, b"x").unwrap();
        assert!(!is_inside(&sub, &sub.join("..").join("o.jpg")));
        assert!(!is_inside(&sub, &sub.join("nothing.jpg")));
        let _ = fs::remove_dir_all(dir);
    }

    /// Needs a system FFmpeg; skipped when there is none.
    #[tokio::test]
    async fn a_big_picture_is_shrunk_to_1024_and_a_small_one_is_not_enlarged() {
        let Some(ffmpeg) = ["/usr/bin/ffmpeg", "/usr/local/bin/ffmpeg"].iter().find(|p| Path::new(p).is_file()) else { return };
        let dir = temp("prepare");
        let big = dir.join("big.png");
        let small = dir.join("small.png");
        for (path, size) in [(&big, "2000x1000"), (&small, "320x200")] {
            let made = std::process::Command::new(ffmpeg).args(["-v", "error", "-f", "lavfi", "-i", &format!("testsrc=size={size}:rate=1"), "-frames:v", "1", "-y"]).arg(path).status();
            if !made.map(|s| s.success()).unwrap_or(false) {
                return;
            }
        }
        let prep = dir.join("prep");
        let size_of = |p: &str| {
            let probe = std::process::Command::new(ffmpeg).args(["-hide_banner", "-i", p]).output().unwrap();
            let info = crate::probe::parse_info(&String::from_utf8_lossy(&probe.stderr));
            let video = info.first(crate::probe::StreamKind::Video).expect("a picture");
            (video.width, video.height)
        };
        let a = prepare(tokio::process::Command::new(ffmpeg), &big, &prep).await.unwrap();
        assert_eq!(a.name, "big.png");
        assert!(a.path.ends_with(".jpg"));
        assert_eq!(size_of(&a.path), (1024, 512));
        let b = prepare(tokio::process::Command::new(ffmpeg), &small, &prep).await.unwrap();
        assert_eq!(size_of(&b.path), (320, 200));
        let broken = dir.join("broken.png");
        fs::write(&broken, b"not a picture").unwrap();
        assert!(prepare(tokio::process::Command::new(ffmpeg), &broken, &prep).await.unwrap_err().message.contains("could not be read as a picture"));
        let _ = fs::remove_dir_all(dir);
    }
}
