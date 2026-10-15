"""Bounded pure PDF operations. Authority and immutable publication belong to the package.
CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | Preserve real pages/forms and explicit OCR reports.
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
from pypdf.annotations import FreeText, Highlight
from pypdf.generic import ArrayObject, DictionaryObject, FloatObject, NameObject, NumberObject

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
    return {"sha256": hashlib.sha256(data).hexdigest(), "bytes": len(data),
            "pages": [{"index": i, "cropBox": [float(x) for x in page.cropbox], "rotation": page.rotation}
                      for i, page in enumerate(reader.pages)], "fields": fields_of(reader)}


def point(value, box):
    require(isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)
            and box[0] <= value <= box[1], "pdf_annotation_geometry")
    return float(value)


def annotate(writer, page_number, item):
    exact(item, ("id", "page", "kind", "rect", "text", "points", "color"))
    require(UUID.fullmatch(str(item.get("id", ""))) and item.get("kind") in ("text", "highlight", "ink"))
    page = writer.pages[page_number]
    box = [float(x) for x in page.cropbox]
    rect = item.get("rect")
    require(isinstance(rect, list) and len(rect) == 4)
    x0, y0, x1, y1 = [point(v, (box[i % 2], box[i % 2 + 2])) for i, v in enumerate(rect)]
    require(x0 < x1 and y0 < y1)
    color = item.get("color", "ffcc00")
    require(isinstance(color, str) and re.fullmatch(r"[0-9a-f]{6}", color))
    if item["kind"] == "text":
        text = item.get("text")
        require(isinstance(text, str) and 0 < len(text) <= 2000 and all(32 <= ord(c) <= 126 or c == "\n" for c in text),
                "pdf_annotation_text_unsupported")
        annotation = FreeText(text=text, rect=rect, font="Helvetica", font_size="12pt", font_color="000000",
                              background_color="ffffff", border_color=color)
    elif item["kind"] == "highlight":
        quad = ArrayObject([FloatObject(v) for v in (x0, y1, x1, y1, x0, y0, x1, y0)])
        annotation = Highlight(rect=rect, quad_points=quad, highlight_color=color, printing=True)
    else:
        points = item.get("points")
        require(isinstance(points, list) and 2 <= len(points) <= 256)
        values = []
        for pair in points:
            require(isinstance(pair, list) and len(pair) == 2)
            values.extend([FloatObject(point(pair[0], (x0, x1))), FloatObject(point(pair[1], (y0, y1)))])
        annotation = DictionaryObject({NameObject("/Type"): NameObject("/Annot"),
            NameObject("/Subtype"): NameObject("/Ink"), NameObject("/Rect"): ArrayObject([FloatObject(v) for v in rect]),
            NameObject("/InkList"): ArrayObject([ArrayObject(values)]), NameObject("/F"): NumberObject(4),
            NameObject("/C"): ArrayObject([FloatObject(int(color[i:i+2], 16) / 255) for i in (0, 2, 4)]),
            NameObject("/BS"): DictionaryObject({NameObject("/W"): NumberObject(2)})})
    annotation[NameObject("/F")] = NumberObject(4)
    writer.add_annotation(page_number, annotation)


def derive(sources, model):
    exact(model, ("pages", "annotations", "fields"))
    require(isinstance(sources, list) and 1 <= len(sources) <= 32)
    readers = {}
    total = 0
    definitions = {}
    for source in sources:
        exact(source, ("id", "data", "sha256"))
        key = source.get("id")
        require(isinstance(key, str) and UUID.fullmatch(key) and key not in readers)
        data = decode(source.get("data"))
        total += len(data)
        require(total <= MAX_BYTES, "pdf_input_limit")
        require(hashlib.sha256(data).hexdigest() == source.get("sha256"), "pdf_source_changed")
        reader = safe_reader(data)
        definitions[key] = fields_of(reader)
        reader.add_form_topname(key)
        readers[key] = reader
    pages = model.get("pages")
    require(isinstance(pages, list) and 1 <= len(pages) <= MAX_PAGES, "pdf_page_limit")
    writer = PdfWriter()
    seen = set()
    source_instances = set()
    for item in pages:
        exact(item, ("id", "source", "index", "rotation"))
        key, index, rotation = item.get("source"), item.get("index"), item.get("rotation")
        require(UUID.fullmatch(str(item.get("id", ""))) and item["id"] not in seen)
        seen.add(item["id"])
        require(key in readers and isinstance(index, int) and not isinstance(index, bool)
                and 0 <= index < len(readers[key].pages) and rotation in (0, 90, 180, 270))
        require(not definitions[key] or (key, index) not in source_instances, "pdf_repeated_form_page_unsupported")
        source_instances.add((key, index))
        writer.reset_translation(readers[key])
        writer.append(readers[key], pages=[index], import_outline=False)
        writer.pages[-1].rotate(rotation)
    annotations = model.get("annotations", [])
    require(isinstance(annotations, list) and len(annotations) <= 128, "pdf_annotation_limit")
    page_index = {item["id"]: i for i, item in enumerate(pages)}
    annotation_ids = set()
    for item in annotations:
        require(isinstance(item, dict) and item.get("page") in page_index and item.get("id") not in annotation_ids)
        annotation_ids.add(item.get("id"))
        annotate(writer, page_index[item["page"]], item)
    values = model.get("fields", {})
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
    output = io.BytesIO()
    writer.write(output)
    data = output.getvalue()
    require(len(data) <= MAX_BYTES, "pdf_output_limit")
    # Re-open the derivative before returning it; never append to the original bytes.
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


def operation(request):
    exact(request, ("op", "data", "sources", "model", "page", "side", "language"))
    op = request.get("op")
    if op == "inspect":
        return inspect_pdf(decode(request.get("data")))
    if op == "derive":
        return derive(request.get("sources"), request.get("model"))
    data = decode(request.get("data"))
    if op == "preview":
        with tempfile.TemporaryDirectory(prefix="pdf-preview-") as directory:
            png, _ = raster(data, request.get("page"), request.get("side", 1200), directory)
            return {"type": "image/png", "data": base64.b64encode(png).decode(), "bytes": len(png),
                    "sha256": hashlib.sha256(png).hexdigest()}
    if op == "text":
        reader = safe_reader(data)
        texts = []
        used = 0
        for i, page in enumerate(reader.pages):
            text = page.extract_text() or ""
            retained = text[:max(0, 1048576 - used)]
            texts.append({"page": i, "text": retained, "truncated": len(retained) != len(text)})
            used += len(retained)
        return {"pages": texts, "ocr": False, "truncated": any(x["truncated"] for x in texts)}
    if op == "ocr":
        require(request.get("language") == "eng", "pdf_ocr_language_unsupported")
        with tempfile.TemporaryDirectory(prefix="pdf-ocr-") as directory:
            _, path = raster(data, request.get("page"), 1600, directory)
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
            return {"page": request["page"], "language": "eng", "rasterMaxSide": 1600,
                    "text": " ".join(w["text"] for w in words), "words": words, "confidence": confidence,
                    "quality": "low" if confidence is None or confidence < 70 else "readable",
                    "uncertain": True, "truncated": False, "sourceUnchanged": True}
    raise Refused("pdf_operation_unsupported")


def main():
    resource.setrlimit(resource.RLIMIT_AS, (512 * 1024 * 1024, 512 * 1024 * 1024))
    resource.setrlimit(resource.RLIMIT_CPU, (35, 35))
    raw = sys.stdin.buffer.read(12 * 1024 * 1024 + 1)
    try:
        require(len(raw) <= 12 * 1024 * 1024, "pdf_request_limit")
        result = operation(json.loads(raw))
        print(json.dumps({"ok": True, "result": result}, separators=(",", ":")))
    except Refused as error:
        print(json.dumps({"ok": False, "error": str(error)}))
    except Exception:
        print(json.dumps({"ok": False, "error": "pdf_parse_or_operation_refused"}))


if __name__ == "__main__":
    main()
