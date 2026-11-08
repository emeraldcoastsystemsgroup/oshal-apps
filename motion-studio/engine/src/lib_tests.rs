//! CHANGE LOG
//! 1 | maintainer@emeraldcoastsystemsgroup.com | Extract engine library unit tests and add RP-MOT-01/RP-MOT-02 audio, media-probing and motion-blur coverage.
#![allow(clippy::unwrap_used)]
use super::*;
use sha2::{Digest, Sha256};

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
fn sine_wav_asset(freq_hz: f64, seconds: f64) -> Value {
    let rate = 48_000u32;
    let frames = (seconds * f64::from(rate)).round() as usize;
    let pcm_bytes = (frames * 4) as u32;
    let mut wav = Vec::with_capacity(44 + pcm_bytes as usize);
    wav.extend_from_slice(b"RIFF");
    wav.extend_from_slice(&(36 + pcm_bytes).to_le_bytes());
    wav.extend_from_slice(b"WAVEfmt ");
    wav.extend_from_slice(&16u32.to_le_bytes());
    wav.extend_from_slice(&1u16.to_le_bytes());
    wav.extend_from_slice(&2u16.to_le_bytes());
    wav.extend_from_slice(&rate.to_le_bytes());
    wav.extend_from_slice(&(rate * 4).to_le_bytes());
    wav.extend_from_slice(&4u16.to_le_bytes());
    wav.extend_from_slice(&16u16.to_le_bytes());
    wav.extend_from_slice(b"data");
    wav.extend_from_slice(&pcm_bytes.to_le_bytes());
    for i in 0..frames {
        let phase = 2.0 * std::f64::consts::PI * freq_hz * (i as f64) / f64::from(rate);
        let sample = (phase.sin() * 0.5 * 32767.0).round() as i16;
        wav.extend_from_slice(&sample.to_le_bytes());
        wav.extend_from_slice(&sample.to_le_bytes());
    }
    json!({
        "id": "52e819a2-7c4d-4d61-82b5-9f88e33470a1",
        "sha256": format!("{:x}", Sha256::digest(&wav)),
        "data": STANDARD.encode(wav)
    })
}

#[test]
fn exact_key_adapters_edit_core_keys_and_native_undo_history() {
    let document = animated();
    let (comp, layer, prop) = key_reference(&document, "transform/opacity");
    let params =
        json!({"layer":layer.to_string(),"prop":prop.to_string(),"timeTicks":"254016000000"});
    let edited = invoke(
        json!({"op":"edit","document":document,"comp":comp,"commands":[{"command":"keys.addExact","params":{"layer":layer.to_string(),"prop":prop.to_string(),"timeTicks":"254016000000","value":37}},{"command":"keys.inspectExact","params":params}]}),
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
    assert_eq!(edited["result"]["results"][2]["key"]["out_interp"], "Linear");
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
fn exact_tick_preview_preserves_i64_bits_and_matches_ordinary_frame_pixels() {
    let document = animated();
    let precise = invoke(
        json!({"op":"preview","document":document,"time_ticks":635040000000_i64,"transparent":true}),
    );
    let ordinary = invoke(json!({"op":"preview","document":document,"time":2.5,"transparent":true}));
    assert_eq!(precise["ok"], true, "{precise}");
    let pixels = |reply: &Value| {
        image::load_from_memory(&STANDARD.decode(reply["result"]["png"].as_str().unwrap()).unwrap())
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
        let request =
            json!({"op":"preview","document":document,"comp":"Main","time":time,"transparent":true});
        let first = invoke(request.clone());
        assert_eq!(first["ok"], true, "{first}");
        assert_eq!(first, invoke(request));
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
    let pixels = image::RgbaImage::from_pixel(8, 8, image::Rgba([255, 0, 0, 128]));
    let mut bytes = std::io::Cursor::new(Vec::new());
    pixels.write_to(&mut bytes, image::ImageFormat::Png).unwrap();
    let bytes = bytes.into_inner();
    json!({"id":"91d9480c-39a4-4d2f-bf65-254cdbd48702", "sha256":format!("{:x}", Sha256::digest(&bytes)),"data":STANDARD.encode(bytes)})
}

fn raster_project(asset: &Value, masked: bool) -> Value {
    let mut commands = vec![
        json!({"command":"comp.new","params":{"name":"Photo","width":16,"height":16,"duration":5,"frameRate":30}}),
        json!({"command":"asset.import","params":{"assetId":asset["id"],"name":"Owned photo"}}),
    ];
    if masked {
        commands.push(
            json!({"command":"layer.addMask","params":{"layer":"#1","shape":"rect","rect":[0,0,4,8]}}),
        );
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
        assert_eq!(first, invoke(request));
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
    assert_eq!(
        invoke(json!({"op":"preview","document":document}))["error"],
        "motion_owned_asset_missing"
    );
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
    let mut malformed = asset;
    malformed["data"] = json!("invalid base64");
    assert_eq!(
        invoke(json!({"op":"inspect","document":document,"assets":[malformed]}))["error"],
        "motion_asset_invalid_encoding"
    );
}

#[test]
fn audio_layer_probes_imports_mixes_and_respects_mute_and_levels() {
    let wav_asset = sine_wav_asset(440.0, 1.0);
    let probed = invoke(json!({"op":"probe","assets":[wav_asset]}));
    assert_eq!(probed["ok"], true, "{probed}");
    assert_eq!(probed["result"]["kind"], "audio");
    assert_eq!(probed["result"]["mediaType"], "audio/wav");
    assert_eq!(probed["result"]["hasAudio"], true);
    assert_eq!(probed["result"]["hasVideo"], false);

    let created = invoke(json!({
        "op": "edit",
        "document": empty(),
        "assets": [wav_asset],
        "commands": [
            {"command":"comp.new","params":{"name":"AudioComp","width":320,"height":180,"duration":2,"frameRate":30}},
            {"command":"asset.import","params":{"assetId":wav_asset["id"],"name":"Tone track"}}
        ]
    }));
    assert_eq!(created["ok"], true, "{created}");
    let doc = created["result"]["document"].clone();
    let (comp, layer, levels_uid) = key_reference(&doc, "audio/levels");

    let mix = invoke(json!({
        "op": "audio",
        "document": doc,
        "comp": comp,
        "assets": [wav_asset],
        "start_ticks": "0",
        "end_ticks": "127008000000",
        "sample_rate": 48000,
        "peak_bins": 16
    }));
    assert_eq!(mix["ok"], true, "{mix}");
    assert_eq!(mix["result"]["hasAudio"], true);
    let peaks = mix["result"]["peaks"].as_array().unwrap();
    assert_eq!(peaks.len(), 16);
    let max_peak = peaks.iter().filter_map(Value::as_f64).fold(0.0, f64::max);
    assert!(max_peak > 0.4 && max_peak < 0.6, "unexpected peak: {max_peak}");

    let attenuated = invoke(json!({
        "op": "edit",
        "document": doc,
        "comp": comp,
        "assets": [wav_asset],
        "commands": [
            {"command":"properties.patchAt","params":{"layer":layer.to_string(),"compTimeTicks":"0","changes":[{"prop":levels_uid.to_string(),"value":[-12.0,-12.0]}]}}
        ]
    }));
    assert_eq!(attenuated["ok"], true, "{attenuated}");
    let quieter = invoke(json!({
        "op": "audio",
        "document": attenuated["result"]["document"],
        "comp": comp,
        "assets": [wav_asset],
        "start_ticks": "0",
        "end_ticks": "127008000000",
        "peak_bins": 8
    }));
    let quiet_peak = quieter["result"]["peaks"]
        .as_array()
        .unwrap()
        .iter()
        .filter_map(Value::as_f64)
        .fold(0.0, f64::max);
    assert!(quiet_peak < max_peak * 0.35 && quiet_peak > 0.05, "{quiet_peak}");

    let muted = invoke(json!({
        "op": "edit",
        "document": doc,
        "comp": comp,
        "assets": [wav_asset],
        "commands": [
            {"command":"layer.setSwitch","params":{"layers":[layer],"switch":"audio","value":false}}
        ]
    }));
    assert_eq!(muted["ok"], true, "{muted}");
    let silent = invoke(json!({
        "op": "audio",
        "document": muted["result"]["document"],
        "comp": comp,
        "assets": [wav_asset],
        "start_ticks": "0",
        "end_ticks": "127008000000",
        "peak_bins": 8
    }));
    assert_eq!(silent["result"]["hasAudio"], false);
}

#[test]
fn motion_blur_renders_translating_layer_streak_and_validates_shutter_bounds() {
    let setup = invoke(json!({
        "op": "edit",
        "document": empty(),
        "commands": [
            {"command":"comp.new","params":{"name":"BlurComp","width":320,"height":120,"duration":1,"frameRate":30}},
            {"command":"layer.newSolid","params":{"name":"Mover","color":"#ffffff","width":24,"height":60}},
            {"command":"prop.addKey","params":{"layer":"#1","path":"transform/position","time":0,"value":[20,60]}},
            {"command":"prop.addKey","params":{"layer":"#1","path":"transform/position","time":1,"value":[300,60]}},
            {"command":"comp.setSwitch","params":{"switch":"motionBlur","value":true}},
            {"command":"comp.settings","params":{"shutterAngle":360,"shutterPhase":-180,"motionBlurSamples":16}}
        ]
    }));
    assert_eq!(setup["ok"], true, "{setup}");
    let sharp_doc = setup["result"]["document"].clone();
    let (comp, layer, _) = key_reference(&sharp_doc, "transform/position");
    let sharp_png = STANDARD
        .decode(
            invoke(json!({"op":"preview","document":sharp_doc,"comp":comp,"time":0.5,"transparent":true}))
                ["result"]["png"]
                .as_str()
                .unwrap(),
        )
        .unwrap();
    let sharp_img = image::load_from_memory(&sharp_png).unwrap().to_rgba8();
    let sharp_semi = (0..320)
        .filter(|&x| {
            let a = sharp_img.get_pixel(x, 60).0[3];
            a > 0 && a < 255
        })
        .count();

    let blurred_doc = invoke(json!({
        "op": "edit",
        "document": sharp_doc,
        "comp": comp,
        "commands": [
            {"command":"layer.setSwitch","params":{"layers":[layer],"switch":"motionBlur","value":true}},
            {"command":"properties.inspectAt","params":{"layer":layer.to_string(),"compTimeTicks":"0"}}
        ]
    }));
    assert_eq!(blurred_doc["ok"], true, "{blurred_doc}");
    assert_eq!(blurred_doc["result"]["results"][1]["motionBlur"], true);
    let blur_png = STANDARD
        .decode(
            invoke(json!({"op":"preview","document":blurred_doc["result"]["document"],"comp":comp,"time":0.5,"transparent":true}))
                ["result"]["png"]
                .as_str()
                .unwrap(),
        )
        .unwrap();
    let blur_img = image::load_from_memory(&blur_png).unwrap().to_rgba8();
    let blur_semi = (0..320)
        .filter(|&x| {
            let a = blur_img.get_pixel(x, 60).0[3];
            a > 0 && a < 255
        })
        .count();
    assert!(
        blur_semi > sharp_semi + 6,
        "motion blur must widen horizontal partial-alpha streak: sharp={sharp_semi}, blur={blur_semi}"
    );

    let mut invalid = blurred_doc["result"]["document"].clone();
    invalid["items"]
        .as_object_mut()
        .unwrap()
        .values_mut()
        .find(|i| i["kind"]["type"] == "Comp")
        .unwrap()["kind"]["shutter_angle"] = json!(900.0);
    assert_eq!(
        invoke(json!({"op":"inspect","document":invalid}))["error"],
        "motion_graph_invalid_motion_blur"
    );
}

#[test]
fn oversized_text_source_and_per_character_budget_refuse_and_recover() {
    let seed = invoke(
        json!({"op":"edit","document":empty(),"commands":[{"command":"comp.new","params":{"width":320,"height":180,"duration":5,"frameRate":30}},{"command":"layer.newText","params":{"name":"3D","text":"MM","font":"Inter","size":6000}},{"command":"layer.enablePerChar3D","params":{"layer":"3D","enabled":true}}]}),
    );
    assert_eq!(seed["ok"], true);
    let frame = invoke(
        json!({"op":"preview","document":seed["result"]["document"],"time_ticks":0,"transparent":true}),
    );
    assert_eq!(frame["error"], "motion_text_surface_limit");
    let fixed = invoke(
        json!({"op":"edit","document":seed["result"]["document"],"commands":[{"command":"layer.setText","params":{"layer":"3D","size":24}}]}),
    );
    let recovered = invoke(
        json!({"op":"preview","document":fixed["result"]["document"],"time_ticks":0,"transparent":true}),
    );
    assert_eq!(recovered["ok"], true);
}
