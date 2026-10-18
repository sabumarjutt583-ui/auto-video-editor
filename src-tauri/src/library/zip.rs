//! Reading and writing ZIP files without extra libraries. Reading handles "stored" and "deflate" entries,
//! which is what every zip program makes. Writing makes "stored" entries only (sound files hardly shrink).

use super::hash::crc32;

const LOCAL_SIG: u32 = 0x0403_4b50;
const CENTRAL_SIG: u32 = 0x0201_4b50;
const END_SIG: u32 = 0x0605_4b50;

/// Limits that keep a damaged or hostile package from filling the disk or the memory.
pub const MAX_ENTRIES: usize = 5000;
pub const MAX_TOTAL_BYTES: u64 = 600 * 1024 * 1024;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ZipEntry {
    pub name: String,
    pub data: Vec<u8>,
}

// ---------- inflate (RFC 1951) ----------

struct Bits<'a> {
    data: &'a [u8],
    position: usize,
    buffer: u32,
    count: u32,
}

impl<'a> Bits<'a> {
    fn new(data: &'a [u8]) -> Self {
        Self { data, position: 0, buffer: 0, count: 0 }
    }

    fn bits(&mut self, need: u32) -> Result<u32, String> {
        while self.count < need {
            let byte = *self.data.get(self.position).ok_or("The compressed data ends too early.")?;
            self.position += 1;
            self.buffer |= u32::from(byte) << self.count;
            self.count += 8;
        }
        let value = if need == 0 { 0 } else { self.buffer & ((1u32 << need) - 1) };
        self.buffer = if need >= 32 { 0 } else { self.buffer >> need };
        self.count -= need;
        Ok(value)
    }

    fn align(&mut self) {
        self.buffer = 0;
        self.count = 0;
    }
}

struct Huffman {
    count: [u16; 16],
    symbol: Vec<u16>,
}

impl Huffman {
    fn new(lengths: &[u8]) -> Result<Self, String> {
        let mut count = [0u16; 16];
        for &l in lengths {
            count[usize::from(l)] += 1;
        }
        let mut left: i32 = 1;
        for len in 1..16 {
            left <<= 1;
            left -= i32::from(count[len]);
            if left < 0 {
                return Err("The compressed data is damaged (bad code lengths).".into());
            }
        }
        let mut offsets = [0u16; 16];
        for len in 1..15 {
            offsets[len + 1] = offsets[len] + count[len];
        }
        let mut symbol = vec![0u16; lengths.len()];
        for (sym, &l) in lengths.iter().enumerate() {
            if l != 0 {
                symbol[usize::from(offsets[usize::from(l)])] = sym as u16;
                offsets[usize::from(l)] += 1;
            }
        }
        Ok(Self { count, symbol })
    }

    fn decode(&self, bits: &mut Bits) -> Result<u16, String> {
        let (mut code, mut first, mut index) = (0i32, 0i32, 0i32);
        for len in 1..16 {
            code |= bits.bits(1)? as i32;
            let count = i32::from(self.count[len]);
            if code - count < first {
                return self.symbol.get((index + (code - first)) as usize).copied().ok_or_else(|| "The compressed data is damaged.".to_string());
            }
            index += count;
            first += count;
            first <<= 1;
            code <<= 1;
        }
        Err("The compressed data is damaged (bad code).".into())
    }
}

const LENGTH_BASE: [u16; 29] = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
const LENGTH_EXTRA: [u8; 29] = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
const DIST_BASE: [u16; 30] = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
const DIST_EXTRA: [u8; 30] = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];

fn codes(bits: &mut Bits, out: &mut Vec<u8>, limit: usize, literals: &Huffman, distances: &Huffman) -> Result<(), String> {
    loop {
        let symbol = literals.decode(bits)?;
        match symbol {
            0..=255 => {
                if out.len() >= limit {
                    return Err("The file is bigger than it says.".into());
                }
                out.push(symbol as u8);
            }
            256 => return Ok(()),
            257..=285 => {
                let s = usize::from(symbol - 257);
                let length = usize::from(LENGTH_BASE[s]) + bits.bits(u32::from(LENGTH_EXTRA[s]))? as usize;
                let d = usize::from(distances.decode(bits)?);
                if d >= 30 {
                    return Err("The compressed data is damaged (bad distance).".into());
                }
                let distance = usize::from(DIST_BASE[d]) + bits.bits(u32::from(DIST_EXTRA[d]))? as usize;
                if distance > out.len() {
                    return Err("The compressed data is damaged (distance too far back).".into());
                }
                if out.len() + length > limit {
                    return Err("The file is bigger than it says.".into());
                }
                for _ in 0..length {
                    out.push(out[out.len() - distance]);
                }
            }
            _ => return Err("The compressed data is damaged (bad symbol).".into()),
        }
    }
}

/// Unpacks raw deflate data. Gives an error if the result would be longer than `limit` bytes.
pub fn inflate(data: &[u8], limit: usize) -> Result<Vec<u8>, String> {
    let mut bits = Bits::new(data);
    let mut out = Vec::new();
    loop {
        let last = bits.bits(1)?;
        match bits.bits(2)? {
            0 => {
                bits.align();
                let header = data.get(bits.position..bits.position + 4).ok_or("The compressed data ends too early.")?;
                let len = usize::from(u16::from_le_bytes([header[0], header[1]]));
                let inverse = u16::from_le_bytes([header[2], header[3]]);
                if inverse != !(len as u16) {
                    return Err("The compressed data is damaged (stored block).".into());
                }
                let start = bits.position + 4;
                let block = data.get(start..start + len).ok_or("The compressed data ends too early.")?;
                if out.len() + len > limit {
                    return Err("The file is bigger than it says.".into());
                }
                out.extend_from_slice(block);
                bits.position = start + len;
            }
            1 => {
                let mut lengths = [0u8; 288];
                for (i, l) in lengths.iter_mut().enumerate() {
                    *l = match i {
                        0..=143 => 8,
                        144..=255 => 9,
                        256..=279 => 7,
                        _ => 8,
                    };
                }
                codes(&mut bits, &mut out, limit, &Huffman::new(&lengths)?, &Huffman::new(&[5u8; 30])?)?;
            }
            2 => {
                let nlen = bits.bits(5)? as usize + 257;
                let ndist = bits.bits(5)? as usize + 1;
                let ncode = bits.bits(4)? as usize + 4;
                if nlen > 286 || ndist > 30 {
                    return Err("The compressed data is damaged (too many codes).".into());
                }
                const ORDER: [usize; 19] = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];
                let mut lengths = [0u8; 19];
                for &slot in ORDER.iter().take(ncode) {
                    lengths[slot] = bits.bits(3)? as u8;
                }
                let code_lengths = Huffman::new(&lengths)?;
                let mut all = vec![0u8; nlen + ndist];
                let mut i = 0;
                while i < nlen + ndist {
                    let symbol = code_lengths.decode(&mut bits)?;
                    if symbol < 16 {
                        all[i] = symbol as u8;
                        i += 1;
                    } else {
                        let (value, repeat) = match symbol {
                            16 => {
                                if i == 0 {
                                    return Err("The compressed data is damaged (bad repeat).".into());
                                }
                                (all[i - 1], 3 + bits.bits(2)? as usize)
                            }
                            17 => (0, 3 + bits.bits(3)? as usize),
                            _ => (0, 11 + bits.bits(7)? as usize),
                        };
                        if i + repeat > nlen + ndist {
                            return Err("The compressed data is damaged (bad repeat).".into());
                        }
                        for _ in 0..repeat {
                            all[i] = value;
                            i += 1;
                        }
                    }
                }
                codes(&mut bits, &mut out, limit, &Huffman::new(&all[..nlen])?, &Huffman::new(&all[nlen..])?)?;
            }
            _ => return Err("The compressed data is damaged (bad block type).".into()),
        }
        if last == 1 {
            return Ok(out);
        }
    }
}

// ---------- zip ----------

fn u16_at(data: &[u8], at: usize) -> Result<usize, String> {
    data.get(at..at + 2).map(|b| usize::from(u16::from_le_bytes([b[0], b[1]]))).ok_or_else(|| "The zip file is cut off.".to_string())
}

fn u32_at(data: &[u8], at: usize) -> Result<u32, String> {
    data.get(at..at + 4).map(|b| u32::from_le_bytes([b[0], b[1], b[2], b[3]])).ok_or_else(|| "The zip file is cut off.".to_string())
}

/// A name that can only point inside the folder it is unpacked into.
pub fn safe_name(name: &str) -> bool {
    !name.is_empty()
        && !name.starts_with('/')
        && !name.contains('\\')
        && !name.contains('\0')
        && !name.contains(':')
        && name.split('/').all(|part| !part.is_empty() && part != "." && part != "..")
}

/// Every file in a zip (folders are skipped). Checks sizes, CRC-32 and that names stay inside the folder.
pub fn read_zip(data: &[u8]) -> Result<Vec<ZipEntry>, String> {
    let cut_off = || "This is not a valid zip file.".to_string();
    let search_from = data.len().saturating_sub(22 + 65_535);
    let end = (search_from..=data.len().saturating_sub(22)).rev().find(|&i| u32_at(data, i).ok() == Some(END_SIG)).ok_or_else(cut_off)?;
    let total = u16_at(data, end + 10)?;
    let mut at = u32_at(data, end + 16)? as usize;
    if total > MAX_ENTRIES {
        return Err("The zip file has too many files.".into());
    }
    let mut entries = Vec::new();
    let mut size_sum: u64 = 0;
    for _ in 0..total {
        if u32_at(data, at)? != CENTRAL_SIG {
            return Err(cut_off());
        }
        let flags = u16_at(data, at + 8)?;
        let method = u16_at(data, at + 10)?;
        let crc = u32_at(data, at + 16)?;
        let packed = u32_at(data, at + 20)? as usize;
        let size = u32_at(data, at + 24)? as usize;
        let name_len = u16_at(data, at + 28)?;
        let extra_len = u16_at(data, at + 30)?;
        let comment_len = u16_at(data, at + 32)?;
        let local = u32_at(data, at + 42)? as usize;
        let name_bytes = data.get(at + 46..at + 46 + name_len).ok_or_else(cut_off)?;
        let name = String::from_utf8_lossy(name_bytes).into_owned();
        at += 46 + name_len + extra_len + comment_len;

        if name.ends_with('/') {
            continue;
        }
        if flags & 1 != 0 {
            return Err("The zip file is password protected.".into());
        }
        if !safe_name(&name) {
            return Err(format!("The zip file contains an unsafe file name: {name:?}."));
        }
        size_sum += size as u64;
        if size_sum > MAX_TOTAL_BYTES {
            return Err("The zip file is too big.".into());
        }
        if u32_at(data, local)? != LOCAL_SIG {
            return Err(cut_off());
        }
        let start = local + 30 + u16_at(data, local + 26)? + u16_at(data, local + 28)?;
        let packed_data = data.get(start..start + packed).ok_or_else(cut_off)?;
        let content = match method {
            0 => packed_data.to_vec(),
            8 => inflate(packed_data, size)?,
            other => return Err(format!("The zip file uses a compression type that is not supported ({other}).")),
        };
        if content.len() != size || crc32(&content) != crc {
            return Err(format!("The file {name:?} in the zip is damaged (its check number does not match)."));
        }
        entries.push(ZipEntry { name, data: content });
    }
    Ok(entries)
}

/// Makes a zip with every entry stored (not compressed).
#[cfg(any(feature = "admin", test))]
pub fn write_stored(entries: &[ZipEntry]) -> Vec<u8> {
    let mut out: Vec<u8> = Vec::new();
    let mut central: Vec<u8> = Vec::new();
    for entry in entries {
        let offset = out.len() as u32;
        let crc = crc32(&entry.data);
        let name = entry.name.as_bytes();
        let size = entry.data.len() as u32;
        // Local header. 0x0800 = names are UTF-8. DOS time/date: 1980-01-01.
        out.extend_from_slice(&LOCAL_SIG.to_le_bytes());
        out.extend_from_slice(&[20, 0, 0, 8, 0, 0, 0, 0, 0, 0x21]);
        out.extend_from_slice(&crc.to_le_bytes());
        out.extend_from_slice(&size.to_le_bytes());
        out.extend_from_slice(&size.to_le_bytes());
        out.extend_from_slice(&(name.len() as u16).to_le_bytes());
        out.extend_from_slice(&[0, 0]);
        out.extend_from_slice(name);
        out.extend_from_slice(&entry.data);

        central.extend_from_slice(&CENTRAL_SIG.to_le_bytes());
        central.extend_from_slice(&[20, 0, 20, 0, 0, 8, 0, 0, 0, 0, 0, 0x21]);
        central.extend_from_slice(&crc.to_le_bytes());
        central.extend_from_slice(&size.to_le_bytes());
        central.extend_from_slice(&size.to_le_bytes());
        central.extend_from_slice(&(name.len() as u16).to_le_bytes());
        central.extend_from_slice(&[0; 12]);
        central.extend_from_slice(&offset.to_le_bytes());
        central.extend_from_slice(name);
    }
    let central_offset = out.len() as u32;
    out.extend_from_slice(&central);
    out.extend_from_slice(&END_SIG.to_le_bytes());
    out.extend_from_slice(&[0, 0, 0, 0]);
    out.extend_from_slice(&(entries.len() as u16).to_le_bytes());
    out.extend_from_slice(&(entries.len() as u16).to_le_bytes());
    out.extend_from_slice(&(central.len() as u32).to_le_bytes());
    out.extend_from_slice(&central_offset.to_le_bytes());
    out.extend_from_slice(&[0, 0]);
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::library::hash::sha256_hex;

    fn unhex(text: &str) -> Vec<u8> {
        (0..text.len()).step_by(2).map(|i| u8::from_str_radix(&text[i..i + 2], 16).unwrap()).collect()
    }

    // Made with Python's zlib (level 9): a short text (fixed codes) and a longer one (dynamic codes).
    const FIXED: &str = "4b4c4a4e8421858cd49c9c7c641200";
    const DYNAMIC: &str = "75946b8e83300c84afc2d5b20b2d95ca824a57bd7e45c6c5df34f027043f676cc7fd707f966e9997ee715b8747772dd354bae172197e9f557c9b9612d79f214ccb7d19cb47b3ceff7f7d78f7359ace504ba13344af719ed73152c9587759855a496a4e6933b352f20e94e1ee1f30318635bc02491e4642a5d811c27e0ce9163ce2490e18db55c1c282a837a5c149f7bddefdde20f9e8acaa7a04e0f85411b959ad99dbeb833a7cb2ebef8c62dbf5b6350932e74b1a7958619321b1464effc8c009d8b401b4045f20ac02a7ad6e895a0bdbca34f2ecafb109ac4e2af9873abba19b8530cb2c20c0d85cd94f93d0b87f4d823cdb6e4b62936d6df1de7b66db0ff2e2dce6c41b3f89018f70c08988f9128023cd4e1bee3d3a5a0178e4d678ae355b94397fb6440e2c4f270f35c8f6614d7052181d9069c2a5c10dcc8233d8c17edef7940d01a1db381b0fb0c13365fdda85d02e7aee1d7a65b909fb0d";
    // A zip made by Python's zipfile (deflate), with a folder entry.
    const PYTHON_ZIP: &str = "504b0304140000000800414e525dfb0c3f195b010000f00600000a000000696e6465782e6a736f6e75946b8e83300c84afc2d5b20b2d95ca824a57bd7e45c6c5df34f027043f676cc7fd707f966e9997ee715b8747772dd354bae172197e9f557c9b9612d79f214ccb7d19cb47b3ceff7f7d78f7359ace504ba13344af719ed73152c9587759855a496a4e6933b352f20e94e1ee1f30318635bc02491e4642a5d811c27e0ce9163ce2490e18db55c1c282a837a5c149f7bddefdde20f9e8acaa7a04e0f85411b959ad99dbeb833a7cb2ebef8c62dbf5b6350932e74b1a7958619321b1464effc8c009d8b401b4045f20ac02a7ad6e895a0bdbca34f2ecafb109ac4e2af9873abba19b8530cb2c20c0d85cd94f93d0b87f4d823cdb6e4b62936d6df1de7b66db0ff2e2dce6c41b3f89018f70c08988f9128023cd4e1bee3d3a5a0178e4d678ae355b94397fb6440e2c4f270f35c8f6614d7052181d9069c2a5c10dcc8233d8c17edef7940d01a1db381b0fb0c13365fdda85d02e7aee1d7a65b909fb0d504b0304140000000800414e525dc532dc820f0000001e000000090000007375622f612e7478744b4c4a4e8421858cd49c9c7c641200504b0304140000000800414e525d00000000020000000000000006000000656d7074792f0300504b01021403140000000800414e525dfb0c3f195b010000f00600000a0000000000000000000000800100000000696e6465782e6a736f6e504b01021403140000000800414e525dc532dc820f0000001e0000000900000000000000000000008001830100007375622f612e747874504b01021403140000000800414e525d000000000200000000000000060000000000000000001000fd41b9010000656d7074792f504b05060000000003000300a3000000df0100000000";

    #[test]
    fn inflates_fixed_and_dynamic_blocks() {
        assert_eq!(inflate(&unhex(FIXED), 1000).unwrap(), b"abcabcabcabc hello hello hello");
        let long = inflate(&unhex(DYNAMIC), 5000).unwrap();
        assert_eq!(long.len(), 1776);
        assert_eq!(crc32(&long), 0x193f_0cfb);
        assert_eq!(sha256_hex(&long), "2c08ffcb1c75f689260275fec6609263017f96d853468a150c38d9e5e63560ad");
    }

    #[test]
    fn inflate_refuses_bigger_than_promised_and_damaged_data() {
        assert!(inflate(&unhex(DYNAMIC), 100).is_err());
        let mut damaged = unhex(DYNAMIC);
        damaged.truncate(40);
        assert!(inflate(&damaged, 5000).is_err());
        assert!(inflate(&[0x07], 10).is_err(), "block type 3 does not exist");
    }

    #[test]
    fn reads_a_zip_made_by_another_program() {
        let entries = read_zip(&unhex(PYTHON_ZIP)).unwrap();
        let names: Vec<&str> = entries.iter().map(|e| e.name.as_str()).collect();
        assert_eq!(names, vec!["index.json", "sub/a.txt"], "folders are skipped");
        assert_eq!(sha256_hex(&entries[0].data), "2c08ffcb1c75f689260275fec6609263017f96d853468a150c38d9e5e63560ad");
        assert_eq!(entries[1].data, b"abcabcabcabc hello hello hello");
    }

    #[test]
    fn what_is_written_can_be_read_back() {
        let entries = vec![
            ZipEntry { name: "index.json".into(), data: b"[1,2,3]".to_vec() },
            ZipEntry { name: "sounds/한국어.wav".into(), data: (0..5000u32).map(|i| (i % 253) as u8).collect() },
            ZipEntry { name: "empty.txt".into(), data: Vec::new() },
        ];
        assert_eq!(read_zip(&write_stored(&entries)).unwrap(), entries);
    }

    #[test]
    fn damage_and_unsafe_names_are_caught() {
        let mut bytes = write_stored(&[ZipEntry { name: "a.txt".into(), data: b"hello world".to_vec() }]);
        bytes[40] ^= 0xff;
        assert!(read_zip(&bytes).unwrap_err().contains("damaged"));
        for name in ["../x.txt", "/etc/passwd", "a/../../b", "C:/x", "a\\b"] {
            let zip = write_stored(&[ZipEntry { name: name.into(), data: b"x".to_vec() }]);
            assert!(read_zip(&zip).unwrap_err().contains("unsafe"), "{name}");
        }
        assert!(read_zip(b"not a zip at all, really").is_err());
        assert!(read_zip(&[]).is_err());
    }
}
