/**
 * CHANGE LOG
 * SEQ | AUTHOR | DESCRIPTION
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Prove the region compositing boundary with real sharp: every pixel the mask does not cover is byte-identical to the source, fully covered pixels are the provider's answer, feathering never spreads outside, the anchor is exactly the crop box, and malformed or mismatched inputs are refused.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sharp, loadCompiled } from './project-api.fixture.mjs';
import { noiseImage, rgba, ANSWER } from './region-edit.fixture.mjs';

const { compositeRegion, regionMask, regionCropBox, regionAnchor, regionMaskSvg, regionPrompt, REGION_CONTEXT } = loadCompiled('create-region-edit-composite.js');
const WIDTH = 160, HEIGHT = 100;
const selection = (points, patch = {}) => ({ version: 1, kind: 'lasso', layerId: 'photo', assetId: 'photo', sourceWidth: WIDTH, sourceHeight: HEIGHT, feather: 0, points, ...patch });
const PENTAGON = [{ x: 50.25, y: 20.5 }, { x: 90.75, y: 30 }, { x: 85, y: 70.4 }, { x: 55.5, y: 75 }, { x: 40, y: 45.3 }];
const answer = (width = 64, height = 48, channels = 4) => sharp({ create: { width, height, channels, background: { r: ANSWER[0], g: ANSWER[1], b: ANSWER[2], alpha: 1 } } }).png().toBuffer();

/** Compare every pixel, split by the mask the compositor itself used. */
async function classify(source, output, region) {
  const before = await rgba(source), after = await rgba(output), mask = await regionMask(region);
  const result = { outside: 0, outsideChanged: 0, full: 0, fullWrong: 0, partial: 0 };
  for (let index = 0; index < mask.length; index++) {
    const a = before.data.subarray(index * 4, index * 4 + 4), b = after.data.subarray(index * 4, index * 4 + 4);
    if (mask[index] === 0) { result.outside++; if (!a.equals(b)) result.outsideChanged++; }
    else if (mask[index] === 255) { result.full++; if (!Buffer.from(ANSWER).equals(b)) result.fullWrong++; }
    else result.partial++;
  }
  return { ...result, width: after.width, height: after.height };
}

test('pixels outside the region stay byte-identical and fully covered pixels are the provider answer', async () => {
  const source = await noiseImage(WIDTH, HEIGHT), region = selection(PENTAGON), result = await compositeRegion(source, region, await answer());
  const counts = await classify(source, result.png, region);
  assert.deepEqual([counts.width, counts.height, result.width, result.height], [WIDTH, HEIGHT, WIDTH, HEIGHT]);
  assert.ok(counts.outside > 12000 && counts.full > 1500, JSON.stringify(counts));
  assert.equal(counts.outsideChanged, 0); assert.equal(counts.fullWrong, 0);
  assert.equal(result.changedPixels, counts.full + counts.partial);
  const box = regionCropBox(region), after = await rgba(result.png), before = await rgba(source);
  for (let y = 0; y < HEIGHT; y++) for (let x = 0; x < WIDTH; x++) {
    if (x >= box.left && x < box.left + box.width && y >= box.top && y < box.top + box.height) continue;
    assert.ok(before.data.subarray((y * WIDTH + x) * 4, (y * WIDTH + x) * 4 + 4).equals(after.data.subarray((y * WIDTH + x) * 4, (y * WIDTH + x) * 4 + 4)), `${x},${y}`);
  }
});

test('an inward feather softens the edge inside the region and still leaves the outside byte-identical', async () => {
  const source = await noiseImage(WIDTH, HEIGHT), hard = selection(PENTAGON), soft = selection(PENTAGON, { feather: 8 });
  const [hardMask, softMask] = await Promise.all([regionMask(hard), regionMask(soft)]);
  let softened = 0;
  for (let index = 0; index < hardMask.length; index++) {
    assert.ok(softMask[index] <= hardMask[index], 'feathering never adds coverage');
    if (hardMask[index] === 255 && softMask[index] < 255) softened++;
  }
  assert.ok(softened > 100, `feather softened ${softened} pixels`); assert.equal(softMask[65 + 45 * WIDTH], 255);
  const counts = await classify(source, (await compositeRegion(source, soft, await answer())).png, soft);
  assert.equal(counts.outsideChanged, 0); assert.ok(counts.partial > counts.full / 10);
});

test('box, rotated-quad and whole-image regions replace exactly what they cover', async () => {
  const source = await noiseImage(WIDTH, HEIGHT);
  const whole = selection([{ x: 0, y: 0 }, { x: WIDTH, y: 0 }, { x: WIDTH, y: HEIGHT }, { x: 0, y: HEIGHT }], { kind: 'layer' });
  const wholeCounts = await classify(source, (await compositeRegion(source, whole, await answer(10, 10))).png, whole);
  assert.deepEqual([wholeCounts.outside, wholeCounts.full, wholeCounts.fullWrong], [0, WIDTH * HEIGHT, 0]);
  const quad = selection([{ x: 80, y: 10 }, { x: 120, y: 50 }, { x: 80, y: 90 }, { x: 40, y: 50 }], { kind: 'box' });
  const quadCounts = await classify(source, (await compositeRegion(source, quad, await answer(300, 20))).png, quad);
  assert.equal(quadCounts.outsideChanged, 0); assert.equal(quadCounts.fullWrong, 0); assert.ok(quadCounts.full > 2800);
});

test('an RGB source without alpha keeps its outside pixels and gains only an opaque alpha channel', async () => {
  const rgb = await sharp(await noiseImage(WIDTH, HEIGHT)).removeAlpha().png().toBuffer(), region = selection(PENTAGON);
  assert.equal((await sharp(rgb).metadata()).channels, 3);
  const counts = await classify(rgb, (await compositeRegion(rgb, region, await answer(64, 48, 3))).png, region);
  assert.equal(counts.outsideChanged, 0); assert.equal(counts.fullWrong, 0);
});

test('the anchor is exactly the crop box: region bounds plus bounded context, clamped to the image', async () => {
  const source = await noiseImage(WIDTH, HEIGHT), region = selection(PENTAGON), box = regionCropBox(region);
  assert.deepEqual(box, { left: 24, top: 4, width: 83, height: 87 });
  const corner = regionCropBox(selection([{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 20 }, { x: 0, y: 20 }]));
  assert.deepEqual(corner, { left: 0, top: 0, width: 20 + REGION_CONTEXT.minimum, height: 20 + REGION_CONTEXT.minimum });
  const anchor = await rgba(await regionAnchor(source, box)), full = await rgba(source);
  assert.deepEqual([anchor.width, anchor.height], [box.width, box.height]);
  for (const [x, y] of [[0, 0], [box.width - 1, box.height - 1], [30, 40]]) {
    const at = ((y + box.top) * WIDTH + x + box.left) * 4;
    assert.ok(anchor.data.subarray((y * box.width + x) * 4, (y * box.width + x) * 4 + 4).equals(full.data.subarray(at, at + 4)));
  }
});

test('the mask SVG carries only fixed-notation numbers and the prompt carries the instruction', () => {
  const svg = regionMaskSvg(selection([{ x: 0.0000001, y: 1 }, { x: 99.5, y: 1 }, { x: 50, y: 80 }]));
  assert.match(svg, /d="M0\.000 1\.000 L99\.500 1\.000 L50\.000 80\.000 Z"/); assert.doesNotMatch(svg, /e-|script|href/i);
  const prompt = regionPrompt('Replace the cup with a small plant');
  assert.match(prompt, /Instruction: Replace the cup with a small plant/); assert.match(prompt, /same framing/);
});

test('malformed, oversized, vector and GIF answers are refused before anything is composited', async () => {
  const source = await noiseImage(WIDTH, HEIGHT), region = selection(PENTAGON);
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>');
  const gif = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#123456' } }).gif().toBuffer();
  for (const bad of [Buffer.alloc(0), Buffer.from('not an image'), svg, gif, Buffer.alloc(REGION_CONTEXT.generatedBytes + 1)]) {
    await assert.rejects(compositeRegion(source, region, bad), error => error.code === 'region_edit_result_invalid' && error.status === 502);
  }
});

test('a selection made for a different image size is refused as a changed source', async () => {
  const source = await noiseImage(WIDTH, HEIGHT);
  await assert.rejects(compositeRegion(source, selection(PENTAGON, { sourceWidth: WIDTH + 1 }), await answer()),
    error => error.code === 'region_edit_source_changed' && error.status === 409);
});
