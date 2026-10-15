//! CHANGE LOG
//! 1 | maintainer@emeraldcoastsystemsgroup.com | Decode bounded supplied raster bytes into the real compositor source without reading media paths.
use base64::{Engine as _, engine::general_purpose::STANDARD};
use effectcraft_project::{Footage, FootageKind, ItemId};
use effectcraft_raster::Image;
use effectcraft_render::FootageSource;
use effectcraft_time::Tick;
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::{collections::BTreeMap, io::Cursor, sync::Arc};

pub const MAX_ASSETS: usize = 64;
pub const MAX_ASSET_BYTES: usize = 4 * 1024 * 1024;
pub const MAX_TOTAL_BYTES: usize = 6 * 1024 * 1024;
pub const MAX_PIXELS: u64 = 33_554_432;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct EncodedAsset {
    pub id: String,
    pub sha256: String,
    pub data: String,
}
struct Raster {
    uri: String,
    image: Arc<Image>,
}
#[derive(Default)]
pub struct OwnedAssets {
    images: BTreeMap<String, Raster>,
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

impl OwnedAssets {
    pub fn decode(inputs: &[EncodedAsset]) -> Result<Self, String> {
        if inputs.len() > MAX_ASSETS {
            return Err("motion_asset_limit".into());
        }
        let mut source = Self::default();
        let mut total_bytes = 0usize;
        let mut total_pixels = 0u64;
        for input in inputs {
            let id = uuid::Uuid::parse_str(&input.id).map_err(|_| "motion_asset_invalid_id")?;
            if id.to_string() != input.id || !(1..=5).contains(&id.get_version_num()) {
                return Err("motion_asset_invalid_id".into());
            }
            if source.images.contains_key(&input.id) {
                return Err("motion_duplicate_asset".into());
            }
            if input.data.len() > MAX_ASSET_BYTES.div_ceil(3) * 4 {
                return Err("motion_asset_bytes_limit".into());
            }
            let bytes = STANDARD
                .decode(&input.data)
                .map_err(|_| "motion_asset_invalid_encoding")?;
            if bytes.is_empty() || bytes.len() > MAX_ASSET_BYTES {
                return Err("motion_asset_bytes_limit".into());
            }
            total_bytes = total_bytes
                .checked_add(bytes.len())
                .ok_or("motion_asset_bytes_limit")?;
            if total_bytes > MAX_TOTAL_BYTES {
                return Err("motion_asset_transport_limit".into());
            }
            let hash = format!("{:x}", Sha256::digest(&bytes));
            if input.sha256 != hash {
                return Err("motion_asset_digest_mismatch".into());
            }
            let format = image::guess_format(&bytes).map_err(|_| "motion_asset_invalid_raster")?;
            if ![
                image::ImageFormat::Png,
                image::ImageFormat::Jpeg,
                image::ImageFormat::WebP,
            ]
            .contains(&format)
            {
                return Err("motion_asset_unsupported_raster".into());
            }
            let (width, height) = reader(&bytes, format)
                .into_dimensions()
                .map_err(|_| "motion_asset_invalid_raster")?;
            let pixels = u64::from(width) * u64::from(height);
            if width == 0 || height == 0 || width > 8192 || height > 8192 || pixels > MAX_PIXELS {
                return Err("motion_asset_pixel_limit".into());
            }
            total_pixels = total_pixels
                .checked_add(pixels)
                .ok_or("motion_asset_pixel_limit")?;
            if total_pixels > MAX_PIXELS {
                return Err("motion_asset_pixel_limit".into());
            }
            let rgba = reader(&bytes, format)
                .decode()
                .map_err(|_| "motion_asset_invalid_raster")?
                .to_rgba8();
            let image = Arc::new(Image::from_rgba8(width, height, rgba.as_raw()));
            source.images.insert(
                input.id.clone(),
                Raster {
                    uri: format!("oshal-asset:{}@{hash}", input.id),
                    image,
                },
            );
        }
        Ok(source)
    }
    pub fn footage(&self, id: &str) -> Result<Footage, String> {
        let raster = self.images.get(id).ok_or("motion_owned_asset_missing")?;
        Ok(Footage {
            path: raster.uri.clone(),
            kind: FootageKind::Still,
            width: raster.image.width,
            height: raster.image.height,
            has_video: true,
            codec: "owned-raster".into(),
            ..Footage::default()
        })
    }
    pub fn validate(&self, footage: &Footage) -> Result<(), String> {
        let raster = self
            .images
            .values()
            .find(|raster| raster.uri == footage.path)
            .ok_or("motion_owned_asset_missing")?;
        if footage.kind != FootageKind::Still
            || footage.width != raster.image.width
            || footage.height != raster.image.height
            || !footage.has_video
            || footage.has_audio
            || !footage.sequence.is_empty()
            || footage.layer.is_some()
            || footage.data.is_some()
        {
            return Err("motion_asset_source_mismatch".into());
        }
        Ok(())
    }
}
impl FootageSource for OwnedAssets {
    fn frame(&self, _: ItemId, footage: &Footage, _: Tick) -> Option<Arc<Image>> {
        self.images
            .values()
            .find(|raster| raster.uri == footage.path)
            .map(|raster| raster.image.clone())
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
                    // Custom OCIO configurations can contain further file references.
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
