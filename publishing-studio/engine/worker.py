# CHANGE LOG
# -----------------------------------------------------------------------------
# SEQ | AUTHOR                                  | DESCRIPTION
# -----------------------------------------------------------------------------
# 1   | maintainer@emeraldcoastsystemsgroup.com | Pure bounded publishing renderer with Typst shaping and pypdf assembly.
# 2   | maintainer@emeraldcoastsystemsgroup.com | Support Liberation Sans/Mono fonts, item groupId/animation, page duration, and --mode video dispatch.
# -----------------------------------------------------------------------------
"""Pure bounded publishing renderer; no user paths, SQL, authority or networking.

Typst owns shaping/flow. pypdf only transforms/assembles genuine native pages.
The exact assembled PDF is the source for every preview.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import re
import resource
import shutil
import struct
import subprocess
import tempfile
import time
from pypdf import PdfReader, PdfWriter, Transformation
from pypdf.generic import RectangleObject, NameObject, NumberObject

HERE = Path(__file__).resolve().parent
FONTS = ("Libertinus Serif", "Liberation Sans", "Liberation Mono")
ANIMATION_PRESETS = ("fade-in", "rise", "pan-left", "pan-right", "pop", "wipe")
LIMITS = {
    "pages": 8, "frames": 128, "stories": 16, "textBytes": 65536,
    "styles": 32, "assets": 32, "assetBytes": 4 * 1024 * 1024,
    "outputBytes": 4 * 1024 * 1024, "totalAssetBytes": 32 * 1024 * 1024,
    "totalOutputBytes": 32 * 1024 * 1024, "modelBytes": 512 * 1024,
    "deadlineSeconds": 300, "minImageDpi": 150, "maxImagePixels": 32_000_000,
}
IDENTIFIER = re.compile(r"^[a-zA-Z][a-zA-Z0-9_-]{0,63}$")
SHA = re.compile(r"^[0-9a-f]{64}$")


class Refusal(Exception):
    def __init__(self, code: str, details=None):
        super().__init__(code)
        self.code, self.details = code, details


def digest(value):
    return hashlib.sha256(value).hexdigest()


def closed(value, required, optional=()):
    if not isinstance(value, dict) or set(value) - set(required) - set(optional) or set(required) - set(value):
        raise Refusal("publishing_model_invalid")
    return value


def number(value, low, high):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or not low <= value <= high:
        raise Refusal("publishing_model_invalid")
    return value


def identifier(value):
    if not isinstance(value, str) or not IDENTIFIER.fullmatch(value):
        raise Refusal("publishing_model_invalid")
    return value


def color(value):
    if not isinstance(value, list) or len(value) != 3:
        raise Refusal("publishing_model_invalid")
    for item in value:
        number(item, 0, 255)


def text(value, cap=65536):
    if not isinstance(value, str) or len(value.encode()) > cap or any(ord(c) < 32 and c not in '\n\t' or ord(c) > 126 for c in value):
        raise Refusal("publishing_text_profile_unsupported")
    return value


def animation_spec(value):
    closed(value, ("preset", "duration", "delay"))
    if value["preset"] not in ANIMATION_PRESETS:
        raise Refusal("publishing_model_invalid")
    number(value["duration"], 0.1, 10)
    number(value["delay"], 0, 20)
    return value


def paragraph(value, model):
    closed(value, ("style", "runs"))
    identifier(value["style"])
    if value["style"] not in model["paragraphStyles"] or not isinstance(value["runs"], list) or not 1 <= len(value["runs"]) <= 256:
        raise Refusal("publishing_model_invalid")
    result = 0
    for run in value["runs"]:
        closed(run, ("text",), ("style",))
        result += len(text(run["text"]).encode())
        identifier(run.get("style", "default"))
        if run.get("style", "default") not in model["characterStyles"]:
            raise Refusal("publishing_style_missing")
    return result


def _validate_styles_and_assets(model):
    for name in ("paragraphStyles", "characterStyles"):
        if not isinstance(model[name], dict) or not 1 <= len(model[name]) <= LIMITS["styles"]:
            raise Refusal("publishing_capacity")
        for key in model[name]:
            identifier(key)
    if "default" not in model["characterStyles"]:
        raise Refusal("publishing_style_missing")
    for style in model["characterStyles"].values():
        closed(style, ("font", "size", "weight", "style", "color"))
        if style["font"] not in FONTS:
            raise Refusal("publishing_font_missing", {"requested": str(style["font"])[:160], "available": list(FONTS), "requiresExplicitSubstitution": True})
        number(style["size"], 6, 96)
        if style["weight"] not in (400, 700) or isinstance(style["weight"], bool) or style["style"] not in ("normal", "italic"):
            raise Refusal("publishing_font_variant_missing")
        color(style["color"])
    for style in model["paragraphStyles"].values():
        closed(style, ("leading", "spaceAfter", "indent", "align"))
        number(style["leading"], 0, 96)
        number(style["spaceAfter"], 0, 96)
        number(style["indent"], 0, 144)
        if style["align"] not in ("left", "center", "right"):
            raise Refusal("publishing_model_invalid")
    assets = {}
    for asset in model["assets"]:
        closed(asset, ("id", "sha256", "bytes", "mime"))
        identifier(asset["id"])
        if asset["id"] in assets or not isinstance(asset["sha256"], str) or not SHA.fullmatch(asset["sha256"]) or isinstance(asset["bytes"], bool) or not isinstance(asset["bytes"], int) or not 1 <= asset["bytes"] <= LIMITS["assetBytes"] or asset["mime"] not in ("image/png", "image/jpeg"):
            raise Refusal("publishing_asset_invalid")
        assets[asset["id"]] = asset
    if sum(item["bytes"] for item in assets.values()) > LIMITS["totalAssetBytes"]:
        raise Refusal("publishing_asset_capacity")
    return assets


def _validate_objects(items, model, assets, allow_meta=False):
    if not isinstance(items, list) or len(items) > LIMITS["frames"]:
        raise Refusal("publishing_capacity")
    ids, total_text = set(), 0
    extra = ("groupId", "animation") if allow_meta else ()
    for obj in items:
        common = ("id", "kind", "x", "y", "width", "height")
        kind = obj.get("kind") if isinstance(obj, dict) else None
        if kind == "text":
            closed(obj, (*common, "paragraph"), extra)
            total_text += paragraph(obj["paragraph"], model)
        elif kind == "number":
            closed(obj, (*common, "style"), extra)
            identifier(obj["style"])
        elif kind == "image":
            closed(obj, (*common, "assetId"), extra)
            identifier(obj["assetId"])
        elif kind == "rect":
            closed(obj, (*common, "color"), extra)
            color(obj["color"])
        else:
            raise Refusal("publishing_model_invalid")
        identifier(obj["id"])
        if obj["id"] in ids:
            raise Refusal("publishing_duplicate_id")
        ids.add(obj["id"])
        if "groupId" in obj:
            identifier(obj["groupId"])
        if "animation" in obj:
            animation_spec(obj["animation"])
        if kind == "number" and obj["style"] not in model["characterStyles"]:
            raise Refusal("publishing_style_missing")
        if kind == "image" and obj["assetId"] not in assets:
            raise Refusal("publishing_asset_missing")
        number(obj["x"], -72, 1440)
        number(obj["y"], -72, 1440)
        number(obj["width"], 1, 1440)
        number(obj["height"], 1, 1440)
    return total_text


def _validate_pages(model, masters, assets):
    frames, page_ids, frame_count, total_text = {}, set(), 0, 0
    for page_index, page in enumerate(model["pages"]):
        closed(page, ("id", "width", "height", "bleed", "margin", "guides", "masterId", "objects", "frames"), ("duration",))
        identifier(page["id"])
        if page["id"] in page_ids:
            raise Refusal("publishing_duplicate_id")
        page_ids.add(page["id"])
        if "duration" in page:
            number(page["duration"], 0.5, 30)
        number(page["width"], 72, 1440)
        number(page["height"], 72, 1440)
        number(page["bleed"], 0, 36)
        number(page["margin"], 0, min(page["width"], page["height"]) / 2)
        closed(page["guides"], ("x", "y"))
        for axis, bound in (("x", page["width"]), ("y", page["height"])):
            guides = page["guides"][axis]
            if not isinstance(guides, list) or len(guides) > 32:
                raise Refusal("publishing_capacity")
            for guide in guides:
                number(guide, 0, bound)
        if page["masterId"] is not None:
            identifier(page["masterId"])
            if page["masterId"] not in masters:
                raise Refusal("publishing_master_missing")
        total_text += _validate_objects(page["objects"], model, assets, allow_meta=True)
        if not isinstance(page["frames"], list):
            raise Refusal("publishing_model_invalid")
        all_objects = page["objects"] + ([] if page["masterId"] is None else masters[page["masterId"]]["objects"])
        for obj in all_objects:
            if obj["x"] < -page["bleed"] or obj["y"] < -page["bleed"] or obj["x"] + obj["width"] > page["width"] + page["bleed"] or obj["y"] + obj["height"] > page["height"] + page["bleed"]:
                raise Refusal("publishing_object_outside_bleed")
        frame_count += len(page["frames"]) + len(all_objects)
        for frame in page["frames"]:
            closed(frame, ("id", "storyId", "nextFrame", "x", "y", "width", "height"), ("groupId", "animation"))
            identifier(frame["id"])
            identifier(frame["storyId"])
            if frame["nextFrame"] is not None:
                identifier(frame["nextFrame"])
            if "groupId" in frame:
                identifier(frame["groupId"])
            if "animation" in frame:
                animation_spec(frame["animation"])
            if frame["id"] in frames:
                raise Refusal("publishing_duplicate_id")
            number(frame["x"], 0, page["width"])
            number(frame["y"], 0, page["height"])
            number(frame["width"], 12, page["width"])
            number(frame["height"], 12, page["height"])
            if frame["x"] + frame["width"] > page["width"] or frame["y"] + frame["height"] > page["height"]:
                raise Refusal("publishing_frame_outside_trim")
            frames[frame["id"]] = (page_index, frame)
    if frame_count > LIMITS["frames"]:
        raise Refusal("publishing_capacity")
    return frames, total_text


def validate(model):
    closed(model, ("version", "title", "pageView", "pages", "masters", "stories", "paragraphStyles", "characterStyles", "assets"))
    if type(model["version"]) is not int or model["version"] != 1 or model["pageView"] not in ("single", "facing") or len(json.dumps(model, separators=(",", ":")).encode()) > LIMITS["modelBytes"]:
        raise Refusal("publishing_model_invalid")
    text(model["title"], 160)
    if not model["title"].strip():
        raise Refusal("publishing_title_invalid")
    for name in ("pages", "masters", "stories", "assets"):
        if not isinstance(model[name], list):
            raise Refusal("publishing_model_invalid")
    if not 1 <= len(model["pages"]) <= LIMITS["pages"] or len(model["stories"]) > LIMITS["stories"] or len(model["assets"]) > LIMITS["assets"] or len(model["masters"]) > 8:
        raise Refusal("publishing_capacity")
    assets = _validate_styles_and_assets(model)
    masters, total_text = {}, 0
    for master in model["masters"]:
        closed(master, ("id", "objects"))
        identifier(master["id"])
        total_text += _validate_objects(master["objects"], model, assets, allow_meta=False)
        if master["id"] in masters:
            raise Refusal("publishing_duplicate_id")
        masters[master["id"]] = master
    frames, page_text = _validate_pages(model, masters, assets)
    total_text += page_text
    used, stories = set(), {}
    for story in model["stories"]:
        closed(story, ("id", "firstFrame", "paragraphs"))
        identifier(story["id"])
        identifier(story["firstFrame"])
        if story["id"] in stories or not isinstance(story["paragraphs"], list) or not 1 <= len(story["paragraphs"]) <= 1024:
            raise Refusal("publishing_model_invalid")
        for p in story["paragraphs"]:
            total_text += paragraph(p, model)
        chain, current = [], story["firstFrame"]
        while current is not None:
            if current in used:
                raise Refusal("publishing_link_cycle_or_branch")
            if current not in frames:
                raise Refusal("publishing_frame_missing")
            index, frame = frames[current]
            if frame["storyId"] != story["id"]:
                raise Refusal("publishing_story_mismatch")
            if chain:
                previous_index, previous = chain[-1]
                if index < previous_index or (index == previous_index and (frame["y"], frame["x"]) <= (previous["y"], previous["x"])):
                    raise Refusal("publishing_reading_order")
                if (frame["width"], frame["height"]) != (previous["width"], previous["height"]):
                    raise Refusal("publishing_linked_frame_size_unsupported")
            used.add(current)
            chain.append((index, frame))
            current = frame["nextFrame"]
        stories[story["id"]] = (story, chain)
    if len(used) != len(frames):
        raise Refusal("publishing_unlinked_frame")
    if total_text > LIMITS["textBytes"]:
        raise Refusal("publishing_capacity")
    return masters, assets, stories


def image_size(data, mime):
    if mime == "image/png":
        if len(data) < 33 or data[:8] != b"\x89PNG\r\n\x1a\n" or data[12:16] != b"IHDR":
            raise Refusal("publishing_asset_invalid")
        width, height = struct.unpack(">II", data[16:24])
    else:
        if data[:2] != b"\xff\xd8":
            raise Refusal("publishing_asset_invalid")
        cursor, width, height = 2, 0, 0
        while cursor + 4 <= len(data):
            if data[cursor] != 255:
                raise Refusal("publishing_asset_invalid")
            while cursor < len(data) and data[cursor] == 255:
                cursor += 1
            if cursor >= len(data):
                break
            marker = data[cursor]
            cursor += 1
            if marker in (0xd9, 0xda):
                break
            if marker in (*range(0xd0, 0xd8), 0x01):
                continue
            size = int.from_bytes(data[cursor:cursor + 2], "big")
            if size < 2 or cursor + size > len(data):
                raise Refusal("publishing_asset_invalid")
            if marker in (0xc0, 0xc1, 0xc2):
                if size < 8:
                    raise Refusal("publishing_asset_invalid")
                height, width = struct.unpack(">HH", data[cursor + 3:cursor + 7])
                break
            cursor += size
        if not width or not height:
            raise Refusal("publishing_asset_invalid")
    if not 1 <= width <= 8192 or not 1 <= height <= 8192 or width * height > LIMITS["maxImagePixels"]:
        raise Refusal("publishing_image_capacity")
    return width, height


def _child_limits():
    resource.setrlimit(resource.RLIMIT_AS, (1024 * 1024 * 1024, 1024 * 1024 * 1024))
    resource.setrlimit(resource.RLIMIT_FSIZE, (32 * 1024 * 1024, 32 * 1024 * 1024))
    resource.setrlimit(resource.RLIMIT_NOFILE, (64, 64))
    resource.setrlimit(resource.RLIMIT_CPU, (60, 60))


def prepare_paragraphs(data):
    for p in data.get("paragraphs", []):
        words, word = [], []
        for run in p["runs"]:
            for token in re.findall(r"\S+|\s+", run["text"]):
                if token.isspace():
                    if word:
                        words.append(word)
                        word = []
                else:
                    word.append({"text": token, "style": run.get("style", "default")})
        if word:
            words.append(word)
        p_copy = dict(p)
        p_copy["words"] = words
        data.setdefault("_paragraphs", []).append(p_copy)
    if "paragraphs" in data:
        data["paragraphs"] = data.pop("_paragraphs", [])
    for obj in data.get("objects", []):
        if obj.get("kind") == "text" and "paragraph" in obj:
            sub = {"paragraphs": [obj["paragraph"]]}
            prepare_paragraphs(sub)
            obj["paragraph"] = sub["paragraphs"][0]
    return data


def verify_prerequisites(typst=None):
    lock = json.loads((HERE / "source-lock.json").read_text())
    executable = Path(typst or os.environ.get("OSHAL_PUBLISHING_TYPST", ""))
    if not executable.is_absolute() or not executable.is_file() or digest(executable.read_bytes()) != lock["typst"]["binarySha256"]:
        raise Refusal("publishing_renderer_prerequisite_invalid")
    for font in lock["fonts"]:
        path = HERE / "fonts" / font["file"]
        if not path.is_file() or digest(path.read_bytes()) != font["sha256"]:
            raise Refusal("publishing_font_prerequisite_invalid")
    return lock, executable


def compile_typst_pdf(executable, work, serial, data, started, current):
    current()
    source, result = work / f"data-{serial}.json", work / f"native-{serial}.pdf"
    prepare_paragraphs(data)
    source.write_text(json.dumps(data, ensure_ascii=True))
    args = [
        str(executable), "compile", "--root", str(work), "--input", "data=" + source.name,
        "--font-path", str(HERE / "fonts"), "--ignore-system-fonts", "--ignore-embedded-fonts",
        "--package-path", str(work / "packages"), "--package-cache-path", str(work / "packages"),
        "--creation-timestamp", "0", "--jobs", "1", "--pdf-standard", "1.7", "--no-pdf-tags",
        str(work / "layout.typ"), str(result),
    ]
    try:
        done = subprocess.run(
            args, cwd=work, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            timeout=min(60, max(1, LIMITS["deadlineSeconds"] - (time.monotonic() - started))),
            env={"PATH": "/usr/bin:/bin", "HOME": str(work), "TMPDIR": str(work)}, preexec_fn=_child_limits,
        )
    except subprocess.TimeoutExpired:
        raise Refusal("publishing_renderer_timeout") from None
    current()
    if done.returncode:
        message = done.stderr.decode(errors="replace")
        if "publishing_unbreakable_word_overflow" in message or "publishing_glyph_height_overflow" in message:
            raise Refusal("publishing_text_overflow")
        raise Refusal("publishing_renderer_refused", {"diagnostic": message[-2048:]})
    if result.stat().st_size > LIMITS["outputBytes"]:
        raise Refusal("publishing_output_capacity")
    return PdfReader(result, strict=True)


def _assemble_pages(model, masters, stories, dimensions, paths, compile_fn, current):
    def base(mode, width, height):
        return {"mode": mode, "title": model["title"], "width": width, "height": height,
                "paragraphStyles": model["paragraphStyles"], "characterStyles": model["characterStyles"]}
    writer, marks, page_offsets, preflight = PdfWriter(), 12, [], []
    for index, page in enumerate(model["pages"]):
        current()
        offset = marks + page["bleed"]
        width, height = page["width"] + 2 * offset, page["height"] + 2 * offset
        page_offsets.append(offset)
        objs = ([] if page["masterId"] is None else masters[page["masterId"]]["objects"]) + page["objects"]
        graphical, texts = [], []
        for obj in objs:
            item = {k: v for k, v in obj.items() if k not in ("groupId", "animation")}
            item["x"] += offset
            item["y"] += offset
            if obj["kind"] in ("text", "number"):
                texts.append(item)
                continue
            if obj["kind"] == "image":
                pixel_w, pixel_h = dimensions[obj["assetId"]]
                dpi = min(pixel_w * 72 / obj["width"], pixel_h * 72 / obj["height"])
                if dpi < LIMITS["minImageDpi"]:
                    preflight.append({"code": "publishing_image_resolution", "pageId": page["id"], "objectId": obj["id"], "dpi": round(dpi, 2), "minimumDpi": LIMITS["minImageDpi"]})
                item["path"] = paths[obj["assetId"]]
            graphical.append(item)
        data = base("page", width, height)
        data["objects"] = graphical
        native = compile_fn(data)
        if len(native.pages) != 1:
            raise Refusal("publishing_master_overflow")
        target = writer.add_page(native.pages[0])
        target[NameObject("/TrimBox")] = RectangleObject([offset, offset, offset + page["width"], offset + page["height"]])
        target[NameObject("/BleedBox")] = RectangleObject([marks, marks, width - marks, height - marks])
        target[NameObject("/Rotate")] = NumberObject(0)
        for obj in texts:
            p = obj.get("paragraph", {"style": next(iter(model["paragraphStyles"])), "runs": [{"text": str(index + 1), "style": obj["style"]}]}) if obj["kind"] == "number" else obj["paragraph"]
            tdata = base("story", obj["width"], obj["height"])
            tdata["paragraphs"] = [p]
            native_text = compile_fn(tdata)
            if len(native_text.pages) != 1:
                raise Refusal("publishing_master_text_overflow")
            target.merge_transformed_page(native_text.pages[0], Transformation().translate(obj["x"], height - obj["y"] - obj["height"]), expand=False)
        crop = [{"kind": "rect", "x": x, "y": y, "width": 0.5, "height": 8, "color": [0, 0, 0]} for x in (offset, offset + page["width"]) for y in (2, height - 10)]
        crop += [{"kind": "rect", "x": x, "y": y, "width": 8, "height": 0.5, "color": [0, 0, 0]} for y in (offset, offset + page["height"]) for x in (2, width - 10)]
        cdata = base("page", width, height)
        cdata["objects"] = crop
        target.merge_page(compile_fn(cdata).pages[0])
    story_receipts = []
    for story, chain in stories.values():
        current()
        first = chain[0][1]
        sdata = base("story", first["width"], first["height"])
        sdata["paragraphs"] = story["paragraphs"]
        native = compile_fn(sdata)
        if len(native.pages) > len(chain):
            preflight.append({"code": "publishing_text_overflow", "storyId": story["id"], "requiredFrames": len(native.pages), "availableFrames": len(chain)})
            continue
        for native_index, (page_index, frame) in enumerate(chain[:len(native.pages)]):
            target = writer.pages[page_index]
            offset = page_offsets[page_index]
            target.merge_transformed_page(native.pages[native_index], Transformation().translate(frame["x"] + offset, float(target.mediabox.height) - offset - frame["y"] - frame["height"]), expand=False)
        story_receipts.append({"storyId": story["id"], "renderedFrames": len(native.pages), "availableFrames": len(chain), "frameIds": [f["id"] for _, f in chain]})
    if preflight:
        raise Refusal("publishing_preflight_failed", {"issues": preflight})
    return writer, story_receipts


def _verify_pdf_resources(reopened, model, masters, dimensions):
    fonts, actual_images = set(), set()
    def scan(page):
        res = page.get("/Resources", {})
        if hasattr(res, "get_object"):
            res = res.get_object()
        for font in res.get("/Font", {}).values():
            font = font.get_object()
            name = str(font.get("/BaseFont", ""))
            for candidate in font.get("/DescendantFonts", [font]):
                candidate = candidate.get_object()
                descriptor = candidate.get("/FontDescriptor")
                if not descriptor or not any(k in descriptor.get_object() for k in ("/FontFile", "/FontFile2", "/FontFile3")):
                    raise Refusal("publishing_font_not_embedded")
            if not any(tag in name for tag in ("Libertinus", "Liberation")):
                raise Refusal("publishing_font_substitution")
            fonts.add(name)
        for item in res.get("/XObject", {}).values():
            item = item.get_object()
            if item.get("/Subtype") == "/Image":
                actual_images.add((item.get("/Width"), item.get("/Height")))
            if item.get("/Subtype") == "/Form":
                scan(item)
    for page in reopened.pages:
        scan(page)
    placed = {obj["assetId"] for page in model["pages"] for obj in page["objects"] + ([] if page["masterId"] is None else masters[page["masterId"]]["objects"]) if obj["kind"] == "image"}
    if not {dimensions[key] for key in placed} <= actual_images:
        raise Refusal("publishing_image_decode_mismatch")
    return fonts


def render(model, assets, output_dir, typst=None, check=None):
    started = time.monotonic()
    masters, descriptors, stories = validate(model)
    lock, executable = verify_prerequisites(typst)
    destination = Path(output_dir)
    if destination.exists() or destination.is_symlink():
        raise Refusal("publishing_output_exists")
    destination.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    def current():
        if time.monotonic() - started >= LIMITS["deadlineSeconds"]:
            raise Refusal("publishing_render_deadline")
        if check:
            check()
    with tempfile.TemporaryDirectory(prefix="publishing-", dir=destination.parent) as directory:
        work = Path(directory)
        shutil.copyfile(HERE / "layout.typ", work / "layout.typ")
        (work / "packages").mkdir()
        paths, dimensions = {}, {}
        if set(assets) != set(descriptors):
            raise Refusal("publishing_asset_missing")
        for key, descriptor in descriptors.items():
            current()
            payload = assets[key]
            if not isinstance(payload, bytes) or len(payload) != descriptor["bytes"] or digest(payload) != descriptor["sha256"]:
                raise Refusal("publishing_asset_changed")
            dimensions[key] = image_size(payload, descriptor["mime"])
            path = work / (key + (".png" if descriptor["mime"] == "image/png" else ".jpg"))
            path.write_bytes(payload)
            paths[key] = path.name
        serial = [0]
        def compile_fn(data):
            serial[0] += 1
            return compile_typst_pdf(executable, work, serial[0], data, started, current)
        writer, story_receipts = _assemble_pages(model, masters, stories, dimensions, paths, compile_fn, current)
        current()
        result = work / "publication.pdf"
        writer.add_metadata({"/Title": model["title"], "/Producer": "Publishing Studio / Typst 0.15.1 / pypdf 6.20.1"})
        with result.open("wb") as handle:
            writer.write(handle)
        if result.stat().st_size > LIMITS["outputBytes"]:
            raise Refusal("publishing_output_capacity")
        reopened = PdfReader(result, strict=True)
        fonts = _verify_pdf_resources(reopened, model, masters, dimensions)
        outputs = [("publication.pdf", result.read_bytes())]
        for index in range(len(reopened.pages)):
            current()
            prefix = work / f"preview-{index + 1}"
            done = subprocess.run(["/usr/bin/pdftoppm", "-f", str(index + 1), "-l", str(index + 1), "-singlefile", "-r", "96", "-png", str(result), str(prefix)],
                                  stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=30, preexec_fn=_child_limits)
            if done.returncode:
                raise Refusal("publishing_preview_decode_failed")
            payload = prefix.with_suffix(".png").read_bytes()
            if len(payload) > LIMITS["outputBytes"]:
                raise Refusal("publishing_output_capacity")
            outputs.append((f"preview-{index + 1}.png", payload))
        if sum(len(payload) for _, payload in outputs) > LIMITS["totalOutputBytes"]:
            raise Refusal("publishing_output_capacity")
        completed, receipts = work / "completed", []
        completed.mkdir(mode=0o700)
        for name, payload in outputs:
            with (completed / name).open("xb") as handle:
                handle.write(payload)
            receipts.append({"name": name, "bytes": len(payload), "sha256": digest(payload), "mime": "application/pdf" if name.endswith(".pdf") else "image/png"})
        current()
        if destination.exists() or destination.is_symlink():
            raise Refusal("publishing_output_exists")
        os.rename(completed, destination)
        return {
            "version": 1, "pages": len(reopened.pages), "renderer": "Typst 0.15.1", "rendererSha256": lock["typst"]["binarySha256"],
            "modelSha256": digest(json.dumps(model, sort_keys=True, separators=(",", ":")).encode()),
            "modelHashEncoding": "python-json-sort-keys-ascii", "preflight": {"clean": True, "issues": []},
            "stories": story_receipts, "embeddedFonts": sorted(fonts), "outputs": receipts,
            "elapsedMs": round((time.monotonic() - started) * 1000),
        }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", required=True)
    parser.add_argument("--assets", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--typst")
    parser.add_argument("--mode", choices=("print", "video"), default="print")
    args = parser.parse_args()
    try:
        source = Path(args.model)
        if source.stat().st_size > LIMITS["modelBytes"]:
            raise Refusal("publishing_capacity")
        model = json.loads(source.read_text())
        validate(model)
        assets = {}
        for descriptor in model["assets"]:
            path = Path(args.assets) / descriptor["id"]
            if not path.is_file() or path.is_symlink() or path.stat().st_size > LIMITS["assetBytes"]:
                raise Refusal("publishing_asset_missing")
            assets[descriptor["id"]] = path.read_bytes()
        if args.mode == "video":
            from video_worker import render_video
            receipt = render_video(model, assets, args.output, args.typst)
        else:
            receipt = render(model, assets, args.output, args.typst)
        print(json.dumps({"ok": True, "receipt": receipt}, separators=(",", ":")))
    except (Refusal, ValueError, OSError) as error:
        print(json.dumps({"ok": False, "error": error.code if isinstance(error, Refusal) else "publishing_input_invalid", "details": error.details if isinstance(error, Refusal) else None}, separators=(",", ":")))
        raise SystemExit(1)


if __name__ == "__main__":
    main()
