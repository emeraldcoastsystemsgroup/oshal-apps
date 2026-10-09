# CHANGE LOG
# -----------------------------------------------------------------------------
# SEQ                 | AUTHOR                      | DESCRIPTION
# -----------------------------------------------------------------------------
# 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial implementation -- a new Blender project's
#   |                                           | scene.blend: Blender's default scene (cube, camera,
#   |                                           | light) or the same scene without the cube.
"""Usage: blender --background --factory-startup --python blender_new.py -- --template default|empty --out scene.blend"""
import json
import sys

import bpy

MARKER = "__SCENE_STUDIO__"


def main(argv):
    opts = dict(zip(argv[::2], argv[1::2]))
    template = opts.get("--template", "default")
    out = opts["--out"]
    if template == "empty":
        for obj in list(bpy.data.objects):
            if obj.type == "MESH":
                bpy.data.objects.remove(obj, do_unlink=True)
    bpy.context.preferences.filepaths.save_version = 0
    bpy.ops.wm.save_as_mainfile(filepath=out, compress=True)
    print(MARKER + json.dumps({"template": template, "objects": sorted(o.name for o in bpy.data.objects)}))


main(sys.argv[sys.argv.index("--") + 1:])
