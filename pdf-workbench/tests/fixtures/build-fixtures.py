"""Small genuine PDF fixtures; independent Poppler decode verifies worker output."""
import io
import json
import re
import subprocess
import sys
from pathlib import Path
from pypdf import PdfWriter
from pypdf.generic import ArrayObject, BooleanObject, DictionaryObject, FloatObject, NameObject, NumberObject, TextStringObject, DecodedStreamObject


def obj(**values):
    return DictionaryObject({NameObject('/'+key): value for key, value in values.items()})


def fixture(label, color, form=False):
    writer = PdfWriter()
    font = writer._add_object(obj(Type=NameObject('/Font'), Subtype=NameObject('/Type1'), BaseFont=NameObject('/Helvetica')))
    for i in range(2):
        page = writer.add_blank_page(240, 200)
        page[NameObject('/Resources')] = obj(Font=obj(F1=font, Helv=font))
        content = DecodedStreamObject()
        content.set_data(f'{color} rg 10 10 70 70 re f 0 0 0 rg BT /F1 20 Tf 10 165 Td ({label} PAGE {i+1}) Tj ET'.encode())
        page[NameObject('/Contents')] = writer._add_object(content)
    if form:
        fields = ArrayObject()
        text = obj(Type=NameObject('/Annot'), Subtype=NameObject('/Widget'), FT=NameObject('/Tx'),
                   T=TextStringObject('name'), V=TextStringObject('Original'), DA=TextStringObject('/Helv 12 Tf 0 g'),
                   Rect=ArrayObject([NumberObject(v) for v in (20,100,200,125)]), F=NumberObject(4),
                   Ff=NumberObject(0), MaxLen=NumberObject(120), P=writer.pages[0].indirect_reference)
        text_ref = writer._add_object(text)
        fields.append(text_ref)
        # Genuine checkbox with explicit Off/Yes appearances.
        appearances = {}
        for state in ('Off','Yes'):
            stream = DecodedStreamObject()
            stream.set_data(b'0 0 0 RG 1 w 1 1 18 18 re S' + (b' 2 w 3 10 m 8 4 l 17 17 l S' if state=='Yes' else b''))
            stream.update(obj(Type=NameObject('/XObject'), Subtype=NameObject('/Form'),
                              BBox=ArrayObject([NumberObject(x) for x in (0,0,20,20)]), Resources=DictionaryObject()))
            appearances[NameObject('/'+state)] = writer._add_object(stream)
        check = obj(Type=NameObject('/Annot'), Subtype=NameObject('/Widget'), FT=NameObject('/Btn'),
                    T=TextStringObject('consent'), V=NameObject('/Off'), AS=NameObject('/Off'),
                    Rect=ArrayObject([NumberObject(v) for v in (20,130,40,150)]), F=NumberObject(4),
                    Ff=NumberObject(0), AP=obj(N=DictionaryObject(appearances)), P=writer.pages[0].indirect_reference)
        check_ref = writer._add_object(check)
        fields.append(check_ref)
        choice=obj(Type=NameObject('/Annot'),Subtype=NameObject('/Widget'),FT=NameObject('/Ch'),
                   T=TextStringObject('color'),V=TextStringObject('Red'),DA=TextStringObject('/Helv 12 Tf 0 g'),
                   Rect=ArrayObject([NumberObject(v) for v in (100,130,200,150)]),F=NumberObject(4),Ff=NumberObject(131072),
                   Opt=ArrayObject([TextStringObject('Red'),TextStringObject('Blue')]),P=writer.pages[0].indirect_reference)
        choice_ref=writer._add_object(choice);fields.append(choice_ref)
        radio=obj(FT=NameObject('/Btn'),T=TextStringObject('decision'),V=NameObject('/Off'),Ff=NumberObject(32768),Kids=ArrayObject())
        radio_ref=writer._add_object(radio);fields.append(radio_ref);radio_widgets=[]
        for state,x in [('YesChoice',50),('NoChoice',75)]:
            normal=DictionaryObject({NameObject('/Off'):appearances[NameObject('/Off')],NameObject('/'+state):appearances[NameObject('/Yes')]})
            widget=obj(Type=NameObject('/Annot'),Subtype=NameObject('/Widget'),Parent=radio_ref,AS=NameObject('/Off'),
                       Rect=ArrayObject([NumberObject(v) for v in (x,130,x+20,150)]),F=NumberObject(4),AP=obj(N=normal),P=writer.pages[0].indirect_reference)
            ref=writer._add_object(widget);radio['/Kids'].append(ref);radio_widgets.append(ref)
        writer.pages[0][NameObject('/Annots')] = ArrayObject([text_ref,check_ref,choice_ref,*radio_widgets])
        writer._root_object[NameObject('/AcroForm')] = writer._add_object(obj(Fields=fields,
            NeedAppearances=BooleanObject(False), DR=obj(Font=obj(Helv=font)), DA=TextStringObject('/Helv 12 Tf 0 g')))
        writer.update_page_form_field_values(writer.pages[0], {'name':'Original','color':'Red'},auto_regenerate=False)
    result = io.BytesIO()
    writer.write(result)
    return result.getvalue()


root = Path(sys.argv[1]); root.mkdir(parents=True, exist_ok=True)
(root/'first.pdf').write_bytes(fixture('FIRST','1 0 0',True))
(root/'second.pdf').write_bytes(fixture('SECOND','0 0 1',True))
subprocess.run(['pdftoppm','-f','1','-l','1','-singlefile','-scale-to','1200',str(root/'first.pdf'),str(root/'scan')],check=True,capture_output=True)
ppm=(root/'scan.ppm').read_bytes()
header=re.match(rb'P6\s+(\d+)\s+(\d+)\s+255\s',ppm)
assert header is not None
width,height=map(int,header.groups()); pixels=ppm[header.end():]
assert len(pixels)==width*height*3
writer=PdfWriter();page=writer.add_blank_page(240,200)
image=DecodedStreamObject();image.set_data(pixels);image.update(obj(Type=NameObject('/XObject'),Subtype=NameObject('/Image'),Width=NumberObject(width),Height=NumberObject(height),ColorSpace=NameObject('/DeviceRGB'),BitsPerComponent=NumberObject(8)))
page[NameObject('/Resources')]=obj(XObject=obj(Scan=writer._add_object(image.flate_encode())))
content=DecodedStreamObject();content.set_data(b'q 240 0 0 200 0 0 cm /Scan Do Q');page[NameObject('/Contents')]=writer._add_object(content)
with (root/'scanned.pdf').open('wb') as f:writer.write(f)
encrypted=PdfWriter();encrypted.add_blank_page(240,200);encrypted.encrypt('private-fixture')
with (root/'encrypted.pdf').open('wb') as f:encrypted.write(f)
active=PdfWriter();active.add_blank_page(240,200);active.add_js("app.alert('fixture');")
with (root/'active.pdf').open('wb') as f:active.write(f)
