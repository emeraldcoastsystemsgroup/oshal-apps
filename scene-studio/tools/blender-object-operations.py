# CHANGE LOG
# 1 | maintainer@emeraldcoastsystemsgroup.com | Closed native Blender object inspection/property editing; caller input is JSON data only.
import bpy, json, math

def _oshal_local(data):
    return data is not None and data.library is None and getattr(data, "override_library", None) is None

def _oshal_material(o):
    mat = o.active_material if o.type in {"MESH", "CURVE", "SURFACE", "FONT", "META"} else None
    color = list(mat.diffuse_color) if mat else None
    bsdf = None
    editable = True
    if mat and mat.use_nodes:
        nodes = [n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED"]
        bsdf = nodes[0] if len(nodes) == 1 else None
        socket = bsdf.inputs.get("Base Color") if bsdf else None
        editable = socket is not None and not socket.is_linked
        if socket: color = list(socket.default_value)
    return mat, color, editable, bsdf

def _oshal_describe(o, _oshal_local=_oshal_local, _oshal_material=_oshal_material, math=math):
    mat, color, color_editable, bsdf = _oshal_material(o)
    reply = {"id":o.name, "type":o.type, "editable":_oshal_local(o) and not o.hide_select,
        "dataEditable":_oshal_local(o.data), "rotationEditable":o.rotation_mode not in {"QUATERNION", "AXIS_ANGLE"}, "location":list(o.location),
        "rotation":[math.degrees(v) for v in o.rotation_euler], "scale":list(o.scale),
        "visible":not o.hide_render, "color":color, "colorEditable":color_editable,
        "animated":bool(o.animation_data and o.animation_data.action)}
    if o.type == "FONT": reply["text"] = o.data.body if len(o.data.body.encode("utf-8")) < 2000 else None
    if o.type == "LIGHT": reply.update(lightEnergy=o.data.energy)
    if o.type == "CAMERA": reply.update(projection=o.data.type, lens=o.data.lens, orthoScale=o.data.ortho_scale)
    return reply

def _oshal_patch(o, operation, frame, _oshal_local=_oshal_local, _oshal_material=_oshal_material, bpy=bpy, math=math):
    if not _oshal_local(o) or o.hide_select: raise ValueError("Select a local editable Blender object")
    if (operation.get("channel") == "rotation" or str(operation.get("property", "")).startswith("rotation:")) and o.rotation_mode in {"QUATERNION", "AXIS_ANGLE"}:
        raise ValueError("This rotation mode is not editable through Euler channels")
    if operation["kind"] == "keyframe":
        if o.animation_data and o.animation_data.action:
            action = o.animation_data.action
            if action.library is not None or action.users > 1: o.animation_data.action = action.copy()
        channel = "rotation_euler" if operation["channel"] == "rotation" else operation["channel"]
        o.keyframe_insert(data_path=channel, frame=frame)
        return
    key, value = operation["property"], operation["value"]
    if ":" in key:
        channel, index = key.split(":")
        if channel == "rotation": o.rotation_euler[int(index)] = math.radians(value)
        else: getattr(o, channel)[int(index)] = value
    elif key == "visible": o.hide_render = not value
    elif key == "color":
        if o.type not in {"MESH", "CURVE", "SURFACE", "FONT", "META"}: raise ValueError("This object has no editable material")
        mat, old_color, editable, bsdf = _oshal_material(o)
        if not editable: raise ValueError("Linked or ambiguous shader inputs cannot be edited as a base color")
        if not o.material_slots:
            if not _oshal_local(o.data): raise ValueError("Linked object data cannot acquire a material")
            if o.data.users > 1: o.data = o.data.copy()
            o.data.materials.append(None)
        if mat is not None and (mat.users > 1 or o.data.users > 1 or not _oshal_local(mat)): mat = mat.copy()
        slot = o.material_slots[o.active_material_index]
        slot.link = "OBJECT"
        if mat is None:
            mat = bpy.data.materials.new("Object material")
            mat.use_nodes = True
        slot.material = mat
        rgb = [int(value[i:i+2],16)/255 for i in (1,3,5)]
        rgb = [v/12.92 if v <= .04045 else ((v+.055)/1.055)**2.4 for v in rgb]
        rgba = rgb + [old_color[3] if old_color else 1]
        mat.diffuse_color = rgba
        if mat.use_nodes:
            bsdf = next(n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
            bsdf.inputs["Base Color"].default_value = rgba
    else:
        expected = {"text":"FONT", "lightEnergy":"LIGHT", "lens":"CAMERA", "orthoScale":"CAMERA"}
        if o.type != expected[key] or not _oshal_local(o.data): raise ValueError("This native data property is unavailable")
        if key == "lens" and o.data.type != "PERSP": raise ValueError("Only perspective cameras expose focal length")
        if key == "orthoScale" and o.data.type != "ORTHO": raise ValueError("Only orthographic cameras expose orthographic scale")
        field = {"text":"body", "lightEnergy":"energy", "lens":"lens", "orthoScale":"ortho_scale"}[key]
        if key != "text":
            rna = o.data.bl_rna.properties[field]
            if not rna.hard_min <= value <= rna.hard_max: raise ValueError("Value exceeds this native property range")
        if o.data.users > 1: o.data = o.data.copy()
        setattr(o.data, field, value)

def _oshal_object_operation(args, bpy=bpy, _oshal_patch=_oshal_patch, _oshal_describe=_oshal_describe):
    if args.get("frame") is not None: bpy.context.scene.frame_set(args["frame"])
    objects = sorted(bpy.context.scene.objects, key=lambda o:o.name)
    name, offset = args.get("objectName"), args.get("offset",0)
    o = bpy.context.scene.objects.get(name) if name is not None else None
    if args["mode"] == "patch":
        if o is None: raise ValueError("The selected native object no longer exists")
        _oshal_patch(o, args["operation"], args["frame"])
    reply = {"objects":[] if name is not None else [{"id":v.name,"name":v.name,"type":v.type} for v in objects[offset:offset+24]],
        "total":len(objects),"offset":offset,"frame":bpy.context.scene.frame_current}
    if o is not None: reply["selected"] = _oshal_describe(o)
    return reply
