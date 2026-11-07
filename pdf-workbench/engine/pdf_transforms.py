"""Bounded PDF annotation, photo-to-PDF and size-reduction transforms.
CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | Persist QuadPoints text markup, ink width, multi-photo PDFs and stream/image compression.
"""
import base64
import io
import math
import re
import warnings
from PIL import Image, ImageOps
import pypdfium2 as pdfium
from pypdf import PdfReader, PdfWriter
from pypdf.annotations import FreeText
from pypdf.generic import ArrayObject, DictionaryObject, FloatObject, NameObject, NumberObject

UUID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")
MARKUP_SUBTYPES = {"highlight": "/Highlight", "underline": "/Underline", "strikethrough": "/StrikeOut"}
Image.MAX_IMAGE_PIXELS = 16777216


def _point(value, bounds, check):
    check(isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)
          and bounds[0] - 0.01 <= value <= bounds[1] + 0.01, "pdf_annotation_geometry")
    return float(min(max(value, bounds[0]), bounds[1]))


def _quad_array(quads, rect, check):
    x0, y0, x1, y1 = rect
    if quads is None:
        return ArrayObject([FloatObject(v) for v in (x0, y1, x1, y1, x0, y0, x1, y0)])
    check(isinstance(quads, list) and 1 <= len(quads) <= 64, "pdf_annotation_geometry")
    flat = []
    for quad in quads:
        check(isinstance(quad, list) and len(quad) == 8, "pdf_annotation_geometry")
        for idx, val in enumerate(quad):
            flat.append(FloatObject(_point(val, (x0, x1) if idx % 2 == 0 else (y0, y1), check)))
    return ArrayObject(flat)


def _ink_annot(rect, rgb, item, check):
    x0, y0, x1, y1 = rect
    points = item.get("points")
    width = item.get("strokeWidth", 2)
    check(isinstance(points, list) and 2 <= len(points) <= 256)
    check(isinstance(width, (int, float)) and not isinstance(width, bool) and 0.5 <= width <= 24)
    values = []
    for pair in points:
        check(isinstance(pair, list) and len(pair) == 2)
        values.extend([FloatObject(_point(pair[0], (x0, x1), check)), FloatObject(_point(pair[1], (y0, y1), check))])
    return DictionaryObject({
        NameObject("/Type"): NameObject("/Annot"),
        NameObject("/Subtype"): NameObject("/Ink"),
        NameObject("/Rect"): ArrayObject([FloatObject(v) for v in (x0, y0, x1, y1)]),
        NameObject("/InkList"): ArrayObject([ArrayObject(values)]),
        NameObject("/C"): rgb,
        NameObject("/BS"): DictionaryObject({NameObject("/W"): FloatObject(float(width))}),
        NameObject("/F"): NumberObject(4),
    })


def annotate_page(writer, page_number, item, check):
    allowed = {"id", "page", "kind", "rect", "text", "points", "color", "quadPoints", "strokeWidth"}
    check(isinstance(item, dict) and not set(item) - allowed)
    kind = item.get("kind")
    check(UUID.fullmatch(str(item.get("id", ""))) and kind in ("text", "highlight", "underline", "strikethrough", "ink"))
    box = [float(x) for x in writer.pages[page_number].cropbox]
    rect = item.get("rect")
    check(isinstance(rect, list) and len(rect) == 4)
    x0, y0, x1, y1 = [_point(v, (box[i % 2], box[i % 2 + 2]), check) for i, v in enumerate(rect)]
    check(x0 < x1 and y0 < y1, "pdf_annotation_geometry")
    color = item.get("color", "ffcc00" if kind == "highlight" else "ef4444" if kind == "strikethrough" else "2563eb")
    check(isinstance(color, str) and re.fullmatch(r"[0-9a-f]{6}", color))
    rgb = ArrayObject([FloatObject(int(color[i:i + 2], 16) / 255) for i in (0, 2, 4)])
    if kind == "text":
        text = item.get("text")
        check(isinstance(text, str) and 0 < len(text) <= 2000 and all(32 <= ord(c) <= 126 or c == "\n" for c in text),
              "pdf_annotation_text_unsupported")
        annot = FreeText(text=text, rect=[x0, y0, x1, y1], font="Helvetica", font_size="12pt",
                         font_color="000000", background_color="ffffff", border_color=color)
    elif kind in MARKUP_SUBTYPES:
        quads = _quad_array(item.get("quadPoints"), (x0, y0, x1, y1), check)
        annot = DictionaryObject({
            NameObject("/Type"): NameObject("/Annot"),
            NameObject("/Subtype"): NameObject(MARKUP_SUBTYPES[kind]),
            NameObject("/Rect"): ArrayObject([FloatObject(v) for v in (x0, y0, x1, y1)]),
            NameObject("/QuadPoints"): quads,
            NameObject("/C"): rgb,
            NameObject("/CA"): FloatObject(0.42 if kind == "highlight" else 1.0),
            NameObject("/F"): NumberObject(4),
        })
    else:
        annot = _ink_annot((x0, y0, x1, y1), rgb, item, check)
    annot[NameObject("/F")] = NumberObject(4)
    writer.add_annotation(page_number, annot)


def _decode_photo(entry, max_side_px, jpeg_quality, check):
    check(isinstance(entry, dict) and not set(entry) - {"data", "type", "name"})
    encoded = entry.get("data")
    check(isinstance(encoded, str) and 8 <= len(encoded) <= 5600000, "pdf_photo_limit")
    try:
        raw = base64.b64decode(encoded, validate=True)
    except (ValueError, TypeError):
        check(False, "pdf_invalid_encoding")
    with warnings.catch_warnings():
        warnings.simplefilter("error", Image.DecompressionBombWarning)
        with Image.open(io.BytesIO(raw), formats=["JPEG", "PNG"]) as opened:
            img = ImageOps.exif_transpose(opened)
            w, h = img.size
            check(w > 0 and h > 0 and w * h <= 16777216, "pdf_photo_limit")
            has_alpha = "A" in img.getbands()
            work = img.convert("RGBA" if has_alpha else "RGB")
    if max(work.size) > max_side_px:
        work.thumbnail((max_side_px, max_side_px), Image.Resampling.LANCZOS)
    scale = min(792.0 / max(work.size[0], 1), 792.0 / max(work.size[1], 1), 1.0)
    pt_w = max(36.0, round(work.size[0] * scale, 2))
    pt_h = max(36.0, round(work.size[1] * scale, 2))
    if has_alpha:
        return {"mode": "png", "pil": work, "pt": (pt_w, pt_h)}
    buf = io.BytesIO()
    work.save(buf, format="JPEG", quality=jpeg_quality, optimize=True)
    work.close()
    return {"mode": "jpeg", "bytes": buf.getvalue(), "pt": (pt_w, pt_h)}


def photos_to_pdf(photos, max_bytes, check):
    check(isinstance(photos, list) and 1 <= len(photos) <= 32, "pdf_page_limit")
    for max_px, quality in ((1800, 82), (1200, 70), (900, 56)):
        decoded = [_decode_photo(entry, max_px, quality, check) for entry in photos]
        doc = pdfium.PdfDocument.new()
        keepers = []
        try:
            for item in decoded:
                w_pt, h_pt = item["pt"]
                page = doc.new_page(w_pt, h_pt)
                img_obj = pdfium.PdfImage.new(doc)
                if item["mode"] == "png":
                    bmp = pdfium.PdfBitmap.from_pil(item["pil"])
                    keepers.append((bmp, item["pil"]))
                    img_obj.set_bitmap(bmp)
                else:
                    img_obj.load_jpeg(io.BytesIO(item["bytes"]))
                img_obj.set_matrix(pdfium.PdfMatrix(w_pt, 0, 0, h_pt, 0, 0))
                page.insert_obj(img_obj)
                page.gen_content()
                page.close()
            out = io.BytesIO()
            doc.save(out)
            pdf_bytes = out.getvalue()
        finally:
            for bmp, pil_im in keepers:
                bmp.close()
                pil_im.close()
            doc.close()
        if len(pdf_bytes) <= max_bytes:
            return pdf_bytes
    check(False, "pdf_output_limit")


def compress_pdf(data, level, max_bytes, check):
    check(level in ("balanced", "maximum"), "pdf_invalid_input")
    max_px, quality = (1200, 68) if level == "balanced" else (850, 50)
    reader = PdfReader(io.BytesIO(data), strict=True)
    writer = PdfWriter(clone_from=reader)
    for page in writer.pages:
        for pimg in list(page.images):
            try:
                pil = pimg.image
            except Exception:
                continue
            if pil is None:
                continue
            work = pil.copy()
            if max(work.size) > max_px:
                work.thumbnail((max_px, max_px), Image.Resampling.LANCZOS)
            try:
                if "A" in work.getbands():
                    quant = work.quantize(colors=128, method=Image.Quantize.FASTOCTREE)
                    pimg.replace(quant.convert("RGBA"))
                else:
                    rgb = work if work.mode in ("RGB", "L") else work.convert("RGB")
                    pimg.replace(rgb, quality=quality)
            except Exception:
                pass
            finally:
                work.close()
        page.compress_content_streams(level=9)
    writer.compress_identical_objects(remove_duplicates=True, remove_unreferenced=True)
    out = io.BytesIO()
    writer.write(out)
    candidate = out.getvalue()
    result = candidate if 0 < len(candidate) <= len(data) else data
    check(len(result) <= max_bytes, "pdf_output_limit")
    return result, {"beforeBytes": len(data), "afterBytes": len(result), "savedBytes": max(0, len(data) - len(result))}
