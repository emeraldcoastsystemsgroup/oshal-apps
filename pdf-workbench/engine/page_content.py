"""Native PDF page objects, kept separate from annotations and owner authority.
CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | Inspect and modify real PDFium objects with stable original ordinals.
"""
import base64
import hashlib
import ctypes as c
import io
import math
import re
import warnings
import secrets
from contextlib import closing
from PIL import Image
import pypdfium2 as pdfium
import pypdfium2.raw as raw
from pypdf import PdfReader, PdfWriter
from pypdf.generic import ContentStream, DictionaryObject, NameObject, FloatObject

KINDS = {1: "text", 2: "path", 3: "image", 4: "shading", 5: "group"}
FONTS = {"Helvetica", "Helvetica-Bold", "Helvetica-Oblique", "Helvetica-BoldOblique", "Times-Roman", "Times-Bold", "Times-Italic", "Times-BoldItalic", "Courier", "Courier-Bold", "Courier-Oblique", "Courier-BoldOblique"}
Image.MAX_IMAGE_PIXELS = 16777216
WORK_MARK_PREFIX = "OSHALImageAlpha" + secrets.token_hex(16) + "_"


class ContentRefused(Exception):
    pass


def require(value, code="pdf_content_operation_refused"):
    if not value:
        raise ContentRefused(code)


def color_of(obj, stroke=False):
    parts = [c.c_uint() for _ in range(4)]
    get = raw.FPDFPageObj_GetStrokeColor if stroke else raw.FPDFPageObj_GetFillColor
    if get(obj, *(c.byref(v) for v in parts)):
        return "".join(f"{v.value:02x}" for v in parts[:3]), parts[3].value / 255
    return None, 1


def inspect_image(data):
    require(isinstance(data, bytes) and 5 <= len(data) <= 1048576, "pdf_content_image_limit")
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(data), formats=["PNG"]) as image:
                width, height = image.size
                require(width > 0 and height > 0 and width * height <= 16777216, "pdf_content_image_limit")
                image.verify()
        mime = "image/png"
    else:
        require(data.startswith(b"\xff\xd8\xff"), "pdf_content_image_unsupported")
        with pdfium.PdfDocument.new() as document:
            image = pdfium.PdfImage.new(document)
            try:
                image.load_jpeg(io.BytesIO(data))
                width, height = image.get_px_size()
            finally:
                image.close()
        mime = "image/jpeg"
    require(width > 0 and height > 0 and width * height <= 16777216, "pdf_content_image_limit")
    return {"type": mime, "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest(), "width": width, "height": height}


def printable_text(text, encoding="latin1"):
    return isinstance(text, str) and 0 < len(text) <= 4000 and all(32 <= ord(ch) <= 126 or encoding == "latin1" and 160 <= ord(ch) <= 255 for ch in text)


def page_fonts_supported(page):
    resources = page.get("/Resources", DictionaryObject()).get_object()
    fonts = resources.get("/Font", DictionaryObject()).get_object()
    return not any(ref.get_object().get("/Subtype") == "/Type3" for ref in fonts.values())


def font_profiles(page):
    """Only complete, non-custom standard resources are safe for source re-encoding."""
    resources = page.get("/Resources", DictionaryObject()).get_object()
    fonts = resources.get("/Font", DictionaryObject()).get_object()
    profiles = {}
    for ref in fonts.values():
        font = ref.get_object()
        name, encoding = str(font.get("/BaseFont", ""))[1:], font.get("/Encoding")
        safe = font.get("/Subtype") == "/Type1" and name in FONTS and "/ToUnicode" not in font
        profile = "latin1" if safe and encoding == "/WinAnsiEncoding" else "ascii" if safe and encoding in (None, "/StandardEncoding") else None
        profiles[name] = profile if name not in profiles else profile if profiles[name] == profile else None
    return profiles


def font_name(font):
    try:
        return font.get_base_name()
    except pdfium.PdfiumError:
        return "Original PDF font"


def text_policy(obj, text, profiles):
    font = obj.get_font()
    encoding = profiles.get(font_name(font)) if raw.FPDFFont_GetIsEmbedded(font) == 0 else None
    safe = encoding is not None and printable_text(text, encoding)
    reason = "" if safe else "Choose a supported standard font explicitly to edit Latin-1 text and font size." if printable_text(text) else "This text cannot be re-encoded by the Latin-1 editing profile; geometry and appearance remain editable."
    return {"textEditable": safe, "fontSizeEditable": safe, "fontReplaceable": printable_text(text), "textEncoding": encoding, "textEditReason": reason}


def validate_text_change(info, properties):
    if "font" in properties:
        require(properties["font"] in FONTS, "pdf_content_font_unsupported")
        require(printable_text(properties.get("text", info["text"])), "pdf_content_text_unsupported")
    else:
        if "text" in properties:
            require(info.get("textEditable") and printable_text(properties["text"], info.get("textEncoding")), "pdf_content_font_reencoding_unsupported")
        if "fontSize" in properties:
            require(info.get("fontSizeEditable"), "pdf_content_font_reencoding_unsupported")


def object_info(obj, index, textpage, profiles):
    rect = list(obj.get_bounds())
    require(all(math.isfinite(v) and abs(v) <= 100000 for v in rect), "pdf_content_geometry")
    kind = KINDS.get(obj.type, "unknown")
    info = {"id": "o" + str(index), "kind": kind, "rect": rect, "editable": kind != "unknown"}
    if kind in ("text", "path"):
        fill, opacity = color_of(obj)
        stroke, _ = color_of(obj, True)
        if fill is not None:
            info["fill"] = fill
            info["opacity"] = opacity
        if stroke is not None:
            info["stroke"] = stroke
        width = c.c_float()
        if raw.FPDFPageObj_GetStrokeWidth(obj, c.byref(width)):
            info["strokeWidth"] = width.value
    if kind == "text":
        obj.textpage = textpage
        info.update(text=obj.extract(), font=font_name(obj.get_font()), fontSize=obj.get_font_size())
        info.update(text_policy(obj, info["text"], profiles))
        mode = raw.FPDFTextObj_GetTextRenderMode(obj)
        info["renderMode"] = mode
        if mode not in (0, 1, 2):
            info.update(editable=False, reason="Hidden or clipping text is read only in this editing profile.")
        if mode not in (1, 2, 5, 6):
            info["strokeWidth"] = 0
        if len(info["text"]) > 4000:
            info.update(text=info["text"][:4000], editable=False, reason="This text run exceeds the editing limit.")
    if kind == "path":
        fill_mode, stroked = c.c_int(), c.c_int()
        if raw.FPDFPath_GetDrawMode(obj, c.byref(fill_mode), c.byref(stroked)) and not stroked.value:
            info["strokeWidth"] = 0
    if kind == "image":
        info["opacity"] = color_of(obj)[1]
    return info


def image_alphas(page):
    contents = page.get_contents()
    if contents is None:
        return []
    resources = page.get("/Resources", DictionaryObject()).get_object()
    states = resources.get("/ExtGState", DictionaryObject()).get_object()
    xobjects = resources.get("/XObject", DictionaryObject()).get_object()
    alpha, stack, result = 1, [], []
    for operands, operator in contents.operations:
        if operator == b"q":
            stack.append(alpha)
        elif operator == b"Q":
            alpha = stack.pop() if stack else 1
        elif operator == b"gs" and operands:
            state = states.get(operands[0])
            if state is not None:
                value = state.get_object().get("/ca")
                if value is not None:
                    alpha = float(value)
                    require(math.isfinite(alpha) and 0 <= alpha <= 1, "pdf_content_opacity")
        elif operator == b"Do" and operands:
            target = xobjects.get(operands[0])
            if target is not None and target.get_object().get("/Subtype") == "/Image":
                result.append(alpha)
        elif operator == b"INLINE IMAGE":
            result.append(alpha)
    return result


def inspect_objects(data, reader=None):
    reader = reader or PdfReader(io.BytesIO(data), strict=True)
    with pdfium.PdfDocument(data) as document:
        result, count, text_size = [], 0, 0
        for page_number, page in enumerate(document):
            with closing(page):
                with closing(page.get_textpage()) as textpage:
                    items = []
                    editable_page = page_fonts_supported(reader.pages[page_number])
                    profiles = font_profiles(reader.pages[page_number])
                    for index, obj in enumerate(page.get_objects(max_depth=1)):
                        count += 1
                        if count > 4096 or index >= 512:
                            break
                        item = object_info(obj, index, textpage, profiles)
                        text_size += len(item.get("text", ""))
                        if text_size > 131072:
                            item.update(text="", editable=False, reason="The document text editing budget is reached.")
                        if not editable_page:
                            item.update(editable=False, reason="This page uses Type3 glyph programs that cannot safely round-trip through content editing.", textEditReason="Type3 page content is read only; its original glyph programs are preserved.")
                        items.append(item)
                    images = [item for item in items if item["kind"] == "image"]
                    alphas = image_alphas(reader.pages[page_number])
                    if len(alphas) >= len(images):
                        for item, alpha in zip(images, alphas):
                            item["opacity"] = alpha
                    else:
                        for item in images:
                            item.pop("opacity", None)
                    result.append({"contentEditable": editable_page, "objects": items, "objectCount": raw.FPDFPage_CountObjects(page), "objectsTruncated": len(items) < raw.FPDFPage_CountObjects(page)})
        return result


def set_style(obj, properties, preserve_draw_mode=False):
    if obj.type == raw.FPDF_PAGEOBJ_IMAGE:
        if "opacity" in properties:
            alpha = properties["opacity"]
            require(isinstance(alpha, (int, float)) and not isinstance(alpha, bool) and math.isfinite(alpha) and 0 <= alpha <= 1)
            require(raw.FPDFPageObj_AddMark(obj, (WORK_MARK_PREFIX + str(round(alpha * 1000000))).encode()))
        return
    for key, setter in (("fill", raw.FPDFPageObj_SetFillColor), ("stroke", raw.FPDFPageObj_SetStrokeColor)):
        if key in properties or "opacity" in properties:
            color, alpha = color_of(obj, key == "stroke")
            value = properties.get(key, color)
            if value is not None:
                require(isinstance(value, str) and re.fullmatch("[0-9a-f]{6}", value), "pdf_content_color")
                opacity = properties.get("opacity", alpha)
                require(isinstance(opacity, (int, float)) and not isinstance(opacity, bool) and 0 <= opacity <= 1)
                require(setter(obj, *(int(value[i:i+2], 16) for i in (0, 2, 4)), round(opacity * 255)))
    if "strokeWidth" in properties:
        width = properties["strokeWidth"]
        require(isinstance(width, (int, float)) and not isinstance(width, bool) and math.isfinite(width) and 0 <= width <= 40)
        require(raw.FPDFPageObj_SetStrokeWidth(obj, width))
    if obj.type == raw.FPDF_PAGEOBJ_TEXT and not preserve_draw_mode and any(key in properties for key in ("fill", "stroke", "strokeWidth")):
        mode = raw.FPDFTextObj_GetTextRenderMode(obj)
        require(mode in (0, 1, 2), "pdf_content_text_render_mode_unsupported")
        filled, stroked = mode in (0, 2), mode in (1, 2)
        if "fill" in properties:
            filled = True
        if "stroke" in properties:
            stroked = True
        if "strokeWidth" in properties:
            stroked = properties["strokeWidth"] > 0
        require(filled or stroked, "pdf_content_visible_paint_required")
        if stroked and "strokeWidth" not in properties:
            width = c.c_float()
            require(raw.FPDFPageObj_GetStrokeWidth(obj, c.byref(width)))
            if width.value <= 0:
                require(raw.FPDFPageObj_SetStrokeWidth(obj, 1))
        require(raw.FPDFTextObj_SetTextRenderMode(obj, 2 if filled and stroked else 0 if filled else 1))
    if obj.type == raw.FPDF_PAGEOBJ_PATH and ("fill" in properties or "stroke" in properties or "strokeWidth" in properties):
        fill, stroke = c.c_int(), c.c_int()
        require(raw.FPDFPath_GetDrawMode(obj, c.byref(fill), c.byref(stroke)))
        require(raw.FPDFPath_SetDrawMode(obj, fill.value if fill.value != raw.FPDF_FILLMODE_NONE else raw.FPDF_FILLMODE_WINDING if "fill" in properties else fill.value,
                                       properties.get("strokeWidth", 1) > 0 if "stroke" in properties or "strokeWidth" in properties else stroke.value))


def set_text(obj, text):
    require(isinstance(text, str) and 0 < len(text) <= 4000 and all(32 <= ord(ch) <= 126 or 160 <= ord(ch) <= 255 for ch in text), "pdf_content_text_unsupported")
    encoded = text.encode("utf-16-le") + b"\0\0"
    buffer = (raw.FPDF_WCHAR * (len(encoded) // 2)).from_buffer_copy(encoded)
    require(raw.FPDFText_SetText(obj, buffer), "pdf_content_text_unsupported")


def fit_rect(obj, rect, crop):
    require(isinstance(rect, list) and len(rect) == 4 and all(isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v) and crop[i % 2] <= v <= crop[i % 2 + 2] for i, v in enumerate(rect))
            and rect[0] < rect[2] and rect[1] < rect[3], "pdf_content_geometry")
    old = obj.get_bounds()
    require(old[2] > old[0] and old[3] > old[1], "pdf_content_geometry")
    sx, sy = (rect[2] - rect[0]) / (old[2] - old[0]), (rect[3] - rect[1]) / (old[3] - old[1])
    obj.transform(pdfium.PdfMatrix(a=sx, d=sy, e=rect[0] - old[0] * sx, f=rect[1] - old[1] * sy))


def create_object(document, page, item, crop, keepers):
    kind, rect = item.get("kind"), item.get("rect")
    require(kind in ("text", "rectangle", "ellipse", "image"))
    if kind == "text":
        font, size = item.get("font", "Helvetica"), item.get("fontSize", 16)
        require(font in FONTS and isinstance(size, (int, float)) and not isinstance(size, bool) and 1 <= size <= 256)
        handle = raw.FPDFPageObj_NewTextObj(document, font.encode(), size)
        require(handle)
        obj = pdfium.PdfObject(handle, pdf=document)
        set_text(obj, item.get("text"))
    elif kind == "rectangle":
        obj = pdfium.PdfObject(raw.FPDFPageObj_CreateNewRect(0, 0, 100, 100), pdf=document)
    elif kind == "ellipse":
        # Four cubic segments, in our own normalized coordinate system.
        handle = raw.FPDFPageObj_CreateNewPath(100, 50)
        require(handle)
        obj = pdfium.PdfObject(handle, pdf=document)
        k = 27.6142374915
        for values in ((100, 50+k, 50+k, 100, 50, 100), (50-k, 100, 0, 50+k, 0, 50), (0, 50-k, 50-k, 0, 50, 0), (50+k, 0, 100, 50-k, 100, 50)):
            require(raw.FPDFPath_BezierTo(obj, *values))
        require(raw.FPDFPath_Close(obj))
    else:
        encoded = item.get("image")
        require(isinstance(encoded, str) and len(encoded) <= 1398104, "pdf_content_image_limit")
        try:
            data = base64.b64decode(encoded, validate=True)
        except (ValueError, TypeError):
            raise ContentRefused("pdf_content_image_unsupported") from None
        require(base64.b64encode(data).decode() == encoded, "pdf_content_image_unsupported")
        obj = pdfium.PdfImage.new(document)
        if item.get("imageType", "image/jpeg") == "image/png":
            require(data.startswith(b"\x89PNG\r\n\x1a\n"), "pdf_content_image_unsupported")
            with warnings.catch_warnings():
                warnings.simplefilter("error", Image.DecompressionBombWarning)
                with Image.open(io.BytesIO(data), formats=["PNG"]) as image:
                    require(image.width > 0 and image.height > 0 and image.width * image.height <= 16777216, "pdf_content_image_limit")
                    image.load()
                    with image.convert("RGBA") as rgba:
                        bitmap = pdfium.PdfBitmap.from_pil(rgba)
                    keepers.append(bitmap)
                    obj.set_bitmap(bitmap)
        else:
            require(item.get("imageType", "image/jpeg") == "image/jpeg" and data.startswith(b"\xff\xd8\xff"), "pdf_content_image_unsupported")
            obj.load_jpeg(io.BytesIO(data))
        width, height = obj.get_px_size()
        require(width > 0 and height > 0 and width * height <= 16777216, "pdf_content_image_limit")
    if kind in ("rectangle", "ellipse"):
        require(raw.FPDFPath_SetDrawMode(obj, raw.FPDF_FILLMODE_WINDING, True))
    page.insert_obj(obj)
    set_style(obj, {"fill": "000000" if kind == "text" else "dbeafe", **{key: item[key] for key in ("fill", "stroke", "strokeWidth", "opacity") if key in item}} if kind != "image" else {key:item[key] for key in ("opacity",) if key in item})
    fit_rect(obj, rect, crop)
    return obj


def edit_page(data, index, edits, additions, crop):
    require(len(edits) <= 2048 and len(additions) <= 128)
    with pdfium.PdfDocument(data) as document:
        keepers = []
        with closing(document[index]) as page:
            require(page_fonts_supported(PdfReader(io.BytesIO(data), strict=True).pages[index]), "pdf_content_page_unsupported")
            objects = list(page.get_objects(max_depth=1))
            # Cache text and style before any removals invalidate text-page handles.
            with closing(page.get_textpage()) as textpage:
                profiles = font_profiles(PdfReader(io.BytesIO(data), strict=True).pages[index])
                metadata = [object_info(obj, i, textpage, profiles) for i, obj in enumerate(objects)]
            alphas = image_alphas(PdfReader(io.BytesIO(data), strict=True).pages[index])
            images = [(obj, info) for obj, info in zip(objects, metadata) if obj.type == raw.FPDF_PAGEOBJ_IMAGE]
            require(len(alphas) == len(images), "pdf_image_opacity_unavailable")
            for (_, info), alpha in zip(images, alphas):
                info["opacity"] = alpha
            for obj, info in zip(objects, metadata):
                if obj.type == raw.FPDF_PAGEOBJ_IMAGE:
                    set_style(obj, {"opacity": info.get("opacity", 1)})
            seen = set()
            # Reverse order keeps replacement insertion positions stable after deletions.
            for edit in sorted(edits, key=lambda e: int(str(e.get("object", "o-1"))[1:]), reverse=True):
                key = edit.get("object")
                require(isinstance(key, str) and re.fullmatch(r"o(?:0|[1-9][0-9]{0,4})", key) and key not in seen)
                seen.add(key)
                ordinal = int(key[1:])
                require(ordinal < len(objects), "pdf_content_object_unavailable")
                obj, info = objects[ordinal], metadata[ordinal]
                require(info["editable"], "pdf_content_object_unsupported")
                if edit.get("deleted") is True:
                    page.remove_obj(obj)
                    obj.close()
                    continue
                properties = edit.get("properties")
                require(isinstance(properties, dict) and properties and not set(properties) - {"rect", "text", "font", "fontSize", "fill", "stroke", "strokeWidth", "opacity"})
                if obj.type == raw.FPDF_PAGEOBJ_TEXT:
                    validate_text_change(info, properties)
                if "font" in properties or "fontSize" in properties:
                    require(obj.type == raw.FPDF_PAGEOBJ_TEXT)
                    size = properties.get("fontSize", info["fontSize"])
                    require(isinstance(size, (int, float)) and not isinstance(size, bool) and 1 <= size <= 256)
                    if "font" in properties:
                        require(properties["font"] in FONTS, "pdf_content_font_unsupported")
                        handle = raw.FPDFPageObj_NewTextObj(document, properties["font"].encode(), size)
                    else:
                        handle = raw.FPDFPageObj_CreateTextObj(document, obj.get_font(), size)
                    require(handle)
                    replacement = pdfium.PdfObject(handle, pdf=document)
                    set_text(replacement, properties.get("text", info["text"]))
                    replacement.set_matrix(obj.get_matrix())
                    require(raw.FPDFTextObj_SetTextRenderMode(replacement, info["renderMode"]))
                    set_style(replacement, {key: info[key] for key in ("strokeWidth",) if key in info}, preserve_draw_mode=True)
                    for stroked, setter in ((False, raw.FPDFPageObj_SetFillColor), (True, raw.FPDFPageObj_SetStrokeColor)):
                        color, alpha = color_of(obj, stroked)
                        if color is not None:
                            require(setter(replacement, *(int(color[i:i+2], 16) for i in (0, 2, 4)), round(alpha * 255)))
                    page.remove_obj(obj)
                    require(raw.FPDFPage_InsertObjectAtIndex(page, replacement, ordinal))
                    replacement._detach_finalizer()
                    replacement.page, replacement.pdf = page, document
                    obj.close()
                    obj = replacement
                elif "text" in properties:
                    require(obj.type == raw.FPDF_PAGEOBJ_TEXT)
                    set_text(obj, properties["text"])
                set_style(obj, properties)
                if "rect" in properties:
                    fit_rect(obj, properties["rect"], crop)
            for item in additions:
                create_object(document, page, item, crop, keepers)
            page.gen_content()
        output = io.BytesIO()
        document.save(output)
        for bitmap in keepers:
            bitmap.close()
        return image_alpha_states(output.getvalue())


def image_alpha_states(data):
    """PDFium's image writer does not serialize changed fill alpha. Write a real
    isolated ExtGState around the marked image invocation, preserving its pixels,
    masks, transforms and every unrelated graphics state. Remove our work marks.
    """
    reader = PdfReader(io.BytesIO(data), strict=True)
    writer = PdfWriter()
    writer.clone_document_from_reader(reader)
    changed = False
    for page in writer.pages:
        contents = page.get_contents()
        if contents is None or WORK_MARK_PREFIX.encode() not in contents.get_data():
            continue
        stack, operations, alphas = [], [], {}
        resources = page.get("/Resources", DictionaryObject()).get_object()
        states = resources.get("/ExtGState", DictionaryObject()).get_object()
        for operands, operator in contents.operations:
            if operator in (b"BMC", b"BDC"):
                name = str(operands[0]) if operands else ""
                match = re.fullmatch("/" + re.escape(WORK_MARK_PREFIX) + r"([0-9]{1,7})", name)
                if match:
                    alpha = int(match[1]) / 1000000
                    require(0 <= alpha <= 1)
                    stack.append(alpha)
                    changed = True
                    continue
                stack.append(None)
            elif operator == b"EMC":
                if stack and stack.pop() is not None:
                    continue
            if operator == b"Do" and any(value is not None for value in stack):
                alpha = next(value for value in reversed(stack) if value is not None)
                if alpha not in alphas:
                    ordinal = len(states)
                    while NameObject("/OSHALImageAlpha" + str(ordinal)) in states:
                        ordinal += 1
                    name = NameObject("/OSHALImageAlpha" + str(ordinal))
                    states[name] = DictionaryObject({NameObject("/Type"): NameObject("/ExtGState"), NameObject("/ca"): FloatObject(alpha), NameObject("/CA"): FloatObject(alpha)})
                    alphas[alpha] = name
                operations.extend([([], b"q"), ([alphas[alpha]], b"gs"), (operands, operator), ([], b"Q")])
            else:
                operations.append((operands, operator))
        require(not stack, "pdf_content_mark_balance")
        resources[NameObject("/ExtGState")] = states
        page[NameObject("/Resources")] = resources
        contents.operations = operations
        page.replace_contents(contents)
    if not changed:
        return data
    result = io.BytesIO()
    writer.write(result)
    return result.getvalue()
