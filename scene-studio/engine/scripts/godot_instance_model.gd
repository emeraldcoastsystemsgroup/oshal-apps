# CHANGE LOG
# -----------------------------------------------------------------------------
# SEQ                 | AUTHOR                      | DESCRIPTION
# -----------------------------------------------------------------------------
# 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial implementation -- add an imported model
#   |                                           | (a glTF the Godot importer turned into a scene) to a
#   |                                           | scene as an instance, and save the scene.
# Usage: godot --headless --path <project> --script godot_instance_model.gd -- res://<scene>.tscn <parent|.> <NodeName> res://<model>.glb
extends SceneTree


func _init() -> void:
	var args := OS.get_cmdline_user_args()
	if args.size() < 4:
		printerr("usage: -- res://<scene>.tscn <parent node path or .> <node name> res://<model>")
		quit(2)
		return
	var packed = load(args[0])
	if packed == null or not (packed is PackedScene):
		printerr("cannot load scene ", args[0])
		quit(3)
		return
	var root: Node = packed.instantiate()
	var parent: Node = root if args[1] == "." else root.get_node_or_null(NodePath(args[1]))
	if parent == null:
		printerr("no node ", args[1], " in ", args[0])
		root.free()
		quit(4)
		return
	var model = load(args[3])
	if model == null or not (model is PackedScene):
		printerr("cannot load model ", args[3], " (was it imported?)")
		root.free()
		quit(5)
		return
	var instance: Node = model.instantiate()
	instance.name = args[2]
	parent.add_child(instance, true)
	instance.owner = root
	var out := PackedScene.new()
	var err := out.pack(root)
	if err == OK:
		err = ResourceSaver.save(out, args[0])
	root.free()
	if err != OK:
		printerr("could not save ", args[0], ": ", error_string(err))
		quit(6)
		return
	print("INSTANCED ", args[2], " in ", args[0])
	quit(0)
