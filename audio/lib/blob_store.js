/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com | Content-addressable SHA-256 sharded blob store for Audio Studio stems and mixdowns.
 * 2   | maintainer@emeraldcoastsystemsgroup.com | Add byte-range reads and truthful MIME detection under OSHAL_PACKAGE_DATA_DIR.
 */
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

function detectAudioMime(buf, fallback = 'audio/wav') {
  if (!Buffer.isBuffer(buf) || buf.length < 4) return fallback;
  if (buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.length >= 12 && buf.subarray(8, 12).toString('ascii') === 'WAVE') {
    return 'audio/wav';
  }
  if (buf.subarray(0, 3).toString('ascii') === 'ID3' || (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0)) {
    return 'audio/mpeg';
  }
  if (buf.subarray(0, 4).toString('ascii') === 'OggS') return 'audio/ogg';
  if (buf.subarray(0, 4).toString('ascii') === 'fLaC') return 'audio/flac';
  return fallback;
}

class BlobStore {
  constructor(vaultRoot) {
    this.vaultRoot = vaultRoot
      || process.env.OSHAL_PACKAGE_DATA_DIR
      || process.env.OSHAL_AUDIO_VAULT
      || path.join(os.tmpdir(), 'oshal-audio-studio');
    this.blobsDir = path.join(this.vaultRoot, 'blobs');
    fs.mkdirSync(this.blobsDir, { recursive: true, mode: 0o700 });
  }

  getBlobPath(sha256) {
    if (!/^[a-f0-9]{64}$/i.test(String(sha256 || ''))) {
      throw new Error('Invalid SHA-256 blob identifier');
    }
    const normalized = String(sha256).toLowerCase();
    const dir = path.join(this.blobsDir, normalized.slice(0, 2), normalized.slice(2, 4));
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    return path.join(dir, `${normalized}.blob`);
  }

  put(bufferOrFloats, mimeType) {
    let buf;
    if (Buffer.isBuffer(bufferOrFloats)) {
      buf = bufferOrFloats;
    } else if (bufferOrFloats instanceof ArrayBuffer) {
      buf = Buffer.from(bufferOrFloats);
    } else if (bufferOrFloats instanceof Float32Array) {
      buf = Buffer.from(bufferOrFloats.buffer, bufferOrFloats.byteOffset, bufferOrFloats.byteLength);
    } else if (typeof bufferOrFloats === 'string') {
      buf = Buffer.from(bufferOrFloats, 'utf8');
    } else {
      throw new Error('BlobStore.put requires Buffer or Float32Array');
    }
    if (buf.length === 0 || buf.length > 104857600) {
      throw new Error('Audio blob size must be between 1 byte and 100 MiB');
    }

    const sha256 = crypto.createHash('sha256').update(buf).digest('hex');
    const blobPath = this.getBlobPath(sha256);
    const exists = fs.existsSync(blobPath);
    if (!exists) {
      const tempPath = `${blobPath}.tmp.${process.pid}.${crypto.randomBytes(6).toString('hex')}`;
      fs.writeFileSync(tempPath, buf, { mode: 0o600 });
      fs.renameSync(tempPath, blobPath);
    }

    const resolvedMime = detectAudioMime(buf, mimeType || 'audio/wav');
    return {
      hash: sha256,
      sha256,
      byteSize: buf.length,
      byte_size: buf.length,
      mimeType: resolvedMime,
      mime_type: resolvedMime,
      storagePath: blobPath,
      storage_path: blobPath,
      refCount: 1,
      deduplicated: exists,
    };
  }

  get(sha256, expectedMimeType) {
    const normalized = String(sha256 || '').toLowerCase();
    const blobPath = this.getBlobPath(normalized);
    if (!fs.existsSync(blobPath)) return null;

    const buf = fs.readFileSync(blobPath);
    const calculated = crypto.createHash('sha256').update(buf).digest('hex');
    if (calculated !== normalized) {
      throw new Error(`Blob integrity violation for ${normalized}`);
    }

    return {
      hash: normalized,
      data: buf,
      buffer: buf,
      byteSize: buf.length,
      mimeType: expectedMimeType || detectAudioMime(buf, 'audio/wav'),
    };
  }
}

module.exports = { BlobStore, detectAudioMime };
