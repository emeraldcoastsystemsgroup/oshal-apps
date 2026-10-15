//! CHANGE LOG
//! 1 | maintainer@emeraldcoastsystemsgroup.com | Inspect/select/edit actual native keyframes at exact decimal ticks without floating nearest-key selection.
use effectcraft_automation::Backend;
use effectcraft_project::{Keyframe, LayerId};
use effectcraft_time::Tick;
use serde_json::{Value, json};

const REFERENCES: &[&str] = &["layer", "prop", "timeTicks"];
fn bad() -> String {
    "motion_invalid_exact_keyframe".into()
}
fn unsigned(p: &Value, name: &str) -> Result<u64, String> {
    let s = p.get(name).and_then(Value::as_str).ok_or_else(bad)?;
    if s.is_empty()
        || s.len() > 20
        || !s.bytes().all(|c| c.is_ascii_digit())
        || s.len() > 1 && s.starts_with('0')
    {
        return Err(bad());
    }
    s.parse().map_err(|_| bad())
}
fn ticks(p: &Value, name: &str) -> Result<i64, String> {
    let s = p.get(name).and_then(Value::as_str).ok_or_else(bad)?;
    let digits = s.strip_prefix('-').unwrap_or(s);
    if digits.is_empty()
        || digits.len() > 19
        || !digits.bytes().all(|c| c.is_ascii_digit())
        || digits.len() > 1 && digits.starts_with('0')
        || s == "-0"
    {
        return Err(bad());
    }
    s.parse().map_err(|_| bad())
}
fn vector(p: &Value, name: &str) -> Result<Option<[f64; 3]>, String> {
    let Some(v) = p.get(name) else {
        return Ok(None);
    };
    let a = v.as_array().filter(|a| a.len() == 3).ok_or_else(bad)?;
    let mut out = [0.0; 3];
    for (target, value) in out.iter_mut().zip(a) {
        *target = value.as_f64().filter(|v| v.is_finite()).ok_or_else(bad)?;
    }
    Ok(Some(out))
}
pub fn execute(backend: &mut Backend, command: &str, p: &Value) -> Result<Value, String> {
    let fields = p.as_object().ok_or_else(bad)?;
    let patch = command == "keys.patchExact";
    let add = command == "keys.addExact";
    if fields.keys().any(|key| {
        !REFERENCES.contains(&key.as_str())
            && !(patch
                && [
                    "newTimeTicks",
                    "value",
                    "spatialIn",
                    "spatialOut",
                    "spatialAuto",
                    "spatialContinuous",
                ]
                .contains(&key.as_str()))
            && !(add && key == "value")
    }) {
        return Err(bad());
    }
    let lid = LayerId(unsigned(p, "layer")?);
    let uid = unsigned(p, "prop")?;
    let time = Tick(ticks(p, "timeTicks")?);
    let session = backend.session().ok_or("motion_session_unavailable")?;
    let cid = session
        .active_comp_id()
        .ok_or("motion_composition_required")?;
    let layer = session
        .project
        .comp(cid)
        .and_then(|c| c.layer(lid))
        .ok_or("motion_keyframe_layer_missing")?;
    let prop = layer
        .props
        .find(uid)
        .ok_or("motion_keyframe_property_missing")?;
    let indexes: Vec<_> = prop
        .keys
        .iter()
        .enumerate()
        .filter(|(_, k)| k.time == time)
        .map(|(i, _)| i)
        .collect();
    if indexes.len() > 1 {
        return Err("motion_keyframe_ambiguous".into());
    }
    if !add && indexes.is_empty() {
        return Err("motion_keyframe_missing".into());
    }
    if add && !indexes.is_empty() {
        return Err("motion_keyframe_collision".into());
    }
    if command == "keys.inspectExact" {
        let key = &prop.keys[indexes[0]];
        let (tin, tout) = effectcraft_project::keyframe::spatial_handles(&prop.keys, indexes[0]);
        let numeric = matches!(key.value.kind_name(), "scalar" | "vec2" | "vec3" | "color");
        let mut samples = Vec::new();
        if numeric {
            let start = prop.keys[indexes[0].saturating_sub(1)].time.0;
            let end = prop.keys[(indexes[0] + 1).min(prop.keys.len() - 1)].time.0;
            for index in 0..=64 {
                let at =
                    (i128::from(start) + (i128::from(end) - i128::from(start)) * index / 64) as i64;
                samples.push(
                    json!({"timeTicks":at.to_string(),"value":prop.value_at(Tick(at)).to_json()}),
                );
            }
        }
        let offset = indexes[0].saturating_sub(32);
        let path: Vec<_> = if prop.spatial {
            prop.keys.iter().enumerate().skip(offset).take(64).map(|(index,key)|{
            let (inn,out)=effectcraft_project::keyframe::spatial_handles(&prop.keys,index);
            json!({"timeTicks":key.time.0.to_string(),"value":key.value.to_json(),"in":inn,"out":out,"outInterp":key.out_interp.label()})
        }).collect()
        } else {
            Vec::new()
        };
        return Ok(
            json!({"layer":lid.0,"prop":uid,"propertyName":prop.name,"valueType":key.value.kind_name(),
            "spatial":prop.spatial,"holdOnly":prop.hold_only,"locked":layer.switches.locked,"hasExpression":prop.has_expression(),
            "layerTimeTicks":time.0,"compTimeTicks":layer.comp_time(time).0,"key":key,"resolvedSpatialIn":tin,"resolvedSpatialOut":tout,
            "samples":samples,"sampleSpace":"native keyframe values before expressions","pathWindow":{"offset":offset,"total":prop.keys.len(),"complete":offset==0&&path.len()==prop.keys.len(),"points":path}}),
        );
    }
    if layer.switches.locked || prop.static_only {
        return Err("motion_keyframe_locked".into());
    }
    let selection = serde_json::from_value(json!([{"layer":lid.0,"prop":uid,"time":time.0}]))
        .map_err(|_| bad())?;
    if command == "keys.selectExact" {
        session.state.selected_layers = vec![lid];
        session.state.selected_props = vec![(lid, uid)];
        session.state.selected_keys = selection;
        return Ok(
            json!({"selected":1,"layerTimeTicks":time.0,"compTimeTicks":layer.comp_time(time).0}),
        );
    }
    if !patch && !add {
        return Err(bad());
    }
    let new_time = Tick(if p.get("newTimeTicks").is_some() {
        ticks(p, "newTimeTicks")?
    } else {
        time.0
    });
    if patch
        && prop
            .keys
            .iter()
            .any(|k| k.time == new_time && k.time != time)
    {
        return Err("motion_keyframe_collision".into());
    }
    let mut updated = if add {
        Keyframe::new(time, prop.value_at(time))
    } else {
        prop.keys[indexes[0]].clone()
    };
    if add && prop.hold_only {
        updated = updated.hold();
    }
    let mut changed = add || new_time != time;
    if let Some(value) = p.get("value") {
        let v = updated.value.coerce_json(value).ok_or_else(bad)?;
        changed |= v != updated.value;
        updated.value = v;
    }
    let sin = vector(p, "spatialIn")?;
    let sout = vector(p, "spatialOut")?;
    if (sin.is_some()
        || sout.is_some()
        || p.get("spatialAuto").is_some()
        || p.get("spatialContinuous").is_some())
        && !prop.spatial
    {
        return Err("motion_keyframe_not_spatial".into());
    }
    for (name, target) in [
        ("spatialAuto", &mut updated.spatial_auto),
        ("spatialContinuous", &mut updated.spatial_continuous),
    ] {
        if let Some(value) = p.get(name) {
            let v = value.as_bool().ok_or_else(bad)?;
            changed |= *target != v;
            *target = v;
        }
    }
    if !add
        && prop.keys[indexes[0]].spatial_auto
        && (!updated.spatial_auto || sin.is_some() || sout.is_some())
    {
        let (inn, out) = effectcraft_project::keyframe::spatial_handles(&prop.keys, indexes[0]);
        updated.spatial_in = inn;
        updated.spatial_out = out;
    }
    if let Some(v) = sin {
        changed |= updated.spatial_in != v || updated.spatial_auto;
        updated.spatial_in = v;
        updated.spatial_auto = false;
    }
    if let Some(v) = sout {
        changed |= updated.spatial_out != v || updated.spatial_auto;
        updated.spatial_out = v;
        updated.spatial_auto = false;
    }
    if !changed {
        return Err("motion_keyframe_no_change".into());
    }
    updated.time = new_time;
    let mut keys = prop.keys.clone();
    if add {
        keys.push(updated);
    } else {
        keys[indexes[0]] = updated;
    }
    keys.sort_by_key(|key| key.time);
    let target = keys
        .iter()
        .position(|key| key.time == new_time)
        .ok_or_else(bad)?;
    effectcraft_project::keyframe::retime_roving(&mut keys, prop.spatial);
    let final_time = keys[target].time;
    let selected = serde_json::from_value(json!([{"layer":lid.0,"prop":uid,"time":final_time.0}]))
        .map_err(|_| bad())?;
    // Session::edit supplies the real core undo history. The target was validated above,
    // synchronously in this same session; a vanished target still refuses the whole worker result.
    let result = session
        .edit("Edit exact keyframe", None, move |project, state| {
            let Some(prop) = project
                .comp_mut(cid)
                .and_then(|c| c.layer_mut(lid))
                .and_then(|l| l.props.find_mut(uid))
            else {
                return Ok(json!({"changed":false}));
            };
            prop.keys = keys;
            state.selected_layers = vec![lid];
            state.selected_props = vec![(lid, uid)];
            state.selected_keys = selected;
            Ok(json!({"changed":true,"layerTimeTicks":final_time.0}))
        })
        .map_err(|e| format!("motion_keyframe_failed: {e}"))?;
    if result["changed"] != true {
        return Err("motion_keyframe_property_missing".into());
    }
    Ok(result)
}
pub fn catalog() -> Vec<Value> {
    ["keys.inspectExact","keys.selectExact","keys.addExact","keys.patchExact"].into_iter().map(|id| {
        let mut properties = json!({"layer":{"type":"string","description":"Exact native layer u64 decimal"},"prop":{"type":"string","description":"Actual native property UID u64 decimal"},"timeTicks":{"type":"string","description":"Exact signed native layer-time tick i64 decimal"}});
        if id == "keys.addExact" || id == "keys.patchExact" { properties["value"] = json!({"description":"Native typed value; omit to preserve value"}); }
        if id == "keys.patchExact" { for (name,schema) in [ ("newTimeTicks",json!({"type":"string","description":"Exact replacement layer-time ticks; collisions refuse"})),("spatialIn",json!({"type":"array","items":{"type":"number"},"minItems":3,"maxItems":3})),("spatialOut",json!({"type":"array","items":{"type":"number"},"minItems":3,"maxItems":3})),("spatialAuto",json!({"type":"boolean"})),("spatialContinuous",json!({"type":"boolean"})) ] { properties[name] = schema; } }
        json!({"id":id,"label":id.replace("keys.","Exact keyframe: "),"adapter":"oshal-native-keyframe","schema":{"type":"object","additionalProperties":false,"required":REFERENCES,"properties":properties}})
    }).collect()
}
