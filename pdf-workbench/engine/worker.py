"""Bounded pure PDF operations. Authority and immutable publication belong to the package.
CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | Preserve real pages/forms and explicit OCR reports.
CHANGE LOG: 2 | maintainer@emeraldcoastsystemsgroup.com | Add blank-page derivation, QuadPoints/ink markup, word boxes, photo-to-PDF, compression and OOXML export.
"""
import base64
import csv
import hashlib
import io
import json
import math
import re
import resource
import subprocess
import sys
import tempfile
from pathlib import Path

from pypdf import PdfReader, PdfWriter
from page_content import inspect_objects, inspect_image, edit_page, blank_page_bytes, extract_page_words, ContentRefused
from pdf_transforms import annotate_page, photos_to_pdf, compress_pdf
from ooxml_export import convert_pdf_to_ooxml

MAX_BYTES = 4 * 1024 * 1024
MAX_PAGES = 32
UUID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")
UNSAFE = {"/XFA", "/JS", "/JavaScript", "/OpenAction", "/AA", "/Launch", "/EmbeddedFiles", "/RichMedia", "/A"}


class Refused(Exception):
    pass


def require(test, code="pdf_invalid_input"):
    if not test:
        raise Refused(code)


def exact(value, keys):
    require(isinstance(value, dict) and not set(value) - set(keys))


def decode(value):
    require(isinstance(value, str) and len(value) <= 4 * math.ceil(MAX_BYTES / 3), "pdf_input_limit")
    try:
        data = base64.b64decode(value, validate=True)
    except (ValueError, TypeError):
        raise Refused("pdf_invalid_encoding") from None
    require(0 < len(data) <= MAX_BYTES and data.startswith(b"%PDF-"), "pdf_invalid_pdf")
    require(base64.b64encode(data).decode() == value, "pdf_invalid_encoding")
    return data


def safe_reader(data):
    reader = PdfReader(io.BytesIO(data), strict=True, root_object_recovery_limit=1000)
    require(not reader.is_encrypted, "pdf_encrypted_unsupported")
    require(0 < len(reader.pages) <= MAX_PAGES, "pdf_page_limit")
    # Traverse every reachable object, not only visible page dictionaries. The process
    # hard memory/deadline bound also covers decompression before this traversal.
    pending = [reader.trailer]
    seen = set()
    count = 0
    while pending:
        obj = pending.pop()
        if hasattr(obj, "get_object"):
            obj = obj.get_object()
        marker = id(obj)
        if marker in seen:
            continue
        seen.add(marker)
        count += 1
        require(count <= 50000, "pdf_object_limit")
        if isinstance(obj, dict):
            require(not set(obj) & UNSAFE, "pdf_active_content_unsupported")
            require(obj.get("/FT") != "/Sig" and obj.get("/Type") != "/Sig", "pdf_signed_unsupported")
            pending.extend(obj.values())
        elif isinstance(obj, (list, tuple)):
            pending.extend(obj)
    for page in reader.pages:
        box = [float(x) for x in page.cropbox]
        require(all(math.isfinite(x) and abs(x) <= 2000 for x in box)
                and 0 < box[2] - box[0] <= 2000 and 0 < box[3] - box[1] <= 2000, "pdf_geometry_limit")
        require(page.rotation in (0, 90, 180, 270), "pdf_rotation_unsupported")
    return reader


def fields_of(reader):
    fields = reader.get_fields() or {}
    require(len(fields) <= 256, "pdf_field_limit")
    result = []
    for name, field in fields.items():
        kind = str(field.get("/FT", ""))
        if not kind:
            continue  # A namespace container is not a widget or fillable field.
        flags = int(field.get("/Ff", 0))
        # Text, non-push-button buttons and single-choice forms, without scripts.
        supported = kind in ("/Tx", "/Btn", "/Ch") and not flags & (1 | 65536 | 2097152 | 33554432)
        original = field.indirect_reference.get_object() if field.indirect_reference else field
        if kind in ("/Tx", "/Ch"):
            form = reader.root_object.get("/AcroForm", {}).get_object()
            appearance = str(original.get("/DA", form.get("/DA", "")))
            font_match = re.search(r"/([^\s]+)\s+[0-9.]+\s+Tf", appearance)
            fonts = original.get("/DR", form.get("/DR", {})).get("/Font", {})
            font = fonts.get("/" + font_match[1]) if font_match else None
            supported = supported and font is not None and font.get_object().get("/BaseFont") == "/Helvetica"
        options = []
        if kind == "/Ch":
            options = [str(x[0] if isinstance(x, list) else x) for x in field.get("/Opt", [])]
        elif kind == "/Btn":
            widgets = original.get("/Kids", [original])
            for widget in widgets:
                normal = widget.get_object().get("/AP", {}).get("/N", {})
                if isinstance(normal, dict):
                    options.extend(str(key) for key in normal if key != "/Off")
        pages = [page.page_number for page in reader.get_pages_showing_field(field)]
        result.append({"name": name, "type": kind[1:], "flags": flags, "supported": supported,
                       "options": sorted(set(options)), "pages": pages, "value": str(field.get("/V", "")),
                       "maxLength": int(field.get("/MaxLen", 4096))})
    require(len(json.dumps(result)) <= 65536, "pdf_field_limit")
    return result


def inspect_pdf(data):
    reader = safe_reader(data)
    objects = inspect_objects(data, reader)
    return {"sha256": hashlib.sha256(data).hexdigest(), "bytes": len(data),
            "pages": [{"index": i, "cropBox": [float(x) for x in page.cropbox], "rotation": page.rotation, **objects[i]}
                      for i, page in enumerate(reader.pages)], "fields": fields_of(reader)}


def _page_additions(page_id, additions, images):
    objects = []
    for obj in additions:
        if obj["page"] != page_id:
            continue
        if obj.get("kind") == "image":
            asset = images.get(obj.get("asset"))
            require(asset is not None, "pdf_image_asset_unavailable")
            objects.append({**obj, "image": asset["data"], "imageType": asset["type"]})
        else:
            objects.append(obj)
    return objects


def _append_derived_page(writer, item, readers, source_bytes, definitions, source_instances, content_edits, additions, images):
    edits = [edit for edit in content_edits if edit["page"] == item["id"]]
    objects = _page_additions(item["id"], additions, images)
    if item.get("blank") is True:
        exact(item, ("id", "blank", "cropBox", "rotation"))
        crop, rotation = item.get("cropBox"), item.get("rotation")
        require(isinstance(crop, list) and len(crop) == 4 and all(isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v) for v in crop)
                and crop[0] == 0 and crop[1] == 0 and 0 < crop[2] <= 2000 and 0 < crop[3] <= 2000 and rotation in (0, 90, 180, 270))
        base = blank_page_bytes(crop)
        if edits or objects:
            base = edit_page(base, 0, edits, objects, [float(v) for v in crop])
            require(len(base) <= MAX_BYTES, "pdf_output_limit")
        selected_reader = safe_reader(base)
        writer.reset_translation(selected_reader)
        writer.append(selected_reader, pages=[0], import_outline=False)
        writer.pages[-1].rotate(rotation)
        return
    exact(item, ("id", "source", "index", "rotation"))
    key, index, rotation = item.get("source"), item.get("index"), item.get("rotation")
    require(key in readers and isinstance(index, int) and not isinstance(index, bool)
            and 0 <= index < len(readers[key].pages) and rotation in (0, 90, 180, 270))
    require(not definitions[key] or (key, index) not in source_instances, "pdf_repeated_form_page_unsupported")
    source_instances.add((key, index))
    selected_reader = readers[key]
    if edits or objects:
        changed = edit_page(source_bytes[key], index, edits, objects, [float(x) for x in readers[key].pages[index].cropbox])
        require(len(changed) <= MAX_BYTES, "pdf_output_limit")
        selected_reader = safe_reader(changed)
        selected_reader.add_form_topname(key)
    writer.reset_translation(selected_reader)
    writer.append(selected_reader, pages=[index], import_outline=False)
    writer.pages[-1].rotate(rotation)


def _load_assets(assets):
    assets = assets or []
    require(isinstance(assets, list) and len(assets) <= 128, "pdf_content_limit")
    images, image_bytes = {}, 0
    for asset in assets:
        exact(asset, ("id", "data", "sha256", "type"))
        key, encoded = asset.get("id"), asset.get("data")
        require(UUID.fullmatch(str(key)) and key not in images)
        require(isinstance(encoded, str) and len(encoded) <= 1398104, "pdf_content_image_limit")
        data = base64.b64decode(encoded, validate=True)
        info = inspect_image(data)
        require(base64.b64encode(data).decode() == encoded and info["sha256"] == asset.get("sha256") and info["type"] == asset.get("type"), "pdf_image_asset_changed")
        image_bytes += len(data)
        require(image_bytes <= MAX_BYTES, "pdf_content_image_limit")
        images[key] = asset
    return images


def _load_sources(sources, allow_empty):
    require(isinstance(sources, list) and (0 if allow_empty else 1) <= len(sources) <= 32)
    readers, source_bytes, definitions, total = {}, {}, {}, 0
    for source in sources:
        exact(source, ("id", "data", "sha256"))
        key = source.get("id")
        require(isinstance(key, str) and UUID.fullmatch(key) and key not in readers)
        data = decode(source.get("data"))
        total += len(data)
        require(total <= MAX_BYTES, "pdf_input_limit")
        require(hashlib.sha256(data).hexdigest() == source.get("sha256"), "pdf_source_changed")
        reader = safe_reader(data)
        source_bytes[key], definitions[key] = data, fields_of(reader)
        reader.add_form_topname(key)
        readers[key] = reader
    return readers, source_bytes, definitions


def _apply_fields(writer, values, definitions):
    require(isinstance(values, dict) and len(values) <= 256, "pdf_field_limit")
    all_fields = {key + "." + item["name"]: item for key, items in definitions.items() for item in items}
    available = writer.get_fields() or {}
    for name, value in values.items():
        field = all_fields.get(name)
        require(field is not None and name in available and field["supported"], "pdf_field_unsupported")
        require(isinstance(value, str) and len(value) <= 4096 and all(32 <= ord(c) <= 126 or c == "\n" for c in value),
                "pdf_field_text_unsupported")
        require(len(value) <= field["maxLength"], "pdf_field_value_limit")
        if field["type"] == "Btn":
            require(value in field["options"] + ["/Off"], "pdf_field_option_invalid")
        elif field["type"] == "Ch":
            require(value in field["options"], "pdf_field_option_invalid")
    if values:
        writer.update_page_form_field_values(None, values, auto_regenerate=False)


def derive(sources, model, assets=None):
    exact(model, ("pages", "annotations", "fields", "contentEdits", "objects"))
    pages = model.get("pages")
    require(isinstance(pages, list) and 1 <= len(pages) <= MAX_PAGES, "pdf_page_limit")
    has_blank = any(isinstance(item, dict) and item.get("blank") is True for item in pages)
    images = _load_assets(assets)
    readers, source_bytes, definitions = _load_sources(sources, has_blank)
    writer, seen, source_instances = PdfWriter(), set(), set()
    content_edits, additions = model.get("contentEdits", []), model.get("objects", [])
    require(isinstance(content_edits, list) and len(content_edits) <= 2048 and isinstance(additions, list) and len(additions) <= 128, "pdf_content_limit")
    valid_pages = {item.get("id") for item in pages if isinstance(item, dict)}
    require(all(isinstance(item, dict) and item.get("page") in valid_pages for item in content_edits + additions))
    for item in pages:
        require(isinstance(item, dict) and UUID.fullmatch(str(item.get("id", ""))) and item["id"] not in seen)
        seen.add(item["id"])
        _append_derived_page(writer, item, readers, source_bytes, definitions, source_instances, content_edits, additions, images)
    annotations = model.get("annotations", [])
    require(isinstance(annotations, list) and len(annotations) <= 128, "pdf_annotation_limit")
    page_index = {item["id"]: i for i, item in enumerate(pages)}
    annotation_ids = set()
    for item in annotations:
        require(isinstance(item, dict) and item.get("page") in page_index and item.get("id") not in annotation_ids)
        annotation_ids.add(item.get("id"))
        annotate_page(writer, page_index[item["page"]], item, require)
    _apply_fields(writer, model.get("fields", {}), definitions)
    output = io.BytesIO()
    writer.write(output)
    data = output.getvalue()
    require(len(data) <= MAX_BYTES, "pdf_output_limit")
    inspection = inspect_pdf(data)
    return {**inspection, "data": base64.b64encode(data).decode()}


def raster(data, page, side, directory):
    info = inspect_pdf(data)
    require(isinstance(page, int) and not isinstance(page, bool) and 0 <= page < len(info["pages"]))
    require(isinstance(side, int) and 128 <= side <= 1600)
    path = Path(directory) / "source.pdf"
    path.write_bytes(data)
    prefix = Path(directory) / "preview"
    subprocess.run(["pdftoppm", "-f", str(page + 1), "-l", str(page + 1), "-singlefile", "-png",
                    "-scale-to", str(side), str(path), str(prefix)], check=True, capture_output=True, timeout=20)
    png = prefix.with_suffix(".png").read_bytes()
    require(png.startswith(b"\x89PNG\r\n\x1a\n") and len(png) <= MAX_BYTES, "pdf_preview_limit")
    return png, prefix.with_suffix(".png")


def _ocr_page(data, page, language):
    require(language == "eng", "pdf_ocr_language_unsupported")
    with tempfile.TemporaryDirectory(prefix="pdf-ocr-") as directory:
        _, path = raster(data, page, 1600, directory)
        result = subprocess.run(["tesseract", str(path), "stdout", "-l", "eng", "tsv"], check=True,
                                capture_output=True, timeout=20)
        require(len(result.stdout) <= 1048576, "pdf_ocr_output_limit")
        words = []
        for row in csv.DictReader(io.StringIO(result.stdout.decode()), delimiter="\t"):
            if row.get("level") != "5" or not row.get("text", "").strip():
                continue
            confidence = float(row["conf"])
            require(math.isfinite(confidence) and -1 <= confidence <= 100, "pdf_ocr_invalid_response")
            require(len(words) < 10000, "pdf_ocr_output_limit")
            words.append({"text": row["text"], "confidence": confidence,
                          "rect": [int(row[k]) for k in ("left", "top", "width", "height")]})
        confidence = sum(w["confidence"] for w in words) / len(words) if words else None
        return {"page": page, "language": "eng", "rasterMaxSide": 1600,
                "text": " ".join(w["text"] for w in words), "words": words, "confidence": confidence,
                "quality": "low" if confidence is None or confidence < 70 else "readable",
                "uncertain": True, "truncated": False, "sourceUnchanged": True}


def _data_operation(op, data, request):
    if op == "preview":
        with tempfile.TemporaryDirectory(prefix="pdf-preview-") as directory:
            png, _ = raster(data, request.get("page"), request.get("side", 1200), directory)
            return {"type": "image/png", "data": base64.b64encode(png).decode(), "bytes": len(png),
                    "sha256": hashlib.sha256(png).hexdigest()}
    if op == "words":
        safe_reader(data)
        return {"page": request.get("page"), "words": extract_page_words(data, request.get("page"))}
    if op == "compress":
        safe_reader(data)
        out_bytes, stats = compress_pdf(data, request.get("level", "balanced"), MAX_BYTES, require)
        info = inspect_pdf(out_bytes)
        return {**info, **stats, "data": base64.b64encode(out_bytes).decode()}
    if op == "convert":
        safe_reader(data)
        fmt = request.get("format")
        require(fmt in ("docx", "xlsx", "pptx"))
        title = str(request.get("title") or "Document")[:160]
        archive, mime = convert_pdf_to_ooxml(data, fmt, title)
        require(len(archive) <= 6 * 1024 * 1024, "pdf_output_limit")
        return {"format": fmt, "type": mime, "bytes": len(archive), "sha256": hashlib.sha256(archive).hexdigest(),
                "data": base64.b64encode(archive).decode(), "approximateLayout": True}
    if op == "text":
        reader = safe_reader(data)
        texts, used = [], 0
        for i, page in enumerate(reader.pages):
            text = page.extract_text() or ""
            retained = text[:max(0, 1048576 - used)]
            texts.append({"page": i, "text": retained, "truncated": len(retained) != len(text)})
            used += len(retained)
        return {"pages": texts, "ocr": False, "truncated": any(x["truncated"] for x in texts)}
    if op == "ocr":
        return _ocr_page(data, request.get("page"), request.get("language"))
    raise Refused("pdf_operation_unsupported")


def operation(request):
    exact(request, ("op", "data", "sources", "model", "page", "side", "language", "assets", "photos", "level", "format", "title"))
    op = request.get("op")
    if op == "inspect":
        return inspect_pdf(decode(request.get("data")))
    if op == "inspect-image":
        encoded = request.get("data")
        require(isinstance(encoded, str) and len(encoded) <= 1398104, "pdf_content_image_limit")
        data = base64.b64decode(encoded, validate=True)
        require(base64.b64encode(data).decode() == encoded, "pdf_invalid_encoding")
        return inspect_image(data)
    if op == "photos-to-pdf":
        pdf_bytes = photos_to_pdf(request.get("photos"), MAX_BYTES, require)
        info = inspect_pdf(pdf_bytes)
        return {**info, "data": base64.b64encode(pdf_bytes).decode()}
    if op == "derive":
        return derive(request.get("sources"), request.get("model"), request.get("assets"))
    if op == "draft-preview":
        derived = derive(request.get("sources"), request.get("model"), request.get("assets"))
        data = decode(derived["data"])
        with tempfile.TemporaryDirectory(prefix="pdf-draft-") as directory:
            png, _ = raster(data, request.get("page"), request.get("side", 1200), directory)
            return {"type": "image/png", "data": base64.b64encode(png).decode(), "bytes": len(png),
                    "sha256": hashlib.sha256(png).hexdigest(), "page": derived["pages"][request["page"]]}
    return _data_operation(op, decode(request.get("data")), request)


def main():
    resource.setrlimit(resource.RLIMIT_AS, (512 * 1024 * 1024, 512 * 1024 * 1024))
    resource.setrlimit(resource.RLIMIT_CPU, (35, 35))
    raw = sys.stdin.buffer.read(12 * 1024 * 1024 + 1)
    try:
        require(len(raw) <= 12 * 1024 * 1024, "pdf_request_limit")
        result = operation(json.loads(raw))
        print(json.dumps({"ok": True, "result": result}, separators=(",", ":")))
    except (Refused, ContentRefused) as error:
        print(json.dumps({"ok": False, "error": str(error)}))
    except Exception:
        print(json.dumps({"ok": False, "error": "pdf_parse_or_operation_refused"}))


if __name__ == "__main__":
    main()
