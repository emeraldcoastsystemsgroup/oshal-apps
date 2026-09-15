/*
 * Pixel comparison and clustering adapted from picojs, MIT, Nenad Markus.
 * Upstream license and exact source/model provenance: face-model/README.md.
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Bound local frontal-face detection over the pinned, lossless JSON cascade.
 */
'use strict';
{
  function classifier(model) {
    if (!model || model.format !== 1 || model.depth !== 6 || model.count !== 468 ||
        !Array.isArray(model.trees) || model.trees.length !== 468) throw new Error('Invalid face model');
    const codes = new Int8Array(468 * 256), leaves = new Float32Array(468 * 64), thresholds = new Float32Array(468);
    model.trees.forEach((tree, index) => {
      if (!Array.isArray(tree.codes) || tree.codes.length !== 252 || !Array.isArray(tree.leaves) ||
          tree.leaves.length !== 64 || !Number.isFinite(tree.threshold) ||
          tree.codes.some(n => !Number.isInteger(n) || n < -128 || n > 127) ||
          tree.leaves.some(n => !Number.isFinite(n))) throw new Error('Invalid face tree');
      codes.set(tree.codes, index * 256 + 4); leaves.set(tree.leaves, index * 64); thresholds[index] = tree.threshold;
    });
    return (row, col, size, pixels, width) => classify(row, col, size, pixels, width, codes, leaves, thresholds);
  }

  function classify(row, col, size, pixels, width, codes, leaves, thresholds) {
    row *= 256; col *= 256;
    let score = 0;
    for (let tree = 0; tree < 468; tree++) {
      let node = 1;
      for (let depth = 0; depth < 6; depth++) {
        const at = tree * 256 + 4 * node;
        const a = pixels[((row + codes[at] * size) >> 8) * width + ((col + codes[at + 1] * size) >> 8)];
        const b = pixels[((row + codes[at + 2] * size) >> 8) * width + ((col + codes[at + 3] * size) >> 8)];
        node = 2 * node + (a <= b);
      }
      score += leaves[tree * 64 + node - 64];
      if (score <= thresholds[tree]) return -1;
    }
    return score - thresholds[467];
  }

  function scan(pixels, width, height, classifyRegion) {
    const detections = [];
    for (let size = 24; size <= Math.min(width, height); size *= 1.1) {
      const step = Math.max(2, Math.floor(size * 0.1)), offset = Math.floor(size / 2 + 1);
      for (let row = offset; row <= height - offset; row += step) {
        for (let col = offset; col <= width - offset; col += step) {
          const score = classifyRegion(row, col, size, pixels, width);
          if (score > 0) detections.push([row, col, size, score]);
          if (detections.length > 4096) throw new Error('Face candidate limit exceeded');
        }
      }
    }
    return detections;
  }

  function overlap(a, b) {
    const rows = Math.max(0, Math.min(a[0] + a[2] / 2, b[0] + b[2] / 2) - Math.max(a[0] - a[2] / 2, b[0] - b[2] / 2));
    const cols = Math.max(0, Math.min(a[1] + a[2] / 2, b[1] + b[2] / 2) - Math.max(a[1] - a[2] / 2, b[1] - b[2] / 2));
    return rows * cols / (a[2] * a[2] + b[2] * b[2] - rows * cols);
  }

  function cluster(detections, maxFaces) {
    detections.sort((a, b) => b[3] - a[3]);
    const assigned = new Set(), found = [];
    detections.forEach((seed, index) => {
      if (assigned.has(index)) return;
      let row = 0, col = 0, size = 0, score = 0, count = 0;
      for (let j = index; j < detections.length; j++) {
        if (assigned.has(j) || overlap(seed, detections[j]) <= 0.2) continue;
        const candidate = detections[j]; assigned.add(j);
        row += candidate[0]; col += candidate[1]; size += candidate[2]; score += candidate[3]; count++;
      }
      if (score >= 50) found.push({ x: (col - size / 2) / count, y: (row - size / 2) / count,
        width: size / count, height: size / count, score });
    });
    return found.sort((a, b) => b.score - a.score).slice(0, maxFaces).sort((a, b) => a.x - b.x);
  }

  function detect(pixels, width, height, model, maxFaces) {
    if (!(pixels instanceof Uint8Array) || !Number.isInteger(width) || !Number.isInteger(height) ||
        width < 24 || height < 24 || width > 640 || height > 640 || pixels.length !== width * height ||
        !Number.isInteger(maxFaces) || maxFaces < 1 || maxFaces > 6) throw new Error('Invalid face image');
    return cluster(scan(pixels, width, height, classifier(model)), maxFaces);
  }
  const api = { detect };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else globalThis.PortraitFaceCascade = api;
}
