"""Model the Little Monsters mascot in Blender and render its rig parts with real fur.

Run: blender -b --factory-startup -noaudio -P build_monster.py -- <out dir> [preview]
Output: body.png and one PNG per arm pose, on transparency, lit the same way, so the
stage can move them as a cut-out puppet. The face is left blank: eyes, brows and mouth
are drawn live by the stage so they can blink, look around and speak.
"""
import math
import os
import sys

import bpy
from mathutils import Vector

ARGV = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
OUT = ARGV[0] if ARGV else '/tmp/monster'
PREVIEW = 'preview' in ARGV
os.makedirs(OUT, exist_ok=True)

FUR = (0.50, 0.018, 0.36, 1)
FUR_DEEP = (0.16, 0.006, 0.17, 1)
BELLY = (0.66, 0.09, 0.46, 1)
HORN_ROOT = (0.26, 0.05, 0.38, 1)
HORN_MID = (0.03, 0.09, 0.42, 1)
HORN_TIP = (0.02, 0.30, 0.36, 1)


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    scene.cycles.device = 'CPU'
    scene.cycles.samples = 32 if PREVIEW else 128
    scene.cycles.use_denoising = True
    scene.cycles.max_bounces = 6
    scene.render.film_transparent = True
    scene.render.image_settings.file_format = 'PNG'
    scene.render.image_settings.color_mode = 'RGBA'
    scene.view_settings.view_transform = 'Standard'
    scene.view_settings.look = 'None'
    return scene


def principled(name, color, roughness=0.6, **extra):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes['Principled BSDF']
    bsdf.inputs['Base Color'].default_value = color
    bsdf.inputs['Roughness'].default_value = roughness
    for key, value in extra.items():
        bsdf.inputs[key].default_value = value
    return mat


def fur_material(name='fur'):
    """Fur shaded per strand: a deep root, a bright tip and a little random variation."""
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    tree = mat.node_tree
    bsdf = tree.nodes['Principled BSDF']
    bsdf.inputs['Roughness'].default_value = 0.55
    bsdf.inputs['Sheen Weight'].default_value = 0.25
    hair = tree.nodes.new('ShaderNodeHairInfo')
    ramp = tree.nodes.new('ShaderNodeValToRGB')
    ramp.color_ramp.elements[0].position = 0.0
    ramp.color_ramp.elements[0].color = FUR_DEEP
    ramp.color_ramp.elements[1].position = 0.75
    ramp.color_ramp.elements[1].color = FUR
    tree.links.new(hair.outputs['Intercept'], ramp.inputs['Fac'])
    noise = tree.nodes.new('ShaderNodeHueSaturation')
    noise.inputs['Saturation'].default_value = 1.0
    mapper = tree.nodes.new('ShaderNodeMapRange')
    mapper.inputs['To Min'].default_value = 0.82
    mapper.inputs['To Max'].default_value = 1.22
    tree.links.new(hair.outputs['Random'], mapper.inputs['Value'])
    tree.links.new(mapper.outputs['Result'], noise.inputs['Value'])
    tree.links.new(ramp.outputs['Color'], noise.inputs['Color'])
    tree.links.new(noise.outputs['Color'], bsdf.inputs['Base Color'])
    return mat


def add_fur(obj, mat, count, length, rough=0.05, child=35, thick=0.0042, sweep=-0.0022, density=None):
    if mat.name not in obj.data.materials:
        obj.data.materials.append(mat)
    obj.modifiers.new('fur', 'PARTICLE_SYSTEM')
    psys = obj.particle_systems[-1]
    ps = psys.settings
    ps.type = 'HAIR'
    ps.material = list(obj.data.materials).index(mat) + 1
    ps.count = count // 3 if PREVIEW else count
    ps.hair_length = length
    ps.hair_step = 5
    ps.child_type = 'INTERPOLATED'
    ps.rendered_child_count = child
    ps.child_percent = 10
    ps.clump_factor = 0.38
    ps.clump_shape = 0.15
    ps.roughness_1 = rough
    ps.roughness_1_size = 0.6
    ps.roughness_endpoint = rough * 1.4
    ps.roughness_end_shape = 1.0
    ps.roughness_2 = rough * 0.8
    ps.roughness_2_size = 0.2
    ps.effector_weights.gravity = 0.0
    ps.normal_factor = 0.005
    ps.object_align_factor = (0, 0, sweep)
    ps.factor_random = 0.0012
    ps.root_radius = 1.0
    ps.tip_radius = 0.15
    ps.radius_scale = thick
    ps.use_hair_bspline = True
    ps.render_step = 4
    if density:
        psys.vertex_group_density = density
    return ps


def fused(name, blobs, voxel=0.022, smooth=(0.6, 24), base=None):
    """Fuse overlapping ellipsoids into one smooth skin, the way a plush toy's shape reads."""
    parts = []
    for loc, radii in blobs:
        bpy.ops.mesh.primitive_uv_sphere_add(segments=48, ring_count=32, radius=1, location=loc)
        part = bpy.context.active_object
        part.scale = radii
        bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
        parts.append(part)
    if base:
        parts.insert(0, base)
    bpy.ops.object.select_all(action='DESELECT')
    for part in parts:
        part.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    bpy.ops.object.join()
    obj = bpy.context.active_object
    obj.name = name
    remesh = obj.modifiers.new('fuse', 'REMESH')
    remesh.mode = 'VOXEL'
    remesh.voxel_size = voxel
    bpy.ops.object.modifier_apply(modifier=remesh.name)
    relax = obj.modifiers.new('relax', 'SMOOTH')
    relax.factor, relax.iterations = smooth
    bpy.ops.object.modifier_apply(modifier=relax.name)
    bpy.ops.object.shade_smooth()
    obj.select_set(False)
    return obj


def region_group(obj, name, weight_of):
    """Paint a soft density map: where a second coat of fur grows, or where the first stops."""
    group = obj.vertex_groups.new(name=name)
    for v in obj.data.vertices:
        group.add([v.index], weight_of(v.co), 'REPLACE')
    return group


def horn(side):
    """A curved horn built ring by ring, deep at the root, blue, then teal at the tip."""
    rings, seg = 34, 28
    verts, faces = [], []
    for i in range(rings):
        t = i / (rings - 1)
        cx = side * (0.62 + 0.26 * t + 0.20 * t * t)
        cz = 2.16 + 0.70 * t + 0.02 * math.sin(t * math.pi)
        radius = 0.285 * (1 - t) ** 0.58 + 0.016
        for j in range(seg):
            a = 2 * math.pi * j / seg
            verts.append((cx + radius * math.cos(a), radius * math.sin(a) * 0.92, cz - side * 0.35 * radius * math.cos(a)))
    for i in range(rings - 1):
        for j in range(seg):
            k = (j + 1) % seg
            faces.append((i * seg + j, i * seg + k, (i + 1) * seg + k, (i + 1) * seg + j))
    mesh = bpy.data.meshes.new('horn')
    mesh.from_pydata(verts, [], faces)
    mesh.update()
    obj = bpy.data.objects.new('horn', mesh)
    bpy.context.collection.objects.link(obj)
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.shade_smooth()
    obj.select_set(False)
    obj.data.materials.append(horn_material())
    return obj


def horn_material():
    mat = bpy.data.materials.get('horn') or bpy.data.materials.new('horn')
    if mat.use_nodes and len(mat.node_tree.nodes) > 2:
        return mat
    mat.use_nodes = True
    tree = mat.node_tree
    bsdf = tree.nodes['Principled BSDF']
    bsdf.inputs['Roughness'].default_value = 0.5
    coord = tree.nodes.new('ShaderNodeNewGeometry')
    sep = tree.nodes.new('ShaderNodeSeparateXYZ')
    rng = tree.nodes.new('ShaderNodeMapRange')
    rng.inputs['From Min'].default_value = 2.26
    rng.inputs['From Max'].default_value = 2.88
    ramp = tree.nodes.new('ShaderNodeValToRGB')
    ramp.color_ramp.elements[0].color = HORN_ROOT
    ramp.color_ramp.elements[1].color = HORN_TIP
    mid = ramp.color_ramp.elements.new(0.38)
    mid.color = HORN_MID
    tree.links.new(coord.outputs['Position'], sep.inputs[0])
    tree.links.new(sep.outputs['Z'], rng.inputs['Value'])
    tree.links.new(rng.outputs['Result'], ramp.inputs['Fac'])
    tree.links.new(ramp.outputs['Color'], bsdf.inputs['Base Color'])
    return mat


def lock(root, direction, length, radius, droop=0.0, steps=9):
    """A soft tapered lock of fur as overlapping ellipsoids, fused into the skin."""
    x, y, z = root
    dx, dy, dz = direction
    norm = math.sqrt(dx * dx + dy * dy + dz * dz)
    dx, dy, dz = dx / norm, dy / norm, dz / norm
    blobs = []
    for i in range(steps + 1):
        t = i / steps
        r = max(0.022, radius * (1 - t) ** 0.9)
        blobs.append(((x + dx * length * t, y + dy * length * t, z + dz * length * t - droop * t * t), (r, r, r)))
    return blobs


def shag():
    """Tuft on the crown and shaggy locks on the cheeks and flanks: the mascot's silhouette."""
    blobs = []
    for angle, length in ((-46, 0.40), (-22, 0.50), (0, 0.56), (22, 0.50), (46, 0.40)):
        a = math.radians(angle)
        blobs += lock((0.20 * math.sin(a), -0.06, 2.46), (math.sin(a), -0.08, math.cos(a)), length, 0.135, droop=0.05)
    for side in (-1, 1):
        for z, out, down, length in ((1.40, 0.95, -0.40, 0.22), (1.14, 0.90, -0.62, 0.26), (0.44, 0.90, -0.65, 0.17)):
            x = side * (1.02 if z > 1.0 else 0.86)
            blobs += lock((x, -0.04, z), (side * out, -0.05, down), length, 0.115, droop=0.02)
    return blobs


def lights_and_camera(scene, target_z, ortho, res_x, res_y):
    cam = bpy.data.cameras.new('cam')
    cam.type = 'ORTHO'
    cam.ortho_scale = ortho
    cam_o = bpy.data.objects.new('cam', cam)
    scene.collection.objects.link(cam_o)
    cam_o.location = (0, -8, target_z)
    cam_o.rotation_euler = (math.pi / 2, 0, 0)
    scene.camera = cam_o
    scene.render.resolution_x = res_x
    scene.render.resolution_y = res_y
    key = bpy.data.lights.new('key', 'AREA')
    key.energy = 1250
    key.size = 7
    key.color = (1.0, 0.95, 0.88)
    key_o = bpy.data.objects.new('key', key)
    scene.collection.objects.link(key_o)
    key_o.location = (-3.6, -5.5, 5.2)
    key_o.rotation_euler = Vector((3.6, 5.5, -4.2)).to_track_quat('-Z', 'Y').to_euler()
    rim = bpy.data.lights.new('rim', 'AREA')
    rim.energy = 360
    rim.size = 5
    rim.color = (0.78, 0.92, 1.0)
    rim_o = bpy.data.objects.new('rim', rim)
    scene.collection.objects.link(rim_o)
    rim_o.location = (3.8, 4.2, 4.6)
    rim_o.rotation_euler = Vector((-3.8, -4.2, -3.6)).to_track_quat('-Z', 'Y').to_euler()
    world = bpy.data.worlds.new('w')
    scene.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes['Background']
    bg.inputs[0].default_value = (0.95, 0.90, 0.92, 1)
    bg.inputs[1].default_value = 0.42


def render(scene, name):
    scene.render.filepath = os.path.join(OUT, name + '.png')
    bpy.ops.render.render(write_still=True)
    print('rendered', name)


def smooth01(x):
    x = max(0.0, min(1.0, x))
    return x * x * (3 - 2 * x)


def belly_weight(co):
    """Soft oval on the front of the tummy: the lighter fluff the mascot wears."""
    dx, dz = co.x / 0.62, (co.z - 0.36) / 0.66
    d = math.sqrt(dx * dx + dz * dz)
    return smooth01((1.15 - d) / 0.55) if co.y < 0 else 0.0


def cheek_weight(co):
    """Shaggy cheeks and flanks: longer locks that break up the silhouette like the mascot's."""
    side = smooth01((abs(co.x) - 0.62) / 0.34)
    band = smooth01(1.0 - abs(co.z - 1.28) / 0.55)
    return side * band


def skin_material():
    """The skin between the strands stays dark so the coat reads deep."""
    return principled('skin', FUR_DEEP, 0.9)


def build_body():
    scene = reset()
    fur = fur_material()
    trunk = fused('trunk', [
        ((0, 0, 1.52), (1.10, 0.96, 1.02)),
        ((0, 0, 0.98), (1.04, 0.90, 0.80)),
        ((0, 0, 0.56), (0.98, 0.84, 0.90)),
    ], 0.03, (0.85, 160))
    body = fused('body', [
        ((-0.46, -0.42, -0.30), (0.34, 0.44, 0.19)),
        ((0.46, -0.42, -0.30), (0.34, 0.44, 0.19)),
    ] + shag(), 0.022, (0.5, 18), base=trunk)
    body.data.materials.append(skin_material())
    belly_mat = fur_material('belly')
    ramp = [n for n in belly_mat.node_tree.nodes if n.type == 'VALTORGB'][0]
    ramp.color_ramp.elements[0].color = (0.38, 0.03, 0.28, 1)
    ramp.color_ramp.elements[1].color = BELLY
    region_group(body, 'coat', lambda co: 1.0 - belly_weight(co))
    region_group(body, 'belly', belly_weight)
    ps = add_fur(body, fur, 64000, 0.17, rough=0.07, density='coat', sweep=-0.0012)
    ps.clump_factor = 0.62
    add_fur(body, belly_mat, 15000, 0.14, rough=0.06, density='belly', sweep=-0.001)
    horn(1)
    horn(-1)
    lights_and_camera(scene, 1.32, 3.9, 1300 if not PREVIEW else 650, 1500 if not PREVIEW else 750)
    render(scene, 'body')


def stub(x, y, top_z, length, radius, lean=0.0):
    """One soft finger as overlapping ellipsoids, hanging down from a knuckle."""
    steps = 4
    return [((x + lean * i / steps, y, top_z - length * i / steps), (radius, radius, radius * 1.05)) for i in range(steps + 1)]


def hand_blobs(z, pose):
    """Mitten hand below the wrist for each pose. The arm hangs along -Z."""
    palm = [((0, -0.01, z), (0.26, 0.20, 0.23))]
    if pose == 'open':
        return palm + stub(-0.17, -0.02, z - 0.14, 0.20, 0.085, -0.07) + stub(0.0, -0.02, z - 0.17, 0.25, 0.09) \
            + stub(0.17, -0.02, z - 0.14, 0.20, 0.085, 0.07) + stub(-0.24, -0.04, z + 0.04, 0.12, 0.085, -0.13)
    if pose == 'point':
        knuckles = [((0.05, -0.05, z - 0.12), (0.22, 0.17, 0.16))]
        return palm + knuckles + stub(-0.08, -0.06, z - 0.18, 0.40, 0.085) + stub(0.22, -0.09, z - 0.02, 0.10, 0.08, 0.05)
    return palm + [((0.0, -0.04, z - 0.14), (0.25, 0.19, 0.17)), ((-0.26, -0.08, z - 0.06), (0.09, 0.09, 0.09)), ((-0.33, -0.09, z + 0.02), (0.085, 0.085, 0.09)), ((-0.36, -0.09, z + 0.12), (0.08, 0.08, 0.09))]


def build_arm(name, pose):
    scene = reset()
    mat = fur_material()
    hand_z = -1.02
    upper = [((0, 0, -i * 0.045), (0.27 - 0.0028 * i, 0.26 - 0.0028 * i, 0.2)) for i in range(23)]
    arm = fused('arm', upper + hand_blobs(hand_z, pose), 0.016, (0.7, 16))
    arm.data.materials.append(skin_material())
    ps = add_fur(arm, mat, 18000, 0.11, rough=0.06, thick=0.0038, sweep=-0.0009)
    ps.clump_factor = 0.6
    lights_and_camera(scene, -0.80, 2.08, 800 if not PREVIEW else 400, 800 if not PREVIEW else 400)
    render(scene, name)


build_body()
build_arm('arm_open', 'open')
build_arm('arm_point', 'point')
build_arm('arm_fist', 'fist')
