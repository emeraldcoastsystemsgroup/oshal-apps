//! CHANGE LOG
//! 1 | maintainer@emeraldcoastsystemsgroup.com | Inspect native animated masks and execute existing mask edits at exact unsnapped composition ticks.
use effectcraft_automation::Backend;
use effectcraft_project::{GroupKind, LayerId};
use effectcraft_time::Tick;
use serde_json::{Value, json};

fn bad() -> String {
    "motion_invalid_exact_mask".into()
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
fn inspect(backend: &mut Backend, lid: LayerId, uid: u64, time: Tick) -> Result<Value, String> {
    let s = backend.session().ok_or("motion_session_unavailable")?;
    let l = s
        .active_comp()
        .and_then(|c| c.layer(lid))
        .ok_or("motion_mask_layer_missing")?;
    let g = l
        .props
        .sub("masks")
        .and_then(|m| m.groups().find(|g| g.uid == uid))
        .ok_or("motion_mask_missing")?;
    let GroupKind::Mask { locked, .. } = g.kind else {
        return Err("motion_not_mask".into());
    };
    let local = l.layer_time(time);
    let mut properties = serde_json::Map::new();
    for name in ["path", "feather", "opacity", "expansion"] {
        let p = g.get(name).ok_or("motion_mask_property_missing")?;
        if p.keys.windows(2).any(|pair| pair[0].time >= pair[1].time) {
            return Err("motion_mask_keys_ambiguous".into());
        }
        properties.insert(name.into(),json!({"prop":p.uid.to_string(),"value":p.value_at(local),"keyCount":p.keys.len(),"hasExpression":p.has_expression(),"staticOnly":p.static_only}));
    }
    Ok(
        json!({"layer":lid.0.to_string(),"mask":uid.to_string(),"compTimeTicks":time.0.to_string(),"layerTimeTicks":local.0.to_string(),"locked":locked||l.switches.locked,"header":g.kind,"name":g.name,"enabled":g.enabled,"properties":properties,"sampleSpace":"native mask values before expressions","preserveConstantVertexCount":s.prefs.general.preserve_constant_vertex_count}),
    )
}
fn action(value: &Value, lid: LayerId, uid: u64) -> Result<(String, Value, String), String> {
    let o = value.as_object().ok_or_else(bad)?;
    if o.len() != 2 || !o.contains_key("command") || !o.contains_key("params") {
        return Err(bad());
    }
    let cmd = value["command"].as_str().ok_or_else(bad)?;
    let p = value["params"].as_object().ok_or_else(bad)?;
    let allowed: &[&str] = match cmd {
        "mask.setVertex" => &["index", "point", "in", "out"],
        "mask.addVertex" => &["point", "in", "out", "index"],
        "mask.insertVertex" => &["segment", "t"],
        "mask.deleteVertices" => &["indices"],
        "mask.setClosed" => &["closed"],
        "layer.mask.set" => &["field", "value"],
        "mask.featherPoint.add" => &["segment", "t", "point", "radius", "tension"],
        "mask.featherPoint.set" => &[
            "index", "segment", "t", "point", "toward", "radius", "tension",
        ],
        "mask.featherPoint.remove" => &["index", "all"],
        _ => return Err("motion_mask_operation_not_admitted".into()),
    };
    if p.keys().any(|k| !allowed.contains(&k.as_str())) {
        return Err(bad());
    }
    for (key, v) in p {
        match key.as_str() {
            "point" | "in" | "out" | "toward" => {
                let a = v.as_array().filter(|a| a.len() == 2).ok_or_else(bad)?;
                if !a.iter().all(|v| v.as_f64().is_some_and(f64::is_finite)) {
                    return Err(bad());
                }
            }
            "index" | "segment" => {
                v.as_u64().ok_or_else(bad)?;
            }
            "t" => {
                if !v
                    .as_f64()
                    .is_some_and(|v| v.is_finite() && (0.0..=1.0).contains(&v))
                {
                    return Err(bad());
                }
            }
            "radius" => {
                if !v.as_f64().is_some_and(f64::is_finite) {
                    return Err(bad());
                }
            }
            "tension" => {
                if !v
                    .as_f64()
                    .is_some_and(|v| v.is_finite() && (0.0..=100.0).contains(&v))
                {
                    return Err(bad());
                }
            }
            "closed" | "all" => {
                v.as_bool().ok_or_else(bad)?;
            }
            _ => {}
        }
    }
    if cmd == "mask.featherPoint.add" && (p.contains_key("segment") == p.contains_key("point")) {
        return Err(bad());
    }
    if cmd == "mask.featherPoint.set" && (!p.contains_key("index") || p.len() == 1) {
        return Err(bad());
    }
    if cmd == "mask.featherPoint.remove"
        && ((p.get("all").and_then(Value::as_bool) == Some(true)) == p.contains_key("index"))
    {
        return Err(bad());
    }
    let field = if cmd == "layer.mask.set" {
        let f = value["params"]["field"]
            .as_str()
            .filter(|f| ["feather", "opacity", "expansion"].contains(f))
            .ok_or_else(bad)?;
        let v = value["params"].get("value").ok_or_else(bad)?;
        if f == "feather" {
            let a = v.as_array().filter(|a| a.len() == 2).ok_or_else(bad)?;
            if !a
                .iter()
                .all(|v| v.as_f64().is_some_and(|v| v.is_finite() && v >= 0.0))
            {
                return Err(bad());
            }
        } else if !v
            .as_f64()
            .is_some_and(|v| v.is_finite() && (f != "opacity" || (0.0..=100.0).contains(&v)))
        {
            return Err(bad());
        }
        f.to_string()
    } else {
        "path".into()
    };
    let mut out = p.clone();
    if cmd == "mask.deleteVertices" {
        let indices = out
            .remove("indices")
            .and_then(|v| v.as_array().cloned())
            .filter(|a| !a.is_empty() && a.len() <= 4096)
            .ok_or_else(bad)?;
        if !indices.iter().all(|v| v.as_u64().is_some()) {
            return Err(bad());
        }
        out.insert(
            "vertices".into(),
            json!(
                indices
                    .iter()
                    .map(|i| json!({"layer":lid.0,"mask":uid,"index":i}))
                    .collect::<Vec<_>>()
            ),
        );
    } else {
        out.insert("layer".into(), json!(lid.0));
        out.insert("mask".into(), json!(uid));
    }
    Ok((cmd.into(), Value::Object(out), field))
}
pub fn execute(backend: &mut Backend, command: &str, p: &Value) -> Result<Value, String> {
    let patch = command == "mask.patchAt";
    if !patch && command != "mask.inspectAt" {
        return Err(bad());
    }
    let o = p.as_object().ok_or_else(bad)?;
    if o.keys().any(|k| {
        !["layer", "mask", "compTimeTicks"].contains(&k.as_str()) && !(patch && k == "operations")
    }) {
        return Err(bad());
    }
    let lid = LayerId(decimal(p, "layer")?);
    let uid = decimal(p, "mask")?;
    let time = Tick(i64::try_from(decimal(p, "compTimeTicks")?).map_err(|_| bad())?);
    let observation = inspect(backend, lid, uid, time)?;
    if !patch {
        return Ok(observation);
    }
    if observation["locked"] == true {
        return Err("motion_mask_locked".into());
    }
    let operations = p["operations"]
        .as_array()
        .filter(|a| !a.is_empty() && a.len() <= 16)
        .ok_or_else(bad)?;
    let actions = operations
        .iter()
        .map(|v| action(v, lid, uid))
        .collect::<Result<Vec<_>, _>>()?;
    for (_, _, field) in &actions {
        if observation["properties"][field]["staticOnly"] == true {
            return Err("motion_mask_static_only".into());
        }
    }
    let s = backend.session().ok_or("motion_session_unavailable")?;
    let cid = s.active_comp_id().ok_or("motion_composition_required")?;
    let before = s.project.to_json_compact();
    let previous = s.state.times.insert(cid, time);
    // Session::set_time snaps/clamps to the frame grid. Native mask commands must instead
    // see the supplied exact Tick, including adjacent ticks above Number precision.
    let result = (|| {
        for (cmd, params, _) in actions {
            if cmd == "mask.deleteVertices" {
                backend
                    .exec(
                        "mask.selectVertices",
                        json!({"vertices":params["vertices"]}),
                    )
                    .map_err(|e| e.to_string())?;
            }
            backend
                .exec(&cmd, params)
                .map_err(|e| format!("motion_mask_operation: {e}"))?;
        }
        Ok::<(), String>(())
    })();
    let s = backend.session().ok_or("motion_session_unavailable")?;
    if let Some(old) = previous {
        s.state.times.insert(cid, old);
    } else {
        s.state.times.remove(&cid);
    }
    result?;
    if s.project.to_json_compact() == before {
        return Err("motion_mask_no_change".into());
    }
    inspect(backend, lid, uid, time)
}
pub fn schemas() -> Vec<Value> {
    ["mask.inspectAt","mask.patchAt"].iter().map(|id|{
        let patch=*id=="mask.patchAt";
        let mut properties=json!({"layer":{"type":"string","minLength":1,"maxLength":20},"mask":{"type":"string","minLength":1,"maxLength":20},"compTimeTicks":{"type":"string","minLength":1,"maxLength":19}});
        let mut required=vec!["layer","mask","compTimeTicks"];
        if patch {properties["operations"]=json!({"type":"array","minItems":1,"maxItems":16,"items":{"type":"object","additionalProperties":false,"required":["command","params"],"properties":{"command":{"type":"string","enum":["mask.setVertex","mask.addVertex","mask.insertVertex","mask.deleteVertices","mask.setClosed","layer.mask.set","mask.featherPoint.add","mask.featherPoint.set","mask.featherPoint.remove"]},"params":{"type":"object","description":"Existing native parameters without layer/mask selectors; deleteVertices uses indices. layer.mask.set accepts feather [x,y], opacity 0..100 or expansion. Native constant vertex count synchronizes topology across keys. Feather point commands use native segment/t/point/radius/tension (%); set/remove require index, or remove {all:true}. Radius is signed (outer positive/inner negative)."}}}});required.push("operations");}
        json!({"id":id,"label":if patch{"Edit Mask at Exact Time"}else{"Inspect Mask at Exact Time"},"adapter":"oshal-native-mask","schema":{"type":"object","additionalProperties":false,"required":required,"properties":properties}})
    }).collect()
}

#[cfg(test)]
#[allow(clippy::expect_used)] // Fixture failures intentionally panic, matching the existing native unit-test convention.
mod tests {
    use super::*;
    fn run(v: Value) -> Result<Value, String> {
        crate::process(serde_json::from_value(v).expect("native fixture must succeed"))
    }
    fn seed() -> (Value, String, String, String) {
        let blank = run(json!({"op":"create"})).expect("native fixture must succeed");
        let answer=run(json!({"op":"edit","document":blank["document"],"commands":[{"command":"comp.new","params":{"name":"Masks","width":160,"height":90,"duration":5,"frameRate":30}},{"command":"layer.newSolid","params":{"name":"Red","color":"#ff0000","width":100,"height":60}},{"command":"layer.addMask","params":{"layer":"Red","rect":[0,0,40,60]}}]})).expect("native fixture must succeed");
        let c = answer["document"]["items"]
            .as_object()
            .expect("native fixture must succeed")
            .values()
            .find(|i| i["kind"]["type"] == "Comp")
            .expect("native fixture must succeed");
        let l = &c["kind"]["layers"][0];
        let g = &l["props"]["children"]
            .as_array()
            .expect("native fixture must succeed")
            .iter()
            .find(|n| n["match"] == "masks")
            .expect("native fixture must succeed")["children"][0];
        (
            answer["document"].clone(),
            c["id"].to_string(),
            l["id"].to_string(),
            g["uid"].to_string(),
        )
    }
    fn inspect_doc(doc: &Value, c: &str, l: &str, m: &str, t: &str) -> Value {
        run(json!({"op":"edit","document":doc,"comp":c.parse::<u64>().expect("native fixture must succeed"),"commands":[{"command":"mask.inspectAt","params":{"layer":l,"mask":m,"compTimeTicks":t}}]})).expect("native fixture must succeed")["results"][0].clone()
    }
    fn patch(doc: &Value, c: &str, l: &str, m: &str, t: &str, ops: Value) -> Result<Value, String> {
        run(
            json!({"op":"edit","document":doc,"comp":c.parse::<u64>().expect("native fixture must succeed"),"commands":[{"command":"mask.patchAt","params":{"layer":l,"mask":m,"compTimeTicks":t,"operations":ops}}]}),
        )
    }
    #[test]
    fn native_mask_exact_neighbor_keys_and_metadata_survive_unsnapped_edits() {
        let (doc, c, l, m) = seed();
        let prop = inspect_doc(&doc, &c, &l, &m, "0")["properties"]["path"]["prop"].clone();
        let keyed=run(json!({"op":"edit","document":doc,"comp":c.parse::<u64>().expect("native fixture must succeed"),"commands":[{"command":"keys.addExact","params":{"layer":l,"prop":prop,"timeTicks":"9007199254740992"}},{"command":"keys.addExact","params":{"layer":l,"prop":prop,"timeTicks":"9007199254740993"}}]})).expect("native fixture must succeed");
        let changed = patch(
            &keyed["document"],
            &c,
            &l,
            &m,
            "9007199254740993",
            json!([{"command":"mask.setVertex","params":{"index":0,"point":[20,0],"out":[12,6]}}]),
        )
        .expect("native fixture must succeed");
        let info = &changed["results"][0];
        assert_eq!(info["compTimeTicks"], "9007199254740993");
        assert_eq!(info["layerTimeTicks"], "9007199254740993");
        assert_eq!(info["properties"]["path"]["keyCount"], 2);
        assert_eq!(
            info["properties"]["path"]["value"]["v"]["vertices"][0][0],
            20.0
        );
        assert_eq!(
            inspect_doc(&changed["document"], &c, &l, &m, "9007199254740992")["properties"]["path"]
                ["value"],
            inspect_doc(&keyed["document"], &c, &l, &m, "9007199254740992")["properties"]["path"]["value"]
        );
        let old=run(json!({"op":"edit","document":keyed["document"],"comp":c.parse::<u64>().expect("native fixture must succeed"),"commands":[{"command":"keys.inspectExact","params":{"layer":l,"prop":prop,"timeTicks":"9007199254740993"}}]})).expect("native fixture must succeed");
        let after=run(json!({"op":"edit","document":changed["document"],"comp":c.parse::<u64>().expect("native fixture must succeed"),"commands":[{"command":"keys.inspectExact","params":{"layer":l,"prop":prop,"timeTicks":"9007199254740993"}}]})).expect("native fixture must succeed");
        let mut old_key = old["results"][0]["key"].clone();
        old_key["value"] = after["results"][0]["key"]["value"].clone();
        assert_eq!(old_key, after["results"][0]["key"]);
    }
    #[test]
    fn native_mask_layer_time_and_interpolated_property_values_are_real() {
        let (doc, c, l, m) = seed();
        let info = inspect_doc(&doc, &c, &l, &m, "0");
        let prop = &info["properties"]["opacity"]["prop"];
        let keyed=run(json!({"op":"edit","document":doc,"comp":c.parse::<u64>().expect("native fixture must succeed"),"commands":[{"command":"keys.addExact","params":{"layer":l,"prop":prop,"timeTicks":"0","value":0}},{"command":"keys.addExact","params":{"layer":l,"prop":prop,"timeTicks":"508032000000","value":100}},{"command":"layer.timing","params":{"layers":[l.parse::<u64>().expect("native fixture must succeed")],"start":1}}]})).expect("native fixture must succeed");
        let info = inspect_doc(&keyed["document"], &c, &l, &m, "508032000000");
        assert_eq!(info["layerTimeTicks"], "254016000000");
        assert_eq!(info["properties"]["opacity"]["value"]["v"], 50.0);
        let changed = patch(
            &keyed["document"],
            &c,
            &l,
            &m,
            "508032000001",
            json!([{"command":"layer.mask.set","params":{"field":"opacity","value":37}}]),
        )
        .expect("native fixture must succeed");
        assert_eq!(changed["results"][0]["layerTimeTicks"], "254016000001");
        assert_eq!(
            changed["results"][0]["properties"]["opacity"]["value"]["v"],
            37.0
        );
        assert_eq!(
            changed["results"][0]["properties"]["opacity"]["keyCount"],
            3
        );
    }
    #[test]
    fn native_mask_topology_commands_keep_native_constant_count_semantics() {
        let (doc, c, l, m) = seed();
        let prop = inspect_doc(&doc, &c, &l, &m, "0")["properties"]["path"]["prop"].clone();
        let keyed=run(json!({"op":"edit","document":doc,"comp":c.parse::<u64>().expect("native fixture must succeed"),"commands":[{"command":"keys.addExact","params":{"layer":l,"prop":prop,"timeTicks":"0"}},{"command":"keys.addExact","params":{"layer":l,"prop":prop,"timeTicks":"254016000000"}}]})).expect("native fixture must succeed");
        let split = patch(
            &keyed["document"],
            &c,
            &l,
            &m,
            "254016000000",
            json!([{"command":"mask.insertVertex","params":{"segment":0,"t":0.25}}]),
        )
        .expect("native fixture must succeed");
        assert_eq!(inspect_doc(&split["document"],&c,&l,&m,"0")["properties"]["path"]["value"]["v"]["vertices"].as_array().expect("native fixture must succeed").len(),5);
        let deleted = patch(
            &split["document"],
            &c,
            &l,
            &m,
            "254016000000",
            json!([{"command":"mask.deleteVertices","params":{"indices":[1]}}]),
        )
        .expect("native fixture must succeed");
        assert_eq!(
            inspect_doc(&deleted["document"], &c, &l, &m, "0")["properties"]["path"]["value"]["v"]
                ["vertices"]
                .as_array()
                .expect("native fixture must succeed")
                .len(),
            4
        );
    }
    #[test]
    fn native_mask_closed_schema_locks_noop_and_invalid_ticks_refuse() {
        let (doc, c, l, m) = seed();
        for t in ["-1", "01", "9223372036854775808"] {
            assert!(
                patch(
                    &doc,
                    &c,
                    &l,
                    &m,
                    t,
                    json!([{"command":"mask.setClosed","params":{"closed":false}}])
                )
                .is_err()
            );
        }
        assert_eq!(
            patch(
                &doc,
                &c,
                &l,
                &m,
                "0",
                json!([{"command":"mask.setClosed","params":{"closed":true}}])
            )
            .expect_err("invalid mask edit must refuse"),
            "motion_mask_no_change"
        );
        for op in [
            json!({"command":"mask.setVertex","params":{"index":0,"point":[1,2,3]}}),
            json!({"command":"mask.setVertex","params":{"index":0,"point":[1,2],"layer":42}}),
            json!({"command":"layer.newSolid","params":{}}),
        ] {
            assert!(patch(&doc, &c, &l, &m, "0", json!([op])).is_err());
        }
        let locked=run(json!({"op":"edit","document":doc,"comp":c.parse::<u64>().expect("native fixture must succeed"),"commands":[{"command":"layer.mask.lock","params":{"layer":l.parse::<u64>().expect("native fixture must succeed"),"mask":m.parse::<u64>().expect("native fixture must succeed"),"value":true}}]})).expect("native fixture must succeed");
        assert_eq!(
            patch(
                &locked["document"],
                &c,
                &l,
                &m,
                "0",
                json!([{"command":"mask.setClosed","params":{"closed":false}}])
            )
            .expect_err("invalid mask edit must refuse"),
            "motion_mask_locked"
        );
    }
    #[test]
    fn exact_feather_points_keep_wide_neighbor_keys_and_native_normalized_tension() {
        let (doc, c, l, m) = seed();
        let prop = inspect_doc(&doc, &c, &l, &m, "0")["properties"]["path"]["prop"].clone();
        let keyed=run(json!({"op":"edit","document":doc,"comp":c.parse::<u64>().expect("fixture comp"),"commands":[{"command":"keys.addExact","params":{"layer":l,"prop":prop,"timeTicks":"9007199254740992"}},{"command":"keys.addExact","params":{"layer":l,"prop":prop,"timeTicks":"9007199254740993"}}]})).expect("native keys");
        let added=patch(&keyed["document"],&c,&l,&m,"9007199254740993",json!([{"command":"mask.featherPoint.add","params":{"segment":3,"t":0.5,"radius":12,"tension":25}}])).expect("native feather add");
        assert_eq!(
            added["results"][0]["properties"]["path"]["value"]["v"]["feather"][0]["tension"],
            0.25
        );
        assert_eq!(
            inspect_doc(&added["document"], &c, &l, &m, "9007199254740992")["properties"]["path"]["value"]
                ["v"]["feather"],
            Value::Null
        );
        let changed=patch(&added["document"],&c,&l,&m,"9007199254740993",json!([{"command":"mask.featherPoint.set","params":{"index":0,"radius":-8,"tension":75}}])).expect("native feather set");
        assert_eq!(
            changed["results"][0]["properties"]["path"]["value"]["v"]["feather"][0]["radius"],
            -8.0
        );
        let removed = patch(
            &changed["document"],
            &c,
            &l,
            &m,
            "9007199254740993",
            json!([{"command":"mask.featherPoint.remove","params":{"index":0}}]),
        )
        .expect("native feather remove");
        assert_eq!(
            removed["results"][0]["properties"]["path"]["value"]["v"]["feather"],
            Value::Null
        );
    }
    #[test]
    fn exact_feather_parameters_refuse_forged_targets_invalid_fields_and_empty_changes() {
        let (doc, c, l, m) = seed();
        for op in [
            json!({"command":"mask.featherPoint.add","params":{"segment":0,"point":[1,2]}}),
            json!({"command":"mask.featherPoint.add","params":{"segment":0,"t":1.2}}),
            json!({"command":"mask.featherPoint.add","params":{"segment":0,"tension":101}}),
            json!({"command":"mask.featherPoint.set","params":{"index":0}}),
            json!({"command":"mask.featherPoint.remove","params":{"all":true,"index":0}}),
            json!({"command":"mask.featherPoint.add","params":{"segment":0,"layer":42}}),
        ] {
            assert!(patch(&doc, &c, &l, &m, "0", json!([op])).is_err());
        }
    }
}
