# CHANGE LOG
# -----------------------------------------------------------------------------
# SEQ                 | AUTHOR                      | DESCRIPTION
# -----------------------------------------------------------------------------
# 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial implementation -- export one scene of a
#   |                                           | Godot project to binary glTF from a headless Godot
#   |                                           | (GLTFDocument), so Blender can render a preview of
#   |                                           | it: headless Godot itself cannot draw.
# Usage: godot --headless --path <project> --script godot_export_glb.gd -- res://<scene>.tscn <out.glb>
extends SceneTree


func _init() -> void:
	var args := OS.get_cmdline_user_args()
	if args.size() < 2:
		printerr("usage: -- res://<scene>.tscn <out.glb>")
		quit(2)
		return
	var packed = load(args[0])
	if packed == null or not (packed is PackedScene):
		printerr("cannot load scene ", args[0])
		quit(3)
		return
	var root: Node = packed.instantiate()
	var doc := GLTFDocument.new()
	var state := GLTFState.new()
	var err := doc.append_from_scene(root, state)
	if err != OK:
		printerr("glTF conversion failed: ", error_string(err))
		root.free()
		quit(4)
		return
	err = doc.write_to_filesystem(state, args[1])
	print("EXPORTED meshes=", state.get_meshes().size(), " nodes=", state.get_nodes().size())
	root.free()
	quit(0 if err == OK else 5)
