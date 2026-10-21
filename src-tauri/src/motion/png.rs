//! Reads how much of a screenshot is drawn: used to reject a graphic that shows nothing or covers the video.
//! Only what Chrome writes is understood: 8-bit RGBA or RGB, not interlaced.

use crate::library::zip::inflate;

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Coverage {
    /// Share of pixels that are not fully transparent (0 to 1).
    pub drawn: f64,
    /// Share of pixels that are (nearly) opaque.
    pub solid: f64,
}

fn paeth(a: i32, b: i32, c: i32) -> i32 {
    let p = a + b - c;
    let (pa, pb, pc) = ((p - a).abs(), (p - b).abs(), (p - c).abs());
    if pa <= pb && pa <= pc { a } else if pb <= pc { b } else { c }
}

/// The coverage of a PNG, or an error text when the file is not one this reader understands.
pub fn coverage(png: &[u8]) -> Result<Coverage, String> {
    if png.len() < 33 || &png[..8] != b"\x89PNG\r\n\x1a\n" {
        return Err("not a PNG".into());
    }
    let (mut width, mut height, mut depth, mut color, mut interlace) = (0usize, 0usize, 0u8, 0u8, 0u8);
    let mut data = Vec::new();
    let mut at = 8;
    while at + 8 <= png.len() {
        let length = u32::from_be_bytes([png[at], png[at + 1], png[at + 2], png[at + 3]]) as usize;
        let kind = &png[at + 4..at + 8];
        let body = png.get(at + 8..at + 8 + length).ok_or("a PNG chunk is cut off")?;
        match kind {
            b"IHDR" if body.len() >= 13 => {
                width = u32::from_be_bytes([body[0], body[1], body[2], body[3]]) as usize;
                height = u32::from_be_bytes([body[4], body[5], body[6], body[7]]) as usize;
                (depth, color, interlace) = (body[8], body[9], body[12]);
            }
            b"IDAT" => data.extend_from_slice(body),
            b"IEND" => break,
            _ => {}
        }
        at += 12 + length;
    }
    let channels = match (color, depth) {
        (6, 8) => 4,
        (2, 8) => 3,
        _ => return Err(format!("PNG type {color}/{depth} is not supported")),
    };
    if interlace != 0 || width == 0 || height == 0 || width * height > 20_000_000 {
        return Err("PNG size or interlacing is not supported".into());
    }
    if data.len() < 6 {
        return Err("the PNG has no picture data".into());
    }
    let stride = width * channels;
    let raw = inflate(&data[2..], (stride + 1) * height + 16)?;
    if raw.len() < (stride + 1) * height {
        return Err("the PNG picture data is too short".into());
    }
    let mut previous = vec![0u8; stride];
    let mut line = vec![0u8; stride];
    let (mut drawn, mut solid) = (0usize, 0usize);
    for row in 0..height {
        let start = row * (stride + 1);
        let filter = raw[start];
        let source = &raw[start + 1..start + 1 + stride];
        for i in 0..stride {
            let a = if i >= channels { i32::from(line[i - channels]) } else { 0 };
            let b = i32::from(previous[i]);
            let c = if i >= channels { i32::from(previous[i - channels]) } else { 0 };
            let x = i32::from(source[i]);
            line[i] = match filter {
                0 => x,
                1 => x + a,
                2 => x + b,
                3 => x + (a + b) / 2,
                4 => x + paeth(a, b, c),
                _ => return Err("an unknown PNG filter".into()),
            } as u8;
        }
        if channels == 4 {
            for pixel in line.chunks_exact(4) {
                if pixel[3] > 0 {
                    drawn += 1;
                }
                if pixel[3] >= 250 {
                    solid += 1;
                }
            }
        } else {
            drawn += width;
            solid += width;
        }
        std::mem::swap(&mut previous, &mut line);
    }
    let total = (width * height) as f64;
    Ok(Coverage { drawn: drawn as f64 / total, solid: solid as f64 / total })
}

/// A rule for tests and for the checker: what a graphic may look like.
pub fn verdict(frames: &[Coverage]) -> Option<&'static str> {
    if frames.iter().all(|c| c.drawn < 0.0005) {
        return Some("The graphic drew nothing: every checked frame was fully transparent.");
    }
    if frames.iter().any(|c| c.solid > 0.5) {
        return Some("The graphic covers the screen with solid colour. Only the graphic itself may be drawn, on a transparent background.");
    }
    None
}

#[cfg(test)]
pub fn test_png(width: usize, height: usize, pixel: impl Fn(usize, usize) -> [u8; 4]) -> Vec<u8> {
    use crate::library::hash::crc32;
    let mut raw = Vec::new();
    for y in 0..height {
        raw.push(0);
        for x in 0..width {
            raw.extend_from_slice(&pixel(x, y));
        }
    }
    // zlib with stored blocks
    let mut z = vec![0x78, 0x01];
    for (index, chunk) in raw.chunks(65_535).enumerate() {
        let last = (index + 1) * 65_535 >= raw.len();
        z.push(u8::from(last));
        z.extend_from_slice(&(chunk.len() as u16).to_le_bytes());
        z.extend_from_slice(&(!(chunk.len() as u16)).to_le_bytes());
        z.extend_from_slice(chunk);
    }
    let (mut a, mut b) = (1u32, 0u32);
    for byte in &raw {
        a = (a + u32::from(*byte)) % 65_521;
        b = (b + a) % 65_521;
    }
    z.extend_from_slice(&((b << 16) | a).to_be_bytes());
    let chunk = |kind: &[u8; 4], body: &[u8]| {
        let mut out = (body.len() as u32).to_be_bytes().to_vec();
        let mut crc_input = kind.to_vec();
        crc_input.extend_from_slice(body);
        out.extend_from_slice(&crc_input);
        out.extend_from_slice(&crc32(&crc_input).to_be_bytes());
        out
    };
    let mut ihdr = Vec::new();
    ihdr.extend_from_slice(&(width as u32).to_be_bytes());
    ihdr.extend_from_slice(&(height as u32).to_be_bytes());
    ihdr.extend_from_slice(&[8, 6, 0, 0, 0]);
    let mut png = b"\x89PNG\r\n\x1a\n".to_vec();
    png.extend(chunk(b"IHDR", &ihdr));
    png.extend(chunk(b"IDAT", &z));
    png.extend(chunk(b"IEND", &[]));
    png
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn coverage_counts_drawn_and_solid_pixels() {
        let png = test_png(10, 10, |x, _| if x < 2 { [255, 0, 0, 255] } else if x < 4 { [0, 0, 0, 100] } else { [0, 0, 0, 0] });
        let c = coverage(&png).unwrap();
        assert!((c.drawn - 0.4).abs() < 1e-9 && (c.solid - 0.2).abs() < 1e-9, "{c:?}");
    }

    #[test]
    fn an_empty_picture_and_a_full_screen_picture_are_rejected() {
        let empty = coverage(&test_png(8, 8, |_, _| [0, 0, 0, 0])).unwrap();
        assert!(verdict(&[empty, empty]).is_some_and(|m| m.contains("nothing")));
        let full = coverage(&test_png(8, 8, |_, _| [9, 9, 9, 255])).unwrap();
        assert!(verdict(&[empty, full]).is_some_and(|m| m.contains("covers the screen")));
        let some = coverage(&test_png(8, 8, |x, y| if x < 3 && y < 3 { [1, 2, 3, 255] } else { [0, 0, 0, 0] })).unwrap();
        assert_eq!(verdict(&[empty, some]), None);
    }

    #[test]
    fn things_that_are_not_understood_are_errors_not_panics() {
        assert!(coverage(b"hello").is_err());
        let png = test_png(4, 4, |_, _| [0, 0, 0, 0]);
        assert!(coverage(&png[..png.len() / 2]).is_err());
    }
}
