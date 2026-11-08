//! CHANGE LOG
//! 1 | maintainer@emeraldcoastsystemsgroup.com | Decode bounded supplied raster bytes into the real compositor source without reading media paths.
//! 2 | maintainer@emeraldcoastsystemsgroup.com | RP-MOT-01: decode bounded video and audio clips through effectcraft-media and verified staged bytes while keeping still-photo bounds intact.
use base64::{Engine as _, engine::general_purpose::STANDARD};
use effectcraft_media::MediaPool;
use effectcraft_project::{Footage, FootageKind, ItemId};
use effectcraft_raster::Image;
use effectcraft_render::FootageSource;
use effectcraft_time::Tick;
use serde::Deserialize;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{collections::BTreeMap, io::Cursor, path::PathBuf, sync::Arc};

pub const MAX_ASSETS: usize = 64;
pub const MAX_ASSET_BYTES: usize = 4 * 1024 * 1024;
pub const MAX_MEDIA_BYTES: usize = 64 * 1024 * 1024;
pub const MAX_TOTAL_BYTES: usize = 6 * 1024 * 1024;
pub const MAX_SESSION_BYTES: usize = 192 * 1024 * 1024;
pub const MAX_PIXELS: u64 = 33_554_432;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct EncodedAsset {
    pub id: String,
    pub sha256: String,
    #[serde(default)]
    pub data: Option<String>,
}

struct Raster {
    uri: String,
    media_type: &'static str,
    image: Arc<Image>,
}

struct Media {
    uri: String,
    pool_path: String,
    media_type: &'static str,
    footage: Footage,
}

enum StoredAsset {
    Raster(Raster),
    Media(Box<Media>),
}

pub struct OwnedAssets {
    entries: BTreeMap<String, StoredAsset>,
    pool: MediaPool,
}

impl Default for OwnedAssets {
    fn default() -> Self {
        Self {
            entries: BTreeMap::new(),
            pool: MediaPool::with_budget(128 * 1024 * 1024),
        }
    }
}

fn reader(bytes: &[u8], format: image::ImageFormat) -> image::ImageReader<Cursor<&[u8]>> {
    let mut reader = image::ImageReader::with_format(Cursor::new(bytes), format);
    let mut limits = image::Limits::default();
    limits.max_image_width = Some(8192);
    limits.max_image_height = Some(8192);
    limits.max_alloc = Some(MAX_PIXELS * 4);
    reader.limits(limits);
    reader
}

pub fn sniff_media_ext(bytes: &[u8]) -> Option<(&'static str, &'static str)> {
    if bytes.len() >= 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WAVE" {
        return Some(("wav", "audio/wav"));
    }
    if bytes.len() >= 12
        && (&bytes[0..4] == b"FORM" || &bytes[0..4] == b"RIFF")
        && (&bytes[8..12] == b"AIFF" || &bytes[8..12] == b"AIFC")
    {
        return Some(("aiff", "audio/aiff"));
    }
    if bytes.starts_with(b"OggS") {
        return Some(("ogg", "audio/ogg"));
    }
    if bytes.starts_with(b"fLaC") {
        return Some(("flac", "audio/flac"));
    }
    if bytes.starts_with(b"ID3")
        || (bytes.len() >= 4
            && bytes[0] == 0xFF
            && (bytes[1] & 0xE0) == 0xE0
            && (bytes[1] & 0x18) != 0x08
            && (bytes[1] & 0x06) != 0
            && (bytes[2] & 0xF0) != 0xF0)
    {
        return Some(("mp3", "audio/mpeg"));
    }
    if bytes.starts_with(&[0x1A, 0x45, 0xDF, 0xA3]) {
        return Some(("webm", "video/webm"));
    }
    if bytes.len() >= 12 && &bytes[4..8] == b"ftyp" {
        return match &bytes[8..12] {
            b"qt  " => Some(("mov", "video/quicktime")),
            b"M4A " | b"M4B " | b"M4P " => Some(("m4a", "audio/mp4")),
            _ => Some(("mp4", "video/mp4")),
        };
    }
    None
}

fn read_staged_bytes(sha256: &str) -> Result<Vec<u8>, String> {
    if sha256.len() != 64
        || !sha256
            .bytes()
            .all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'))
    {
        return Err("motion_asset_digest_mismatch".into());
    }
    let dir = std::env::var("MOTION_STAGED_ASSET_DIR")
        .ok()
        .filter(|v| !v.is_empty())
        .ok_or("motion_staged_asset_missing")?;
    let path = PathBuf::from(dir).join(format!("{sha256}.bin"));
    let meta = std::fs::metadata(&path).map_err(|_| "motion_staged_asset_missing")?;
    if !meta.is_file() || meta.len() == 0 || meta.len() > MAX_MEDIA_BYTES as u64 {
        return Err("motion_asset_bytes_limit".into());
    }
    std::fs::read(&path).map_err(|_| "motion_staged_asset_missing".into())
}

fn load_bytes(
    input: &EncodedAsset,
    inline_total: &mut usize,
    session_total: &mut usize,
) -> Result<(Vec<u8>, String), String> {
    let bytes = if let Some(encoded) = &input.data {
        if encoded.len() > MAX_TOTAL_BYTES.div_ceil(3) * 4 {
            return Err("motion_asset_bytes_limit".into());
        }
        let raw = STANDARD
            .decode(encoded)
            .map_err(|_| "motion_asset_invalid_encoding")?;
        if raw.is_empty() || raw.len() > MAX_MEDIA_BYTES {
            return Err("motion_asset_bytes_limit".into());
        }
        *inline_total = inline_total
            .checked_add(raw.len())
            .ok_or("motion_asset_bytes_limit")?;
        if *inline_total > MAX_TOTAL_BYTES {
            return Err("motion_asset_transport_limit".into());
        }
        raw
    } else {
        read_staged_bytes(&input.sha256)?
    };
    *session_total = session_total
        .checked_add(bytes.len())
        .ok_or("motion_asset_bytes_limit")?;
    if *session_total > MAX_SESSION_BYTES {
        return Err("motion_asset_transport_limit".into());
    }
    let hash = format!("{:x}", Sha256::digest(&bytes));
    if input.sha256 != hash {
        return Err("motion_asset_digest_mismatch".into());
    }
    Ok((bytes, hash))
}

fn decode_raster_entry(
    uri: String,
    bytes: &[u8],
    format: image::ImageFormat,
    total_pixels: &mut u64,
) -> Result<StoredAsset, String> {
    if bytes.len() > MAX_ASSET_BYTES {
        return Err("motion_asset_bytes_limit".into());
    }
    let media_type = match format {
        image::ImageFormat::Png => "image/png",
        image::ImageFormat::Jpeg => "image/jpeg",
        image::ImageFormat::WebP => "image/webp",
        _ => return Err("motion_asset_unsupported_raster".into()),
    };
    let (width, height) = reader(bytes, format)
        .into_dimensions()
        .map_err(|_| "motion_asset_invalid_raster")?;
    let pixels = u64::from(width) * u64::from(height);
    if width == 0 || height == 0 || width > 8192 || height > 8192 || pixels > MAX_PIXELS {
        return Err("motion_asset_pixel_limit".into());
    }
    *total_pixels = total_pixels
        .checked_add(pixels)
        .ok_or("motion_asset_pixel_limit")?;
    if *total_pixels > MAX_PIXELS {
        return Err("motion_asset_pixel_limit".into());
    }
    let rgba = reader(bytes, format)
        .decode()
        .map_err(|_| "motion_asset_invalid_raster")?
        .to_rgba8();
    Ok(StoredAsset::Raster(Raster {
        uri,
        media_type,
        image: Arc::new(Image::from_rgba8(width, height, rgba.as_raw())),
    }))
}

fn decode_media_entry(
    uri: String,
    bytes: Vec<u8>,
    ext: &'static str,
    hint_mime: &'static str,
    pool: &MediaPool,
) -> Result<StoredAsset, String> {
    let pool_path = format!("{uri}.{ext}");
    let shared: Arc<[u8]> = bytes.into();
    let mut probed = effectcraft_media::probe_bytes(&pool_path, shared.clone())
        .map_err(|_| "motion_asset_invalid_media")?;
    if !matches!(probed.kind, FootageKind::Video | FootageKind::Audio)
        || (!probed.has_video && !probed.has_audio)
        || probed.duration.0 <= 0
        || probed.duration.seconds() > 86400.0
    {
        return Err("motion_asset_invalid_media".into());
    }
    if probed.kind == FootageKind::Video {
        let pixels = u64::from(probed.width) * u64::from(probed.height);
        if probed.width == 0
            || probed.height == 0
            || probed.width > 8192
            || probed.height > 8192
            || pixels > MAX_PIXELS
        {
            return Err("motion_asset_pixel_limit".into());
        }
        if probed.frame_rate.num <= 0
            || probed.frame_rate.den <= 0
            || !probed.frame_rate.as_f64().is_finite()
            || probed.frame_rate.as_f64() > 1000.0
        {
            return Err("motion_asset_invalid_media".into());
        }
    } else if probed.width != 0 || probed.height != 0 || probed.has_video {
        return Err("motion_asset_invalid_media".into());
    }
    pool.add_bytes(&pool_path, shared);
    if probed.has_video {
        pool.frame_at(&probed, Tick::ZERO)
            .map_err(|_| "motion_asset_invalid_media")?;
    }
    let media_type = if probed.kind == FootageKind::Audio && hint_mime == "video/mp4" {
        "audio/mp4"
    } else {
        hint_mime
    };
    probed.path = uri.clone();
    Ok(StoredAsset::Media(Box::new(Media {
        uri,
        pool_path,
        media_type,
        footage: probed,
    })))
}

impl OwnedAssets {
    pub fn decode(inputs: &[EncodedAsset]) -> Result<Self, String> {
        if inputs.len() > MAX_ASSETS {
            return Err("motion_asset_limit".into());
        }
        let mut source = Self::default();
        let mut inline_total = 0usize;
        let mut session_total = 0usize;
        let mut total_pixels = 0u64;
        for input in inputs {
            let id = uuid::Uuid::parse_str(&input.id).map_err(|_| "motion_asset_invalid_id")?;
            if id.to_string() != input.id || !(1..=5).contains(&id.get_version_num()) {
                return Err("motion_asset_invalid_id".into());
            }
            if source.entries.contains_key(&input.id) {
                return Err("motion_duplicate_asset".into());
            }
            let (bytes, hash) = load_bytes(input, &mut inline_total, &mut session_total)?;
            let uri = format!("oshal-asset:{}@{hash}", input.id);
            let entry = if let Ok(format) = image::guess_format(&bytes) {
                decode_raster_entry(uri, &bytes, format, &mut total_pixels)?
            } else if let Some((ext, mime)) = sniff_media_ext(&bytes) {
                decode_media_entry(uri, bytes, ext, mime, &source.pool)?
            } else if bytes.len() > MAX_ASSET_BYTES {
                return Err("motion_asset_bytes_limit".into());
            } else {
                return Err("motion_asset_invalid_raster".into());
            };
            source.entries.insert(input.id.clone(), entry);
        }
        Ok(source)
    }

    pub fn footage(&self, id: &str) -> Result<Footage, String> {
        match self.entries.get(id).ok_or("motion_owned_asset_missing")? {
            StoredAsset::Raster(raster) => Ok(Footage {
                path: raster.uri.clone(),
                kind: FootageKind::Still,
                width: raster.image.width,
                height: raster.image.height,
                has_video: true,
                codec: "owned-raster".into(),
                ..Footage::default()
            }),
            StoredAsset::Media(media) => Ok(media.footage.clone()),
        }
    }

    pub fn probe_summary(&self, id: &str) -> Result<Value, String> {
        match self.entries.get(id).ok_or("motion_owned_asset_missing")? {
            StoredAsset::Raster(r) => Ok(json!({
                "id": id, "kind": "image", "mediaType": r.media_type,
                "width": r.image.width, "height": r.image.height,
                "durationTicks": "0", "durationSeconds": 0.0,
                "frameRate": { "num": 30, "den": 1 },
                "hasVideo": true, "hasAudio": false,
                "audioSampleRate": 0, "audioChannels": 0, "codec": "owned-raster"
            })),
            StoredAsset::Media(m) => {
                let f = &m.footage;
                let kind = if f.kind == FootageKind::Audio { "audio" } else { "video" };
                Ok(json!({
                    "id": id, "kind": kind, "mediaType": m.media_type,
                    "width": f.width, "height": f.height,
                    "durationTicks": f.duration.0.to_string(),
                    "durationSeconds": f.duration.seconds(),
                    "frameRate": { "num": f.frame_rate.num, "den": f.frame_rate.den },
                    "hasVideo": f.has_video, "hasAudio": f.has_audio,
                    "audioSampleRate": if f.has_audio { 48000 } else { 0 },
                    "audioChannels": if f.has_audio { 2 } else { 0 },
                    "codec": f.codec
                }))
            }
        }
    }

    pub fn validate(&self, footage: &Footage) -> Result<(), String> {
        let found = self
            .entries
            .values()
            .find(|entry| match entry {
                StoredAsset::Raster(r) => r.uri == footage.path,
                StoredAsset::Media(m) => m.uri == footage.path,
            })
            .ok_or("motion_owned_asset_missing")?;
        if !footage.sequence.is_empty() || footage.layer.is_some() || footage.data.is_some() {
            return Err("motion_asset_source_mismatch".into());
        }
        match found {
            StoredAsset::Raster(raster) => {
                if footage.kind != FootageKind::Still
                    || footage.width != raster.image.width
                    || footage.height != raster.image.height
                    || !footage.has_video
                    || footage.has_audio
                {
                    return Err("motion_asset_source_mismatch".into());
                }
            }
            StoredAsset::Media(media) => {
                let expected = &media.footage;
                if footage.kind != expected.kind
                    || footage.width != expected.width
                    || footage.height != expected.height
                    || footage.has_video != expected.has_video
                    || footage.has_audio != expected.has_audio
                    || footage.duration != expected.duration
                {
                    return Err("motion_asset_source_mismatch".into());
                }
            }
        }
        Ok(())
    }

    fn entry_for_path(&self, path: &str) -> Option<&StoredAsset> {
        self.entries.values().find(|entry| match entry {
            StoredAsset::Raster(r) => r.uri == path,
            StoredAsset::Media(m) => m.uri == path,
        })
    }
}

impl FootageSource for OwnedAssets {
    fn frame(&self, item: ItemId, footage: &Footage, t: Tick) -> Option<Arc<Image>> {
        match self.entry_for_path(&footage.path)? {
            StoredAsset::Raster(r) => Some(r.image.clone()),
            StoredAsset::Media(m) => {
                let mut mapped = footage.clone();
                mapped.path = m.pool_path.clone();
                self.pool.frame(item, &mapped, t)
            }
        }
    }

    fn frame_at_size(
        &self,
        item: ItemId,
        footage: &Footage,
        t: Tick,
        w: u32,
        h: u32,
    ) -> Option<Arc<Image>> {
        match self.entry_for_path(&footage.path)? {
            StoredAsset::Raster(r) => Some(r.image.clone()),
            StoredAsset::Media(m) => {
                let mut mapped = footage.clone();
                mapped.path = m.pool_path.clone();
                self.pool.frame_at_size(item, &mapped, t, w, h)
            }
        }
    }

    fn audio(
        &self,
        item: ItemId,
        footage: &Footage,
        t: Tick,
        frames: usize,
        rate: u32,
    ) -> Option<Vec<f32>> {
        match self.entry_for_path(&footage.path)? {
            StoredAsset::Raster(_) => None,
            StoredAsset::Media(m) => {
                let mut mapped = footage.clone();
                mapped.path = m.pool_path.clone();
                self.pool.audio(item, &mapped, t, frames, rate)
            }
        }
    }
}

/// File-capable effect controls must contain inline data; their renderers otherwise open paths.
pub fn validate_effect_sources(
    group: &effectcraft_project::props::PropGroup,
    depth: usize,
) -> Result<(), String> {
    if depth > 64 {
        return Err("motion_property_depth_limit".into());
    }
    let effect = match &group.kind {
        effectcraft_project::props::GroupKind::Effect { effect } => effect.as_str(),
        _ => "",
    };
    let field = match effect {
        "ec.utility.applylut" => Some("lut"),
        "ec.color.ociofile" => Some("file"),
        "ec.obsolete.mochashape" => Some("shapeData"),
        "ec.color.ociocolorspace" | "ec.color.ociodisplay" => Some("configFile"),
        _ => None,
    };
    if let Some(field) = field {
        for property in group.props().filter(|p| p.match_id == field) {
            if property.expr.is_some() {
                return Err("motion_effect_needs_owned_text_asset".into());
            }
            for value in
                std::iter::once(&property.value).chain(property.keys.iter().map(|key| &key.value))
            {
                let effectcraft_project::Value::Str(text) = value else {
                    return Err("motion_invalid_effect_source".into());
                };
                let source = text.trim();
                let inline = match field {
                    "lut" => text.contains('\n') || text.contains("LUT_"),
                    "file" => text.contains('\n'),
                    "shapeData" => source.starts_with('{') || source.starts_with('['),
                    _ => false,
                };
                if !source.is_empty() && !inline {
                    return Err("motion_effect_needs_owned_text_asset".into());
                }
            }
        }
    }
    for child in group.groups() {
        validate_effect_sources(child, depth + 1)?;
    }
    Ok(())
}
