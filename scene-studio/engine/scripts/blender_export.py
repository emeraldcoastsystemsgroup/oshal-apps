# CHANGE LOG
# -----------------------------------------------------------------------------
# SEQ                 | AUTHOR                      | DESCRIPTION
# -----------------------------------------------------------------------------
# 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial implementation -- export the open .blend's
#   |                                           | scene to one file: binary glTF, FBX, OBJ (no .mtl,
#   |                                           | so it stays one file) or STL.
"""Usage: blender --background scene.blend --python blender_export.py -- --format glb|fbx|obj|stl --out PATH"""
import json
import os
import sys

import bpy

MARKER = "__SCENE_STUDIO__"


def main(argv):
    opts = dict(zip(argv[::2], argv[1::2]))
    fmt = opts["--format"]
    out = opts["--out"]
    if fmt == "glb":
        bpy.ops.export_scene.gltf(filepath=out, export_format="GLB")
    elif fmt == "fbx":
        bpy.ops.export_scene.fbx(filepath=out)
    elif fmt == "obj":
        bpy.ops.wm.obj_export(filepath=out, export_materials=False)
    elif fmt == "stl":
        bpy.ops.wm.stl_export(filepath=out)
    else:
        raise SystemExit(f"unknown format {fmt}")
    if not os.path.isfile(out):
        raise SystemExit(f"{fmt} export wrote nothing")
    meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    print(MARKER + json.dumps({"format": fmt, "bytes": os.path.getsize(out), "meshes": len(meshes)}))


main(sys.argv[sys.argv.index("--") + 1:])
