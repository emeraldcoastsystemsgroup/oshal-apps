/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | phone-control 1.1.0: the bridge files this package installs on the person's own computer, read from the package itself with their sha256, and the same bytes gzip-compressed for the one install command (a single shell argument is limited to 128 KiB, so the sources together must stay under 90 KB).
 * 2 | maintainer@emeraldcoastsystemsgroup.com | The by-name wrapper is text here, not a file in bridge/: the kernel stages only files with a known extension into the package sandbox (crates/packages/src/source_artifact.rs), so an extension-less file shipped in git never reached /package and the manifest route failed (found by the whole-chain proof).
 * 3 | maintainer@emeraldcoastsystemsgroup.com | 1.3.0: ship oshal_phone_mirror.py in the signed bridge manifest alongside oshal_phone_bridge.py and oshal_phone_ble.py.
 * 4 | maintainer@emeraldcoastsystemsgroup.com | 1.4.0: ship oshal_phone_ops.py alongside oshal_phone_mirror.py and raise uncompressed source budget to 140 KiB (gzipped install payload stays ~58 KiB, well under the 128 KiB single-argument shell ceiling).
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');

// The wrapper that lets a person or Jarvis run the bridge by name, installed as ~/.local/bin/oshal-phone-bridge.
const WRAPPER = [
  '#!/bin/sh',
  '# CHANGE LOG',
  '# 1 | maintainer@emeraldcoastsystemsgroup.com | phone-control 1.1.0: the bridge by name, for a person or Jarvis on this computer (oshal-phone-bridge help).',
  'exec python3 -I "$HOME/.local/share/oshal-phone-bridge/oshal_phone_bridge.py" "$@"',
  ''
].join('\n');
const BRIDGE_FILES = Object.freeze([
  { name: 'oshal_phone_bridge.py', mode: 0o755 },
  { name: 'oshal_phone_ble.py', mode: 0o644 },
  { name: 'oshal_phone_mirror.py', mode: 0o644 },
  { name: 'oshal_phone_ops.py', mode: 0o644 },
  { name: 'oshal-phone-bridge', mode: 0o755, text: WRAPPER }
]);
const MAX_SOURCE_BYTES = 140 * 1024;

let cached = null;

/**
 * @description The bridge files with their hashes and compressed bytes, read once per package process.
 * @param {string} packageDir The package folder.
 * @returns {{version:string,files:Array<{name:string,mode:number,bytes:number,sha256:string,gz:string}>}} The manifest.
 */
function bridgeManifest(packageDir) {
  if (cached && cached.dir === packageDir) return cached.manifest;
  let total = 0;
  const files = BRIDGE_FILES.map(({ name, mode, text }) => {
    const bytes = text === undefined ? fs.readFileSync(path.join(packageDir, 'bridge', name)) : Buffer.from(text, 'utf8');
    total += bytes.length;
    return {
      name, mode, bytes: bytes.length,
      sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
      gz: zlib.gzipSync(bytes, { level: 9 }).toString('base64')
    };
  });
  if (total > MAX_SOURCE_BYTES) throw new Error(`the bridge sources are ${total} bytes; the install command allows ${MAX_SOURCE_BYTES}`);
  const version = /^VERSION = '([^']+)'/m.exec(fs.readFileSync(path.join(packageDir, 'bridge', 'oshal_phone_bridge.py'), 'utf8'))?.[1];
  const manifest = Object.freeze({ version: version || 'unknown', files: Object.freeze(files) });
  cached = { dir: packageDir, manifest };
  return manifest;
}

/**
 * @description One bridge file's bytes, when it is one of the bridge files.
 * @param {string} packageDir The package folder.
 * @param {string} name The file name.
 * @returns {Buffer|null} The bytes, or null for any other name.
 */
function bridgeFile(packageDir, name) {
  const file = BRIDGE_FILES.find((item) => item.name === name);
  if (!file) return null;
  return file.text === undefined ? fs.readFileSync(path.join(packageDir, 'bridge', name)) : Buffer.from(file.text, 'utf8');
}

module.exports = { bridgeManifest, bridgeFile, BRIDGE_FILES, MAX_SOURCE_BYTES };
