/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Prove valid LinkedIn extraction while rejecting excessive relevant members, bytes, and compression ratios.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Cover total fan-out, aggregate expansion, encryption, compressed input size, and declared-size mismatches.
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
const fixtureRoot = mkdtempSync(join(tmpdir(), 'career-zip-limits-'));
const python = process.env.JOBHUNTER_PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
const fixtureScript = String.raw`
import io, json, sys, zipfile
from pathlib import Path

mode, target = sys.argv[1], Path(sys.argv[2])
if mode == "input":
    with target.open("wb") as stream:
        stream.seek(64 * 1024 * 1024)
        stream.write(b"x")
elif mode != "declared":
    with zipfile.ZipFile(target, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        if mode == "valid":
            archive.writestr("Positions.csv", "title,company\nEngineer,Acme\n")
        elif mode == "oversize":
            archive.writestr("Positions.csv", b"A" * (2 * 1024 * 1024 + 1))
        elif mode == "aggregate":
            for index in range(3):
                archive.writestr(f"Positions-{index}.csv", b"A" * (2 * 1024 * 1024))
        elif mode == "ratio":
            archive.writestr("Profile.txt", b"A" * (1024 * 1024))
        elif mode == "members":
            for index in range(51):
                archive.writestr(f"Positions-{index}.csv", "title\nEngineer\n")
        elif mode == "total-members":
            for index in range(1001):
                archive.writestr(f"irrelevant-{index}.bin", b"x")
        elif mode == "encrypted":
            archive.writestr("Positions.csv", "title\nEngineer\n")
    if mode == "encrypted":
        raw = bytearray(target.read_bytes())
        local = raw.find(b"PK\x03\x04")
        central = raw.find(b"PK\x01\x02")
        raw[local + 6:local + 8] = (int.from_bytes(raw[local + 6:local + 8], "little") | 1).to_bytes(2, "little")
        raw[central + 8:central + 10] = (int.from_bytes(raw[central + 8:central + 10], "little") | 1).to_bytes(2, "little")
        target.write_bytes(raw)

from jobhunter.profile import _extract_artifact_text, _read_bounded_zip_member
try:
    if mode == "declared":
        member = type("Member", (), {"file_size": 1})()
        archive = type("Archive", (), {"open": lambda self, _member: io.BytesIO(b"xx")})()
        text = _read_bounded_zip_member(archive, member)
    else:
        text = _extract_artifact_text(str(target))
    print(json.dumps({"ok": True, "text": text}))
except Exception as error:
    print(json.dumps({"ok": False, "error": str(error)}))
`;

after(() => rmSync(fixtureRoot, { recursive: true, force: true }));

/** Create and inspect one archive through the production Python extractor. */
function inspectZip(mode) {
  const target = join(fixtureRoot, `${mode}.zip`);
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

test('a bounded LinkedIn-style archive extracts its relevant text', () => {
  const result = inspectZip('valid');
  assert.equal(result.ok, true);
  assert.match(result.text, /Engineer,Acme/);
});

test('an oversized uncompressed member is rejected before extraction', () => {
  const result = inspectZip('oversize');
  assert.equal(result.ok, false);
  assert.match(result.error, /uncompressed-byte limit/);
});

test('a small highly-compressed bomb shape is rejected by ratio', () => {
  const result = inspectZip('ratio');
  assert.equal(result.ok, false);
  assert.match(result.error, /suspicious compression ratio/);
});

test('an archive cannot fan out across excessive relevant members', () => {
  const result = inspectZip('members');
  assert.equal(result.ok, false);
  assert.match(result.error, /too many career-data members/);
});

test('aggregate career data is capped before any selected member is expanded', () => {
  const result = inspectZip('aggregate');
  assert.equal(result.ok, false);
  assert.match(result.error, /career data exceeds the uncompressed-byte limit/);
});

test('central-directory fan-out is capped even when members are irrelevant', () => {
  const result = inspectZip('total-members');
  assert.equal(result.ok, false);
  assert.match(result.error, /too many members/);
});

test('encrypted relevant data and oversized compressed input fail closed', () => {
  const encrypted = inspectZip('encrypted');
  assert.equal(encrypted.ok, false);
  assert.match(encrypted.error, /encrypted zip members/);
  const input = inspectZip('input');
  assert.equal(input.ok, false);
  assert.match(input.error, /zip exceeds the input-byte limit/);
});

test('streamed expansion cannot exceed a member declared size', () => {
  const result = inspectZip('declared');
  assert.equal(result.ok, false);
  assert.match(result.error, /expanded beyond its declared safe size/);
});
