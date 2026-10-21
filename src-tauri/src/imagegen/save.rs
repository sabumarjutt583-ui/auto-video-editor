//! Saving a finished picture into the project's `media` folder, safely.
//!
//! Rules: a file with its final name is always whole (see `store::write_durable`); the same picture is
//! never saved twice (identical bytes under the wanted name count as already saved); a different file
//! is never overwritten (the caller picks `name (2).png`, see `queue::unique_target`).

use std::fs;
use std::path::Path;
use std::process::Stdio;

use super::store::write_durable;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Format {
    Png,
    Jpeg,
    Webp,
}

/// Looks at the first bytes. Returns `None` for anything that is not PNG, JPEG or WebP.
pub fn sniff(bytes: &[u8]) -> Option<Format> {
    if bytes.len() < 100 {
        return None;
    }
    if bytes.starts_with(&[0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a]) {
        Some(Format::Png)
    } else if bytes.starts_with(&[0xff, 0xd8, 0xff]) {
        Some(Format::Jpeg)
    } else if bytes.len() > 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        Some(Format::Webp)
    } else {
        None
    }
}

/// Width and height from the PNG header.
pub fn png_size(bytes: &[u8]) -> Option<(u32, u32)> {
    if sniff(bytes) != Some(Format::Png) || bytes.len() < 24 || &bytes[12..16] != b"IHDR" {
        return None;
    }
    let width = u32::from_be_bytes(bytes[16..20].try_into().ok()?);
    let height = u32::from_be_bytes(bytes[20..24].try_into().ok()?);
    (width > 0 && height > 0).then_some((width, height))
}

/// `16:9` -> 1.777..; anything unknown -> `None`.
pub fn aspect_value(aspect: &str) -> Option<f64> {
    match aspect {
        "16:9" => Some(16.0 / 9.0),
        "9:16" => Some(9.0 / 16.0),
        "1:1" => Some(1.0),
        _ => None,
    }
}

/// The centre crop `(width, height, x, y)` that gives the wanted ratio, or `None` when the picture is
/// already within 2 % of it.
pub fn center_crop(width: u32, height: u32, aspect: &str) -> Option<(u32, u32, u32, u32)> {
    let wanted = aspect_value(aspect)?;
    if width == 0 || height == 0 {
        return None;
    }
    let actual = f64::from(width) / f64::from(height);
    if (actual - wanted).abs() / wanted <= 0.02 {
        return None;
    }
    let (mut w, mut h) = (width, height);
    if actual > wanted {
        w = (f64::from(height) * wanted).round() as u32;
    } else {
        h = (f64::from(width) / wanted).round() as u32;
    }
    // Even numbers keep every encoder happy.
    w = (w & !1).max(2).min(width);
    h = (h & !1).max(2).min(height);
    Some((w, h, (width - w) / 2, (height - h) / 2))
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Saved {
    /// Written now.
    New,
    /// The same bytes were already there (a repeated save after a crash).
    Same,
}

#[derive(Debug)]
pub enum SaveError {
    /// A different file already has this name: choose another one.
    Taken,
    Io(String),
}

/// Writes `bytes` to `<media_dir>/<target>`.
pub fn save_new(media_dir: &Path, target: &str, bytes: &[u8]) -> Result<Saved, SaveError> {
    if target.is_empty() || target.contains(['/', '\\']) || target.starts_with('.') {
        return Err(SaveError::Io(format!("The file name \"{target}\" is not allowed.")));
    }
    let path = media_dir.join(target);
    if path.exists() {
        return match fs::read(&path) {
            Ok(existing) if existing == bytes => Ok(Saved::Same),
            Ok(_) => Err(SaveError::Taken),
            Err(error) => Err(SaveError::Io(error.to_string())),
        };
    }
    write_durable(&path, bytes).map_err(|e| SaveError::Io(e.to_string()))?;
    Ok(Saved::New)
}

/// Removes `*.png.part` files an interrupted save left behind.
pub fn clean_partial(media_dir: &Path) -> usize {
    let Ok(entries) = fs::read_dir(media_dir) else { return 0 };
    let mut removed = 0;
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if name.ends_with(".png.part") && fs::remove_file(entry.path()).is_ok() {
            removed += 1;
        }
    }
    removed
}

/// Turns any picture into a PNG, centre-cropped to `aspect` when it is more than 2 % off.
/// PNGs that already fit are returned unchanged and need no FFmpeg.
pub async fn normalize(bytes: Vec<u8>, aspect: &str, work_dir: &Path) -> Result<Vec<u8>, String> {
    let format = sniff(&bytes).ok_or_else(|| "The picture is not a PNG, JPEG or WebP image.".to_string())?;
    let crop = match (format, png_size(&bytes)) {
        (Format::Png, Some((w, h))) => {
            let crop = center_crop(w, h, aspect);
            if crop.is_none() {
                return Ok(bytes);
            }
            crop
        }
        _ => None,
    };
    fs::create_dir_all(work_dir).map_err(|e| e.to_string())?;
    let stamp = format!("{}-{:x}", std::process::id(), bytes.len());
    let input = work_dir.join(format!("in-{stamp}.img"));
    let output = work_dir.join(format!("out-{stamp}.png"));
    fs::write(&input, &bytes).map_err(|e| e.to_string())?;
    let result = run_ffmpeg(&input, &output, crop, aspect, format).await;
    let data = result.and_then(|()| fs::read(&output).map_err(|e| e.to_string()));
    let _ = fs::remove_file(&input);
    let _ = fs::remove_file(&output);
    let data = data?;
    if sniff(&data) != Some(Format::Png) {
        return Err("The picture could not be converted to PNG.".to_string());
    }
    Ok(data)
}

async fn run_ffmpeg(input: &Path, output: &Path, crop: Option<(u32, u32, u32, u32)>, aspect: &str, format: Format) -> Result<(), String> {
    let mut command = crate::ffmpeg::command(crate::ffmpeg::Tool::Ffmpeg).map_err(|e| format!("{e:?}"))?;
    command.args(["-hide_banner", "-nostdin", "-y", "-loglevel", "error", "-i"]).arg(input);
    if let Some((w, h, x, y)) = crop {
        command.args(["-vf", &format!("crop={w}:{h}:{x}:{y}")]);
    } else if format != Format::Png {
        // Size is unknown for JPEG/WebP: let FFmpeg compute the centre crop.
        if let Some(wanted) = aspect_value(aspect) {
            let filter = format!("crop='if(gt(iw/ih,{wanted:.6}),trunc(ih*{wanted:.6}/2)*2,iw)':'if(gt(iw/ih,{wanted:.6}),ih,trunc(iw/{wanted:.6}/2)*2)'");
            command.args(["-vf", &filter]);
        }
    }
    command.args(["-frames:v", "1"]).arg(output).stdout(Stdio::null()).stderr(Stdio::piped());
    let out = command.output().await.map_err(|e| e.to_string())?;
    if out.status.success() {
        Ok(())
    } else {
        Err(String::from_utf8_lossy(&out.stderr).chars().take(600).collect())
    }
}

#[cfg(test)]
pub fn tiny_png(width: u32, height: u32) -> Vec<u8> {
    // Header only is enough for the size reader; padded to pass the minimum length.
    let mut bytes = vec![0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, b'I', b'H', b'D', b'R'];
    bytes.extend_from_slice(&width.to_be_bytes());
    bytes.extend_from_slice(&height.to_be_bytes());
    bytes.resize(200, 7);
    bytes
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("ave-save-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn sniffs_formats_and_rejects_junk() {
        assert_eq!(sniff(&tiny_png(10, 10)), Some(Format::Png));
        let mut jpeg = vec![0xff, 0xd8, 0xff, 0xe0];
        jpeg.resize(150, 0);
        assert_eq!(sniff(&jpeg), Some(Format::Jpeg));
        let mut webp = b"RIFF\0\0\0\0WEBPVP8 ".to_vec();
        webp.resize(150, 0);
        assert_eq!(sniff(&webp), Some(Format::Webp));
        assert_eq!(sniff(b"<html>error</html>"), None);
        assert_eq!(sniff(&vec![0u8; 500]), None);
    }

    #[test]
    fn reads_the_png_size() {
        assert_eq!(png_size(&tiny_png(1920, 1080)), Some((1920, 1080)));
        assert_eq!(png_size(&tiny_png(0, 5)), None);
        assert_eq!(png_size(&[1, 2, 3]), None);
    }

    #[test]
    fn crops_only_when_more_than_two_percent_off() {
        assert_eq!(center_crop(1920, 1080, "16:9"), None);
        assert_eq!(center_crop(1900, 1080, "16:9"), None, "1.759 is within 2 %");
        assert_eq!(center_crop(1024, 1024, "16:9"), Some((1024, 576, 0, 224)));
        assert_eq!(center_crop(1920, 1080, "1:1"), Some((1080, 1080, 420, 0)));
        assert_eq!(center_crop(1920, 1080, "9:16"), Some((608, 1080, 656, 0)));
        assert_eq!(center_crop(100, 100, "4:3"), None, "unknown ratios are left alone");
    }

    #[test]
    fn saves_once_and_never_overwrites_a_different_file() {
        let dir = temp("once");
        let png = tiny_png(16, 9);
        assert!(matches!(save_new(&dir, "S01_000.0-005.1.png", &png), Ok(Saved::New)));
        assert!(matches!(save_new(&dir, "S01_000.0-005.1.png", &png), Ok(Saved::Same)));
        let other = tiny_png(32, 18);
        assert!(matches!(save_new(&dir, "S01_000.0-005.1.png", &other), Err(SaveError::Taken)));
        assert_eq!(fs::read(dir.join("S01_000.0-005.1.png")).unwrap(), png);
        assert!(!dir.join("S01_000.0-005.1.png.part").exists());
    }

    #[test]
    fn refuses_names_that_leave_the_folder() {
        let dir = temp("names");
        for bad in ["../x.png", "a/b.png", "a\\b.png", ".hidden.png", ""] {
            assert!(matches!(save_new(&dir, bad, &tiny_png(1, 1)), Err(SaveError::Io(_))), "{bad}");
        }
    }

    #[test]
    fn cleans_partial_files_only() {
        let dir = temp("part");
        fs::write(dir.join("S01_000.0-005.1.png.part"), b"x").unwrap();
        fs::write(dir.join("S01_000.0-005.1.png"), b"y").unwrap();
        assert_eq!(clean_partial(&dir), 1);
        assert!(dir.join("S01_000.0-005.1.png").exists());
    }

    #[tokio::test]
    async fn a_png_that_fits_is_returned_untouched() {
        let dir = temp("norm");
        let png = tiny_png(1920, 1080);
        assert_eq!(normalize(png.clone(), "16:9", &dir).await.unwrap(), png);
        assert!(normalize(b"not an image at all".to_vec(), "16:9", &dir).await.is_err());
    }
}
