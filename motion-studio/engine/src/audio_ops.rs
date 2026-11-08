//! CHANGE LOG
//! 1 | maintainer@emeraldcoastsystemsgroup.com | RP-MOT-01: probe single owned media assets and render exact-tick stereo PCM16 WAV mixes with animated audio levels and peak summaries.
use crate::{Request, UPSTREAM, owned_assets::OwnedAssets};
use base64::{Engine as _, engine::general_purpose::STANDARD};
use effectcraft_project::{ItemId, Project};
use effectcraft_render::audio::{comp_has_audio, mix_comp};
use effectcraft_time::Tick;
use serde_json::{Value, json};

const MAX_AUDIO_SECONDS: f64 = 30.0;
const MIX_BLOCK_FRAMES: usize = 1024;

fn parse_tick_or(raw: Option<&str>, fallback: Tick) -> Result<Tick, String> {
    let Some(text) = raw else {
        return Ok(fallback);
    };
    let digits = text.strip_prefix('-').unwrap_or(text);
    if digits.is_empty()
        || digits.len() > 19
        || !digits.bytes().all(|b| b.is_ascii_digit())
        || (digits.len() > 1 && digits.starts_with('0'))
        || text == "-0"
    {
        return Err("motion_audio_range".into());
    }
    text.parse().map(Tick).map_err(|_| "motion_audio_range".into())
}

fn sample_tick(sample_index: i64, rate: u32) -> Tick {
    let t = Tick::from_units(sample_index, i64::from(rate));
    if t.to_units_floor(i64::from(rate)) < sample_index {
        Tick(t.0.saturating_add(1))
    } else {
        t
    }
}

fn mix_window(
    project: &Project,
    assets: &OwnedAssets,
    comp_id: ItemId,
    start: Tick,
    frames: usize,
    rate: u32,
) -> Vec<f32> {
    if !comp_has_audio(project, comp_id) {
        return vec![0.0f32; frames * 2];
    }
    let s0 = start.to_units_floor(i64::from(rate));
    let mut out = Vec::with_capacity(frames * 2);
    let mut offset = 0usize;
    while offset < frames {
        let block = (frames - offset).min(MIX_BLOCK_FRAMES);
        let at = sample_tick(s0.saturating_add(offset as i64), rate);
        out.extend(mix_comp(project, assets, None, comp_id, at, block, rate));
        offset += block;
    }
    out
}

fn encode_wav_stereo_pcm16(stereo: &[f32], sample_rate: u32) -> Result<Vec<u8>, String> {
    let pcm_bytes = u32::try_from(stereo.len().saturating_mul(2)).map_err(|_| "motion_audio_limit")?;
    let riff_size = pcm_bytes.checked_add(36).ok_or("motion_audio_limit")?;
    let byte_rate = sample_rate.checked_mul(4).ok_or("motion_audio_limit")?;
    let mut wav = Vec::with_capacity(44 + pcm_bytes as usize);
    wav.extend_from_slice(b"RIFF");
    wav.extend_from_slice(&riff_size.to_le_bytes());
    wav.extend_from_slice(b"WAVEfmt ");
    wav.extend_from_slice(&16u32.to_le_bytes());
    wav.extend_from_slice(&1u16.to_le_bytes());
    wav.extend_from_slice(&2u16.to_le_bytes());
    wav.extend_from_slice(&sample_rate.to_le_bytes());
    wav.extend_from_slice(&byte_rate.to_le_bytes());
    wav.extend_from_slice(&4u16.to_le_bytes());
    wav.extend_from_slice(&16u16.to_le_bytes());
    wav.extend_from_slice(b"data");
    wav.extend_from_slice(&pcm_bytes.to_le_bytes());
    for sample in stereo {
        let clamped = if sample.is_finite() {
            sample.clamp(-1.0, 1.0)
        } else {
            0.0
        };
        let quantized = (clamped * 32767.0).round() as i16;
        wav.extend_from_slice(&quantized.to_le_bytes());
    }
    Ok(wav)
}

fn compute_peaks(stereo: &[f32], bins: usize) -> Vec<f32> {
    let total_frames = stereo.len() / 2;
    if bins == 0 || total_frames == 0 {
        return Vec::new();
    }
    (0..bins)
        .map(|bin| {
            let from = bin * total_frames / bins;
            let until = ((bin + 1) * total_frames / bins).max(from + 1).min(total_frames);
            stereo[from * 2..until * 2]
                .iter()
                .fold(0.0f32, |acc, v| if v.is_finite() { acc.max(v.abs().min(1.0)) } else { acc })
        })
        .collect()
}

pub fn probe_request(request: &Request, assets: &OwnedAssets) -> Result<Value, String> {
    if request.document.is_some() || !request.commands.is_empty() || request.assets.len() != 1 {
        return Err("motion_probe_single_asset_required".into());
    }
    let mut summary = assets.probe_summary(&request.assets[0].id)?;
    if let Some(obj) = summary.as_object_mut() {
        obj.insert("upstream".into(), json!(UPSTREAM));
    }
    Ok(summary)
}

pub fn render_audio(
    request: &Request,
    project: &Project,
    comp_id: ItemId,
    assets: &OwnedAssets,
) -> Result<Value, String> {
    let comp = project.comp(comp_id).ok_or("motion_composition_required")?;
    let sample_rate = request.sample_rate.unwrap_or(48_000);
    if !(8_000..=96_000).contains(&sample_rate) {
        return Err("motion_audio_limit".into());
    }
    let bins = request.peak_bins.unwrap_or(0);
    if bins > 2048 {
        return Err("motion_audio_limit".into());
    }
    let start = parse_tick_or(request.start_ticks.as_deref(), comp.work_area.0)?;
    let end = parse_tick_or(request.end_ticks.as_deref(), comp.work_area.1)?;
    if start.0 < 0 || end.0 <= start.0 || end > comp.duration {
        return Err("motion_audio_range".into());
    }
    if (end - start).seconds() > MAX_AUDIO_SECONDS {
        return Err("motion_audio_window_limit".into());
    }
    let s0 = start.to_units_floor(i64::from(sample_rate));
    let s1 = end.to_units_floor(i64::from(sample_rate));
    let frames = usize::try_from((s1 - s0).max(1)).map_err(|_| "motion_audio_limit")?;
    if frames > 30 * 96_000 {
        return Err("motion_audio_limit".into());
    }
    let has_audio = comp_has_audio(project, comp_id);
    let stereo = mix_window(project, assets, comp_id, start, frames, sample_rate);
    let peaks = compute_peaks(&stereo, bins);
    let wav = encode_wav_stereo_pcm16(&stereo, sample_rate)?;
    Ok(json!({
        "upstream": UPSTREAM,
        "comp": comp_id.0,
        "hasAudio": has_audio,
        "sampleRate": sample_rate,
        "channels": 2,
        "frames": frames,
        "startTicks": start.0.to_string(),
        "endTicks": end.0.to_string(),
        "wav": STANDARD.encode(wav),
        "peaks": peaks
    }))
}
