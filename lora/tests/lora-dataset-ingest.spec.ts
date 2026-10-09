/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Pin the dataset destination's pure boundaries: basenames, magic-byte typing, caption bounds, the staging DDL, and a worker command that downloads from the LoRA staging route, never the artifact handle, and reports failure from a catch. The previous version of this file answered /api/artifacts/handles/:ref with an express stub that accepted the service secret, so it passed while real core refused that rail; the handle path is now proven against the real core relay in lora-dataset-relay.spec.ts.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | The worker command signs its download and callbacks with the dispatch's callback grant from OSHAL_LORA_CALLBACK_GRANT; pin that it no longer names the fleet secret at all, and that the signer is defined before the try block so the failure callback can use it.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | The worker downloads the staged image with an empty signed POST to /api/lora/ingest/dataset-download/:id: the kernel's signed-package-callbacks rail admits POST only, and the live GET was refused authorization_identity_required.
 * 4 | maintainer@emeraldcoastsystemsgroup.com | Pin the box-side paths of the import command as PowerShell double-quoted expandable strings under the DEFAULT box root, and that no "'$env:" appears anywhere: 1.7.0 single-quoted the curated directory, image and caption paths, so "$env:USERPROFILE/lora-characters" reached the live GPU box unexpanded and New-Item failed DriveNotFound ($env:String). Every earlier run of this file left LORA_BOX_ROOT to the shell, which never carried a $env: prefix, so it is removed here before the module loads.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';

// The box root is read once at module load. The defect this file guards lives in the DEFAULT root
// ($env:USERPROFILE/...), so a LORA_BOX_ROOT left in the shell must not stand in for it.
vi.hoisted(() => { delete process.env.LORA_BOX_ROOT; });
vi.mock('@/shared/logger', () => ({ createChildLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) }));
vi.mock('@/app/routes/remote-client-routes', () => ({ remoteClientRegistry: { listClients: () => [], enqueueTask: vi.fn() } }));

import {
  datasetCaption,
  datasetFilename,
  datasetSchemaStatements,
  sniffDatasetImageType,
} from '../src-routes/lora-dataset-ingest';
import {
  buildDatasetImportCommand,
  characterConfigFromRow,
  isSafeDatasetFilename,
  MAX_DATASET_IMAGE_BYTES,
} from '../src-routes/lora-train-dispatch';

const SECRET = 'dataset-unit-secret';
const OWNER = 'dataset-owner';
const IMAGE_ID = '0f0e0d0c-0b0a-4908-8706-050403020100';
const CHARACTER = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', subject: 'tin-drummer', trigger_word: 'tindrummer',
  hero_image: 'hero.png', ident_prompt: 'a small tin drummer', negative_prompt: 'blurry',
  identity_structure: 'one drum', identity_violation: 'three drums', base_model: 'base.safetensors',
};
/** The character's immutable worker directory under the default root, as the box must expand it. */
const CURATED = '$env:USERPROFILE/lora-characters/lora-aaaaaaaaaaaa4aaa8aaaaaaaaaaaaaaa/curated';
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
const JPEG = Buffer.from('ffd8ffe000104a464946', 'hex');
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8 ')]);
const pkg = fileURLToPath(new URL('..', import.meta.url));

describe('LoRA dataset destination boundaries', () => {
  it('keeps dataset names bounded to basenames', () => {
    expect(isSafeDatasetFilename('portrait.png')).toBe(true);
    expect(isSafeDatasetFilename('../portrait.png')).toBe(false);
    expect(isSafeDatasetFilename('portrait.png/other.txt')).toBe(false);
    expect(isSafeDatasetFilename('portrait.ps1')).toBe(false);
  });

  it('types an image by its magic bytes, never by its declared name', () => {
    expect(sniffDatasetImageType(PNG)).toBe('image/png');
    expect(sniffDatasetImageType(JPEG)).toBe('image/jpeg');
    expect(sniffDatasetImageType(WEBP)).toBe('image/webp');
    expect(sniffDatasetImageType(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBeNull();
    expect(sniffDatasetImageType(Buffer.alloc(0))).toBeNull();
  });

  it('gives the curated file the extension its bytes support and strips any directory', () => {
    expect(datasetFilename('portrait-1234abcd.png', 'image/png')).toBe('portrait-1234abcd.png');
    expect(datasetFilename('portrait-1234abcd.png', 'image/jpeg')).toBe('portrait-1234abcd.jpg');
    expect(datasetFilename('..\\..\\evil/portrait.webp', 'image/webp')).toBe('portrait.webp');
    expect(datasetFilename('', 'image/png')).toBe('portrait.png');
    expect(datasetFilename('bad name;rm.png', 'image/png')).toBeNull();
  });

  it('bounds the caption and falls back to the trigger word', () => {
    expect(datasetCaption('  a tin drummer  ', 'tindrummer')).toBe('a tin drummer');
    expect(datasetCaption('', 'tindrummer')).toBe('tindrummer');
    expect(datasetCaption(undefined, 'tindrummer')).toBe('tindrummer');
    expect(datasetCaption('bad\0caption', 'tindrummer')).toBeNull();
    expect(datasetCaption('x'.repeat(2049), 'tindrummer')).toBeNull();
  });

  it('keeps the runtime staging DDL and migration 104 under forced owner RLS with the same bounds', () => {
    const runtime = datasetSchemaStatements().join('\n');
    const migration = readFileSync(resolve(pkg, 'migrations', '104-lora-dataset-staging.sql'), 'utf8');
    for (const text of [runtime, migration]) {
      expect(text).toContain('CREATE TABLE IF NOT EXISTS oshal_lora_dataset_staging');
      expect(text).toContain('ALTER TABLE oshal_lora_dataset_staging FORCE ROW LEVEL SECURITY');
      expect(text).toContain('REFERENCES oshal_lora_dataset_images(id) ON DELETE CASCADE');
      expect(text).toContain(`byte_size <= ${MAX_DATASET_IMAGE_BYTES}`);
      expect(text).toContain("content_type IN ('image/png', 'image/jpeg', 'image/webp')");
      expect(text).toContain('octet_length(image) = byte_size');
    }
  });

  it('downloads from the owner staging route, never the artifact handle, and signs with the grant, never the fleet secret', () => {
    vi.stubEnv('SWARM_SERVICE_SECRET', SECRET);
    const command = buildDatasetImportCommand(characterConfigFromRow(CHARACTER), IMAGE_ID, 'portrait.png', 'tindrummer portrait', OWNER);
    vi.unstubAllEnvs();
    expect(command).toContain(`/api/lora/ingest/dataset-download/${IMAGE_ID}'`);
    expect(command).toContain('Invoke-WebRequest -UseBasicParsing -Method Post');
    expect(command).not.toContain('/api/artifacts/');
    // Box paths are double-quoted so the worker expands $env:USERPROFILE; a single-quoted one is
    // the 1.7.0 live failure (New-Item ... -Path '$env:USERPROFI...' -> DriveNotFound).
    expect(command).toContain(`New-Item -ItemType Directory -Force -Path "${CURATED}" | Out-Null`);
    expect(command).toContain(`Move-Item -Force -LiteralPath $temp -Destination "${CURATED}/portrait.png"`);
    expect(command).toContain(`[IO.File]::WriteAllText("${CURATED}/portrait.txt", 'tindrummer portrait', [Text.UTF8Encoding]::new($false))`);
    expect(command).not.toContain("'$env:");
    expect(command).toContain(`-gt ${MAX_DATASET_IMAGE_BYTES}`);
    expect(command).toContain('RIFF');
    expect(command).toContain('$env:OSHAL_LORA_CALLBACK_GRANT');
    expect(command).not.toContain('SWARM_SERVICE_SECRET');
    expect(command).not.toContain('x-service-secret');
    expect(command).not.toContain(SECRET);
    expect(command).toContain(`Get-LoraHeaders 'POST' '/api/lora/ingest/dataset-download/${IMAGE_ID}'`);
    expect(command).not.toContain("Get-LoraHeaders 'GET'");
    expect(command).toContain("Get-LoraHeaders 'POST' '/api/lora/ingest' $cb");
    expect(command).toContain("-ContentType 'application/vnd.oshal.lora-callback+json'");
    expect(command).toContain("'oshal-lora-callback-grant-v1:'+$gp[1]");
    expect(command).not.toContain(OWNER);
    expect(command).toContain(`'${Buffer.from(OWNER).toString('base64url')}'`);
  });

  it('reports a failed fetch, check or write from a catch before the task ends in error', () => {
    const command = buildDatasetImportCommand(characterConfigFromRow(CHARACTER), IMAGE_ID, 'portrait.png', 'tindrummer portrait', OWNER);
    const catchBlock = command.slice(command.indexOf('} catch {'), command.indexOf('finally {'));
    expect(catchBlock).toContain("status='failed'");
    expect(catchBlock).toContain("kind='dataset'");
    expect(catchBlock).toContain("filename='portrait.png'");
    expect(catchBlock).toContain('throw $failure');
    expect(command.indexOf("status='ready'")).toBeLessThan(command.indexOf('} catch {'));
    expect(command.indexOf('function Get-LoraHeaders')).toBeLessThan(command.indexOf('try {'));
  });

  it('refuses a non-UUID staging id or an unsafe filename before building a command', () => {
    const config = characterConfigFromRow(CHARACTER);
    expect(() => buildDatasetImportCommand(config, 'art_12345678', 'portrait.png', 'caption', OWNER)).toThrow(/image id/);
    expect(() => buildDatasetImportCommand(config, IMAGE_ID, '../portrait.png', 'caption', OWNER)).toThrow(/filename/);
  });
});
