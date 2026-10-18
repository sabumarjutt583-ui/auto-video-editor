//! The final audio: voice, background music (ducked under the voice), sound effects, and a
//! two-pass loudness step that brings everything to -14 LUFS with a -1 dBTP ceiling.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::commands::error::AppError;
use crate::ffmpeg_job::{run, RunOptions};
use crate::jobs::Job;

pub const SAMPLE_RATE: u32 = 48_000;
pub const TARGET_LUFS: f64 = -14.0;
pub const TARGET_PEAK: f64 = -1.0;
const LOUDNESS_RANGE: f64 = 11.0;
const FORMAT: &str = "aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo";
/// A track list is repeated to fill the video, but never more often than this.
const MAX_REPEATS: usize = 200;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Ducking {
    Off,
    Light,
    Normal,
    Strong,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MusicMode {
    /// The tracks start again when they run out.
    Loop,
    /// The tracks play once; the music fades out where it ends.
    Fade,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MusicTrack {
    pub path: String,
    pub duration: f64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MusicPlan {
    pub tracks: Vec<MusicTrack>,
    /// 0 to 1
    pub volume: f64,
    pub fade_in: f64,
    pub fade_out: f64,
    pub mode: MusicMode,
    pub ducking: Ducking,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SfxCue {
    pub sound_id: String,
    pub time: f64,
    /// 0 to 1
    pub gain: f64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MixRequest {
    /// Length of the video in seconds.
    pub duration: f64,
    pub voice_path: String,
    pub music: MusicPlan,
    pub sfx: Vec<SfxCue>,
    pub normalize: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Loudness {
    /// Integrated loudness in LUFS.
    pub integrated: f64,
    /// True peak in dBTP.
    pub true_peak: f64,
    pub range: f64,
}

/// The sound-effect files a request needs, in the order of the cues.
pub struct SfxFile {
    pub path: PathBuf,
    pub time: f64,
    pub gain: f64,
}

/// The sidechain compressor settings of a ducking preset: music drops while the voice speaks.
pub fn ducking_filter(ducking: Ducking) -> Option<String> {
    let (threshold, ratio, attack, release) = match ducking {
        Ducking::Off => return None,
        Ducking::Light => (0.06, 3.0, 20.0, 500.0),
        Ducking::Normal => (0.03, 6.0, 15.0, 600.0),
        Ducking::Strong => (0.015, 12.0, 10.0, 800.0),
    };
    Some(format!("sidechaincompress=threshold={threshold}:ratio={ratio}:attack={attack}:release={release}:makeup=1"))
}

/// Which tracks to feed to FFmpeg, in order: the list once, or repeated until it covers the video.
pub fn music_sequence(tracks: &[MusicTrack], duration: f64, mode: MusicMode) -> Vec<usize> {
    let usable: Vec<usize> = tracks.iter().enumerate().filter(|(_, t)| t.duration.is_finite() && t.duration > 0.1).map(|(i, _)| i).collect();
    if usable.is_empty() {
        return Vec::new();
    }
    let once: f64 = usable.iter().map(|&i| tracks[i].duration).sum();
    if mode == MusicMode::Fade || once >= duration {
        return usable;
    }
    let repeats = ((duration / once).ceil() as usize).clamp(1, MAX_REPEATS);
    (0..repeats).flat_map(|_| usable.iter().copied()).collect()
}

fn seconds(value: f64) -> String {
    format!("{:.3}", value.max(0.0))
}

/// The `filter_complex` graph. Inputs: 0 = voice, then one per entry of `music_durations`, then one per cue.
pub fn build_filter(request: &MixRequest, music_durations: &[f64], cues: &[(f64, f64)]) -> String {
    let duration = request.duration.max(0.1);
    let has_music = !music_durations.is_empty() && request.music.volume > 0.0;
    let mut parts: Vec<String> = Vec::new();
    let mut mix_inputs: Vec<String> = Vec::new();

    if has_music && request.music.ducking != Ducking::Off {
        parts.push(format!("[0:a]{FORMAT},atrim=duration={},asetpts=PTS-STARTPTS,asplit=2[v1][v2]", seconds(duration)));
    } else {
        parts.push(format!("[0:a]{FORMAT},atrim=duration={},asetpts=PTS-STARTPTS[v2]", seconds(duration)));
    }
    mix_inputs.push("[v2]".to_string());

    if has_music {
        let count = music_durations.len();
        for i in 0..count {
            parts.push(format!("[{}:a]{FORMAT}[m{i}]", i + 1));
        }
        let joined: String = (0..count).map(|i| format!("[m{i}]")).collect();
        parts.push(format!("{joined}concat=n={count}:v=0:a=1[mc]"));
        let total: f64 = music_durations.iter().sum();
        let end = duration.min(total);
        let fade_in = request.music.fade_in.clamp(0.0, end);
        let fade_out = request.music.fade_out.clamp(0.0, end);
        let mut chain = format!("[mc]atrim=duration={},asetpts=PTS-STARTPTS", seconds(duration));
        if fade_in > 0.0 {
            chain.push_str(&format!(",afade=t=in:st=0:d={}", seconds(fade_in)));
        }
        if fade_out > 0.0 {
            chain.push_str(&format!(",afade=t=out:st={}:d={}", seconds(end - fade_out), seconds(fade_out)));
        }
        chain.push_str(&format!(",volume={:.4}[mus]", request.music.volume.clamp(0.0, 1.0)));
        parts.push(chain);
        match ducking_filter(request.music.ducking) {
            Some(filter) => {
                parts.push(format!("[mus][v1]{filter}[duck]"));
                mix_inputs.push("[duck]".to_string());
            }
            None => mix_inputs.push("[mus]".to_string()),
        }
    }

    let first_sfx = 1 + music_durations.len();
    for (j, (time, gain)) in cues.iter().enumerate() {
        let delay = (time.max(0.0) * 1000.0).round() as i64;
        parts.push(format!("[{}:a]{FORMAT},volume={:.4},adelay=delays={delay}:all=1[s{j}]", first_sfx + j, gain.clamp(0.0, 1.0)));
        mix_inputs.push(format!("[s{j}]"));
    }

    if mix_inputs.len() == 1 {
        parts.push("[v2]anull[out]".to_string());
    } else {
        parts.push(format!(
            "{}amix=inputs={}:duration=longest:normalize=0:dropout_transition=0,atrim=duration={}[out]",
            mix_inputs.concat(),
            mix_inputs.len(),
            seconds(duration)
        ));
    }
    parts.join(";\n")
}

/// The measurements `loudnorm` prints as JSON at the end of a run.
#[derive(Debug, Clone, PartialEq)]
pub struct Measured {
    pub input_i: f64,
    pub input_tp: f64,
    pub input_lra: f64,
    pub input_thresh: f64,
    pub target_offset: f64,
}

/// Finds the last `{ ... }` block in FFmpeg's output and reads a `loudnorm` JSON report from it.
fn last_json(stderr: &str) -> Result<serde_json::Value, String> {
    let end = stderr.rfind('}').ok_or("FFmpeg did not print loudness numbers.")?;
    let start = stderr[..end].rfind('{').ok_or("FFmpeg did not print loudness numbers.")?;
    serde_json::from_str(&stderr[start..=end]).map_err(|e| format!("The loudness numbers could not be read: {e}"))
}

fn number(value: &serde_json::Value, key: &str) -> Result<f64, String> {
    let raw = value.get(key).ok_or_else(|| format!("The loudness report has no {key}."))?;
    let parsed = match raw {
        serde_json::Value::String(text) => text.trim().parse::<f64>().ok(),
        serde_json::Value::Number(n) => n.as_f64(),
        _ => None,
    };
    parsed.filter(|v| v.is_finite()).ok_or_else(|| format!("The loudness value {key} is not a number (silent audio?)."))
}

pub fn parse_measured(stderr: &str) -> Result<Measured, String> {
    let json = last_json(stderr)?;
    Ok(Measured {
        input_i: number(&json, "input_i")?,
        input_tp: number(&json, "input_tp")?,
        input_lra: number(&json, "input_lra")?,
        input_thresh: number(&json, "input_thresh")?,
        target_offset: number(&json, "target_offset")?,
    })
}

/// The result of the second pass: how loud the output turned out.
#[cfg(test)]
pub fn parse_output(stderr: &str) -> Result<Loudness, String> {
    let json = last_json(stderr)?;
    Ok(Loudness { integrated: number(&json, "output_i")?, true_peak: number(&json, "output_tp")?, range: number(&json, "output_lra")? })
}

/// Pass 1: only measure.
pub fn measure_filter() -> String {
    format!("loudnorm=I={TARGET_LUFS}:TP={TARGET_PEAK}:LRA={LOUDNESS_RANGE}:print_format=json")
}

/// Pass 2: apply the correction found in pass 1 (a straight gain change when possible, so the sound is not squashed).
pub fn apply_filter(m: &Measured) -> String {
    format!(
        "loudnorm=I={TARGET_LUFS}:TP={TARGET_PEAK}:LRA={LOUDNESS_RANGE}:measured_I={:.2}:measured_TP={:.2}:measured_LRA={:.2}:measured_thresh={:.2}:offset={:.2}:linear=true:print_format=json,aresample={SAMPLE_RATE}",
        m.input_i, m.input_tp, m.input_lra, m.input_thresh, m.target_offset
    )
}

fn path_arg(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

/// Mixes everything into `output` (48 kHz stereo WAV) and tells how loud it is.
///
/// `voice` and the music files are absolute paths of files inside the project; `cues` are the sound files with
/// their time and volume. `scratch` is a folder for temporary files.
pub async fn render_mix(
    job: &Job,
    request: &MixRequest,
    voice: &Path,
    music_files: &[(PathBuf, f64)],
    cues: &[SfxFile],
    scratch: &Path,
    output: &Path,
) -> Result<Loudness, AppError> {
    std::fs::create_dir_all(scratch).map_err(|e| AppError::new("The audio folder could not be created.", e.to_string()))?;
    let script = scratch.join("mix-filter.tmp.txt");
    let raw = scratch.join("mix-raw.tmp.wav");
    let cleanup = || {
        let _ = std::fs::remove_file(&script);
        let _ = std::fs::remove_file(&raw);
    };

    let durations: Vec<f64> = music_files.iter().map(|(_, d)| *d).collect();
    let pairs: Vec<(f64, f64)> = cues.iter().map(|c| (c.time, c.gain)).collect();
    let graph = build_filter(request, &durations, &pairs);
    if let Err(e) = std::fs::write(&script, &graph) {
        return Err(AppError::new("The audio mix could not be prepared.", e.to_string()));
    }

    let mut args: Vec<String> = vec!["-i".into(), path_arg(voice)];
    for (path, _) in music_files {
        args.extend(["-i".into(), path_arg(path)]);
    }
    for cue in cues {
        args.extend(["-i".into(), path_arg(&cue.path)]);
    }
    args.extend(["-filter_complex_script".into(), path_arg(&script), "-map".into(), "[out]".into(), "-c:a".into(), "pcm_f32le".into(), "-ar".into(), SAMPLE_RATE.to_string(), "-ac".into(), "2".into(), path_arg(&raw)]);

    let mut options = RunOptions::new("Mixing voice, music and sound effects", Some(request.duration), 0.0, 55.0);
    options.failure_message = "The audio could not be mixed. A music or sound file may be damaged.".to_string();
    if let Err(e) = run(job, &args, &options).await {
        cleanup();
        return Err(e);
    }

    let result = finish(job, request, &raw, output).await;
    cleanup();
    result
}

async fn finish(job: &Job, request: &MixRequest, raw: &Path, output: &Path) -> Result<Loudness, AppError> {
    let mut options = RunOptions::new("Measuring the loudness", Some(request.duration), 55.0, 70.0);
    options.failure_message = "The loudness could not be measured.".to_string();
    let to_error = |details: String| AppError::new("The loudness of the mix could not be read.", details);

    if request.normalize {
        let measure = vec!["-i".into(), path_arg(raw), "-af".into(), measure_filter(), "-f".into(), "null".into(), "-".into()];
        let measured = parse_measured(&run(job, &measure, &options).await?).map_err(to_error)?;

        let mut apply_options = RunOptions::new("Setting the loudness to -14 LUFS", Some(request.duration), 70.0, 95.0);
        apply_options.failure_message = "The loudness could not be set.".to_string();
        let apply = vec!["-i".into(), path_arg(raw), "-af".into(), apply_filter(&measured), "-c:a".into(), "pcm_s16le".into(), "-ar".into(), SAMPLE_RATE.to_string(), "-ac".into(), "2".into(), path_arg(output)];
        run(job, &apply, &apply_options).await?;
    } else {
        let mut copy_options = RunOptions::new("Saving the audio", Some(request.duration), 70.0, 95.0);
        copy_options.failure_message = "The audio could not be saved.".to_string();
        let copy = vec!["-i".into(), path_arg(raw), "-c:a".into(), "pcm_s16le".into(), "-ar".into(), SAMPLE_RATE.to_string(), "-ac".into(), "2".into(), path_arg(output)];
        run(job, &copy, &copy_options).await?;
    }

    // Measure what was really written, so the number the user sees is true.
    let mut check_options = RunOptions::new("Checking the result", Some(request.duration), 95.0, 100.0);
    check_options.failure_message = "The finished audio could not be checked.".to_string();
    let check = vec!["-i".into(), path_arg(output), "-af".into(), measure_filter(), "-f".into(), "null".into(), "-".into()];
    let stderr = run(job, &check, &check_options).await?;
    let m = parse_measured(&stderr).map_err(to_error)?;
    Ok(Loudness { integrated: m.input_i, true_peak: m.input_tp, range: m.input_lra })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ffmpeg::{sidecar_path, Tool};
    use crate::ffmpeg_job::sidecars_for_tests;
    use crate::jobs::{test_job, JobRegistry};

    fn track(path: &str, duration: f64) -> MusicTrack {
        MusicTrack { path: path.into(), duration }
    }

    fn request(tracks: Vec<MusicTrack>, ducking: Ducking, mode: MusicMode) -> MixRequest {
        MixRequest { duration: 30.0, voice_path: "audio/processed.wav".into(), music: MusicPlan { tracks, volume: 0.25, fade_in: 2.0, fade_out: 3.0, mode, ducking }, sfx: vec![], normalize: true }
    }

    #[test]
    fn music_tracks_play_in_order_and_repeat_to_fill_the_video() {
        let tracks = vec![track("a", 10.0), track("b", 5.0)];
        assert_eq!(music_sequence(&tracks, 30.0, MusicMode::Loop), vec![0, 1, 0, 1]);
        assert_eq!(music_sequence(&tracks, 12.0, MusicMode::Loop), vec![0, 1]);
        assert_eq!(music_sequence(&tracks, 30.0, MusicMode::Fade), vec![0, 1]);
        assert_eq!(music_sequence(&[track("a", 100.0)], 30.0, MusicMode::Loop), vec![0]);
        assert!(music_sequence(&[], 30.0, MusicMode::Loop).is_empty());
        assert!(music_sequence(&[track("x", 0.0)], 30.0, MusicMode::Loop).is_empty());
    }

    #[test]
    fn ducking_presets_get_stronger() {
        assert!(ducking_filter(Ducking::Off).is_none());
        let get = |d| ducking_filter(d).unwrap();
        assert!(get(Ducking::Light).contains("ratio=3") && get(Ducking::Normal).contains("ratio=6") && get(Ducking::Strong).contains("ratio=12"));
        assert!(get(Ducking::Strong).starts_with("sidechaincompress="));
    }

    #[test]
    fn the_graph_uses_the_voice_as_sidechain_and_adds_sfx_at_their_times() {
        let req = request(vec![track("a", 10.0)], Ducking::Normal, MusicMode::Loop);
        let graph = build_filter(&req, &[10.0, 10.0, 10.0], &[(1.5, 0.8), (12.0, 0.5)]);
        assert!(graph.contains("asplit=2[v1][v2]"));
        assert!(graph.contains("[m0][m1][m2]concat=n=3:v=0:a=1[mc]"));
        assert!(graph.contains("afade=t=in:st=0:d=2.000"));
        assert!(graph.contains("afade=t=out:st=27.000:d=3.000"));
        assert!(graph.contains("volume=0.2500[mus]"));
        assert!(graph.contains("[mus][v1]sidechaincompress=threshold=0.03:ratio=6"));
        assert!(graph.contains("[4:a]") && graph.contains("adelay=delays=1500:all=1[s0]"));
        assert!(graph.contains("[5:a]") && graph.contains("adelay=delays=12000:all=1[s1]"));
        assert!(graph.contains("[v2][duck][s0][s1]amix=inputs=4:duration=longest:normalize=0"));
    }

    #[test]
    fn without_ducking_the_music_goes_straight_to_the_mix_and_a_short_music_fades_where_it_ends() {
        let req = request(vec![track("a", 10.0)], Ducking::Off, MusicMode::Fade);
        let graph = build_filter(&req, &[10.0], &[]);
        assert!(!graph.contains("sidechaincompress") && !graph.contains("asplit"));
        assert!(graph.contains("afade=t=out:st=7.000:d=3.000"), "{graph}");
        assert!(graph.contains("[v2][mus]amix=inputs=2"));
    }

    #[test]
    fn voice_only_has_no_mixer() {
        let req = request(vec![], Ducking::Normal, MusicMode::Loop);
        let graph = build_filter(&req, &[], &[]);
        assert!(graph.ends_with("[v2]anull[out]") && !graph.contains("amix"));
        let silent = MixRequest { music: MusicPlan { volume: 0.0, ..req.music.clone() }, ..req.clone() };
        assert!(!build_filter(&silent, &[10.0], &[]).contains("concat"));
    }

    #[test]
    fn loudnorm_reports_are_read() {
        let stderr = "size=N/A\n[Parsed_loudnorm_0 @ 0x1] \n{\n\t\"input_i\" : \"-23.54\",\n\t\"input_tp\" : \"-5.02\",\n\t\"input_lra\" : \"4.10\",\n\t\"input_thresh\" : \"-34.01\",\n\t\"output_i\" : \"-14.31\",\n\t\"output_tp\" : \"-1.10\",\n\t\"output_lra\" : \"3.50\",\n\t\"output_thresh\" : \"-24.5\",\n\t\"normalization_type\" : \"dynamic\",\n\t\"target_offset\" : \"0.31\"\n}\n";
        let m = parse_measured(stderr).unwrap();
        assert_eq!(m, Measured { input_i: -23.54, input_tp: -5.02, input_lra: 4.10, input_thresh: -34.01, target_offset: 0.31 });
        let out = parse_output(stderr).unwrap();
        assert_eq!(out, Loudness { integrated: -14.31, true_peak: -1.10, range: 3.50 });
        assert!(apply_filter(&m).contains("measured_I=-23.54") && apply_filter(&m).contains("linear=true"));
        assert!(parse_measured("nothing here").is_err());
        assert!(parse_measured("{\"input_i\":\"-inf\",\"input_tp\":\"-inf\",\"input_lra\":\"0\",\"input_thresh\":\"-70\",\"target_offset\":\"0\"}").is_err());
    }

    fn make(path: &Path, expression: &str, seconds: f64) {
        let status = std::process::Command::new(sidecar_path(Tool::Ffmpeg).unwrap())
            .args(["-v", "error", "-y", "-f", "lavfi", "-i", &format!("aevalsrc='{expression}':s=44100:d={seconds}"), "-ac", "2"])
            .arg(path)
            .status()
            .unwrap();
        assert!(status.success());
    }

    /// Reads the loudness of a file with FFmpeg (the same measure the mix uses).
    fn loudness_of(path: &Path) -> Measured {
        let out = std::process::Command::new(sidecar_path(Tool::Ffmpeg).unwrap())
            .args(["-hide_banner", "-nostats", "-i"])
            .arg(path)
            .args(["-af", &measure_filter(), "-f", "null", "-"])
            .output()
            .unwrap();
        parse_measured(&String::from_utf8_lossy(&out.stderr)).unwrap()
    }

    #[tokio::test]
    async fn a_real_mix_comes_out_at_minus_14_lufs_and_keeps_the_voice_above_the_music() {
        if !sidecars_for_tests() {
            return;
        }
        let dir = std::env::temp_dir().join(format!("ave-mix-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        // A quiet "voice": a 300 Hz tone that speaks 2 s, pauses 2 s, speaks 2 s...
        let voice = dir.join("voice.wav");
        make(&voice, "0.2*sin(2*PI*300*t)*lt(mod(t,4),2)", 12.0);
        // "Music": a loud steady chord.
        let music = dir.join("music.wav");
        make(&music, "0.4*sin(2*PI*220*t)+0.3*sin(2*PI*330*t)", 7.0);
        let sfx = dir.join("hit.wav");
        make(&sfx, "0.9*sin(2*PI*60*t)*exp(-6*t)", 0.6);

        let mut req = request(vec![track("music.wav", 7.0)], Ducking::Strong, MusicMode::Loop);
        req.duration = 12.0;
        let registry = JobRegistry::default();
        let (job, log) = test_job(&registry, "mix");
        let cue = SfxFile { path: sfx.clone(), time: 4.5, gain: 0.8 };
        let output = dir.join("out.wav");
        let loud = render_mix(&job, &req, &voice, &[(music.clone(), 7.0), (music.clone(), 7.0)], &[cue], &dir, &output).await.unwrap();

        assert!((loud.integrated - TARGET_LUFS).abs() < 1.0, "integrated {} LUFS", loud.integrated);
        assert!(loud.true_peak <= TARGET_PEAK + 0.3, "true peak {} dBTP", loud.true_peak);
        let measured = loudness_of(&output);
        assert!((measured.input_i - TARGET_LUFS).abs() < 1.0, "{}", measured.input_i);
        assert!(!dir.join("mix-filter.tmp.txt").exists() && !dir.join("mix-raw.tmp.wav").exists(), "scratch files are removed");
        let stages: Vec<String> = log.lock().unwrap().iter().map(|p| p.stage.clone()).collect();
        assert!(stages.iter().any(|s| s.contains("Mixing")) && stages.iter().any(|s| s.contains("-14")));

        // The music is ducked while the voice speaks: compare the mix with ducking off and strong, same voice and music.
        let loud_of_window = |file: &Path, from: f64, to: f64| {
            let out = std::process::Command::new(sidecar_path(Tool::Ffmpeg).unwrap())
                .args(["-hide_banner", "-nostats", "-ss", &from.to_string(), "-t", &(to - from).to_string(), "-i"])
                .arg(file)
                .args(["-af", "volumedetect", "-f", "null", "-"])
                .output()
                .unwrap();
            let text = String::from_utf8_lossy(&out.stderr).into_owned();
            let line = text.lines().find(|l| l.contains("mean_volume")).unwrap().to_string();
            line.rsplit(':').next().unwrap().trim().trim_end_matches(" dB").parse::<f64>().unwrap()
        };
        // Loud music, so that ducking it makes a clear difference to the whole mix.
        let mut off_req = req.clone();
        off_req.music.volume = 1.0;
        off_req.music.ducking = Ducking::Off;
        off_req.normalize = false;
        let mut strong_req = off_req.clone();
        strong_req.music.ducking = Ducking::Strong;
        let (off_out, strong_out) = (dir.join("off.wav"), dir.join("strong.wav"));
        render_mix(&job, &off_req, &voice, &[(music.clone(), 7.0), (music.clone(), 7.0)], &[], &dir, &off_out).await.unwrap();
        render_mix(&job, &strong_req, &voice, &[(music.clone(), 7.0), (music.clone(), 7.0)], &[], &dir, &strong_out).await.unwrap();
        // 0.5 to 1.9 s: the voice speaks. 2.6 to 3.9 s: a pause (the music comes back up).
        let speaking_drop = loud_of_window(&off_out, 0.6, 1.9) - loud_of_window(&strong_out, 0.6, 1.9);
        let pause_drop = loud_of_window(&off_out, 2.8, 3.9) - loud_of_window(&strong_out, 2.8, 3.9);
        assert!(speaking_drop > 3.0, "the music should drop while the voice speaks (only {speaking_drop} dB)");
        assert!(pause_drop < 1.0, "the music should come back in the pauses (still {pause_drop} dB lower)");
        let _ = std::fs::remove_dir_all(&dir);
    }
}
