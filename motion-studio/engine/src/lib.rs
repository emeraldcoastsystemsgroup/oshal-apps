//! CHANGE LOG
//! 1 | maintainer@emeraldcoastsystemsgroup.com | Execute declarative motion edits and genuine CPU previews using a pinned compositor, with no filesystem or shell commands.
//! 2 | maintainer@emeraldcoastsystemsgroup.com | Admit bounded supplied raster footage through the actual compositor source and a typed native import command.
//! 3 | maintainer@emeraldcoastsystemsgroup.com | Validate native source, folder, composition, parent and matte graphs before execution and preview.
//! 4 | maintainer@emeraldcoastsystemsgroup.com | Publish the actual pinned time unit for manual timeline/keyframe controls.
//! 5 | maintainer@emeraldcoastsystemsgroup.com | Render exact signed native ticks directly through the pinned session without floating-second conversion.
//! 6 | maintainer@emeraldcoastsystemsgroup.com | Bind exact native keyframe adapters to the real core model and undo history.
//! 7 | maintainer@emeraldcoastsystemsgroup.com | RP-MOT-01, RP-MOT-02: admit owned video and audio layers, media probing, exact-tick audio mixes and composition/layer motion-blur rendering.
use base64::{Engine as _, engine::general_purpose::STANDARD};
use effectcraft_automation::{Backend, confine::Confinement};
use effectcraft_project::{ItemKind, LayerId, Project};
mod audio_ops;
mod exact_keys;
mod exact_masks;
mod exact_properties;
mod exact_text;
mod graph;
mod owned_assets;
use owned_assets::{EncodedAsset, OwnedAssets};
use serde::Deserialize;
use serde_json::{Value, json};
use std::sync::Arc;

pub const UPSTREAM: &str = "67434e90388b6dca4417555346fa6850b6f96033";
pub const MAX_REQUEST: usize = 12 * 1024 * 1024;
const MAX_DOCUMENT: usize = 2 * 1024 * 1024;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Request {
    pub op: String,
    #[serde(default)]
    pub document: Option<Value>,
    #[serde(default)]
    pub commands: Vec<Command>,
    #[serde(default)]
    pub assets: Vec<EncodedAsset>,
    #[serde(default)]
    pub comp: Option<Value>,
    #[serde(default)]
    pub time: Option<f64>,
    #[serde(default)]
    pub time_ticks: Option<i64>,
    #[serde(default)]
    pub start_ticks: Option<String>,
    #[serde(default)]
    pub end_ticks: Option<String>,
    #[serde(default)]
    pub sample_rate: Option<u32>,
    #[serde(default)]
    pub peak_bins: Option<usize>,
    #[serde(default = "preview_size")]
    pub max_side: u32,
    #[serde(default = "yes")]
    pub transparent: bool,
    #[serde(default)]
    pub filter: Option<String>,
}
fn preview_size() -> u32 {
    1280
}
fn yes() -> bool {
    true
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Command {
    pub command: String,
    #[serde(default = "empty_params")]
    pub params: Value,
}
fn empty_params() -> Value {
    json!({})
}

fn check_document(project: &Project, assets: &OwnedAssets) -> Result<(), String> {
    graph::validate(project)?;
    if project.items.len() > 2048 {
        return Err("motion_item_limit".into());
    }
    let mut layers = 0usize;
    for item in project.items.values() {
        if item.proxy.is_some() {
            return Err("motion_proxy_requires_owned_asset_transport".into());
        }
        if let ItemKind::Footage(footage) = &item.kind {
            assets.validate(footage)?;
        }
        if let ItemKind::Comp(comp) = &item.kind {
            if comp.width == 0
                || comp.height == 0
                || comp.width > 8192
                || comp.height > 8192
                || u64::from(comp.width) * u64::from(comp.height) > 33_554_432
            {
                return Err("motion_canvas_limit".into());
            }
            for layer in &comp.layers {
                owned_assets::validate_effect_sources(&layer.props, 0)?;
            }
            layers = layers
                .checked_add(comp.layers.len())
                .ok_or("motion_layer_limit")?;
        }
    }
    if layers > 16_384 {
        return Err("motion_layer_limit".into());
    }
    Ok(())
}

fn check_command(command: &str) -> Result<(), String> {
    if command == "asset.import" {
        return Ok(());
    }
    let prefix = command.split('.').next().ok_or("motion_invalid_command")?;
    if ![
        "comp", "layer", "prop", "properties", "keys", "key", "effect", "mask", "shape", "text",
        "anim", "align", "marker", "track", "camera", "roto", "warp", "puppet", "essential",
        "select", "edit", "view", "command", "project", "render",
    ]
    .contains(&prefix)
    {
        return Err("motion_command_not_admitted".into());
    }
    if command == "engine.batch"
        || command.starts_with("effect.plugins.")
        || command.starts_with("essential.import")
        || command.starts_with("essential.export")
        || command.starts_with("render.")
        || [
            "comp.saveFrameAs",
            "comp.saveFrameAsPsd",
            "comp.saveFrameAsExr",
            "anim.applyPreset",
            "anim.applyRecentPreset",
            "anim.savePreset",
            "view.importGuides",
            "view.exportGuides",
            "layer.openSource",
            "keys.rpfCameraImport",
        ]
        .contains(&command)
    {
        return Err("motion_command_needs_asset_or_export_adapter".into());
    }
    Ok(())
}

fn import_asset(
    backend: &mut Backend,
    assets: &OwnedAssets,
    params: &Value,
) -> Result<Value, String> {
    if params.as_object().is_none_or(|fields| {
        fields
            .keys()
            .any(|key| !["assetId", "name"].contains(&key.as_str()))
    }) {
        return Err("motion_asset_invalid_params".into());
    }
    let id = params
        .get("assetId")
        .and_then(Value::as_str)
        .ok_or("motion_asset_invalid_params")?;
    if params.get("name").is_some_and(|name| !name.is_string()) {
        return Err("motion_asset_invalid_name".into());
    }
    let name = params
        .get("name")
        .and_then(Value::as_str)
        .unwrap_or("Owned media");
    if name.is_empty() || name.len() > 160 || name.chars().any(char::is_control) {
        return Err("motion_asset_invalid_name".into());
    }
    let footage = assets.footage(id)?;
    let (has_video, has_audio) = (footage.has_video, footage.has_audio);
    let session = backend.session().ok_or("motion_session_unavailable")?;
    let item = Arc::make_mut(&mut session.project).add_item(
        name,
        Default::default(),
        None,
        ItemKind::Footage(footage),
    );
    let layer = backend
        .exec("layer.addItem", json!({"item":item.0}))
        .map_err(|e| e.to_string())?;
    if let (Some(lid), Some(session)) = (
        layer.get("layer").and_then(Value::as_u64),
        backend.session(),
    ) && let Some(cid) = session.active_comp_id()
        && let Some(added) = Arc::make_mut(&mut session.project)
            .comp_mut(cid)
            .and_then(|c| c.layer_mut(LayerId(lid)))
    {
        added.switches.video = has_video;
        added.switches.audio = has_audio;
    }
    Ok(json!({"assetId":id,"item":item.0,"layer":layer}))
}

fn validate_request(request: &Request) -> Result<(), String> {
    if ![
        "create", "catalog", "inspect", "edit", "preview", "probe", "audio",
    ]
    .contains(&request.op.as_str())
    {
        return Err("motion_invalid_operation".into());
    }
    if request.commands.len() > 32 {
        return Err("motion_command_limit".into());
    }
    if request.op != "edit" && !request.commands.is_empty() {
        return Err("motion_commands_need_edit".into());
    }
    if request.op == "edit" && request.commands.is_empty() {
        return Err("motion_empty_edit".into());
    }
    if request.op == "preview"
        && (request.max_side == 0
            || request.max_side > 4096
            || request
                .time
                .is_some_and(|time| !time.is_finite() || !(0.0..=86400.0).contains(&time)))
    {
        return Err("motion_preview_limit".into());
    }
    if request.time_ticks.is_some() && (request.op != "preview" || request.time.is_some()) {
        return Err("motion_exact_time_conflict".into());
    }
    if request.time_ticks.is_some_and(|ticks| ticks < 0) {
        return Err("motion_preview_limit".into());
    }
    Ok(())
}

fn execute_edits(
    backend: &mut Backend,
    assets: &OwnedAssets,
    commands: &[Command],
) -> Result<Vec<Value>, String> {
    let mut results = Vec::with_capacity(commands.len());
    for (index, command) in commands.iter().enumerate() {
        check_command(&command.command)?;
        if !command.params.is_object() {
            return Err("motion_params_must_be_object".into());
        }
        let result = match command.command.as_str() {
            "keys.inspectExact" | "keys.selectExact" | "keys.addExact" | "keys.patchExact" => {
                exact_keys::execute(backend, &command.command, &command.params)?
            }
            "text.inspectAt" | "text.patchAt" => {
                exact_text::execute(backend, &command.command, &command.params)?
            }
            "mask.inspectAt" | "mask.patchAt" => {
                exact_masks::execute(backend, &command.command, &command.params)?
            }
            "properties.inspectAt" | "properties.patchAt" => {
                exact_properties::execute(backend, &command.command, &command.params)?
            }
            "asset.import" => import_asset(backend, assets, &command.params)?,
            _ => backend
                .exec(&command.command, command.params.clone())
                .map_err(|e| format!("motion_edit_step_{}: {e}", index + 1))?,
        };
        let session = backend.session().ok_or("motion_session_unavailable")?;
        check_document(&session.project, assets)?;
        results.push(result);
    }
    Ok(results)
}

fn catalog_response(backend: &mut Backend, filter: Option<&String>) -> Result<Value, String> {
    let raw = backend
        .exec("command.list", json!({"filter": filter, "schemas": true}))
        .map_err(|e| e.to_string())?;
    let mut commands = raw
        .as_array()
        .ok_or("motion_invalid_catalog")?
        .iter()
        .filter(|entry| {
            entry
                .get("id")
                .and_then(Value::as_str)
                .is_some_and(|id| check_command(id).is_ok())
        })
        .cloned()
        .collect::<Vec<_>>();
    if filter.is_none_or(|f| "asset.import".contains(f)) {
        commands.push(json!({"id":"asset.import","label":"Import owned media","params":"{assetId,name?}",
            "schema":{"type":"object","additionalProperties":false,"required":["assetId"],
            "properties":{"assetId":{"type":"string","format":"uuid"},"name":{"type":"string","maxLength":160}}}}));
    }
    commands.extend(
        exact_keys::catalog()
            .into_iter()
            .chain(exact_text::schemas())
            .chain(exact_masks::schemas())
            .chain(exact_properties::schemas())
            .filter(|entry| {
                filter.is_none_or(|f| entry["id"].as_str().is_some_and(|id| id.contains(f)))
            }),
    );
    Ok(json!({
        "upstream": UPSTREAM,
        "ticksPerSecond": effectcraft_time::TICKS_PER_SECOND,
        "commands": commands,
        "renderer": "cpu",
        "assetTransport": true,
        "assetLimits": {
            "count": 64,
            "bytes": 4194304,
            "mediaBytes": 67108864,
            "requestBytes": 6291456,
            "sessionBytes": 201326592,
            "pixels": 33554432
        },
        "textSurfacePixels": effectcraft_render::text::MAX_TEXT_SURFACE_PIXELS,
        "nativeRenderDerivative": "full-bounded-text-surfaces",
        "perCharacterTextSurfacePixels": effectcraft_render::text::MAX_TEXT_SURFACE_PIXELS,
        "exportJobs": false
    }))
}

fn preview_response(backend: &mut Backend, request: &Request) -> Result<Value, String> {
    let (png, width, height, comp, time, ticks) = if let Some(ticks) = request.time_ticks {
        let session = backend.session().ok_or("motion_session_unavailable")?;
        let comp = session
            .resolve_comp(request.comp.as_ref())
            .map_err(|e| format!("motion_render_failed: {e}"))?;
        let (width, height, rgba) = session
            .render_rgba8_alpha(
                comp,
                effectcraft_time::Tick(ticks),
                request.max_side,
                request.transparent,
            )
            .map_err(|e| format!("motion_render_failed: {e}"))?;
        let mut png = Vec::new();
        image::ImageEncoder::write_image(
            image::codecs::png::PngEncoder::new(&mut png),
            &rgba,
            width,
            height,
            image::ExtendedColorType::Rgba8,
        )
        .map_err(|e| format!("motion_render_failed: {e}"))?;
        (
            png,
            width,
            height,
            json!(comp.0),
            effectcraft_time::Tick(ticks).seconds(),
            Some(ticks),
        )
    } else {
        let frame = backend
            .render_with(
                request.comp.as_ref(),
                request.time,
                request.max_side,
                request.transparent,
            )
            .map_err(|e| format!("motion_render_failed: {e}"))?;
        (frame.png, frame.width, frame.height, frame.comp, frame.time, None)
    };
    if effectcraft_render::text::take_surface_limit() {
        return Err("motion_text_surface_limit".into());
    }
    if png.len() > 8 * 1024 * 1024 {
        return Err("motion_preview_bytes_limit".into());
    }
    Ok(json!({
        "upstream": UPSTREAM, "png": STANDARD.encode(png), "width": width,
        "height": height, "comp": comp, "time": time, "timeTicks": ticks, "transparent": request.transparent
    }))
}

pub fn process(request: Request) -> Result<Value, String> {
    static REQUEST_RENDER_SCOPE: std::sync::Mutex<()> = std::sync::Mutex::new(());
    let _render_scope = REQUEST_RENDER_SCOPE
        .lock()
        .unwrap_or_else(|poison| poison.into_inner());
    effectcraft_render::text::take_surface_limit();
    validate_request(&request)?;
    let assets = Arc::new(OwnedAssets::decode(&request.assets)?);
    if request.op == "probe" {
        return audio_ops::probe_request(&request, &assets);
    }
    let mut session = effectcraft_host::session();
    session.footage = assets.clone();
    session.importer = None;
    session.exporter = None;
    session.script = None;
    session.script_ui.dispatch = None;
    session.plugin_loader = None;
    session.models_dir = None;
    if let Some(document) = &request.document {
        let text =
            serde_json::to_string(document).map_err(|e| format!("motion_invalid_document: {e}"))?;
        if text.len() > MAX_DOCUMENT {
            return Err("motion_document_limit".into());
        }
        let project =
            Project::from_json(&text).map_err(|e| format!("motion_invalid_document: {e}"))?;
        check_document(&project, &assets)?;
        session.replace_project(project, None);
    } else if !["create", "catalog"].contains(&request.op.as_str()) {
        return Err("motion_document_required".into());
    }
    if let Some(comp) = &request.comp {
        let id = session.resolve_comp(Some(comp)).map_err(|e| e.to_string())?;
        session.open_comp(id);
    }
    if request.op == "audio" {
        let comp_id = session
            .resolve_comp(request.comp.as_ref())
            .map_err(|e| format!("motion_audio_failed: {e}"))?;
        return audio_ops::render_audio(&request, &session.project, comp_id, &assets);
    }
    let mut backend = Backend::headless(session);
    backend.confine(Confinement::new(&[], &[]).map_err(|e| e.to_string())?);
    if request.op == "catalog" {
        return catalog_response(&mut backend, request.filter.as_ref());
    }
    let results = if request.op == "edit" {
        execute_edits(&mut backend, &assets, &request.commands)?
    } else {
        Vec::new()
    };
    if request.op == "preview" {
        return preview_response(&mut backend, &request);
    }
    if effectcraft_render::text::take_surface_limit() {
        return Err("motion_text_surface_limit".into());
    }
    let summary = backend
        .exec("project.summary", json!({}))
        .map_err(|e| e.to_string())?;
    let session = backend.session().ok_or("motion_session_unavailable")?;
    let document = serde_json::to_value(session.project.as_ref()).map_err(|e| e.to_string())?;
    if serde_json::to_vec(&document)
        .map_err(|e| e.to_string())?
        .len()
        > MAX_DOCUMENT
    {
        return Err("motion_document_limit".into());
    }
    Ok(json!({"upstream": UPSTREAM, "document": document, "summary": summary, "results": results}))
}

pub fn handle(bytes: &[u8]) -> Value {
    if bytes.len() > MAX_REQUEST {
        return json!({"error": "motion_request_limit"});
    }
    let request = match serde_json::from_slice::<Request>(bytes) {
        Ok(request) => request,
        Err(error) => {
            return json!({"error": "motion_invalid_request", "detail": error.to_string()});
        }
    };
    match std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| process(request))) {
        Ok(Ok(result)) => json!({"ok": true, "result": result}),
        Ok(Err(error)) => json!({"error": error}),
        Err(_) => json!({"error": "motion_engine_failed"}),
    }
}

#[cfg(test)]
mod lib_tests;
