//! CHANGE LOG
//! 1 | maintainer@emeraldcoastsystemsgroup.com | Read and patch native scene properties at exact ticks, retaining independent axes and original key/history semantics.
use effectcraft_automation::Backend;
use effectcraft_project::{GroupKind, LayerId, Node, ParamUi, PropGroup};
use effectcraft_time::Tick;
use serde_json::{Value, json};
const GROUPS: &[&str] = &["transform", "cameraOptions", "lightOptions"];
fn bad() -> String {
    "motion_invalid_exact_properties".into()
}
fn decimal(p: &Value, name: &str) -> Result<u64, String> {
    let s = p.get(name).and_then(Value::as_str).ok_or_else(bad)?;
    if s.is_empty()
        || s.len() > 20
        || !s.bytes().all(|b| b.is_ascii_digit())
        || s.len() > 1 && s.starts_with('0')
    {
        return Err(bad());
    }
    s.parse().map_err(|_| bad())
}
fn at(p: &Value) -> Result<Tick, String> {
    let s = p
        .get("compTimeTicks")
        .and_then(Value::as_str)
        .ok_or_else(bad)?;
    let digits = s.strip_prefix('-').unwrap_or(s);
    if digits.is_empty()
        || digits.len() > 19
        || !digits.bytes().all(|b| b.is_ascii_digit())
        || digits.len() > 1 && digits.starts_with('0')
        || s == "-0"
    {
        return Err(bad());
    }
    s.parse().map(Tick).map_err(|_| bad())
}
fn finite(v: &Value) -> bool {
    match v {
        Value::Number(n) => n.as_f64().is_some_and(f64::is_finite),
        Value::Array(a) => a.iter().all(finite),
        Value::Object(_) => false,
        _ => true,
    }
}
fn collect(group: &PropGroup, prefix: &str, local: Tick, properties: &mut Vec<Value>) {
    for node in &group.children {
        match node {
            Node::Prop(prop) => properties.push(json!({"prop":prop.uid.to_string(),
                "path":if prefix.is_empty(){prop.match_id.clone()}else{format!("{prefix}/{}",prop.match_id)},
                "name":prop.name,"valueType":prop.value.kind_name(),"value":prop.value_at(local).to_json(),
                "ui":prop.ui,"keyCount":prop.keys.len(),"staticOnly":prop.static_only,"hasExpression":prop.has_expression()})),
            Node::Group(child) => collect(child, &if prefix.is_empty(){child.match_id.clone()}else{format!("{prefix}/{}",child.match_id)}, local, properties),
        }
    }
}
fn utf16_byte(text: &str, offset: u64) -> Result<usize, String> {
    let mut units = 0u64;
    for (byte, ch) in text.char_indices() {
        if units == offset {
            return Ok(byte);
        }
        units += ch.len_utf16() as u64;
        if units > offset {
            return Err(bad());
        }
    }
    if units == offset {
        Ok(text.len())
    } else {
        Err(bad())
    }
}
fn patched_text(old: &Value, patch: &Value) -> Result<Value, String> {
    let text = old.as_str().ok_or_else(bad)?;
    let entry = patch.as_object().ok_or_else(bad)?;
    if entry.len() != 3
        || !entry.contains_key("start")
        || !entry.contains_key("end")
        || !entry.contains_key("text")
    {
        return Err(bad());
    }
    let start = patch["start"].as_u64().ok_or_else(bad)?;
    let end = patch["end"].as_u64().ok_or_else(bad)?;
    if start > end {
        return Err(bad());
    }
    let (start, end) = (utf16_byte(text, start)?, utf16_byte(text, end)?);
    let insert = patch["text"].as_str().ok_or_else(bad)?;
    let mut next = String::with_capacity(text.len() - (end - start) + insert.len());
    next.push_str(&text[..start]);
    next.push_str(insert);
    next.push_str(&text[end..]);
    Ok(Value::String(next))
}
pub fn execute(backend: &mut Backend, command: &str, p: &Value) -> Result<Value, String> {
    let patch = command == "properties.patchAt";
    if !patch && command != "properties.inspectAt" {
        return Err(bad());
    }
    let fields = p.as_object().ok_or_else(bad)?;
    if fields.keys().any(|k| {
        !["layer", "compTimeTicks", "effect"].contains(&k.as_str()) && !(patch && k == "changes")
    }) {
        return Err(bad());
    }
    let lid = LayerId(decimal(p, "layer")?);
    let time = at(p)?;
    let session = backend.session().ok_or("motion_session_unavailable")?;
    let cid = session
        .active_comp_id()
        .ok_or("motion_composition_required")?;
    let layer = session
        .project
        .comp(cid)
        .and_then(|c| c.layer(lid))
        .ok_or("motion_properties_layer_missing")?;
    if !layer.stretch.is_finite() || layer.stretch == 0.0 {
        return Err("motion_properties_invalid_timing".into());
    }
    let local = layer.layer_time(time);
    let effect = p.get("effect").map(|_| decimal(p, "effect")).transpose()?;
    let mut properties = Vec::new();
    if let Some(uid) = effect {
        let group = layer
            .props
            .group("effects")
            .and_then(|g| {
                g.children.iter().find_map(|n| match n {
                    Node::Group(g)
                        if g.uid == uid && matches!(g.kind, GroupKind::Effect { .. }) =>
                    {
                        Some(g)
                    }
                    _ => None,
                })
            })
            .ok_or("motion_properties_effect_missing")?;
        collect(group, "", local, &mut properties);
    } else {
        for name in GROUPS {
            if let Some(group) = layer.props.group(name) {
                collect(group, name, local, &mut properties);
            }
        }
    }
    let observed = json!({"layer":lid.0.to_string(),"compTimeTicks":time.0.to_string(),"layerTimeTicks":local.0.to_string(),
        "effect":effect.map(|uid|uid.to_string()),"locked":layer.switches.locked,"threeD":layer.is_3d(),"source":layer.source,"properties":properties,
        "sampleSpace":"native values at exact layer time before expressions"});
    if !patch {
        return Ok(observed);
    }
    if layer.switches.locked {
        return Err("motion_properties_locked".into());
    }
    let changes = p
        .get("changes")
        .and_then(Value::as_array)
        .filter(|a| !a.is_empty() && a.len() <= 32)
        .ok_or_else(bad)?;
    let mut seen = std::collections::BTreeSet::new();
    let mut operations = Vec::new();
    for change in changes {
        let entry = change.as_object().ok_or_else(bad)?;
        if entry.len() != 2
            || !entry.contains_key("prop")
            || entry.contains_key("value") == entry.contains_key("textPatch")
        {
            return Err(bad());
        }
        let uid = decimal(change, "prop")?;
        if !seen.insert(uid) {
            return Err("motion_properties_ambiguous".into());
        }
        if !properties
            .iter()
            .any(|v| v["prop"].as_str() == Some(&uid.to_string()))
        {
            return Err("motion_properties_target_missing".into());
        }
        let prop = layer
            .props
            .find(uid)
            .ok_or("motion_properties_target_missing")?;
        let old = prop.value_at(local);
        let patched;
        let value = if let Some(patch) = change.get("textPatch") {
            patched = patched_text(&old.to_json(), patch)?;
            &patched
        } else {
            change.get("value").ok_or_else(bad)?
        };
        if !finite(value) {
            return Err(bad());
        }
        let mut next = old.coerce_json(value).ok_or_else(bad)?;
        if let ParamUi::Slider { min, max, .. } = prop.ui
            && let effectcraft_project::Value::Scalar(v) = next
        {
            next = effectcraft_project::Value::Scalar(v.clamp(min, max));
        }
        if prop.static_only && !prop.keys.is_empty() {
            return Err("motion_properties_static_keys".into());
        }
        if next != old {
            operations.push((uid, next.to_json()));
        }
    }
    if operations.is_empty() {
        return Ok(json!({"changed":false,"inspection":observed}));
    }
    let previous = session.state.times.insert(cid, time);
    let mut results = Vec::new();
    let outcome = (|| {
        for (uid, value) in operations {
            // No floating `time` parameter: core with_prop uses exact session Tick/layer_time.
            // The core keeps existing key handles/interpolation when set_value_at replaces it.
            results.push(
                backend
                    .exec("prop.set", json!({"layer":lid.0,"prop":uid,"value":value}))
                    .map_err(|e| e.to_string())?,
            );
        }
        Ok(
            json!({"changed":true,"compTimeTicks":time.0.to_string(),"layerTimeTicks":local.0.to_string(),"results":results}),
        )
    })();
    let session = backend.session().ok_or("motion_session_unavailable")?;
    if let Some(old) = previous {
        session.state.times.insert(cid, old);
    } else {
        session.state.times.remove(&cid);
    }
    outcome
}
pub fn schemas() -> Vec<Value> {
    let reference = json!({"type":"string","maxLength":20});
    vec![
        json!({"id":"properties.inspectAt","label":"Inspect exact native scene properties","params":"{layer: decimal u64, compTimeTicks: decimal i64, effect?: decimal effect-instance uid}","schema":{"type":"object","additionalProperties":false,"required":["layer","compTimeTicks"],"properties":{"layer":reference,"effect":reference,"compTimeTicks":{"type":"string","maxLength":20}}}}),
        json!({"id":"properties.patchAt","label":"Patch exact native scene properties","params":"{layer, compTimeTicks, changes:[{prop: decimal u64,value: native JSON value OR textPatch:{start,end,text}}]}","schema":{"type":"object","additionalProperties":false,"required":["layer","compTimeTicks","changes"],"properties":{"layer":reference,"effect":reference,"compTimeTicks":{"type":"string","maxLength":20},"changes":{"type":"array","minItems":1,"maxItems":32,"items":{"type":"object","additionalProperties":false,"required":["prop"],"oneOf":[{"required":["value"]},{"required":["textPatch"]}],"properties":{"prop":reference,"value":{},"textPatch":{"type":"object","additionalProperties":false,"required":["start","end","text"],"properties":{"start":{"type":"integer","minimum":0},"end":{"type":"integer","minimum":0},"text":{"type":"string"}}}}}}}}}),
    ]
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::panic)]
mod tests {
    use super::*;
    fn run(p: Value) -> Value {
        let reply = crate::handle(&serde_json::to_vec(&p).unwrap());
        assert_eq!(reply["ok"], true, "{reply}");
        reply["result"].clone()
    }
    fn seed() -> Value {
        let blank = run(json!({"op":"create"}));
        run(json!({"op":"edit","document":blank["document"],"commands":[
            {"command":"comp.new","params":{"name":"Exact scene","width":160,"height":90,"duration":5}},
            {"command":"layer.newSolid","params":{"name":"Plane","width":40,"height":20}},
            {"command":"layer.setSwitch","params":{"layers":["Plane"],"switch":"threeD","value":true}},
            {"command":"prop.set","params":{"layer":"Plane","path":"transform/scale","value":[80,120,150]}}
        ]}))
    }
    fn references(doc: &Value) -> (String, String) {
        let c = doc["items"]
            .as_object()
            .unwrap()
            .values()
            .find(|i| i["kind"]["type"] == "Comp")
            .unwrap();
        (
            c["id"].as_u64().unwrap().to_string(),
            c["kind"]["layers"][0]["id"].as_u64().unwrap().to_string(),
        )
    }
    fn read(doc: &Value, tick: &str) -> Value {
        let (c, l) = references(doc);
        run(json!({"op":"edit","document":doc,"comp":c.parse::<u64>().unwrap(),"commands":[{"command":"properties.inspectAt","params":{"layer":l,"compTimeTicks":tick}}]}))["results"][0].clone()
    }
    #[test]
    fn native_string_ranges_preserve_unicode_and_refuse_invalid_or_forged_boundaries() {
        let old = json!("a😀b");
        assert_eq!(
            patched_text(&old, &json!({"start":1,"end":3,"text":"😁"})).unwrap(),
            json!("a😁b")
        );
        for patch in [
            json!({"start":2,"end":3,"text":"x"}),
            json!({"start":1,"end":2,"text":"x"}),
            json!({"start":4,"end":1,"text":"x"}),
            json!({"start":9,"end":9,"text":"x"}),
            json!({"start":0,"end":0,"text":"x","owner":"other"}),
            json!({"start":0.5,"end":1,"text":"x"}),
        ] {
            assert!(patched_text(&old, &patch).is_err());
        }
        assert!(patched_text(&json!(4), &json!({"start":0,"end":1,"text":"x"})).is_err());
    }
    #[test]
    fn changed_only_native_values_preserve_scale_and_restore_playhead() {
        let doc = seed()["document"].clone();
        let info = read(&doc, "1");
        let opacity = info["properties"]
            .as_array()
            .unwrap()
            .iter()
            .find(|p| p["path"] == "transform/opacity")
            .unwrap();
        let (c, l) = references(&doc);
        let edited = run(
            json!({"op":"edit","document":doc,"comp":c.parse::<u64>().unwrap(),"commands":[{"command":"properties.patchAt","params":{"layer":l,"compTimeTicks":"1","changes":[{"prop":opacity["prop"],"value":25}]}}]}),
        );
        let after = read(&edited["document"], "1");
        assert_eq!(
            after["properties"]
                .as_array()
                .unwrap()
                .iter()
                .find(|p| p["path"] == "transform/scale")
                .unwrap()["value"],
            json!([80.0, 120.0, 150.0])
        );
        assert_eq!(
            after["properties"]
                .as_array()
                .unwrap()
                .iter()
                .find(|p| p["path"] == "transform/opacity")
                .unwrap()["value"],
            25.0
        );
        let replay = run(
            json!({"op":"edit","document":edited["document"],"comp":c.parse::<u64>().unwrap(),"commands":[{"command":"properties.patchAt","params":{"layer":l,"compTimeTicks":"1","changes":[{"prop":opacity["prop"],"value":25}]}}]}),
        );
        assert_eq!(replay["results"][0]["changed"], false);
    }
    #[test]
    fn wide_identifiers_and_neighbor_ticks_keep_original_key_metadata() {
        let mut doc = seed()["document"].clone();
        let c = doc["items"]
            .as_object_mut()
            .unwrap()
            .values_mut()
            .find(|i| i["kind"]["type"] == "Comp")
            .unwrap();
        c["kind"]["duration"] = json!(9007199254740995i64);
        let l = &mut c["kind"]["layers"][0];
        l["id"] = json!(18446744073709550000u64);
        l["out_point"] = json!(9007199254740995i64);
        let p = l["props"]["children"]
            .as_array_mut()
            .unwrap()
            .iter_mut()
            .find(|g| g["match"] == "transform")
            .unwrap()["children"]
            .as_array_mut()
            .unwrap()
            .iter_mut()
            .find(|p| p["match"] == "opacity")
            .unwrap();
        p["uid"] = json!(18446744073709550001u64);
        let old = json!({"time":9007199254740992i64,"value":{"t":"Scalar","v":10},"in_interp":"Bezier","out_interp":"Bezier","in_ease":[{"speed":3,"influence":25}],"out_ease":[{"speed":4,"influence":35}],"label":3});
        let next = json!({"time":9007199254740993i64,"value":{"t":"Scalar","v":20},"in_interp":"Bezier","out_interp":"Bezier","in_ease":[{"speed":5,"influence":45}],"out_ease":[{"speed":6,"influence":55}],"label":4});
        p["keys"] = json!([old, next]);
        let before = read(&doc, "9007199254740993");
        let (c, l) = references(&doc);
        let edited = run(
            json!({"op":"edit","document":doc,"comp":c.parse::<u64>().unwrap(),"commands":[{"command":"properties.patchAt","params":{"layer":l,"compTimeTicks":"9007199254740993","changes":[{"prop":"18446744073709550001","value":70}]}}]}),
        );
        let layer = edited["document"]["items"]
            .as_object()
            .unwrap()
            .values()
            .find(|i| i["kind"]["type"] == "Comp")
            .unwrap()["kind"]["layers"][0]
            .clone();
        let prop = layer["props"]["children"]
            .as_array()
            .unwrap()
            .iter()
            .find(|g| g["match"] == "transform")
            .unwrap()["children"]
            .as_array()
            .unwrap()
            .iter()
            .find(|p| p["match"] == "opacity")
            .unwrap();
        assert_eq!(prop["keys"].as_array().unwrap().len(), 2);
        assert_eq!(prop["keys"][0]["time"], json!(9007199254740992i64));
        assert_eq!(prop["keys"][0]["value"]["v"], 10.0);
        assert_eq!(prop["keys"][1]["time"], json!(9007199254740993i64));
        assert_eq!(prop["keys"][1]["label"], 4);
        assert_eq!(prop["keys"][1]["in_ease"][0]["speed"], 5.0);
        assert_eq!(before["compTimeTicks"], "9007199254740993");
    }
    #[test]
    fn unknown_targets_duplicate_changes_and_lock_refuse() {
        let doc = seed()["document"].clone();
        let (c, l) = references(&doc);
        for changes in [
            json!([{"prop":"999999","value":1}]),
            json!([{"prop":"1","value":1,"owner":"other"}]),
        ] {
            let reply = crate::handle(&serde_json::to_vec(&json!({"op":"edit","document":doc,"comp":c.parse::<u64>().unwrap(),"commands":[{"command":"properties.patchAt","params":{"layer":l,"compTimeTicks":"1","changes":changes}}]})).unwrap());
            assert!(reply.get("error").is_some());
        }
        let locked = run(
            json!({"op":"edit","document":doc,"commands":[{"command":"layer.setSwitch","params":{"layers":["Plane"],"switch":"lock","value":true}}]}),
        );
        let reply = crate::handle(&serde_json::to_vec(&json!({"op":"edit","document":locked["document"],"commands":[{"command":"properties.patchAt","params":{"layer":l,"compTimeTicks":"1","changes":[{"prop":"1","value":1}]}}]})).unwrap());
        assert_eq!(reply["error"], "motion_properties_locked");
    }
}
