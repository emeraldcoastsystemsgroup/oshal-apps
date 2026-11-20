# CHANGE LOG
# -----------------------------------------------------------------------------
# SEQ | AUTHOR                                  | DESCRIPTION
# -----------------------------------------------------------------------------
# 1 | maintainer@emeraldcoastsystemsgroup.com | Pure-stdlib OOXML (.docx / .dotx) writer implementing the 4 verified executive resume template families (Standard, Professional, Leadership, Technical) with zero Word theme-font leaks, Quick Styles, native bullets, right-tabbed dates, borders/shading, and styled PAGE footers.
"""Pure-stdlib OOXML writer for ATS-safe, RTF-safe executive resumes and cover letters.

Emits valid WordprocessingML packages using only the Python standard library so the
engine executes identically inside read-only Bubblewrap sandboxes without python-docx.
"""
from __future__ import annotations

from pathlib import Path
from typing import Any
from xml.etree import ElementTree as ET
from zipfile import ZIP_DEFLATED, ZipFile

W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
R_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships"
CT_NS = "http://schemas.openxmlformats.org/package/2006/content-types"
CP_NS = "http://schemas.openxmlformats.org/package/2006/metadata/core-properties"
DC_NS = "http://purl.org/dc/elements/1.1/"
XML_NS = "http://www.w3.org/XML/1998/namespace"

DOC_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"
DOTX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.template.main+xml"

for _pfx, _uri in (("w", W_NS), ("r", R_NS), ("cp", CP_NS), ("dc", DC_NS)):
    ET.register_namespace(_pfx, _uri)

FAMILIES: dict[str, dict[str, Any]] = {
    "Standard": dict(
        font="Arial", body_size=10.25, skills_size=10.0, role_size=10.75, emp_size=9.5,
        heading_size=10.5, headline_size=11.0, contact_size=9.25, name_size=22.0,
        center=False, upper=True, heading_tracking=12, name_hex="111111", headline_hex="333333",
        contact_hex="444444", heading_hex="111111", header_rule_hex="333333", header_rule_sz="10",
        heading_rule_hex="888888", heading_rule_sz="6", heading_fill=None, emp_hex="444444",
        date_hex="222222", bullet_hex="333333", line_spacing=1.13, space_after_bullet=3.2,
        space_before_role=7.0, space_before_heading=9.0, space_after_heading=4.5,
        margin_top=0.55, margin_bottom=0.52, margin_lr=0.64,
    ),
    "Professional": dict(
        font="Calibri", body_size=10.75, skills_size=10.25, role_size=11.0, emp_size=10.0,
        heading_size=10.75, headline_size=11.5, contact_size=9.5, name_size=25.0,
        center=False, upper=True, heading_tracking=14, name_hex="1B365D", headline_hex="2D3748",
        contact_hex="4A5568", heading_hex="1B365D", header_rule_hex="1B365D", header_rule_sz="12",
        heading_rule_hex="1B365D", heading_rule_sz="6", heading_fill=None, emp_hex="4A5568",
        date_hex="1B365D", bullet_hex="1B365D", line_spacing=1.10, space_after_bullet=3.0,
        space_before_role=6.8, space_before_heading=8.5, space_after_heading=4.0,
        margin_top=0.55, margin_bottom=0.52, margin_lr=0.64,
    ),
    "Leadership": dict(
        font="Cambria", body_size=10.75, skills_size=10.25, role_size=11.0, emp_size=9.75,
        heading_size=10.75, headline_size=11.25, contact_size=9.5, name_size=24.5,
        center=True, upper=True, heading_tracking=18, name_hex="1B2A4A", headline_hex="2C4A6E",
        contact_hex="4A5568", heading_hex="1B2A4A", header_rule_hex="1B2A4A", header_rule_sz="12",
        heading_rule_hex="8FA3B8", heading_rule_sz="6", heading_fill=None, emp_hex="4A5568",
        date_hex="1B2A4A", bullet_hex="2C4A6E", line_spacing=1.11, space_after_bullet=3.2,
        space_before_role=7.2, space_before_heading=9.0, space_after_heading=4.5,
        margin_top=0.55, margin_bottom=0.52, margin_lr=0.64,
    ),
    "Technical": dict(
        font="Calibri", body_size=10.5, skills_size=10.0, role_size=10.75, emp_size=9.75,
        heading_size=10.5, headline_size=11.25, contact_size=9.5, name_size=24.0,
        center=False, upper=True, heading_tracking=14, name_hex="163A4A", headline_hex="1F5E73",
        contact_hex="3E4C59", heading_hex="163A4A", header_rule_hex="1F5E73", header_rule_sz="12",
        heading_rule_hex="1F5E73", heading_rule_sz="6", heading_fill="EDF4F7", emp_hex="3E4C59",
        date_hex="163A4A", bullet_hex="1F5E73", line_spacing=1.09, space_after_bullet=2.8,
        space_before_role=6.2, space_before_heading=8.0, space_after_heading=4.0,
        margin_top=0.55, margin_bottom=0.52, margin_lr=0.64,
    ),
}


def qn(tag: str) -> str:
    """Expand a namespace-prefixed OOXML tag like 'w:p' into Clark notation."""
    prefix, local = tag.split(":", 1)
    uris = {"w": W_NS, "r": R_NS, "cp": CP_NS, "dc": DC_NS, "xml": XML_NS}
    return f"{{{uris[prefix]}}}{local}"


def w_el(tag: str, attrib: dict[str, str] | None = None, text: str | None = None) -> ET.Element:
    """Create a WordprocessingML element with w:-prefixed attribute keys."""
    attrs = {qn(k) if ":" in k else k: str(v) for k, v in (attrib or {}).items()}
    el = ET.Element(qn(tag), attrs)
    if text is not None:
        el.text = text
    return el


def pt_twips(pt: float) -> str:
    return str(int(round(pt * 20)))


def pt_half(pt: float) -> str:
    return str(int(round(pt * 2)))


def in_twips(inches: float) -> str:
    return str(int(round(inches * 1440)))


def line_240(mult: float) -> str:
    return str(int(round(mult * 240)))


def bind_font_rpr(rpr: ET.Element, font: str) -> None:
    """Explicitly bind ascii/hAnsi/cs/eastAsia fonts with zero Word theme attributes."""
    rf = w_el("w:rFonts", {"w:ascii": font, "w:hAnsi": font, "w:cs": font, "w:eastAsia": font})
    rpr.insert(0, rf)


def build_rpr(
    font: str,
    size_pt: float | None = None,
    color_hex: str | None = None,
    bold: bool = False,
    italic: bool = False,
    tracking: int = 0,
) -> ET.Element:
    rpr = w_el("w:rPr")
    bind_font_rpr(rpr, font)
    if bold:
        rpr.append(w_el("w:b"))
        rpr.append(w_el("w:bCs"))
    if italic:
        rpr.append(w_el("w:i"))
        rpr.append(w_el("w:iCs"))
    if color_hex:
        rpr.append(w_el("w:color", {"w:val": color_hex.lstrip("#").upper()}))
    if tracking:
        rpr.append(w_el("w:spacing", {"w:val": str(tracking)}))
    if size_pt is not None:
        hp = pt_half(size_pt)
        rpr.append(w_el("w:sz", {"w:val": hp}))
        rpr.append(w_el("w:szCs", {"w:val": hp}))
    return rpr


def append_borders(
    ppr: ET.Element,
    color_hex: str,
    sz: str = "6",
    space: str = "2",
    top_fill: str | None = None,
) -> None:
    pbdr = w_el("w:pBdr")
    if top_fill:
        for side in ("top", "left", "right"):
            pbdr.append(w_el(f"w:{side}", {
                "w:val": "single",
                "w:sz": "12" if side == "top" else "18",
                "w:space": "2" if side == "top" else "3",
                "w:color": top_fill,
            }))
    pbdr.append(w_el("w:bottom", {
        "w:val": "single", "w:sz": sz, "w:space": space, "w:color": color_hex,
    }))
    ppr.append(pbdr)


def _style_el(
    style_id: str,
    name: str,
    font: str,
    size: float,
    color_hex: str = "1A1A1A",
    *,
    bold: bool = False,
    italic: bool = False,
    before: float = 0,
    after: float = 0,
    keep_next: bool = False,
    keep_lines: bool = True,
    line_spacing: float = 1.08,
    priority: int = 10,
    align: str | None = None,
    tracking: int = 0,
    base: str | None = "Normal",
) -> ET.Element:
    attrs = {"w:type": "paragraph", "w:styleId": style_id}
    if style_id == "Normal":
        attrs["w:default"] = "1"
    st = w_el("w:style", attrs)
    st.append(w_el("w:name", {"w:val": name}))
    if base and style_id != "Normal":
        st.append(w_el("w:basedOn", {"w:val": base}))
    st.append(w_el("w:uiPriority", {"w:val": str(priority)}))
    st.append(w_el("w:qFormat"))
    ppr = w_el("w:pPr")
    if keep_next:
        ppr.append(w_el("w:keepNext"))
    if keep_lines:
        ppr.append(w_el("w:keepLines"))
    ppr.append(w_el("w:widowControl"))
    ppr.append(w_el("w:spacing", {
        "w:before": pt_twips(before), "w:after": pt_twips(after),
        "w:line": line_240(line_spacing), "w:lineRule": "auto",
    }))
    if align:
        ppr.append(w_el("w:jc", {"w:val": align}))
    st.append(ppr)
    st.append(build_rpr(font, size, color_hex, bold=bold, italic=italic, tracking=tracking))
    return st


def _doc_defaults_el(c: dict[str, Any]) -> ET.Element:
    dd = w_el("w:docDefaults")
    rprd = w_el("w:rPrDefault")
    rprd.append(build_rpr(c["font"], c["body_size"]))
    dd.append(rprd)
    pprd = w_el("w:pPrDefault")
    ppr0 = w_el("w:pPr")
    ppr0.append(w_el("w:spacing", {"w:after": "0", "w:line": line_240(c["line_spacing"]), "w:lineRule": "auto"}))
    pprd.append(ppr0)
    dd.append(pprd)
    return dd


def _header_styles(c: dict[str, Any], align: str) -> list[ET.Element]:
    cl = _style_el("ResumeContactLast", "Resume Contact Last", c["font"], c["contact_size"], c["contact_hex"],
                   after=7.5, keep_next=True, line_spacing=1.05, priority=5, align=align)
    append_borders(cl.find(qn("w:pPr")), c["header_rule_hex"], sz=c["header_rule_sz"], space="4")
    h1 = _style_el("Heading1", "heading 1", c["font"], c["heading_size"], c["heading_hex"],
                   bold=True, before=c["space_before_heading"], after=c["space_after_heading"],
                   keep_next=True, line_spacing=1.05, priority=6, tracking=c["heading_tracking"])
    h1_ppr = h1.find(qn("w:pPr"))
    append_borders(h1_ppr, c["heading_rule_hex"], sz=c["heading_rule_sz"], space="2", top_fill=c["heading_fill"])
    if c["heading_fill"]:
        h1_ppr.append(w_el("w:shd", {"w:val": "clear", "w:color": "auto", "w:fill": c["heading_fill"]}))
    return [
        _style_el("Normal", "Normal", c["font"], c["body_size"], "1A1A1A",
                  after=3.5, keep_lines=False, line_spacing=c["line_spacing"], priority=1, base=None),
        _style_el("Title", "Title", c["font"], c["name_size"], c["name_hex"],
                  bold=True, after=2.0, keep_next=True, line_spacing=1.0, priority=2, align=align),
        _style_el("ResumeHeadline", "Resume Headline", c["font"], c["headline_size"], c["headline_hex"],
                  bold=True, after=2.5, keep_next=True, line_spacing=1.05, priority=3, align=align),
        _style_el("ResumeContact", "Resume Contact", c["font"], c["contact_size"], c["contact_hex"],
                  after=1.5, keep_next=True, line_spacing=1.05, priority=4, align=align),
        cl,
        h1,
    ]


def build_styles_xml(c: dict[str, Any]) -> bytes:
    """Build word/styles.xml with docDefaults and all 12 Quick Styles (zero theme leaks)."""
    root = w_el("w:styles")
    root.append(_doc_defaults_el(c))
    align = "center" if c["center"] else "left"
    printable_dxa = in_twips(8.5 - 2.0 * float(c["margin_lr"]))
    for st in _header_styles(c, align):
        root.append(st)

    root.append(_style_el("ResumeRole", "Resume Role", c["font"], c["role_size"], "111111",
                          bold=True, before=c["space_before_role"], after=0.8, keep_next=True, line_spacing=1.05, priority=7))
    emp = _style_el("ResumeEmployer", "Resume Employer", c["font"], c["emp_size"], c["emp_hex"],
                    after=2.5, keep_next=True, line_spacing=1.05, priority=8)
    tabs = w_el("w:tabs")
    tabs.append(w_el("w:tab", {"w:val": "right", "w:pos": printable_dxa}))
    emp.find(qn("w:pPr")).append(tabs)
    root.append(emp)

    bul = _style_el("ResumeBullet", "Resume Bullet", c["font"], c["body_size"], "1A1A1A",
                    after=c["space_after_bullet"], keep_lines=True, line_spacing=c["line_spacing"], priority=9)
    numpr = w_el("w:numPr")
    numpr.append(w_el("w:ilvl", {"w:val": "0"}))
    numpr.append(w_el("w:numId", {"w:val": "80"}))
    bul.find(qn("w:pPr")).append(numpr)
    root.append(bul)

    root.append(_style_el("ResumeSkills", "Resume Skills", c["font"], c["skills_size"], "1A1A1A",
                          after=2.5, keep_lines=True, line_spacing=c["line_spacing"], priority=10))
    root.append(_style_el("ResumeEarlier", "Resume Earlier", c["font"], c["skills_size"], "222222",
                          before=6.0, after=2.5, keep_lines=True, line_spacing=c["line_spacing"], priority=11))
    root.append(_style_el("Footer", "footer", c["font"], 8.5, "666666",
                          keep_lines=True, line_spacing=1.0, priority=99))
    return ET.tostring(root, encoding="utf-8", xml_declaration=True)


def _bullet_abstract(num_id: str, left_dxa: str, font: str, bullet_hex: str) -> ET.Element:
    ab = w_el("w:abstractNum", {"w:abstractNumId": num_id})
    lvl = w_el("w:lvl", {"w:ilvl": "0"})
    for tag, val in (("start", "1"), ("numFmt", "bullet"), ("lvlText", "\u2022"), ("lvlJc", "left")):
        lvl.append(w_el(f"w:{tag}", {"w:val": val}))
    pp = w_el("w:pPr")
    pp.append(w_el("w:ind", {"w:left": left_dxa, "w:hanging": "160"}))
    lvl.append(pp)
    lvl.append(build_rpr(font, color_hex=bullet_hex))
    ab.append(lvl)
    return ab


def build_numbering_xml(c: dict[str, Any]) -> bytes:
    """Build word/numbering.xml with primary (80) and indented child (81) bullet lists."""
    root = w_el("w:numbering")
    root.append(_bullet_abstract("80", "240", c["font"], c["bullet_hex"]))
    root.append(_bullet_abstract("81", "480", c["font"], c["bullet_hex"]))
    for num_id in ("80", "81"):
        num = w_el("w:num", {"w:numId": num_id})
        num.append(w_el("w:abstractNumId", {"w:val": num_id}))
        root.append(num)
    return ET.tostring(root, encoding="utf-8", xml_declaration=True)


def make_run(
    text: str,
    font: str,
    size_pt: float | None = None,
    color_hex: str | None = None,
    bold: bool = False,
    italic: bool = False,
) -> ET.Element:
    """Create one explicitly font-bound run, handling embedded tabs cleanly."""
    r = w_el("w:r")
    r.append(build_rpr(font, size_pt, color_hex, bold=bold, italic=italic))
    parts = text.split("\t")
    for idx, part in enumerate(parts):
        if idx > 0:
            r.append(w_el("w:tab"))
        if part or len(parts) == 1:
            t = w_el("w:t", text=part)
            if part.startswith(" ") or part.endswith(" ") or "  " in part:
                t.set(qn("xml:space"), "preserve")
            r.append(t)
    return r


def make_paragraph(
    style_id: str,
    runs: list[ET.Element] | None = None,
    *,
    text: str | None = None,
    font: str | None = None,
    space_before: float | None = None,
    space_after: float | None = None,
    keep_next: bool = False,
    num_id: str | None = None,
    indent_left_dxa: int | None = None,
    align: str | None = None,
) -> ET.Element:
    """Create a styled paragraph with optional overrides and explicit runs."""
    p = w_el("w:p")
    ppr = w_el("w:pPr")
    ppr.append(w_el("w:pStyle", {"w:val": style_id}))
    if keep_next:
        ppr.append(w_el("w:keepNext"))
    if num_id:
        np = w_el("w:numPr")
        np.append(w_el("w:ilvl", {"w:val": "0"}))
        np.append(w_el("w:numId", {"w:val": num_id}))
        ppr.append(np)
    if space_before is not None or space_after is not None:
        sp_attrs: dict[str, str] = {}
        if space_before is not None:
            sp_attrs["w:before"] = pt_twips(space_before)
        if space_after is not None:
            sp_attrs["w:after"] = pt_twips(space_after)
        ppr.append(w_el("w:spacing", sp_attrs))
    if indent_left_dxa is not None:
        ppr.append(w_el("w:ind", {"w:left": str(indent_left_dxa)}))
    if align:
        ppr.append(w_el("w:jc", {"w:val": align}))
    p.append(ppr)
    if runs:
        for run in runs:
            p.append(run)
    elif text is not None:
        p.append(make_run(text, font or "Calibri"))
    return p


def build_footer_xml(display_name: str, font: str) -> bytes:
    """Build word/footer1.xml with right-aligned name and styled complex PAGE field."""
    root = w_el("w:ftr")
    p = make_paragraph("Footer", align="right")
    p.append(make_run(f"{display_name}  |  Page ", font, size_pt=8.5, color_hex="666666"))
    for ftype, instr in (("begin", None), ("instr", " PAGE "), ("separate", None), ("text", "1"), ("end", None)):
        r = w_el("w:r")
        r.append(build_rpr(font, size_pt=8.5, color_hex="666666"))
        if ftype in ("begin", "separate", "end"):
            r.append(w_el("w:fldChar", {"w:fldCharType": ftype}))
        elif ftype == "instr":
            it = w_el("w:instrText", text=instr)
            it.set(qn("xml:space"), "preserve")
            r.append(it)
        else:
            r.append(w_el("w:t", text=instr))
        p.append(r)
    root.append(p)
    return ET.tostring(root, encoding="utf-8", xml_declaration=True)


def build_document_xml(paragraphs: list[ET.Element], c: dict[str, Any]) -> bytes:
    """Assemble word/document.xml with single-column body and section margins."""
    root = w_el("w:document")
    body = w_el("w:body")
    for p in paragraphs:
        body.append(p)
    sect = w_el("w:sectPr")
    sect.append(w_el("w:footerReference", {"w:type": "default", "r:id": "rId3"}))
    sect.append(w_el("w:pgSz", {"w:w": "12240", "w:h": "15840"}))
    sect.append(w_el("w:pgMar", {
        "w:top": in_twips(c["margin_top"]),
        "w:right": in_twips(c["margin_lr"]),
        "w:bottom": in_twips(c["margin_bottom"]),
        "w:left": in_twips(c["margin_lr"]),
        "w:header": in_twips(0.22),
        "w:footer": in_twips(0.24),
        "w:gutter": "0",
    }))
    body.append(sect)
    root.append(body)
    return ET.tostring(root, encoding="utf-8", xml_declaration=True)


def _content_types_xml(is_template: bool = False) -> bytes:
    main_ct = DOTX_MIME if is_template else DOC_MIME
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        f'<Types xmlns="{CT_NS}">'
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        '<Default Extension="xml" ContentType="application/xml"/>'
        f'<Override PartName="/word/document.xml" ContentType="{main_ct}"/>'
        '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>'
        '<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>'
        '<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>'
        '<Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>'
        '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>'
        '</Types>'
    ).encode("utf-8")


def _root_rels_xml() -> bytes:
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        f'<Relationships xmlns="{REL_NS}">'
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>'
        '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>'
        '</Relationships>'
    ).encode("utf-8")


def _doc_rels_xml() -> bytes:
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        f'<Relationships xmlns="{REL_NS}">'
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'
        '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>'
        '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/>'
        '<Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/>'
        '</Relationships>'
    ).encode("utf-8")


def _settings_xml() -> bytes:
    root = w_el("w:settings")
    root.append(w_el("w:updateFields", {"w:val": "true"}))
    return ET.tostring(root, encoding="utf-8", xml_declaration=True)


def _core_props_xml(author: str, title: str, subject: str) -> bytes:
    root = w_el("cp:coreProperties")
    for tag, value in (("dc:title", title), ("dc:subject", subject), ("dc:creator", author), ("dc:description", "")):
        el = w_el(tag, text=value)
        root.append(el)
    return ET.tostring(root, encoding="utf-8", xml_declaration=True)


def write_docx_zip(
    output_path: Path | str,
    paragraphs: list[ET.Element],
    c: dict[str, Any],
    *,
    footer_name: str,
    author: str,
    title: str,
    subject: str,
) -> Path:
    """Write a complete, valid OOXML .docx archive to output_path."""
    out = Path(output_path)
    out.parent.mkdir(parents=True, exist_ok=True)
    parts = {
        "[Content_Types].xml": _content_types_xml(False),
        "_rels/.rels": _root_rels_xml(),
        "docProps/core.xml": _core_props_xml(author, title, subject),
        "word/_rels/document.xml.rels": _doc_rels_xml(),
        "word/settings.xml": _settings_xml(),
        "word/styles.xml": build_styles_xml(c),
        "word/numbering.xml": build_numbering_xml(c),
        "word/footer1.xml": build_footer_xml(footer_name, c["font"]),
        "word/document.xml": build_document_xml(paragraphs, c),
    }
    with ZipFile(out, "w", ZIP_DEFLATED) as zf:
        for name, data in parts.items():
            zf.writestr(name, data)
    return out


def save_as_dotx(docx_path: Path | str, dotx_path: Path | str) -> Path:
    """Convert an existing .docx into a Word .dotx template by swapping the main content type."""
    src, dst = Path(docx_path), Path(dotx_path)
    dst.parent.mkdir(parents=True, exist_ok=True)
    with ZipFile(src) as zin, ZipFile(dst, "w", ZIP_DEFLATED) as zout:
        for item in zin.namelist():
            data = zin.read(item)
            if item == "[Content_Types].xml":
                data = data.replace(DOC_MIME.encode("ascii"), DOTX_MIME.encode("ascii"))
            zout.writestr(item, data)
    return dst
