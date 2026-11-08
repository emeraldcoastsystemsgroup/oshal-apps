# CHANGE LOG
# -----------------------------------------------------------------------------
# SEQ | AUTHOR                                  | DESCRIPTION
# -----------------------------------------------------------------------------
# 1   | maintainer@emeraldcoastsystemsgroup.com | Bounded H.264 MP4 timeline renderer compositing Typst RGBA layers over print-verified pages.
# -----------------------------------------------------------------------------
"""Bounded H.264 MP4 timeline renderer for Publishing Studio."""
from __future__ import annotations
import copy
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import time
from worker import (
    HERE, LIMITS, Refusal, _child_limits, digest, image_size,
    prepare_paragraphs, render, validate, verify_prerequisites,
)

FPS = 16
SCALE = 96.0 / 72.0


def _compile_typst_png(executable, work, serial, data, ppi=96):
    source = work / f"vdata-{serial}.json"
    out_png = work / f"vlayer-{serial}.png"
    data["transparent"] = True
    prepare_paragraphs(data)
    source.write_text(json.dumps(data, ensure_ascii=True))
    args = [
        str(executable), "compile", "--format", "png", "--ppi", str(ppi),
        "--root", str(work), "--input", "data=" + source.name,
        "--font-path", str(HERE / "fonts"), "--ignore-system-fonts", "--ignore-embedded-fonts",
        "--package-path", str(work / "packages"), "--package-cache-path", str(work / "packages"),
        "--creation-timestamp", "0", "--jobs", "1",
        str(work / "layout.typ"), str(out_png),
    ]
    done = subprocess.run(
        args, cwd=work, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        timeout=30, env={"PATH": "/usr/bin:/bin", "HOME": str(work), "TMPDIR": str(work)},
        preexec_fn=_child_limits,
    )
    if done.returncode or not out_png.is_file():
        raise Refusal("publishing_video_layer_failed")
    return out_png


def _story_frame_pngs(executable, work, serial, model, story, chain):
    first = chain[0][1]
    data = {
        "mode": "story", "title": model["title"], "width": first["width"], "height": first["height"],
        "paragraphStyles": model["paragraphStyles"], "characterStyles": model["characterStyles"],
        "paragraphs": copy.deepcopy(story["paragraphs"]), "transparent": True,
    }
    prepare_paragraphs(data)
    source = work / f"vstory-{serial}.json"
    source.write_text(json.dumps(data, ensure_ascii=True))
    pattern = work / f"vstory-{serial}-{{p}}.png"
    args = [
        str(executable), "compile", "--format", "png", "--ppi", "96",
        "--root", str(work), "--input", "data=" + source.name,
        "--font-path", str(HERE / "fonts"), "--ignore-system-fonts", "--ignore-embedded-fonts",
        "--package-path", str(work / "packages"), "--package-cache-path", str(work / "packages"),
        "--creation-timestamp", "0", "--jobs", "1",
        str(work / "layout.typ"), str(pattern),
    ]
    done = subprocess.run(
        args, cwd=work, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        timeout=30, env={"PATH": "/usr/bin:/bin", "HOME": str(work), "TMPDIR": str(work)},
        preexec_fn=_child_limits,
    )
    if done.returncode:
        raise Refusal("publishing_video_layer_failed")
    result = {}
    for idx, (_, frame) in enumerate(chain):
        png = work / f"vstory-{serial}-{idx + 1}.png"
        if png.is_file():
            result[frame["id"]] = png
    return result


def _layer_filter(inp_idx, prev_label, out_label, x_px, y_px, anim):
    preset, d, st = anim["preset"], float(anim["duration"]), float(anim["delay"])
    prog = f"clip((t-{st:.3f})/{d:.3f},0,1)"
    prog_t = f"clip((T-{st:.3f})/{d:.3f},0,1)"
    en = f"gte(t,{st:.3f})"
    fade_d = min(d, 0.35) if preset == "pop" else d
    chain = f"[{inp_idx}:v]format=rgba"
    ox, oy = str(x_px), str(y_px)
    if preset == "wipe":
        chain += f",geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='if(lte(X,W*{prog_t}),alpha(X,Y),0)'"
    else:
        chain += f",fade=t=in:st={st:.3f}:d={fade_d:.3f}:alpha=1"
    if preset == "rise":
        oy = f"{y_px}+round(28*(1-{prog}))"
    elif preset == "pan-left":
        ox = f"{x_px}+round(44*(1-{prog}))"
    elif preset == "pan-right":
        ox = f"{x_px}-round(44*(1-{prog}))"
    elif preset == "pop":
        oy = f"{y_px}+round(12*(1-{prog}))"
    return f"{chain}[ly{inp_idx}];[{prev_label}][ly{inp_idx}]overlay=x='{ox}':y='{oy}':enable='{en}':format=auto[{out_label}]"


def _encode_segment(base_png, crop_box, layers, duration, seg_path):
    ox, oy, pw, ph = crop_box
    inputs = ["-threads", "1", "-loop", "1", "-t", f"{duration:.3f}", "-r", str(FPS), "-i", str(base_png)]
    filters = [f"[0:v]crop={pw}:{ph}:{ox}:{oy},format=rgba[v0]"]
    last = "v0"
    for idx, (png_path, tx, ty, anim) in enumerate(layers, start=1):
        inputs += ["-threads", "1", "-loop", "1", "-t", f"{duration:.3f}", "-r", str(FPS), "-i", str(png_path)]
        nxt = f"v{idx}"
        filters.append(_layer_filter(idx, last, nxt, tx, ty, anim))
        last = nxt
    filters.append(f"[{last}]format=yuv420p[vout]")
    args = [
        "/usr/bin/ffmpeg", "-y", "-filter_threads", "1", "-filter_complex_threads", "1", *inputs,
        "-filter_complex", ";".join(filters), "-map", "[vout]", "-threads", "1",
        "-c:v", "libx264", "-preset", "ultrafast", "-crf", "23",
        "-pix_fmt", "yuv420p", "-movflags", "+faststart", str(seg_path),
    ]
    done = subprocess.run(args, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=45, preexec_fn=_child_limits)
    if done.returncode or not seg_path.is_file():
        raise Refusal("publishing_video_encode_failed")


def _static_model_without_animated(model, page_index):
    cloned = copy.deepcopy(model)
    page = cloned["pages"][page_index]
    page["objects"] = [o for o in page["objects"] if "animation" not in o]
    anim_frame_ids = {f["id"] for f in page["frames"] if "animation" in f}
    if not anim_frame_ids:
        return cloned
    # Keep unlinked/animated frames clean by replacing animated story runs with whitespace only if whole story is single-frame on this page
    for story in cloned["stories"]:
        if story["firstFrame"] in anim_frame_ids:
            f_obj = next((f for f in page["frames"] if f["id"] == story["firstFrame"]), None)
            if f_obj and f_obj["nextFrame"] is None:
                story["paragraphs"] = [{"style": story["paragraphs"][0]["style"], "runs": [{"text": " "}]}]
    return cloned


def _build_page_layers(executable, work, serial_ref, model, page_index, paths, story_pngs):
    page = model["pages"][page_index]
    layers = []
    for obj in page["objects"]:
        if "animation" not in obj:
            continue
        serial_ref[0] += 1
        base = {"title": model["title"], "width": obj["width"], "height": obj["height"],
                "paragraphStyles": model["paragraphStyles"], "characterStyles": model["characterStyles"]}
        if obj["kind"] in ("text", "number"):
            p = obj.get("paragraph", {"style": next(iter(model["paragraphStyles"])), "runs": [{"text": str(page_index + 1), "style": obj.get("style", "default")}]}) if obj["kind"] == "number" else copy.deepcopy(obj["paragraph"])
            png = _compile_typst_png(executable, work, serial_ref[0], {**base, "mode": "story", "paragraphs": [p]})
        else:
            item = {k: v for k, v in obj.items() if k not in ("groupId", "animation")}
            item["x"], item["y"] = 0, 0
            if obj["kind"] == "image":
                item["path"] = paths[obj["assetId"]]
            png = _compile_typst_png(executable, work, serial_ref[0], {**base, "mode": "page", "objects": [item]})
        layers.append((png, round(obj["x"] * SCALE), round(obj["y"] * SCALE), obj["animation"]))
    for frame in page["frames"]:
        if "animation" in frame and frame["id"] in story_pngs:
            layers.append((story_pngs[frame["id"]], round(frame["x"] * SCALE), round(frame["y"] * SCALE), frame["animation"]))
    return layers


def render_video(model, assets, output_dir, typst=None, check=None):
    started = time.monotonic()
    _, descriptors, stories = validate(model)
    lock, executable = verify_prerequisites(typst)
    destination = Path(output_dir)
    if destination.exists() or destination.is_symlink():
        raise Refusal("publishing_output_exists")
    destination.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="publishing-video-", dir=destination.parent) as directory:
        work = Path(directory)
        print_dir = work / "print"
        print_receipt = render(model, assets, str(print_dir), typst, check)
        shutil.copyfile(HERE / "layout.typ", work / "layout.typ")
        (work / "packages").mkdir()
        paths = {}
        for key, descriptor in descriptors.items():
            payload = assets[key]
            image_size(payload, descriptor["mime"])
            p = work / (key + (".png" if descriptor["mime"] == "image/png" else ".jpg"))
            p.write_bytes(payload)
            paths[key] = p.name
        serial_ref, story_pngs = [0], {}
        if any("animation" in f for page in model["pages"] for f in page["frames"]):
            for story, chain in stories.values():
                serial_ref[0] += 1
                story_pngs.update(_story_frame_pngs(executable, work, serial_ref[0], model, story, chain))
        segments, total_duration = [], 0.0
        for idx, page in enumerate(model["pages"]):
            if check:
                check()
            dur = float(page.get("duration", 3.0))
            total_duration += dur
            offset_px = round((12 + page["bleed"]) * SCALE)
            pw = max(2, round(page["width"] * SCALE) // 2 * 2)
            ph = max(2, round(page["height"] * SCALE) // 2 * 2)
            has_anim = any("animation" in o for o in page["objects"]) or any("animation" in f for f in page["frames"])
            if has_anim:
                static_dir = work / f"static-{idx}"
                render(_static_model_without_animated(model, idx), assets, str(static_dir), typst, check)
                base_png = static_dir / f"preview-{idx + 1}.png"
                layers = _build_page_layers(executable, work, serial_ref, model, idx, paths, story_pngs)
            else:
                base_png = print_dir / f"preview-{idx + 1}.png"
                layers = []
            seg = work / f"seg-{idx}.mp4"
            _encode_segment(base_png, (offset_px, offset_px, pw, ph), layers, dur, seg)
            segments.append(seg)
        final_mp4 = work / "publication.mp4"
        if len(segments) == 1:
            shutil.copyfile(segments[0], final_mp4)
        else:
            concat_txt = work / "concat.txt"
            concat_txt.write_text("".join(f"file '{s.name}'\n" for s in segments))
            done = subprocess.run(
                ["/usr/bin/ffmpeg", "-y", "-filter_threads", "1", "-threads", "1", "-f", "concat", "-safe", "0", "-i", str(concat_txt),
                 "-threads", "1", "-c:v", "libx264", "-preset", "ultrafast", "-crf", "23", "-pix_fmt", "yuv420p", "-movflags", "+faststart", str(final_mp4)],
                cwd=work, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=45, preexec_fn=_child_limits,
            )
            if done.returncode or not final_mp4.is_file():
                raise Refusal("publishing_video_encode_failed")
        payload = final_mp4.read_bytes()
        if len(payload) < 32 or payload[4:8] != b"ftyp" or len(payload) > LIMITS["outputBytes"]:
            raise Refusal("publishing_output_capacity" if len(payload) > LIMITS["outputBytes"] else "publishing_video_encode_failed")
        completed = work / "completed"
        completed.mkdir(mode=0o700)
        with (completed / "publication.mp4").open("xb") as handle:
            handle.write(payload)
        os.rename(completed, destination)
        return {
            "version": 1, "pages": len(model["pages"]), "durationSeconds": round(total_duration, 3),
            "fps": FPS, "renderer": "Typst 0.15.1 + ffmpeg", "rendererSha256": lock["typst"]["binarySha256"],
            "modelSha256": print_receipt["modelSha256"], "preflight": {"clean": True, "issues": []},
            "outputs": [{"name": "publication.mp4", "bytes": len(payload), "sha256": digest(payload), "mime": "video/mp4"}],
            "elapsedMs": round((time.monotonic() - started) * 1000),
        }
