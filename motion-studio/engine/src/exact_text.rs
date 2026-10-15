//! CHANGE LOG
//! 1 | maintainer@emeraldcoastsystemsgroup.com | Inspect and patch genuine native text at exact composition ticks with Unicode ranges, original key metadata and undo.
use effectcraft_automation::Backend;
use effectcraft_project::{LayerId, LayerSource, Value as NativeValue};
use effectcraft_time::Tick;
use serde_json::{Value, json};

fn bad() -> String {
    "motion_invalid_exact_text".into()
}
fn decimal<'a>(p: &'a Value, name: &str) -> Result<&'a str, String> {
    let s = p.get(name).and_then(Value::as_str).ok_or_else(bad)?;
    if s.is_empty()
        || s.len() > 20
        || !s.bytes().all(|c| c.is_ascii_digit())
        || s.len() > 1 && s.starts_with('0')
    {
        return Err(bad());
    }
    Ok(s)
}
pub fn execute(backend: &mut Backend, command: &str, p: &Value) -> Result<Value, String> {
    let patch = command == "text.patchAt";
    if !patch && command != "text.inspectAt" {
        return Err(bad());
    }
    let fields = p.as_object().ok_or_else(bad)?;
    if fields.keys().any(|k| {
        !["layer", "compTimeTicks"].contains(&k.as_str())
            && !(patch && ["attributes", "range"].contains(&k.as_str()))
    }) {
        return Err(bad());
    }
    let lid = LayerId(decimal(p, "layer")?.parse().map_err(|_| bad())?);
    let time = Tick(decimal(p, "compTimeTicks")?.parse().map_err(|_| bad())?);
    let session = backend.session().ok_or("motion_session_unavailable")?;
    let cid = session
        .active_comp_id()
        .ok_or("motion_composition_required")?;
    let layer = session
        .project
        .comp(cid)
        .and_then(|c| c.layer(lid))
        .ok_or("motion_text_layer_missing")?;
    if !matches!(layer.source, LayerSource::Text) {
        return Err("motion_not_text_layer".into());
    }
    let prop = layer
        .props
        .prop("text/sourceText")
        .ok_or("motion_text_property_missing")?;
    if prop
        .keys
        .windows(2)
        .any(|pair| pair[0].time >= pair[1].time)
    {
        return Err("motion_text_keys_ambiguous".into());
    }
    let local = layer.layer_time(time);
    let mut doc = match prop.value_at(local) {
        NativeValue::Text(d) => *d,
        NativeValue::Str(s) => effectcraft_project::keyframe::TextDoc::plain(&s),
        _ => return Err("motion_not_text_document".into()),
    };
    let source_key = if prop.keys.is_empty() {
        None
    } else {
        Some(
            prop.keys
                .iter()
                .rev()
                .find(|k| k.time <= local)
                .unwrap_or(&prop.keys[0])
                .time
                .0
                .to_string(),
        )
    };
    if !patch {
        return Ok(
            json!({"layer":lid.0.to_string(),"prop":prop.uid.to_string(),"compTimeTicks":time.0.to_string(),"layerTimeTicks":local.0.to_string(),"sourceKeyTimeTicks":source_key,"keyCount":prop.keys.len(),"locked":layer.switches.locked,"hasExpression":prop.has_expression(),"sampleSpace":"native source text before expressions","characterCount":doc.char_len(),"value":doc}),
        );
    }
    if layer.switches.locked || prop.static_only {
        return Err("motion_text_locked".into());
    }
    let attrs = p
        .get("attributes")
        .and_then(Value::as_object)
        .filter(|attrs| !attrs.is_empty())
        .ok_or_else(bad)?;
    let range = match p.get("range") {
        None => None,
        Some(value) => {
            let a = value.as_array().filter(|a| a.len() == 2).ok_or_else(bad)?;
            let start = a[0]
                .as_u64()
                .and_then(|v| usize::try_from(v).ok())
                .ok_or_else(bad)?;
            let end = a[1]
                .as_u64()
                .and_then(|v| usize::try_from(v).ok())
                .ok_or_else(bad)?;
            if start > end || end > doc.char_len() {
                return Err("motion_text_range_invalid".into());
            }
            Some(start..end)
        }
    };
    let before = doc.clone();
    let range = if let Some(text) = attrs.get("text") {
        let text = text.as_str().ok_or_else(bad)?;
        if let Some(r) = range {
            doc.replace_range(r.clone(), text, None);
            Some(r.start..r.start + text.chars().count())
        } else {
            doc.set_text(text);
            None
        }
    } else {
        range
    };
    for (key, value) in attrs {
        if ["text", "applyStroke", "applyFill"].contains(&key.as_str()) {
            continue;
        }
        if !doc
            .set_attr(key, value, range.clone())
            .map_err(|error| format!("motion_text_attribute: {error}"))?
        {
            return Err(format!("motion_text_attribute_unknown: {key}"));
        }
    }
    // Native stroke/color/width attributes may enable stroke. Explicit enable flags apply last.
    for key in ["applyStroke", "applyFill"] {
        if let Some(value) = attrs.get(key) {
            doc.set_attr(key, value, range.clone())
                .map_err(|e| format!("motion_text_attribute: {e}"))?;
        }
    }
    if doc == before {
        return Err("motion_text_no_change".into());
    }
    let uid = prop.uid;
    let changed = session
        .edit("Edit Text at Exact Time", None, move |project, _| {
            let Some(prop) = project
                .comp_mut(cid)
                .and_then(|c| c.layer_mut(lid))
                .and_then(|l| l.props.find_mut(uid))
            else {
                return Ok(false);
            };
            prop.set_value_at(local, NativeValue::Text(Box::new(doc)));
            Ok(true)
        })
        .map_err(|e| e.to_string())?;
    if !changed {
        return Err("motion_text_property_missing".into());
    }
    execute(
        backend,
        "text.inspectAt",
        &json!({"layer":lid.0.to_string(),"compTimeTicks":time.0.to_string()}),
    )
}
pub fn schemas() -> Vec<Value> {
    ["text.inspectAt","text.patchAt"].iter().map(|id|{
        let patch=*id=="text.patchAt";
        let mut properties=json!({"layer":{"type":"string","minLength":1,"maxLength":20},"compTimeTicks":{"type":"string","minLength":1,"maxLength":19}});
        let mut required=vec!["layer","compTimeTicks"];
        if patch {properties["attributes"]=json!({"type":"object","description":"Native TextDoc attributes accepted by layer.setText; only supplied fields change. text may replace all text or the supplied Unicode-scalar range."});properties["range"]=json!({"type":"array","items":{"type":"integer","minimum":0},"minItems":2,"maxItems":2,"description":"Optional [start,end] Unicode scalar offsets, not UTF-16 offsets."});required.push("attributes");}
        json!({"id":id,"label":if patch {"Edit Text at Exact Time"}else{"Inspect Text at Exact Time"},"adapter":"oshal-native-text","schema":{"type":"object","additionalProperties":false,"required":required,"properties":properties}})
    }).collect()
}
