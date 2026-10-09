# CHANGE LOG
# -----------------------------------------------------------------------------
# SEQ                 | AUTHOR                      | DESCRIPTION
# -----------------------------------------------------------------------------
# 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial implementation -- the preview still: Cycles on
#   |                                           | the CPU from the scene's own camera (or one framed on
#   |                                           | every mesh when there is none), a temporary sun when
#   |                                           | the scene has no light, and -- for a Blender project --
#   |                                           | the scene exported to glTF before anything temporary is
#   |                                           | added. A Godot scene arrives as the glTF Godot exported.
#   |                                           | The scene's meshes also go out as one STL for the
#   |                                           | browser's orbit viewer (skipped past STL_MAX_POLYGONS).
"""Usage:
  Godot scene:   blender --background --factory-startup --python blender_render.py -- --glb IN.glb --out OUT.png [opts]
  Blender scene: blender --background scene.blend --python blender_render.py -- --export-glb OUT.glb --out OUT.png [opts]
opts: --width W --height H --samples S --threads T --export-stl OUT.stl
"""
import json
import math
import sys
import time

import bpy
import mathutils

MARKER = "__SCENE_STUDIO__"
#: Past this many polygons the orbit-view STL is skipped (it would be tens of MB).
STL_MAX_POLYGONS = 400_000


def bounds(objects):
    """World-space bounding box over the given objects, or None."""
    points = [obj.matrix_world @ mathutils.Vector(corner) for obj in objects for corner in obj.bound_box]
    if not points:
        return None
    lo = mathutils.Vector((min(p.x for p in points), min(p.y for p in points), min(p.z for p in points)))
    hi = mathutils.Vector((max(p.x for p in points), max(p.y for p in points), max(p.z for p in points)))
    return lo, hi


def ensure_camera(scene, meshes):
    """The scene camera, the first camera object, or a temporary one framed on every mesh."""
    if scene.camera is not None:
        return scene.camera.name, False
    cameras = [obj for obj in scene.objects if obj.type == "CAMERA"]
    if cameras:
        scene.camera = cameras[0]
        return cameras[0].name, False
    box = bounds(meshes) or (mathutils.Vector((-1, -1, -1)), mathutils.Vector((1, 1, 1)))
    centre = (box[0] + box[1]) / 2
    radius = max((box[1] - box[0]).length / 2, 0.25)
    data = bpy.data.cameras.new("SceneStudioPreviewCamera")
    data.lens = 35
    camera = bpy.data.objects.new("SceneStudioPreviewCamera", data)
    scene.collection.objects.link(camera)
    fov = 2 * math.atan(data.sensor_width / (2 * data.lens))
    distance = radius / math.sin(fov / 2) * 1.15
    direction = mathutils.Vector((0.55, -0.75, 0.45)).normalized()
    camera.location = centre + direction * distance
    camera.rotation_euler = (centre - camera.location).to_track_quat("-Z", "Y").to_euler()
    data.clip_end = max(1000.0, distance * 4)
    scene.camera = camera
    return camera.name, True


def ensure_light(scene):
    """A temporary sun when nothing in the scene emits light."""
    if any(obj.type == "LIGHT" and not obj.hide_render for obj in scene.objects):
        return False
    sun = bpy.data.objects.new("SceneStudioPreviewSun", bpy.data.lights.new("SceneStudioPreviewSun", "SUN"))
    sun.data.energy = 3.0
    sun.rotation_euler = (math.radians(50), math.radians(10), math.radians(35))
    scene.collection.objects.link(sun)
    return True


def ensure_world(scene):
    if scene.world is not None:
        return
    world = bpy.data.worlds.new("SceneStudioPreviewWorld")
    world.use_nodes = True
    background = world.node_tree.nodes.get("Background")
    if background is not None:
        background.inputs[0].default_value = (0.42, 0.48, 0.56, 1.0)
        background.inputs[1].default_value = 0.6
    scene.world = world


def configure(scene, opts, out):
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = int(opts.get("--samples", 32))
    scene.cycles.use_adaptive_sampling = True
    scene.cycles.use_denoising = True
    scene.render.resolution_x = int(opts.get("--width", 960))
    scene.render.resolution_y = int(opts.get("--height", 540))
    scene.render.resolution_percentage = 100
    scene.render.threads_mode = "FIXED"
    scene.render.threads = int(opts.get("--threads", 4))
    scene.render.film_transparent = False
    scene.render.image_settings.file_format = "PNG"
    scene.render.filepath = out


def main(argv):
    opts = dict(zip(argv[::2], argv[1::2]))
    started = time.time()
    if "--glb" in opts:
        bpy.ops.wm.read_factory_settings(use_empty=True)
        bpy.ops.import_scene.gltf(filepath=opts["--glb"])
    scene = bpy.context.scene
    if "--export-glb" in opts:
        bpy.ops.export_scene.gltf(filepath=opts["--export-glb"], export_format="GLB")
    meshes = [obj for obj in scene.objects if obj.type == "MESH" and not obj.hide_render]
    polygons = sum(len(obj.data.polygons) for obj in meshes)
    stl = "skipped"
    if "--export-stl" in opts and meshes and polygons <= STL_MAX_POLYGONS:
        bpy.ops.wm.stl_export(filepath=opts["--export-stl"], ascii_format=False, apply_modifiers=True, export_selected_objects=False)
        stl = "written"
    camera, auto_camera = ensure_camera(scene, meshes)
    light_added = ensure_light(scene)
    ensure_world(scene)
    configure(scene, opts, opts["--out"])
    bpy.ops.render.render(write_still=True)
    print(MARKER + json.dumps({
        "objects": len(scene.objects),
        "meshes": len(meshes),
        "polygons": polygons,
        "stl": stl,
        "camera": camera,
        "autoCamera": auto_camera,
        "lightAdded": light_added,
        "engine": "CYCLES/CPU",
        "samples": scene.cycles.samples,
        "seconds": round(time.time() - started, 2),
    }))


main(sys.argv[sys.argv.index("--") + 1:])
