/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Guard the box-path quoting of the dataset import against real PowerShell. LoRA 1.7.0's first live import failed New-Item with DriveNotFound ($env:String): the curated directory, image and caption paths were single-quoted literals, so the default root "$env:USERPROFILE/lora-characters" was never expanded on the GPU box, and every earlier proof pointed LORA_BOX_ROOT at a literal temp directory that no quoting could break. This suite keeps the DEFAULT root, runs the shipped directory/move/write statements through powershell.exe with USERPROFILE pointed at a fresh temp directory, and asserts the files at the EXPANDED path with the exact caption bytes. It also pins psBoxPath as a validator, not an escaper: every quote, backtick, stray $, wildcard, newline, control character and ".." is refused. On a non-win32 host the shell case prints one loud PLATFORM SKIP line rather than passing vacuously.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

// The box root is read once at module load. This guard exists to exercise the DEFAULT root
// ($env:USERPROFILE/lora-characters), so a LORA_BOX_ROOT left in the shell is removed first.
vi.hoisted(() => { delete process.env.LORA_BOX_ROOT; });
vi.mock('@/shared/logger', () => ({ createChildLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) }));
vi.mock('@/app/routes/remote-client-routes', () => ({ remoteClientRegistry: { listClients: () => [], enqueueTask: vi.fn() } }));

import {
  buildDatasetImportCommand,
  buildDatasetWriteFragment,
  characterConfigFromRow,
  psBoxPath,
} from '../src-routes/lora-train-dispatch';

const WIN32 = process.platform === 'win32';
if (!WIN32) {
  process.stderr.write(`PLATFORM SKIP: lora-dataset-box-path — the real-PowerShell case runs only on win32 `
    + `(this host is ${process.platform}); the shipped write statements were NOT executed here.\n`);
}

const IMAGE_ID = '0f0e0d0c-0b0a-4908-8706-050403020100';
const CHARACTER = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', subject: 'tin-drummer', trigger_word: 'tindrummer',
  hero_image: 'hero.png', ident_prompt: 'a small tin drummer', negative_prompt: 'blurry',
  identity_structure: 'one drum', identity_violation: 'three drums', base_model: 'base.safetensors',
};
const KEY = 'lora-aaaaaaaaaaaa4aaa8aaaaaaaaaaaaaaa';
const CURATED = `$env:USERPROFILE/lora-characters/${KEY}/curated`;
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
const config = characterConfigFromRow(CHARACTER);

describe('psBoxPath admits exactly a box path', () => {
  it('quotes the default root, the curated path and an explicit Windows root as one expandable string', () => {
    expect(psBoxPath('$env:USERPROFILE/lora-characters')).toBe('"$env:USERPROFILE/lora-characters"');
    expect(psBoxPath(`${CURATED}/portrait.png`)).toBe(`"${CURATED}/portrait.png"`);
    expect(psBoxPath('$Env:LOCALAPPDATA\\lora')).toBe('"$Env:LOCALAPPDATA\\lora"');
    expect(psBoxPath('C:\\Users\\user\\lora data (gpu)\\lora-characters')).toBe('"C:\\Users\\user\\lora data (gpu)\\lora-characters"');
    expect(psBoxPath('D:/lora-característica/curated')).toBe('"D:/lora-característica/curated"');
  });

  it('refuses every character that could end the string or start an expression', () => {
    for (const bad of ['"', '`', '$', "'", '*', '?', '[', ']', ';', '|', '&', '<', '>', '{', '}', '\n', '\r', '\t', '\u0007', '\u007f', '\u0085']) {
      expect(() => psBoxPath(`C:/lora${bad}characters`), JSON.stringify(bad)).toThrow(/box path/);
    }
    expect(() => psBoxPath('$env:USERPROFILE/$env:TEMP')).toThrow(/box path/);
    expect(() => psBoxPath('C:/lora/$env:USERPROFILE')).toThrow(/box path/);
    expect(() => psBoxPath('$env:USERPROFILE.txt')).toThrow(/box path/);
    expect(() => psBoxPath('$env:/lora')).toThrow(/box path/);
    expect(() => psBoxPath('$(whoami)/lora')).toThrow(/box path/);
  });

  it('refuses traversal, an empty path, surrounding whitespace and an oversized path', () => {
    expect(() => psBoxPath('C:/lora/../characters')).toThrow(/box path/);
    expect(() => psBoxPath(`${CURATED}/a..b.png`)).toThrow(/box path/);
    expect(() => psBoxPath('')).toThrow(/box path/);
    expect(() => psBoxPath(' C:/lora')).toThrow(/box path/);
    expect(() => psBoxPath('C:/lora ')).toThrow(/box path/);
    expect(() => psBoxPath(`C:/${'a'.repeat(2048)}`)).toThrow(/box path/);
  });
});

describe('the dataset write fragment', () => {
  it('is the exact statement sequence the import command ships, with the caption as a literal', () => {
    const fragment = buildDatasetWriteFragment(config, 'portrait.png', "tin drummer's portrait");
    expect(fragment).toBe(`New-Item -ItemType Directory -Force -Path "${CURATED}" | Out-Null; `
      + `Move-Item -Force -LiteralPath $temp -Destination "${CURATED}/portrait.png"; `
      + `[IO.File]::WriteAllText("${CURATED}/portrait.txt", 'tin drummer''s portrait', [Text.UTF8Encoding]::new($false))`);
    expect(buildDatasetImportCommand(config, IMAGE_ID, 'portrait.png', "tin drummer's portrait", 'dataset-owner')).toContain(fragment);
    expect(fragment).not.toContain("'$env:");
  });

  it('refuses an unsafe filename or a caption that cannot be a bounded literal', () => {
    expect(() => buildDatasetWriteFragment(config, '../portrait.png', 'caption')).toThrow(/filename/);
    expect(() => buildDatasetWriteFragment(config, 'portrait.png', 'bad\0caption')).toThrow(/caption/);
    expect(() => buildDatasetWriteFragment(config, 'portrait.png', 'x'.repeat(2049))).toThrow(/caption/);
  });
});

describe('the shipped write statements on real PowerShell', () => {
  let home = '';
  afterEach(() => { if (home) rmSync(home, { recursive: true, force: true }); home = ''; });

  it.skipIf(!WIN32)('expand the default box root and place the image and caption at the expanded path', () => {
    home = mkdtempSync(join(tmpdir(), 'lora-box-path-home-'));
    const source = join(home, 'staged-download.tmp');
    writeFileSync(source, PNG);
    const caption = "tindrummer's portrait — café";
    const fragment = buildDatasetWriteFragment(config, 'portrait.png', caption);
    const script = `$ErrorActionPreference='Stop'; $temp='${source.replace(/'/g, "''")}'; ${fragment}`;
    const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
      encoding: 'utf8', env: { ...process.env, USERPROFILE: home }, windowsHide: true, timeout: 60000,
    });
    expect(result.error).toBeUndefined();
    expect(result.status, `powershell.exe exit ${result.status}\n${result.stderr}`).toBe(0);
    const curated = join(home, 'lora-characters', KEY, 'curated');
    expect(existsSync(curated), `${curated} was not created: the box root did not expand`).toBe(true);
    expect(readFileSync(join(curated, 'portrait.png')).equals(PNG)).toBe(true);
    expect(readFileSync(join(curated, 'portrait.txt')).equals(Buffer.from(caption, 'utf8'))).toBe(true);
    expect(existsSync(source)).toBe(false);
    expect(existsSync(join(process.cwd(), '$env:USERPROFILE'))).toBe(false);
  });
});
