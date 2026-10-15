//! CHANGE LOG
//! 1 | maintainer@emeraldcoastsystemsgroup.com | Reject dangling, aliased and cyclic native composition/parent/matte graphs before render.
use effectcraft_project::{FootageKind, ItemKind, LayerSource, Project};
use std::collections::{BTreeMap, BTreeSet};
type Edges = BTreeMap<u64, Vec<u64>>;

fn acyclic(edges: &Edges) -> Result<(), String> {
    let mut done = BTreeSet::new();
    let mut heights = BTreeMap::<u64, usize>::new();
    for root in edges.keys() {
        let mut active = BTreeSet::new();
        let mut stack = vec![(*root, false, 0usize)];
        while let Some((id, leaving, depth)) = stack.pop() {
            if leaving {
                let height = edges
                    .get(&id)
                    .ok_or("motion_graph_missing_reference")?
                    .iter()
                    .map(|target| heights.get(target).copied().unwrap_or(0) + 1)
                    .max()
                    .unwrap_or(0);
                if height > 64 {
                    return Err("motion_graph_depth_limit".into());
                }
                heights.insert(id, height);
                active.remove(&id);
                done.insert(id);
                continue;
            }
            if active.contains(&id) {
                return Err("motion_graph_cycle".into());
            }
            if done.contains(&id) {
                continue;
            }
            if depth > 64 {
                return Err("motion_graph_depth_limit".into());
            }
            let targets = edges.get(&id).ok_or("motion_graph_missing_reference")?;
            active.insert(id);
            stack.push((id, true, depth));
            for target in targets.iter().rev() {
                stack.push((*target, false, depth + 1));
            }
        }
    }
    Ok(())
}

pub fn validate(project: &Project) -> Result<(), String> {
    let mut ids = BTreeSet::new();
    let mut folders = Edges::new();
    let mut compositions = Edges::new();
    for (key, item) in &project.items {
        if key != &item.id || item.id.0 == 0 || !ids.insert(item.id.0) {
            return Err("motion_graph_invalid_id".into());
        }
        let mut parents = Vec::new();
        if let Some(parent) = item.parent {
            if !project
                .item(parent)
                .is_some_and(|item| matches!(item.kind, ItemKind::Folder))
            {
                return Err("motion_graph_invalid_folder".into());
            }
            parents.push(parent.0);
        }
        folders.insert(item.id.0, parents);
        if matches!(item.kind, ItemKind::Comp(_)) {
            compositions.insert(item.id.0, Vec::new());
        }
        if let ItemKind::Solid(solid) = &item.kind
            && (solid.width == 0
                || solid.height == 0
                || solid.width > 8192
                || solid.height > 8192
                || u64::from(solid.width) * u64::from(solid.height) > 33_554_432
                || !solid.pixel_aspect.is_finite()
                || solid.pixel_aspect <= 0.0
                || solid.pixel_aspect > 10.0)
        {
            return Err("motion_graph_invalid_solid".into());
        }
    }
    for (comp_id, comp) in project.comps() {
        if comp.frame_rate.num <= 0
            || comp.frame_rate.den <= 0
            || comp.frame_rate.num > 1_000_000_000
            || comp.frame_rate.den > 1_000_000_000
            || !comp.frame_rate.as_f64().is_finite()
            || comp.frame_rate.as_f64() > 1000.0
            || comp.duration.seconds() <= 0.0
            || comp.duration.seconds() > 86400.0
        {
            return Err("motion_graph_invalid_timing".into());
        }
        if !comp.pixel_aspect.is_finite() || comp.pixel_aspect <= 0.0 || comp.pixel_aspect > 10.0 {
            return Err("motion_graph_invalid_pixel_aspect".into());
        }
        let mut parents = Edges::new();
        let mut mattes = Edges::new();
        let own = comp
            .layers
            .iter()
            .map(|layer| layer.id.0)
            .collect::<BTreeSet<_>>();
        for layer in &comp.layers {
            if layer.id.0 == 0 || !ids.insert(layer.id.0) {
                return Err("motion_graph_invalid_id".into());
            }
            let parent = match layer.parent {
                Some(parent) if own.contains(&parent.0) => vec![parent.0],
                Some(_) => return Err("motion_graph_missing_parent".into()),
                None => Vec::new(),
            };
            let matte = match layer.track_matte {
                Some(matte) if own.contains(&matte.layer.0) => vec![matte.layer.0],
                Some(_) => return Err("motion_graph_missing_matte".into()),
                None => Vec::new(),
            };
            parents.insert(layer.id.0, parent);
            mattes.insert(layer.id.0, matte);
            if let Some(source) = layer.source.item() {
                let item = project.item(source).ok_or("motion_graph_missing_source")?;
                let matches = match (&layer.source, &item.kind) {
                    (LayerSource::Comp { .. }, ItemKind::Comp(_)) => true,
                    (LayerSource::Footage { .. }, ItemKind::Footage(footage)) => {
                        footage.kind == FootageKind::Still
                    }
                    (LayerSource::Model { .. }, ItemKind::Footage(footage)) => {
                        footage.kind == FootageKind::Model
                    }
                    (LayerSource::Solid { .. }, ItemKind::Solid(_)) => true,
                    _ => false,
                };
                if !matches {
                    return Err("motion_graph_source_type_mismatch".into());
                }
                if matches!(layer.source, LayerSource::Comp { .. }) {
                    compositions
                        .get_mut(&comp_id.0)
                        .ok_or("motion_graph_missing_reference")?
                        .push(source.0);
                }
            }
        }
        acyclic(&parents)?;
        acyclic(&mattes)?;
    }
    acyclic(&folders)?;
    acyclic(&compositions)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn memoized_children_do_not_hide_an_overdeep_graph() {
        let mut graph = Edges::new();
        graph.insert(0, vec![]);
        for id in 1..=65 {
            graph.insert(id, vec![id - 1]);
        }
        assert_eq!(
            acyclic(&graph).err().as_deref(),
            Some("motion_graph_depth_limit")
        );
    }
    #[test]
    fn shared_subtrees_are_valid_and_folder_cycles_are_not() {
        assert!(
            acyclic(&BTreeMap::from([
                (1, vec![2, 3]),
                (2, vec![4]),
                (3, vec![4]),
                (4, vec![])
            ]))
            .is_ok()
        );
        let mut project = Project::default();
        let first = project.add_item("First", Default::default(), None, ItemKind::Folder);
        let second = project.add_item("Second", Default::default(), Some(first), ItemKind::Folder);
        if let Some(item) = project.item_mut(first) {
            item.parent = Some(second);
        }
        assert_eq!(
            validate(&project).err().as_deref(),
            Some("motion_graph_cycle")
        );
    }
}
