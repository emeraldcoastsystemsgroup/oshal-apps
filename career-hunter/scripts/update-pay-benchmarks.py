#!/usr/bin/env python3
"""Refresh the pinned public BLS OEWS national wage extract, without extra packages.

Keep the reviewed occupation/title rules; replace only survey data. Run explicitly
after reviewing a new annual release. No applicant or employer records are sent.
"""
import argparse
import hashlib
import io
import json
from pathlib import Path
import urllib.request
import xml.etree.ElementTree as ET
import zipfile


def extract(archive):
    outer = zipfile.ZipFile(io.BytesIO(archive))
    book = zipfile.ZipFile(io.BytesIO(outer.read(next(n for n in outer.namelist() if n.endswith('.xlsx')))))
    ns = {'x': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
    strings = [''.join(e.itertext()) for e in ET.fromstring(book.read('xl/sharedStrings.xml')).findall('x:si', ns)]
    rows = []
    for row in ET.fromstring(book.read('xl/worksheets/sheet1.xml')).findall('x:sheetData/x:row', ns):
        cells = {}
        for cell in row.findall('x:c', ns):
            v = cell.find('x:v', ns)
            value = '' if v is None else v.text
            cells[''.join(c for c in cell.attrib['r'] if c.isalpha())] = strings[int(value)] if value and cell.get('t') == 's' else value
        rows.append(cells)
    return [{rows[0][k]: v for k, v in r.items() if k in rows[0]} for r in rows[1:]]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--year', type=int, default=2025)
    parser.add_argument('--archive', type=Path, help='Use a previously downloaded official ZIP')
    args = parser.parse_args()
    target = Path(__file__).resolve().parents[1] / 'lib/career-pay-benchmarks.json'
    model = json.loads(target.read_text())
    url = f'https://www.bls.gov/oes/special-requests/oesm{args.year % 100:02d}nat.zip'
    archive = args.archive.read_bytes() if args.archive else urllib.request.urlopen(url, timeout=60).read()
    rows = {r['OCC_CODE']: r for r in extract(archive) if r.get('AREA') == '99' and r.get('OWN_CODE') == '1235'}
    occupations = {}
    for soc in dict.fromkeys(r['soc'] for r in model['rules']):
        row = rows[soc]
        def wage(key):
            try:
                return round(float(row[key]), 2)
            except (ValueError, KeyError):
                return None  # suppressed/top-coded wages are never invented
        occupations[soc] = {'name': row['OCC_TITLE'], 'year': [wage(k) for k in ['A_PCT25', 'A_PCT75']],
                            'hour': [wage(k) for k in ['H_PCT25', 'H_PCT75']]}
        assert all(occupations[soc]['year']), f'Annual middle-50% range unavailable: {soc}'
    model.update(survey=f'May {args.year}', source='BLS OEWS', sourceUrl='https://www.bls.gov/oes/tables.htm',
                 downloadUrl=url, archiveSha256=hashlib.sha256(archive).hexdigest(), occupations=occupations)
    target.write_text(json.dumps(model, indent=2) + '\n')
    print(f'Updated {len(occupations)} occupations from {model["survey"]}; SHA256 {model["archiveSha256"]}')


if __name__ == '__main__':
    main()
