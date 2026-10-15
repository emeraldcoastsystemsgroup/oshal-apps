//! CHANGE LOG
//! 1 | maintainer@emeraldcoastsystemsgroup.com | Execute declarative motion edits and genuine CPU previews using a pinned compositor, with no filesystem or shell commands.
//! 2 | maintainer@emeraldcoastsystemsgroup.com | Admit bounded supplied raster footage through the actual compositor source and a typed native import command.
//! 3 | maintainer@emeraldcoastsystemsgroup.com | Validate native source, folder, composition, parent and matte graphs before execution and preview.
//! 4 | maintainer@emeraldcoastsystemsgroup.com | Publish the actual pinned time unit for manual timeline/keyframe controls.
//! 5 | maintainer@emeraldcoastsystemsgroup.com | Render exact signed native ticks directly through the pinned session without floating-second conversion.
//! 6 | maintainer@emeraldcoastsystemsgroup.com | Bind exact native keyframe adapters to the real core model and undo history.
use base64::{Engine as _, engine::general_purpose::STANDARD};
use effectcraft_automation::{Backend, confine::Confinement};
use effectcraft_project::{ItemKind, Project};
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

// Files, plug-in loading, scripts, application/window actions and render-queue outputs
// need separate owned-asset/job adapters. No caller can smuggle them through a batch.
fn check_command(command: &str) -> Result<(), String> {
    if command == "asset.import" {
        return Ok(());
    }
    let prefix = command.split('.').next().ok_or("motion_invalid_command")?;
    if ![
        "comp",
        "layer",
        "prop",
        "properties",
        "keys",
        "key",
        "effect",
        "mask",
        "shape",
        "text",
        "anim",
        "align",
        "marker",
        "track",
        "camera",
        "roto",
        "warp",
        "puppet",
        "essential",
        "select",
        "edit",
        "view",
        "command",
        "project",
        "render",
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

/// Add only a supplied raster to the native project; the ordinary core layer command places it.
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
        .unwrap_or("Owned image");
    if name.is_empty() || name.len() > 160 || name.chars().any(char::is_control) {
        return Err("motion_asset_invalid_name".into());
    }
    let footage = assets.footage(id)?;
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
    Ok(json!({"assetId":id,"item":item.0,"layer":layer}))
}

/// Every edit occurs in an isolated in-memory session. Errors yield no revised document.
/// The original request contains no owner, executable code or output filename selector.
pub fn process(request: Request) -> Result<Value, String> {
    // Production invokes one request per tracked worker. Serialize library-test calls as well,
    // so a refusal flagged by parallel compositor threads belongs to this request alone.
    static REQUEST_RENDER_SCOPE: std::sync::Mutex<()> = std::sync::Mutex::new(());
    let _render_scope = REQUEST_RENDER_SCOPE
        .lock()
        .unwrap_or_else(|poison| poison.into_inner());
    effectcraft_render::text::take_surface_limit();
    if !["create", "catalog", "inspect", "edit", "preview"].contains(&request.op.as_str()) {
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
    let assets = Arc::new(OwnedAssets::decode(&request.assets)?);
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
        let id = session
            .resolve_comp(Some(comp))
            .map_err(|e| e.to_string())?;
        session.open_comp(id);
    }
    let mut backend = Backend::headless(session);
    backend.confine(Confinement::new(&[], &[]).map_err(|e| e.to_string())?);
    let mut results = Vec::new();
    if request.op == "edit" {
        for (index, command) in request.commands.iter().enumerate() {
            check_command(&command.command)?;
            if !command.params.is_object() {
                return Err("motion_params_must_be_object".into());
            }
            let result = if [
                "keys.inspectExact",
                "keys.selectExact",
                "keys.addExact",
                "keys.patchExact",
            ]
            .contains(&command.command.as_str())
            {
                exact_keys::execute(&mut backend, &command.command, &command.params)?
            } else if ["text.inspectAt", "text.patchAt"].contains(&command.command.as_str()) {
                exact_text::execute(&mut backend, &command.command, &command.params)?
            } else if ["mask.inspectAt", "mask.patchAt"].contains(&command.command.as_str()) {
                exact_masks::execute(&mut backend, &command.command, &command.params)?
            } else if ["properties.inspectAt", "properties.patchAt"]
                .contains(&command.command.as_str())
            {
                exact_properties::execute(&mut backend, &command.command, &command.params)?
            } else if command.command == "asset.import" {
                import_asset(&mut backend, &assets, &command.params)?
            } else {
                backend
                    .exec(&command.command, command.params.clone())
                    .map_err(|e| format!("motion_edit_step_{}: {e}", index + 1))?
            };
            let session = backend.session().ok_or("motion_session_unavailable")?;
            check_document(&session.project, &assets)?;
            results.push(result);
        }
    }
    if request.op == "catalog" {
        let commands = backend
            .exec(
                "command.list",
                json!({"filter": request.filter, "schemas": true}),
            )
            .map_err(|e| e.to_string())?;
        let mut commands = commands
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
        if request
            .filter
            .as_ref()
            .is_none_or(|filter| "asset.import".contains(filter))
        {
            commands.push(json!({"id":"asset.import","label":"Import owned raster","params":"{assetId,name?}",
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
                    request.filter.as_ref().is_none_or(|filter| {
                        entry["id"].as_str().is_some_and(|id| id.contains(filter))
                    })
                }),
        );
        return Ok(
            json!({"upstream": UPSTREAM, "ticksPerSecond":effectcraft_time::TICKS_PER_SECOND,"commands": commands, "renderer": "cpu", "assetTransport": true,
                "assetLimits":{"count":64,"bytes":4194304,"requestBytes":6291456,"pixels":33554432},"textSurfacePixels":effectcraft_render::text::MAX_TEXT_SURFACE_PIXELS,"nativeRenderDerivative":"full-bounded-text-surfaces","perCharacterTextSurfacePixels":effectcraft_render::text::MAX_TEXT_SURFACE_PIXELS,"exportJobs": false}),
        );
    }
    if request.op == "preview" {
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
            (
                frame.png,
                frame.width,
                frame.height,
                frame.comp,
                frame.time,
                None,
            )
        };
        if effectcraft_render::text::take_surface_limit() {
            return Err("motion_text_surface_limit".into());
        }
        if png.len() > 8 * 1024 * 1024 {
            return Err("motion_preview_bytes_limit".into());
        }
        return Ok(
            json!({"upstream": UPSTREAM, "png": STANDARD.encode(png), "width": width,
            "height": height, "comp": comp, "time": time, "timeTicks": ticks, "transparent": request.transparent}),
        );
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

/// A bounded single-request protocol; suitable for one tracked sandbox child per job.
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
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;
    fn invoke(value: Value) -> Value {
        handle(&serde_json::to_vec(&value).unwrap())
    }
    fn empty() -> Value {
        invoke(json!({"op":"create"}))["result"]["document"].clone()
    }
    fn animated() -> Value {
        let result = invoke(json!({"op":"edit","document":empty(),"commands":[
            {"command":"comp.new","params":{"name":"Main","width":320,"height":180,"duration":5,"frameRate":30}},
            {"command":"layer.newSolid","params":{"name":"Logo","color":"#ff0000","width":100,"height":60}},
            {"command":"prop.addKey","params":{"layer":"#1","path":"transform/opacity","time":0,"value":0}},
            {"command":"prop.addKey","params":{"layer":"#1","path":"transform/opacity","time":5,"value":100}}
        ]}));
        assert_eq!(result["ok"], true, "{result}");
        result["result"]["document"].clone()
    }
    fn key_reference(document: &Value, path: &str) -> (u64, u64, u64) {
        let comp = document["items"]
            .as_object()
            .unwrap()
            .values()
            .find(|item| item["kind"]["type"] == "Comp")
            .unwrap();
        let layer = &comp["kind"]["layers"][0];
        let mut prop = &layer["props"];
        for part in path.split('/') {
            prop = prop["children"]
                .as_array()
                .unwrap()
                .iter()
                .find(|node| node["match"] == part)
                .unwrap();
        }
        (
            comp["id"].as_u64().unwrap(),
            layer["id"].as_u64().unwrap(),
            prop["uid"].as_u64().unwrap(),
        )
    }
    #[test]
    fn exact_key_adapters_edit_core_keys_and_native_undo_history() {
        let document = animated();
        let (comp, layer, prop) = key_reference(&document, "transform/opacity");
        let params =
            json!({"layer":layer.to_string(),"prop":prop.to_string(),"timeTicks":"254016000000"});
        let edited = invoke(
            json!({"op":"edit","document":document,"comp":comp,"commands":[{"command":"keys.addExact","params":{ "layer":layer.to_string(),"prop":prop.to_string(),"timeTicks":"254016000000","value":37 }},{"command":"keys.inspectExact","params":params}]}),
        );
        assert_eq!(edited["ok"], true, "{edited}");
        assert_eq!(edited["result"]["results"][1]["key"]["value"]["v"], 37.0);
        let undo = invoke(
            json!({"op":"edit","document":document,"comp":comp,"commands":[{"command":"keys.addExact","params":params},{"command":"edit.undo","params":{}}]}),
        );
        assert_eq!(undo["ok"], true, "{undo}");
        assert_eq!(undo["result"]["document"], document);
    }
    #[test]
    fn exact_neighbor_ticks_target_only_one_key_and_native_interpolation_uses_exact_selection() {
        let mut document = animated();
        let (comp, layer, prop) = key_reference(&document, "transform/opacity");
        let c = document["items"]
            .as_object_mut()
            .unwrap()
            .values_mut()
            .find(|item| item["kind"]["type"] == "Comp")
            .unwrap();
        let opacity = c["kind"]["layers"][0]["props"]["children"]
            .as_array_mut()
            .unwrap()
            .iter_mut()
            .find(|n| n["match"] == "transform")
            .unwrap()["children"]
            .as_array_mut()
            .unwrap()
            .iter_mut()
            .find(|n| n["match"] == "opacity")
            .unwrap();
        opacity["keys"][0]["time"] = json!(9007199254740992_i64);
        opacity["keys"][1]["time"] = json!(9007199254740993_i64);
        let edited = invoke(
            json!({"op":"edit","document":document,"comp":comp,"commands":[{"command":"keys.selectExact","params":{"layer":layer.to_string(),"prop":prop.to_string(),"timeTicks":"9007199254740993"}},{"command":"keys.interpolation","params":{"interpolation":"hold"}},{"command":"keys.inspectExact","params":{"layer":layer.to_string(),"prop":prop.to_string(),"timeTicks":"9007199254740992"}},{"command":"keys.inspectExact","params":{"layer":layer.to_string(),"prop":prop.to_string(),"timeTicks":"9007199254740993"}}]}),
        );
        assert_eq!(edited["ok"], true, "{edited}");
        assert_eq!(
            edited["result"]["results"][2]["key"]["out_interp"],
            "Linear"
        );
        assert_eq!(edited["result"]["results"][3]["key"]["out_interp"], "Hold");
        assert_eq!(
            edited["result"]["results"][3]["layerTimeTicks"].as_i64(),
            Some(9007199254740993)
        );
    }
    #[test]
    fn exact_key_patch_refuses_collisions_forged_fields_and_locked_writes() {
        let document = animated();
        let (comp, layer, prop) = key_reference(&document, "transform/opacity");
        let base = json!({"layer":layer.to_string(),"prop":prop.to_string(),"timeTicks":"0"});
        let mut collision = base.clone();
        collision["newTimeTicks"] = json!("1270080000000");
        assert_eq!(
            invoke(
                json!({"op":"edit","document":document,"comp":comp,"commands":[{"command":"keys.patchExact","params":collision}]})
            )["error"],
            "motion_keyframe_collision"
        );
        let mut forged = base.clone();
        forged["owner"] = json!("another");
        assert_eq!(
            invoke(
                json!({"op":"edit","document":document,"comp":comp,"commands":[{"command":"keys.selectExact","params":forged}]})
            )["error"],
            "motion_invalid_exact_keyframe"
        );
        let mut locked = document;
        locked["items"]
            .as_object_mut()
            .unwrap()
            .values_mut()
            .find(|c| c["kind"]["type"] == "Comp")
            .unwrap()["kind"]["layers"][0]["switches"]["locked"] = json!(true);
        assert_eq!(
            invoke(
                json!({"op":"edit","document":locked,"comp":comp,"commands":[{"command":"keys.selectExact","params":base}]})
            )["error"],
            "motion_keyframe_locked"
        );
        assert_eq!(
            invoke(
                json!({"op":"edit","document":locked,"comp":comp,"commands":[{"command":"keys.inspectExact","params":base}]})
            )["ok"],
            true
        );
    }
    #[test]
    fn exact_spatial_handles_use_native_cubic_samples_and_rendered_pixels() {
        let seed=invoke(json!({"op":"edit","document":empty(),"commands":[{"command":"comp.new","params":{"name":"Path","width":160,"height":90,"duration":2,"frameRate":30}},{"command":"layer.newSolid","params":{"name":"Dot","width":10,"height":6,"color":"#ff0000"}}]}))["result"]["document"].clone();
        let (comp, layer, prop) = key_reference(&seed, "transform/position");
        let refs = |time: &str| json!({"layer":layer.to_string(),"prop":prop.to_string(),"timeTicks":time});
        let mut a = refs("0");
        a["value"] = json!([40, 60, 0]);
        let mut b = refs("508032000000");
        b["value"] = json!([120, 60, 0]);
        let mut out = refs("0");
        out["spatialOut"] = json!([80.0 / 3.0, -40, 0]);
        let mut inn = refs("508032000000");
        inn["spatialIn"] = json!([-80.0 / 3.0, -40, 0]);
        let edited = invoke(
            json!({"op":"edit","document":seed,"comp":comp,"commands":[{"command":"keys.addExact","params":a},{"command":"keys.addExact","params":b},{"command":"keys.patchExact","params":out},{"command":"keys.patchExact","params":inn},{"command":"keys.inspectExact","params":refs("0")}]}),
        );
        assert_eq!(edited["ok"], true, "{edited}");
        let value = &edited["result"]["results"][4]["samples"][32]["value"];
        assert!((value[0].as_f64().unwrap() - 80.0).abs() < 1e-9);
        assert!((value[1].as_f64().unwrap() - 30.0).abs() < 1e-9);
        let frame = invoke(
            json!({"op":"preview","document":edited["result"]["document"],"comp":comp,"time_ticks":254016000000_i64,"transparent":true}),
        );
        let pixels = image::load_from_memory(
            &STANDARD
                .decode(frame["result"]["png"].as_str().unwrap())
                .unwrap(),
        )
        .unwrap()
        .to_rgba8();
        assert_eq!(pixels.get_pixel(80, 30).0[3], 255);
        assert_eq!(pixels.get_pixel(80, 60).0[3], 0);
    }
    #[test]
    fn exact_tick_preview_preserves_i64_bits_and_matches_ordinary_frame_pixels() {
        let document = animated();
        let precise = invoke(
            json!({"op":"preview","document":document,"time_ticks":635040000000_i64,"transparent":true}),
        );
        let ordinary =
            invoke(json!({"op":"preview","document":document,"time":2.5,"transparent":true}));
        assert_eq!(precise["ok"], true, "{precise}");
        let pixels = |reply: &Value| {
            image::load_from_memory(
                &STANDARD
                    .decode(reply["result"]["png"].as_str().unwrap())
                    .unwrap(),
            )
            .unwrap()
            .to_rgba8()
        };
        assert_eq!(pixels(&precise), pixels(&ordinary));
        for ticks in [9007199254740993_i64, i64::MAX] {
            let exact = invoke(
                json!({"op":"preview","document":document,"time_ticks":ticks,"transparent":true}),
            );
            assert_eq!(exact["ok"], true, "{exact}");
            assert_eq!(exact["result"]["timeTicks"].as_i64(), Some(ticks));
        }
        assert_eq!(
            invoke(json!({"op":"preview","document":document,"time_ticks":1,"time":0.0}))["error"],
            "motion_exact_time_conflict"
        );
    }
    #[test]
    fn renderer_decodes_first_middle_last_with_actual_alpha_and_reproducibility() {
        let document = animated();
        for (time, alpha) in [(0.0, 0), (2.5, 128), (149.0 / 30.0, 253)] {
            let request = json!({"op":"preview","document":document,"comp":"Main","time":time,"transparent":true});
            let first = invoke(request.clone());
            assert_eq!(first["ok"], true, "{first}");
            let again = invoke(request);
            assert_eq!(
                first, again,
                "same snapshot/time must render identical bytes"
            );
            let png = STANDARD
                .decode(first["result"]["png"].as_str().unwrap())
                .unwrap();
            let pixels = image::load_from_memory(&png).unwrap().to_rgba8();
            assert_eq!(pixels.dimensions(), (320, 180));
            let expected = if alpha == 0 {
                [0, 0, 0, 0]
            } else {
                [255, 0, 0, alpha]
            };
            assert_eq!(pixels.get_pixel(160, 90).0, expected);
            assert_eq!(pixels.get_pixel(0, 0).0[3], 0);
        }
    }
    #[test]
    fn engine_reopens_native_document_and_invalid_batch_produces_no_document() {
        let document = animated();
        let inspected = invoke(json!({"op":"inspect","document":document,"comp":"Main"}));
        assert_eq!(inspected["ok"], true);
        assert_eq!(inspected["result"]["summary"]["items"][0]["layers"], 1);
        let failed = invoke(json!({"op":"edit","document":document,"commands":[
            {"command":"layer.newText","params":{"text":"Discard this"}},
            {"command":"prop.set","params":{"layer":"missing-layer","path":"transform/opacity","value":50}}
        ]}));
        assert!(failed.get("error").is_some(), "{failed}");
        assert!(failed.get("result").is_none());
        let reopened = invoke(json!({"op":"inspect","document":document}));
        assert_eq!(reopened["result"]["summary"]["items"][0]["layers"], 1);
    }
    #[test]
    fn registry_is_real_and_file_shell_code_and_unknown_fields_are_refused() {
        let catalog = invoke(json!({"op":"catalog","filter":"comp.new"}));
        assert_eq!(catalog["result"]["commands"][0]["id"], "comp.new");
        assert!(catalog["result"]["commands"][0]["schema"].is_object());
        for command in [
            "file.open",
            "script.run",
            "file.executeFile",
            "renderQueue.run",
            "effect.plugins.load",
        ] {
            let result = invoke(
                json!({"op":"edit","document":empty(),"commands":[{"command":command,"params":{"path":"/etc/passwd"}}]}),
            );
            assert!(result.get("error").is_some(), "{command}: {result}");
        }
        for request in [
            json!({"op":"create","owner":"another-person"}),
            json!({"op":"create","commands":[{"command":"comp.new"}]}),
            json!({"op":"preview","document":empty(),"max_side":0}),
        ] {
            assert!(invoke(request).get("error").is_some());
        }
    }
    #[test]
    fn corrupt_or_oversized_json_is_a_bounded_error() {
        assert_eq!(handle(b"{")["error"], "motion_invalid_request");
        assert_eq!(
            handle(&vec![b' '; MAX_REQUEST + 1])["error"],
            "motion_request_limit"
        );
        assert!(
            invoke(json!({"op":"edit","document":{},"commands":[{"command":"comp.new"}]}))
                .get("error")
                .is_some()
        );
    }
    fn raster_asset() -> Value {
        use sha2::{Digest, Sha256};
        let pixels = image::RgbaImage::from_pixel(8, 8, image::Rgba([255, 0, 0, 128]));
        let mut bytes = std::io::Cursor::new(Vec::new());
        pixels
            .write_to(&mut bytes, image::ImageFormat::Png)
            .unwrap();
        let bytes = bytes.into_inner();
        json!({"id":"91d9480c-39a4-4d2f-bf65-254cdbd48702", "sha256":format!("{:x}", Sha256::digest(&bytes)),"data":STANDARD.encode(bytes)})
    }
    fn raster_project(asset: &Value, masked: bool) -> Value {
        let mut commands = vec![
            json!({"command":"comp.new","params":{"name":"Photo","width":16,"height":16,"duration":5,"frameRate":30}}),
            json!({"command":"asset.import","params":{"assetId":asset["id"],"name":"Owned photo"}}),
        ];
        if masked {
            commands.push(json!({"command":"layer.addMask","params":{"layer":"#1","shape":"rect","rect":[0,0,4,8]}}));
        }
        let result =
            invoke(json!({"op":"edit","document":empty(),"assets":[asset],"commands":commands}));
        assert_eq!(result["ok"], true, "{result}");
        result["result"]["document"].clone()
    }
    #[test]
    fn owned_raster_is_actually_composited_masked_reopened_and_byte_reproducible() {
        let asset = raster_asset();
        for masked in [false, true] {
            let document = raster_project(&asset, masked);
            let request = json!({"op":"preview","document":document,"assets":[asset],"comp":"Photo","time":2.5,"transparent":true});
            let first = invoke(request.clone());
            assert_eq!(first["ok"], true, "{first}");
            assert_eq!(
                first,
                invoke(request),
                "owned bytes and native snapshot must produce identical output"
            );
            let png = STANDARD
                .decode(first["result"]["png"].as_str().unwrap())
                .unwrap();
            let pixels = image::load_from_memory(&png).unwrap().to_rgba8();
            assert_eq!(pixels.dimensions(), (16, 16));
            assert_eq!(pixels.get_pixel(5, 8).0, [255, 0, 0, 128]);
            assert_eq!(pixels.get_pixel(10, 8).0[3], if masked { 0 } else { 128 });
            assert_eq!(pixels.get_pixel(0, 0).0[3], 0);
            let opened = invoke(json!({"op":"inspect","document":document,"assets":[asset]}));
            assert_eq!(opened["result"]["document"], document);
        }
    }
    #[test]
    fn owned_source_digest_missing_bytes_external_paths_and_forged_dimensions_refuse() {
        let asset = raster_asset();
        let document = raster_project(&asset, false);
        let missing = invoke(json!({"op":"preview","document":document}));
        assert_eq!(missing["error"], "motion_owned_asset_missing");
        let mut forged = asset.clone();
        forged["sha256"] = json!("0".repeat(64));
        assert_eq!(
            invoke(json!({"op":"inspect","document":document,"assets":[forged]}))["error"],
            "motion_asset_digest_mismatch"
        );
        for (key, value) in [
            ("path", json!("/etc/passwd")),
            ("width", json!(900)),
            ("has_audio", json!(true)),
        ] {
            let mut modified = document.clone();
            let footage = modified["items"]
                .as_object_mut()
                .unwrap()
                .values_mut()
                .find_map(|item| {
                    if item["kind"]["type"] == "Footage" {
                        item.get_mut("kind")
                    } else {
                        None
                    }
                })
                .unwrap();
            footage[key] = value;
            assert!(
                invoke(json!({"op":"inspect","document":modified,"assets":[asset]}))
                    .get("error")
                    .is_some()
            );
        }
        assert_eq!(
            invoke(json!({"op":"inspect","document":document,"assets":[asset,asset]}))["error"],
            "motion_duplicate_asset"
        );
        let mut malformed = asset.clone();
        malformed["data"] = json!("invalid base64");
        assert_eq!(
            invoke(json!({"op":"inspect","document":document,"assets":[malformed]}))["error"],
            "motion_asset_invalid_encoding"
        );
    }
    #[test]
    fn owned_import_joins_atomic_batch_and_publishes_a_real_typed_adapter_command() {
        let asset = raster_asset();
        let catalog = invoke(json!({"op":"catalog","filter":"asset.import"}));
        assert_eq!(catalog["result"]["commands"][0]["id"], "asset.import");
        assert_eq!(
            catalog["result"]["commands"][0]["schema"]["additionalProperties"],
            false
        );
        let comp = invoke(json!({"op":"edit","document":empty(),"commands":[{"command":"comp.new","params":{"name":"Main","width":16,"height":16}}]}))["result"]["document"].clone();
        let failed = invoke(
            json!({"op":"edit","document":comp,"assets":[asset],"commands":[
                {"command":"asset.import","params":{"assetId":asset["id"]}},
                {"command":"script.run","params":{"script":"unavailable"}}
            ]}),
        );
        assert!(failed.get("error").is_some());
        assert!(failed.get("result").is_none());
        assert_eq!(
            invoke(json!({"op":"inspect","document":comp}))["result"]["summary"]["items"][0]["layers"],
            0
        );
        for params in [
            json!({"assetId":asset["id"],"path":"/tmp/override"}),
            json!({"assetId":asset["id"],"name":5}),
        ] {
            assert!(invoke(json!({"op":"edit","document":comp,"assets":[asset],"commands":[{"command":"asset.import","params":params}]})).get("error").is_some());
        }
    }
    #[test]
    fn file_capable_effects_need_inline_data_before_rendering() {
        use effectcraft_project::Value as PropValue;
        use effectcraft_project::props::{GroupKind, Node, PropGroup, Property};
        let mut group = PropGroup {
            uid: 1,
            match_id: "ec.utility.applylut".into(),
            name: "LUT".into(),
            kind: GroupKind::Effect {
                effect: "ec.utility.applylut".into(),
            },
            enabled: true,
            children: vec![Node::Prop(Property::new(
                2,
                "lut",
                "LUT",
                PropValue::Str("/etc/passwd".into()),
            ))],
        };
        assert!(owned_assets::validate_effect_sources(&group, 0).is_err());
        if let Node::Prop(property) = &mut group.children[0] {
            property.value = PropValue::Str("LUT_1D_SIZE 2\n0 0 0\n1 1 1\n".into());
        }
        assert!(owned_assets::validate_effect_sources(&group, 0).is_ok());
        group.match_id = "innocent-visual-label".into();
        group.kind = GroupKind::Effect {
            effect: "ec.color.ociocolorspace".into(),
        };
        if let Node::Prop(property) = &mut group.children[0] {
            property.match_id = "configFile".into();
        }
        assert!(owned_assets::validate_effect_sources(&group, 0).is_err());
    }
    #[test]
    fn actual_jpeg_and_webp_bytes_feed_the_same_native_footage_renderer() {
        use sha2::{Digest, Sha256};
        for format in [image::ImageFormat::Jpeg, image::ImageFormat::WebP] {
            let rgba = image::RgbaImage::from_pixel(8, 8, image::Rgba([255, 0, 0, 128]));
            let mut bytes = std::io::Cursor::new(Vec::new());
            if format == image::ImageFormat::Jpeg {
                image::DynamicImage::ImageRgba8(rgba)
                    .to_rgb8()
                    .write_to(&mut bytes, format)
                    .unwrap();
            } else {
                rgba.write_to(&mut bytes, format).unwrap();
            }
            let bytes = bytes.into_inner();
            let asset = json!({"id":"91d9480c-39a4-4d2f-bf65-254cdbd48702","sha256":format!("{:x}",Sha256::digest(&bytes)),"data":STANDARD.encode(bytes)});
            let document = raster_project(&asset, false);
            let result = invoke(
                json!({"op":"preview","document":document,"assets":[asset],"time":0,"transparent":true}),
            );
            assert_eq!(result["ok"], true, "{result}");
            let bytes = STANDARD
                .decode(result["result"]["png"].as_str().unwrap())
                .unwrap();
            let image = image::load_from_memory(&bytes).unwrap().to_rgba8();
            let pixel = image.get_pixel(6, 8).0;
            assert!(
                pixel[0] >= 248 && pixel[1] <= 8 && pixel[2] <= 8,
                "{pixel:?}"
            );
            assert_eq!(
                pixel[3],
                if format == image::ImageFormat::Jpeg {
                    255
                } else {
                    128
                }
            );
        }
    }
    #[test]
    fn genuine_raster_headers_above_dimension_limits_refuse_before_pixel_allocation() {
        use sha2::{Digest, Sha256};
        let image = image::RgbaImage::from_pixel(8193, 1, image::Rgba([0, 0, 0, 0]));
        let mut bytes = std::io::Cursor::new(Vec::new());
        image.write_to(&mut bytes, image::ImageFormat::Png).unwrap();
        let bytes = bytes.into_inner();
        let asset = json!({"id":"91d9480c-39a4-4d2f-bf65-254cdbd48702","sha256":format!("{:x}",Sha256::digest(&bytes)),"data":STANDARD.encode(bytes)});
        let result = invoke(json!({"op":"inspect","document":empty(),"assets":[asset]}));
        assert!(result.get("error").is_some(), "{result}");
    }
    #[test]
    fn malformed_native_source_parent_matte_and_identity_graphs_refuse() {
        let document = animated();
        let mut project = effectcraft_project::Project::from_json(&document.to_string()).unwrap();
        let comp_id = *project.comps().next().unwrap().0;
        let layer_id = project.comp(comp_id).unwrap().layers[0].id;
        project.comp_mut(comp_id).unwrap().layers[0].parent = Some(layer_id);
        assert_eq!(graph::validate(&project).unwrap_err(), "motion_graph_cycle");
        project.comp_mut(comp_id).unwrap().layers[0].parent =
            Some(effectcraft_project::LayerId(999999));
        assert_eq!(
            graph::validate(&project).unwrap_err(),
            "motion_graph_missing_parent"
        );
        project.comp_mut(comp_id).unwrap().layers[0].parent = None;
        project.comp_mut(comp_id).unwrap().layers[0].track_matte =
            Some(effectcraft_project::TrackMatte {
                layer: layer_id,
                kind: Default::default(),
            });
        assert_eq!(graph::validate(&project).unwrap_err(), "motion_graph_cycle");
        project.comp_mut(comp_id).unwrap().layers[0].track_matte = None;
        project.comp_mut(comp_id).unwrap().layers[0].source =
            effectcraft_project::LayerSource::Comp { item: comp_id };
        assert_eq!(graph::validate(&project).unwrap_err(), "motion_graph_cycle");
        project.comp_mut(comp_id).unwrap().layers[0].source =
            effectcraft_project::LayerSource::Comp {
                item: effectcraft_project::ItemId(999999),
            };
        assert_eq!(
            graph::validate(&project).unwrap_err(),
            "motion_graph_missing_source"
        );
        project.comp_mut(comp_id).unwrap().layers[0].source =
            effectcraft_project::LayerSource::Text;
        project.comp_mut(comp_id).unwrap().frame_rate.den = 0;
        assert_eq!(
            graph::validate(&project).unwrap_err(),
            "motion_graph_invalid_timing"
        );
        project.comp_mut(comp_id).unwrap().frame_rate.den = 1;
        project.item_mut(comp_id).unwrap().id = effectcraft_project::ItemId(999999);
        assert_eq!(
            graph::validate(&project).unwrap_err(),
            "motion_graph_invalid_id"
        );
    }
    #[test]
    fn nested_compositions_render_normally_but_an_indirect_cycle_refuses() {
        let created = invoke(json!({"op":"edit","document":empty(),"commands":[
            {"command":"comp.new","params":{"name":"Child","width":32,"height":32,"duration":5}},
            {"command":"layer.newSolid","params":{"name":"Child logo","color":"#ff0000","width":16,"height":16}},
            {"command":"comp.new","params":{"name":"Parent","width":32,"height":32,"duration":5}},
            {"command":"layer.addItem","params":{"item":"Child"}}
        ]}));
        assert_eq!(created["ok"], true, "{created}");
        let document = &created["result"]["document"];
        let rendered = invoke(
            json!({"op":"preview","document":document,"comp":"Parent","time":2.5,"transparent":true}),
        );
        assert_eq!(rendered["ok"], true, "{rendered}");
        let image = image::load_from_memory(
            &STANDARD
                .decode(rendered["result"]["png"].as_str().unwrap())
                .unwrap(),
        )
        .unwrap()
        .to_rgba8();
        assert_eq!(image.get_pixel(16, 16).0, [255, 0, 0, 255]);
        let mut project = effectcraft_project::Project::from_json(&document.to_string()).unwrap();
        let child = project.find_by_name("Child").unwrap().id;
        let parent = project.find_by_name("Parent").unwrap().id;
        project.comp_mut(child).unwrap().layers[0].source =
            effectcraft_project::LayerSource::Comp { item: parent };
        let refused =
            invoke(json!({"op":"inspect","document":serde_json::to_value(project).unwrap()}));
        assert_eq!(refused["error"], "motion_graph_cycle");
    }
    fn text_seed() -> Value {
        let result = invoke(
            json!({"op":"edit","document":empty(),"commands":[{"command":"comp.new","params":{"name":"Text","width":160,"height":90,"duration":5,"frameRate":30}},{"command":"layer.newText","params":{"text":"A😀BC\nSecond","name":"Caption","size":20}}]}),
        );
        assert_eq!(result["ok"], true, "{result}");
        result["result"]["document"].clone()
    }
    #[test]
    fn exact_text_unicode_styles_replacement_and_native_undo() {
        let doc = text_seed();
        let (comp, layer, _) = key_reference(&doc, "text/sourceText");
        let refs = json!({"layer":layer.to_string(),"compTimeTicks":"0"});
        let result = invoke(
            json!({"op":"edit","document":doc,"comp":comp,"commands":[{"command":"text.patchAt","params":{"layer":layer.to_string(),"compTimeTicks":"0","range":[1,2],"attributes":{"fill":[1,0,0,0.5],"size":30}}},{"command":"text.inspectAt","params":refs}]}),
        );
        assert_eq!(result["ok"], true, "{result}");
        let value = &result["result"]["results"][1]["value"];
        assert_eq!(value["text"], "A😀BC\nSecond");
        assert_eq!(value["runs"][1]["len"], 1);
        assert_eq!(value["runs"][1]["style"]["size"], 30.0);
        assert_eq!(value["runs"][1]["style"]["fill"][3], 0.5);
        let replaced = invoke(
            json!({"op":"edit","document":result["result"]["document"],"comp":comp,"commands":[{"command":"text.patchAt","params":{"layer":layer.to_string(),"compTimeTicks":"0","range":[1,2],"attributes":{"text":"Ω","tracking":25}}},{"command":"text.inspectAt","params":refs}]}),
        );
        assert_eq!(replaced["ok"], true, "{replaced}");
        assert_eq!(
            replaced["result"]["results"][1]["value"]["text"],
            "AΩBC\nSecond"
        );
        let undo = invoke(
            json!({"op":"edit","document":doc,"comp":comp,"commands":[{"command":"text.patchAt","params":{"layer":layer.to_string(),"compTimeTicks":"0","attributes":{"text":"Other"}}},{"command":"edit.undo","params":{}}]}),
        );
        assert_eq!(undo["ok"], true, "{undo}");
        assert_eq!(undo["result"]["document"], doc);
    }
    #[test]
    fn exact_text_preserves_neighboring_wide_keys_and_layer_time_mapping() {
        let doc = text_seed();
        let (comp, layer, prop) = key_reference(&doc, "text/sourceText");
        let result = invoke(
            json!({"op":"edit","document":doc,"comp":comp,"commands":[{"command":"keys.addExact","params":{"layer":layer.to_string(),"prop":prop.to_string(),"timeTicks":"9007199254740992"}},{"command":"keys.addExact","params":{"layer":layer.to_string(),"prop":prop.to_string(),"timeTicks":"9007199254740993"}},{"command":"text.patchAt","params":{"layer":layer.to_string(),"compTimeTicks":"9007199254740993","attributes":{"text":"Exact neighbor"}}},{"command":"text.inspectAt","params":{"layer":layer.to_string(),"compTimeTicks":"9007199254740992"}},{"command":"text.inspectAt","params":{"layer":layer.to_string(),"compTimeTicks":"9007199254740993"}}]}),
        );
        assert_eq!(result["ok"], true, "{result}");
        assert_eq!(
            result["result"]["results"][3]["value"]["text"],
            "A😀BC\nSecond"
        );
        assert_eq!(
            result["result"]["results"][4]["value"]["text"],
            "Exact neighbor"
        );
        let mapped = invoke(
            json!({"op":"edit","document":doc,"comp":comp,"commands":[{"command":"layer.timing","params":{"layers":[layer],"start":1}},{"command":"text.patchAt","params":{"layer":layer.to_string(),"compTimeTicks":"508032000000","attributes":{"size":30}}}]}),
        );
        assert_eq!(mapped["ok"], true, "{mapped}");
        assert_eq!(
            mapped["result"]["results"][1]["layerTimeTicks"],
            "254016000000"
        );
    }
    #[test]
    fn exact_text_refuses_unknown_range_noop_and_lock_without_partial_result() {
        let doc = text_seed();
        let (comp, layer, _) = key_reference(&doc, "text/sourceText");
        for params in [
            json!({"layer":layer.to_string(),"compTimeTicks":"0","attributes":{"unknown":true}}),
            json!({"layer":layer.to_string(),"compTimeTicks":"0","range":[1,100],"attributes":{"size":30}}),
            json!({"layer":layer.to_string(),"compTimeTicks":"0","attributes":{"text":"A😀BC\nSecond"}}),
            json!({"layer":layer.to_string(),"compTimeTicks":"0","owner":"bob","attributes":{"size":30}}),
        ] {
            let result = invoke(
                json!({"op":"edit","document":doc,"comp":comp,"commands":[{"command":"text.patchAt","params":params}]}),
            );
            assert!(result.get("error").is_some(), "{result}");
            assert!(result.get("result").is_none());
        }
        let result = invoke(
            json!({"op":"edit","document":doc,"comp":comp,"commands":[{"command":"layer.setSwitch","params":{"layers":[layer],"switch":"locked","value":true}},{"command":"text.patchAt","params":{"layer":layer.to_string(),"compTimeTicks":"0","attributes":{"size":30}}}]}),
        );
        assert_eq!(result["error"], "motion_text_locked");
    }
    #[test]
    fn exact_text_explicit_stroke_disable_survives_native_color_and_width_side_effects() {
        let doc = text_seed();
        let (comp, layer, _) = key_reference(&doc, "text/sourceText");
        let result = invoke(
            json!({"op":"edit","document":doc,"comp":comp,"commands":[{"command":"text.patchAt","params":{"layer":layer.to_string(),"compTimeTicks":"0","attributes":{"stroke":[0,1,0,1],"strokeWidth":10,"applyStroke":false}}}]}),
        );
        assert_eq!(result["ok"], true, "{result}");
        assert_eq!(
            result["result"]["results"][0]["value"]["apply_stroke"],
            false
        );
        assert_eq!(
            result["result"]["results"][0]["value"]["stroke_width"],
            10.0
        );
    }
    #[test]
    fn oversized_text_source_refuses_the_frame_and_does_not_leak_a_limit_to_next_request() {
        let doc = text_seed();
        let (comp, layer, _) = key_reference(&doc, "text/sourceText");
        let huge = invoke(
            json!({"op":"edit","document":doc,"comp":comp,"commands":[{"command":"text.patchAt","params":{"layer":layer.to_string(),"compTimeTicks":"0","attributes":{"text":"MM","size":10000}}}]}),
        );
        assert_eq!(huge["ok"], true, "{huge}");
        let refused = invoke(
            json!({"op":"preview","document":huge["result"]["document"],"comp":comp,"time_ticks":0,"transparent":true}),
        );
        assert_eq!(refused["error"], "motion_text_surface_limit");
        assert!(refused.get("result").is_none());
        let normal = invoke(
            json!({"op":"preview","document":doc,"comp":comp,"time_ticks":0,"transparent":true}),
        );
        assert_eq!(normal["ok"], true, "{normal}");
    }
    #[test]
    fn per_character_text_budget_refuses_whole_frame_and_next_request_recovers() {
        let seed = invoke(
            json!({"op":"edit","document":empty(),"commands":[{"command":"comp.new","params":{"width":320,"height":180,"duration":5,"frameRate":30}},{"command":"layer.newText","params":{"name":"3D","text":"MM","font":"Inter","size":6000}},{"command":"layer.enablePerChar3D","params":{"layer":"3D","enabled":true}}]}),
        );
        assert!(seed["ok"] == true);
        let frame = invoke(
            json!({"op":"preview","document":seed["result"]["document"],"time_ticks":0,"transparent":true}),
        );
        assert_eq!(frame["error"], "motion_text_surface_limit");
        assert!(frame["result"].is_null());
        let fixed = invoke(
            json!({"op":"edit","document":seed["result"]["document"],"commands":[{"command":"layer.setText","params":{"layer":"3D","size":24}}]}),
        );
        let frame = invoke(
            json!({"op":"preview","document":fixed["result"]["document"],"time_ticks":0,"transparent":true}),
        );
        assert_eq!(frame["ok"], true);
        assert!(frame["result"]["png"].as_str().unwrap().len() > 100);
    }
}
