/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Guard bounded PDF/DOCX extraction, page and paragraph ceilings, and archive expansion rejection.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Cover compressed input size, member fan-out, aggregate expansion, compression ratio, and encrypted DOCX members.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Reject aggregate decoded PDF streams across individually bounded pages and resources.
 */
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { delimiter, dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const engineRoot = join(packageRoot, 'engine');
const fixtureRoot = mkdtempSync(join(tmpdir(), 'career-resume-limits-'));
const python = process.env.JOBHUNTER_PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
const fixtureScript = String.raw`
import json, sys, types, zipfile
from pathlib import Path

mode, target = sys.argv[1], Path(sys.argv[2])
if mode.startswith("docx"):
    if mode == "docx-input":
        with target.open("wb") as stream:
            stream.seek(64 * 1024 * 1024)
            stream.write(b"x")
    else:
        with zipfile.ZipFile(target, "w", compression=zipfile.ZIP_DEFLATED) as archive:
            if mode == "docx-bomb":
                archive.writestr("word/document.xml", b"A" * (12 * 1024 * 1024 + 1))
            elif mode == "docx-ratio":
                archive.writestr("word/document.xml", b"A" * (1024 * 1024))
            elif mode == "docx-total":
                for index in range(3):
                    archive.writestr(f"word/part-{index}.xml", b"A" * (12 * 1024 * 1024))
            elif mode == "docx-members":
                for index in range(1001):
                    archive.writestr(f"word/part-{index}.xml", b"x")
            else:
                archive.writestr("word/document.xml", "<document/>")
        if mode == "docx-encrypted":
            raw = bytearray(target.read_bytes())
            local = raw.find(b"PK\x03\x04")
            central = raw.find(b"PK\x01\x02")
            raw[local + 6:local + 8] = (int.from_bytes(raw[local + 6:local + 8], "little") | 1).to_bytes(2, "little")
            raw[central + 8:central + 10] = (int.from_bytes(raw[central + 8:central + 10], "little") | 1).to_bytes(2, "little")
            target.write_bytes(raw)
    fake_docx = types.ModuleType("docx")
    count = 5001 if mode == "docx-paragraphs" else 2
    fake_docx.Document = lambda _path: types.SimpleNamespace(
        paragraphs=[types.SimpleNamespace(text="paragraph") for _ in range(count)])
    sys.modules["docx"] = fake_docx
else:
    if mode == "pdf-input":
        with target.open("wb") as stream:
            stream.seek(32 * 1024 * 1024)
            stream.write(b"x")
    else:
        target.write_bytes(b"%PDF-fixture")
    fake_pypdf = types.ModuleType("pypdf")
    filters = types.SimpleNamespace(**{name: 75_000_000 for name in (
        "ZLIB_MAX_OUTPUT_LENGTH", "LZW_MAX_OUTPUT_LENGTH", "RUN_LENGTH_MAX_OUTPUT_LENGTH",
        "JBIG2_MAX_OUTPUT_LENGTH", "MAX_ARRAY_BASED_STREAM_OUTPUT_LENGTH",
        "MAX_DECLARED_STREAM_LENGTH", "FLATE_MAX_BUFFER_SIZE")})
    class DecodedStreamObject:
        def __init__(self, data=b""): self._data = data
        def get_data(self): return self._data
    class Page:
        def __init__(self):
            self.stream = DecodedStreamObject(b"A" * (6 * 1024 * 1024)) if mode == "pdf-total" else None
        def extract_text(self):
            if self.stream: self.stream.get_data()
            return "x" if mode == "pdf-total" else "X" * 30000
    page_count = 101 if mode == "pdf-pages" else (4 if mode == "pdf-total" else 2)
    fake_pypdf.PdfReader = lambda _path: types.SimpleNamespace(pages=[Page() for _ in range(page_count)])
    fake_pypdf.filters = filters
    sys.modules["pypdf"] = fake_pypdf
    generic = types.ModuleType("pypdf.generic")
    generic.DecodedStreamObject = DecodedStreamObject
    sys.modules["pypdf.generic"] = generic

from jobhunter.profile import _extract_resume_text
try:
    text = _extract_resume_text(str(target))
    result = {"ok": True, "length": len(text)}
    if not mode.startswith("docx"):
        result["filter_limit"] = filters.ZLIB_MAX_OUTPUT_LENGTH
    print(json.dumps(result))
except Exception as error:
    print(json.dumps({"ok": False, "error": str(error)}))
`;

after(() => rmSync(fixtureRoot, { recursive: true, force: true }));

/** Exercise one extractor shape in an isolated Python interpreter. */
function inspectResume(mode, extension) {
  const target = join(fixtureRoot, `${mode}.${extension}`);
  const result = spawnSync(python, ['-c', fixtureScript, mode, target], {
    cwd: packageRoot,
    encoding: 'utf8',
    timeout: 15_000,
    env: {
      ...process.env,
      PYTHONPATH: [engineRoot, process.env.PYTHONPATH].filter(Boolean).join(delimiter),
      JOBHUNTER_DATA: join(fixtureRoot, 'data'),
      JOBHUNTER_CAREER_DB: join(fixtureRoot, 'career_db.json'),
    },
  });
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout.trim());
}

test('PDF extraction caps retained text and lowers pypdf stream limits', () => {
  const result = inspectResume('pdf-text', 'pdf');
  assert.deepEqual(result, { ok: true, length: 32000, filter_limit: 8 * 1024 * 1024 });
});

test('PDF extraction rejects excessive pages before extracting text', () => {
  const result = inspectResume('pdf-pages', 'pdf');
  assert.equal(result.ok, false);
  assert.match(result.error, /page limit/);
});

test('PDF extraction rejects aggregate decoded streams across bounded pages', () => {
  const result = inspectResume('pdf-total', 'pdf');
  assert.equal(result.ok, false);
  assert.match(result.error, /aggregate decoded-stream limit/);
});

test('DOCX validation rejects a compressed oversized package member', () => {
  const result = inspectResume('docx-bomb', 'docx');
  assert.equal(result.ok, false);
  assert.match(result.error, /uncompressed-byte limit/);
});

test('DOCX extraction rejects excessive paragraph fan-out', () => {
  const result = inspectResume('docx-paragraphs', 'docx');
  assert.equal(result.ok, false);
  assert.match(result.error, /paragraph limit/);
});

test('DOCX validation rejects suspicious compression ratios', () => {
  const result = inspectResume('docx-ratio', 'docx');
  assert.equal(result.ok, false);
  assert.match(result.error, /suspicious compression ratio/);
});

test('DOCX validation rejects aggregate expansion across individually bounded members', () => {
  const result = inspectResume('docx-total', 'docx');
  assert.equal(result.ok, false);
  assert.match(result.error, /uncompressed-byte limit/);
});

test('DOCX validation rejects central-directory fan-out and encrypted members', () => {
  const members = inspectResume('docx-members', 'docx');
  assert.equal(members.ok, false);
  assert.match(members.error, /too many package members/);
  const encrypted = inspectResume('docx-encrypted', 'docx');
  assert.equal(encrypted.ok, false);
  assert.match(encrypted.error, /encrypted DOCX/);
});

test('PDF and DOCX reject oversized raw input before their parsers run', () => {
  const pdf = inspectResume('pdf-input', 'pdf');
  assert.equal(pdf.ok, false);
  assert.match(pdf.error, /PDF exceeds the input-byte limit/);
  const docx = inspectResume('docx-input', 'docx');
  assert.equal(docx.ok, false);
  assert.match(docx.error, /DOCX exceeds the input-byte limit/);
});
