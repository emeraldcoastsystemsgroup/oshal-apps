"""Real restricted-glyph and Unicode PDF fonts; no renderer or font result is mocked."""
import ctypes as c
from pathlib import Path
import sys
import pypdfium2 as pdfium
import pypdfium2.raw as raw
from pypdf import PdfWriter
from pypdf.generic import ArrayObject, DictionaryObject, NameObject, NumberObject, FloatObject, DecodedStreamObject


def type3(path):
    writer = PdfWriter()
    page = writer.add_blank_page(240, 200)
    glyph = DecodedStreamObject()
    glyph.set_data(b"600 0 0 0 600 700 d1 50 0 500 700 re f")
    font = DictionaryObject({NameObject('/Type'): NameObject('/Font'), NameObject('/Subtype'): NameObject('/Type3'),
        NameObject('/Name'): NameObject('/SubsetB'), NameObject('/BaseFont'): NameObject('/ABCDEF+SubsetB'),
        NameObject('/FontBBox'): ArrayObject([NumberObject(v) for v in (0, 0, 600, 700)]),
        NameObject('/FontMatrix'): ArrayObject([FloatObject(v) for v in (.001, 0, 0, .001, 0, 0)]),
        NameObject('/CharProcs'): DictionaryObject({NameObject('/B'): writer._add_object(glyph)}),
        NameObject('/Encoding'): DictionaryObject({NameObject('/Type'): NameObject('/Encoding'), NameObject('/Differences'): ArrayObject([NumberObject(66), NameObject('/B')])}),
        NameObject('/FirstChar'): NumberObject(66), NameObject('/LastChar'): NumberObject(66),
        NameObject('/Widths'): ArrayObject([NumberObject(600)]), NameObject('/Resources'): DictionaryObject()})
    page[NameObject('/Resources')] = DictionaryObject({NameObject('/Font'): DictionaryObject({NameObject('/F1'): writer._add_object(font)})})
    stream = DecodedStreamObject()
    stream.set_data(b"BT /F1 24 Tf 20 100 Td (B) Tj ET")
    page[NameObject('/Contents')] = writer._add_object(stream)
    writer.write(path)


def embedded_text(path, value):
    font_bytes = Path('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf').read_bytes()
    buffer = (c.c_ubyte * len(font_bytes)).from_buffer_copy(font_bytes)
    with pdfium.PdfDocument.new() as document:
        page = document.new_page(240, 200)
        font = raw.FPDFText_LoadFont(document, buffer, len(buffer), raw.FPDF_FONT_TRUETYPE, True)
        assert font
        handle = raw.FPDFPageObj_CreateTextObj(document, font, 24)
        assert handle
        obj = pdfium.PdfObject(handle, pdf=document)
        encoded = value.encode('utf-16-le') + b'\0\0'
        text = (raw.FPDF_WCHAR * (len(encoded) // 2)).from_buffer_copy(encoded)
        assert raw.FPDFText_SetText(obj, text)
        obj.transform(pdfium.PdfMatrix(e=20, f=100))
        page.insert_obj(obj)
        page.gen_content()
        document.save(path)
        raw.FPDFFont_Close(font)


if __name__ == '__main__':
    root = Path(sys.argv[1])
    type3(root / 'type3-font.pdf')
    embedded_text(root / 'embedded-font.pdf', 'café')
    embedded_text(root / 'unicode-font.pdf', 'ΩЖ')
