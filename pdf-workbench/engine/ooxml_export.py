"""Standards-compliant OOXML (.docx, .xlsx, .pptx) export from extracted PDF page layout.
CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | Extract text runs, tabular grids and embedded images into valid Word, Excel and PowerPoint packages.
"""
import io
import math
import re
import zipfile
from contextlib import closing
from xml.sax.saxutils import escape
from PIL import Image
import pypdfium2 as pdfium
from pypdf import PdfReader

BAD_XML = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\ufffe\uffff]")
NUM_RE = re.compile(r"^[+-]?(?:\d+\.?\d*|\.\d+)$")
EMU_PER_PT = 12700


def _xml_text(value):
    return escape(BAD_XML.sub("", str(value or "")))


def _col_name(index):
    out, n = "", index + 1
    while n > 0:
        n, rem = divmod(n - 1, 26)
        out = chr(65 + rem) + out
    return out


def _extract_runs(page, textpage):
    runs = []
    for idx, obj in enumerate(page.get_objects(max_depth=1)):
        if idx >= 512 or obj.type != 1:
            continue
        bounds = list(obj.get_bounds())
        if not all(math.isfinite(v) for v in bounds) or bounds[2] <= bounds[0]:
            continue
        obj.textpage = textpage
        text = BAD_XML.sub("", obj.extract() or "").strip()
        if not text:
            continue
        try:
            fname = obj.get_font().get_base_name()
        except Exception:
            fname = "Helvetica"
        size = float(obj.get_font_size() or 12.0)
        runs.append({"text": text, "rect": bounds, "size": max(6.0, min(size, 96.0)), "bold": "bold" in fname.lower()})
    if runs:
        return runs
    raw_text = BAD_XML.sub("", textpage.get_text_range() or "").strip()
    if not raw_text:
        return []
    width, height = page.get_size()
    return [{"text": line.strip(), "rect": [48.0, max(24.0, height - 48.0 - i * 18.0), max(96.0, width - 48.0), max(38.0, height - 32.0 - i * 18.0)],
             "size": 11.0, "bold": False} for i, line in enumerate(raw_text.splitlines()[:200]) if line.strip()]


def _cluster_blocks(runs):
    ordered = sorted(runs, key=lambda r: (-round(r["rect"][3], 1), r["rect"][0]))
    rows = []
    for run in ordered:
        top, bot = run["rect"][3], run["rect"][1]
        if rows and abs(rows[-1]["top"] - top) <= max(6.0, (top - bot) * 0.55):
            rows[-1]["cells"].append(run)
            rows[-1]["top"] = max(rows[-1]["top"], top)
        else:
            rows.append({"top": top, "cells": [run]})
    for row in rows:
        row["cells"].sort(key=lambda c: c["rect"][0])
    blocks, pending_table = [], []
    for row in rows:
        split_cells = []
        for cell in row["cells"]:
            parts = [p.strip() for p in re.split(r"\t+|\s{3,}", cell["text"]) if p.strip()]
            if len(parts) > 1:
                step = (cell["rect"][2] - cell["rect"][0]) / len(parts)
                for j, part in enumerate(parts):
                    split_cells.append({**cell, "text": part, "rect": [cell["rect"][0] + j * step, cell["rect"][1], cell["rect"][0] + (j + 1) * step, cell["rect"][3]]})
            else:
                split_cells.append(cell)
        if len(split_cells) >= 2:
            pending_table.append(split_cells)
        else:
            if len(pending_table) >= 2:
                blocks.append({"kind": "table", "rows": [[c["text"] for c in r] for r in pending_table]})
            elif pending_table:
                blocks.append({"kind": "para", "text": "  ".join(c["text"] for c in pending_table[0]), "size": pending_table[0][0]["size"], "bold": pending_table[0][0]["bold"]})
            pending_table = []
            only = split_cells[0]
            blocks.append({"kind": "para", "text": only["text"], "size": only["size"], "bold": only["bold"]})
    if len(pending_table) >= 2:
        blocks.append({"kind": "table", "rows": [[c["text"] for c in r] for r in pending_table]})
    elif pending_table:
        blocks.append({"kind": "para", "text": "  ".join(c["text"] for c in pending_table[0]), "size": pending_table[0][0]["size"], "bold": pending_table[0][0]["bold"]})
    return blocks, rows


def _extract_images(reader_page, limit_bytes=1572864):
    images, used = [], 0
    for idx, pimg in enumerate(list(reader_page.images)[:8]):
        try:
            pil = pimg.image
            if pil is None:
                continue
            work = pil.copy()
            if max(work.size) > 900:
                work.thumbnail((900, 900), Image.Resampling.LANCZOS)
            buf = io.BytesIO()
            work.save(buf, format="PNG", optimize=True)
            png = buf.getvalue()
            w_px, h_px = work.size
            work.close()
            if used + len(png) <= limit_bytes:
                used += len(png)
                images.append({"index": idx, "png": png, "width": w_px, "height": h_px})
        except Exception:
            continue
    return images


def extract_layout(data):
    reader = PdfReader(io.BytesIO(data), strict=True)
    pages = []
    with pdfium.PdfDocument(data) as document:
        for idx, page in enumerate(document):
            with closing(page):
                with closing(page.get_textpage()) as textpage:
                    box = [float(x) for x in reader.pages[idx].cropbox]
                    width, height = box[2] - box[0], box[3] - box[1]
                    if reader.pages[idx].rotation in (90, 270):
                        width, height = height, width
                    runs = _extract_runs(page, textpage)
                    blocks, rows = _cluster_blocks(runs)
                    imgs = _extract_images(reader.pages[idx])
                    pages.append({"index": idx, "width": max(72.0, width), "height": max(72.0, height),
                                  "runs": runs, "blocks": blocks, "rows": rows, "images": imgs})
    return pages


def _docx_drawing(rel_id, width_pt, height_pt, doc_pr_id):
    cx, cy = int(width_pt * EMU_PER_PT), int(height_pt * EMU_PER_PT)
    return (
        '<w:p><w:r><w:drawing>'
        '<wp:inline xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" distT="0" distB="0" distL="0" distR="0">'
        f'<wp:extent cx="{cx}" cy="{cy}"/><wp:docPr id="{doc_pr_id}" name="Image {doc_pr_id}"/>'
        '<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">'
        '<a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">'
        '<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">'
        f'<pic:nvPicPr><pic:cNvPr id="{doc_pr_id}" name="Image {doc_pr_id}"/><pic:cNvPicPr/></pic:nvPicPr>'
        f'<pic:blipFill><a:blip xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:embed="{rel_id}"/>'
        '<a:stretch><a:fillRect/></a:stretch></pic:blipFill>'
        f'<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="{cx}" cy="{cy}"/></a:xfrm>'
        '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>'
        '</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>'
    )


PPTX_THEME_XML = (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    '<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Office Theme">'
    '<a:themeElements><a:clrScheme name="Office">'
    '<a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>'
    '<a:dk2><a:srgbClr val="1F2937"/></a:dk2><a:lt2><a:srgbClr val="F3F4F6"/></a:lt2>'
    '<a:accent1><a:srgbClr val="2563EB"/></a:accent1><a:accent2><a:srgbClr val="0D9488"/></a:accent2>'
    '<a:accent3><a:srgbClr val="D97706"/></a:accent3><a:accent4><a:srgbClr val="7C3AED"/></a:accent4>'
    '<a:accent5><a:srgbClr val="DB2777"/></a:accent5><a:accent6><a:srgbClr val="4F46E5"/></a:accent6>'
    '<a:hlink><a:srgbClr val="2563EB"/></a:hlink><a:folHlink><a:srgbClr val="7C3AED"/></a:folHlink></a:clrScheme>'
    '<a:fontScheme name="Office"><a:majorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont>'
    '<a:minorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme>'
    '<a:fmtScheme name="Office"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst>'
    '<a:lnStyleLst><a:ln w="9525"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst>'
    '<a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst>'
    '<a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>'
)


def _write_docx_zip(body, sect, rels, media, title):
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("[Content_Types].xml", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
                    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
                    '<Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/>'
                    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
                    '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>'
                    '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>')
        zf.writestr("_rels/.rels", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
                    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>'
                    '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>')
        zf.writestr("docProps/core.xml", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                    '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" '
                    f'xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>{_xml_text(title)}</dc:title></cp:coreProperties>')
        zf.writestr("word/styles.xml", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                    '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
                    '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style></w:styles>')
        zf.writestr("word/_rels/document.xml.rels", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + "".join(rels) + "</Relationships>")
        zf.writestr("word/document.xml", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" '
                    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>' + "".join(body) + sect + "</w:body></w:document>")
        for name, png in media:
            zf.writestr(f"word/media/{name}", png)
    return out.getvalue()


def export_docx(pages, title):
    body, rels, media = [], ['<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'], []
    next_rel = 2
    for p_idx, page in enumerate(pages):
        if p_idx > 0:
            body.append('<w:p><w:r><w:br w:type="page"/></w:r></w:p>')
        for block in page["blocks"]:
            if block["kind"] == "para":
                hp = max(16, min(144, int(round(block["size"] * 2))))
                b_tag = "<w:b/>" if block["bold"] or block["size"] >= 15 else ""
                body.append(f'<w:p><w:r><w:rPr>{b_tag}<w:sz w:val="{hp}"/></w:rPr><w:t xml:space="preserve">{_xml_text(block["text"])}</w:t></w:r></w:p>')
            else:
                cols = max(len(r) for r in block["rows"])
                trs = [f"<w:tr>{''.join(f'<w:tc><w:p><w:r><w:t xml:space=\"preserve\">{_xml_text(c)}</w:t></w:r></w:p></w:tc>' for c in (row + [''] * (cols - len(row))))}</w:tr>" for row in block["rows"]]
                body.append('<w:tbl><w:tblPr><w:tblBorders><w:top w:val="single" w:sz="4" w:color="CBD5E1"/>'
                            '<w:bottom w:val="single" w:sz="4" w:color="CBD5E1"/><w:insideH w:val="single" w:sz="4" w:color="E2E8F0"/>'
                            '<w:insideV w:val="single" w:sz="4" w:color="E2E8F0"/></w:tblBorders></w:tblPr>' + "".join(trs) + "</w:tbl>")
        for img in page["images"]:
            rid, name = f"rId{next_rel}", f"image{next_rel}.png"
            next_rel += 1
            media.append((name, img["png"]))
            rels.append(f'<Relationship Id="{rid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/{name}"/>')
            scale = min(440.0 / max(img["width"], 1), 540.0 / max(img["height"], 1), 0.75)
            body.append(_docx_drawing(rid, max(36.0, img["width"] * scale), max(36.0, img["height"] * scale), next_rel))
        if not page["blocks"] and not page["images"]:
            body.append('<w:p><w:r><w:t> </w:t></w:r></w:p>')
    w_pt, h_pt = int(pages[0]["width"] * 20), int(pages[0]["height"] * 20)
    sect = f'<w:sectPr><w:pgSz w:w="{w_pt}" w:h="{h_pt}"/><w:pgMar w:top="1080" w:right="1080" w:bottom="1080" w:left="1080"/></w:sectPr>'
    return _write_docx_zip(body, sect, rels, media, title)


def _xlsx_sheet_xml(page, intern):
    grid_rows = []
    for block in page["blocks"]:
        if block["kind"] == "table":
            grid_rows.extend(block["rows"])
        else:
            grid_rows.append([block["text"]])
    if not grid_rows:
        grid_rows = [[""]]
    row_nodes = []
    for r_idx, row in enumerate(grid_rows[:1000], start=1):
        cells = []
        for c_idx, raw in enumerate(row[:64]):
            ref, clean = f"{_col_name(c_idx)}{r_idx}", raw.strip()
            if clean and NUM_RE.fullmatch(clean) and not (clean.startswith("0") and len(clean) > 1 and "." not in clean):
                cells.append(f'<c r="{ref}"><v>{clean}</v></c>')
            else:
                cells.append(f'<c r="{ref}" t="s"><v>{intern(raw)}</v></c>')
        row_nodes.append(f'<row r="{r_idx}">{"".join(cells)}</row>')
    return ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
            f'<sheetData>{"".join(row_nodes)}</sheetData></worksheet>')


def export_xlsx(pages, _title):
    strings, index_of = [], {}
    def intern(val):
        if val not in index_of:
            index_of[val] = len(strings)
            strings.append(val)
        return index_of[val]
    sheets_xml, wb_sheets, wb_rels, overrides = [], [], [], []
    for idx, page in enumerate(pages):
        s_no = idx + 1
        sheets_xml.append((s_no, _xlsx_sheet_xml(page, intern)))
        wb_sheets.append(f'<sheet name="Page {s_no}" sheetId="{s_no}" r:id="rId{s_no}"/>')
        wb_rels.append(f'<Relationship Id="rId{s_no}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet{s_no}.xml"/>')
        overrides.append(f'<Override PartName="/xl/worksheets/sheet{s_no}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>')
    wb_rels.append(f'<Relationship Id="rId{len(pages) + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>')
    wb_rels.append(f'<Relationship Id="rId{len(pages) + 2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>')
    sst_items = "".join(f'<si><t xml:space="preserve">{_xml_text(s)}</t></si>' for s in strings)
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("[Content_Types].xml", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
                    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>'
                    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
                    '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
                    '<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>' + "".join(overrides) + "</Types>")
        zf.writestr("_rels/.rels", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
                    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>')
        zf.writestr("xl/workbook.xml", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
                    f'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>{"".join(wb_sheets)}</sheets></workbook>')
        zf.writestr("xl/_rels/workbook.xml.rels", f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">{"".join(wb_rels)}</Relationships>')
        zf.writestr("xl/styles.xml", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
                    '<fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts><fills count="1"><fill><patternFill patternType="none"/></fill></fills>'
                    '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
                    '<cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs></styleSheet>')
        zf.writestr("xl/sharedStrings.xml", f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="{len(strings)}" uniqueCount="{len(strings)}">{sst_items}</sst>')
        for s_no, xml in sheets_xml:
            zf.writestr(f"xl/worksheets/sheet{s_no}.xml", xml)
    return out.getvalue()


def _pptx_slide_shapes(page, slide_w, slide_h, media):
    shapes, rels = [], ['<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>']
    sx, sy = slide_w / max(page["width"], 1.0), slide_h / max(page["height"], 1.0)
    shape_id = 2
    for img in page["images"]:
        rid, mname = f"rId{len(rels) + 1}", f"slide_img_{len(media) + 1}.png"
        media.append((mname, img["png"]))
        rels.append(f'<Relationship Id="{rid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/{mname}"/>')
        iw = min(int(slide_w * 0.75), int(img["width"] * EMU_PER_PT * 0.75))
        ih = max(EMU_PER_PT * 24, int(iw * img["height"] / max(img["width"], 1)))
        ix, iy = int((slide_w - iw) * 0.5), int(slide_h * 0.55)
        shapes.append(
            f'<p:pic><p:nvPicPr><p:cNvPr id="{shape_id}" name="Picture {shape_id}"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr>'
            f'<p:blipFill><a:blip r:embed="{rid}"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>'
            f'<p:spPr><a:xfrm><a:off x="{ix}" y="{iy}"/><a:ext cx="{iw}" cy="{ih}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>'
        )
        shape_id += 1
    for run in page["runs"][:80]:
        x0, y0, x1, y1 = run["rect"]
        ox, oy = max(0, min(slide_w - 914400, int(x0 * sx))), max(0, min(slide_h - 304800, int((page["height"] - y1) * sy)))
        cx, cy = max(914400, min(slide_w - ox, int((x1 - x0) * sx) + 228600)), max(304800, min(slide_h - oy, int((y1 - y0) * sy) + 152400))
        sz, bold = max(800, min(7200, int(round(run["size"] * 100)))), (' b="1"' if run["bold"] else "")
        shapes.append(
            f'<p:sp><p:nvSpPr><p:cNvPr id="{shape_id}" name="Text {shape_id}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>'
            f'<p:spPr><a:xfrm><a:off x="{ox}" y="{oy}"/><a:ext cx="{cx}" cy="{cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr>'
            f'<p:txBody><a:bodyPr wrap="square"/><a:lstStyle/><a:p><a:r><a:rPr lang="en-US" sz="{sz}"{bold}/><a:t>{_xml_text(run["text"])}</a:t></a:r></a:p></p:txBody></p:sp>'
        )
        shape_id += 1
    return shapes, rels


def _write_pptx_zip(slides, pres_ids, pres_rels, ct_overrides, media, slide_w, slide_h):
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("[Content_Types].xml", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
                    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/>'
                    '<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>'
                    '<Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>'
                    '<Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>'
                    '<Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>' + "".join(ct_overrides) + "</Types>")
        zf.writestr("_rels/.rels", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
                    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/></Relationships>')
        zf.writestr("ppt/presentation.xml", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" '
                    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">'
                    f'<p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst>{"".join(pres_ids)}</p:sldIdLst>'
                    f'<p:sldSz cx="{slide_w}" cy="{slide_h}"/><p:notesSz cx="{slide_h}" cy="{slide_w}"/></p:presentation>')
        zf.writestr("ppt/_rels/presentation.xml.rels", f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">{"".join(pres_rels)}</Relationships>')
        zf.writestr("ppt/slideMasters/slideMaster1.xml", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sldMaster xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" '
                    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">'
                    '<p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld>'
                    '<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>'
                    '<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst></p:sldMaster>')
        zf.writestr("ppt/slideMasters/_rels/slideMaster1.xml.rels", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
                    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>'
                    '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/></Relationships>')
        zf.writestr("ppt/slideLayouts/slideLayout1.xml", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sldLayout xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" '
                    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" type="blank">'
                    '<p:cSld name="Blank"><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld></p:sldLayout>')
        zf.writestr("ppt/slideLayouts/_rels/slideLayout1.xml.rels", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
                    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/></Relationships>')
        zf.writestr("ppt/theme/theme1.xml", PPTX_THEME_XML)
        for s_no, s_rels, s_xml in slides:
            zf.writestr(f"ppt/slides/slide{s_no}.xml", s_xml)
            zf.writestr(f"ppt/slides/_rels/slide{s_no}.xml.rels", f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">{"".join(s_rels)}</Relationships>')
        for mname, png in media:
            zf.writestr(f"ppt/media/{mname}", png)
    return out.getvalue()


def export_pptx(pages, _title):
    slide_w = max(914400, min(51206400, int(pages[0]["width"] * EMU_PER_PT)))
    slide_h = max(914400, min(51206400, int(pages[0]["height"] * EMU_PER_PT)))
    slides, pres_ids, pres_rels, ct_overrides, media = [], [], [
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/>',
        '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="theme/theme1.xml"/>',
    ], [], []
    for idx, page in enumerate(pages):
        s_no, rid = idx + 1, f"rId{idx + 3}"
        shapes, s_rels = _pptx_slide_shapes(page, slide_w, slide_h, media)
        slides.append((s_no, s_rels, '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                       '<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" '
                       'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" '
                       'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">'
                       '<p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>'
                       f'<p:grpSpPr/>{"".join(shapes)}</p:spTree></p:cSld></p:sld>'))
        pres_ids.append(f'<p:sldId id="{256 + idx}" r:id="{rid}"/>')
        pres_rels.append(f'<Relationship Id="{rid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide{s_no}.xml"/>')
        ct_overrides.append(f'<Override PartName="/ppt/slides/slide{s_no}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>')
    return _write_pptx_zip(slides, pres_ids, pres_rels, ct_overrides, media, slide_w, slide_h)


def convert_pdf_to_ooxml(data, fmt, title="Document"):
    pages = extract_layout(data)
    if fmt == "docx":
        return export_docx(pages, title), "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    if fmt == "xlsx":
        return export_xlsx(pages, title), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    if fmt == "pptx":
        return export_pptx(pages, title), "application/vnd.openxmlformats-officedocument.presentationml.presentation"
    raise ValueError("unsupported format")
