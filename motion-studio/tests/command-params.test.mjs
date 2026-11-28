/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Prove native command-form values and real compositor settings, including numeric ids, booleans and exact wide numbers.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { commandParams, commandValue } from '../tools/command-params.mjs';
import { parseNative, stringifyNative } from '../tools/native-json.mjs';

const field = (name, value, type = 'native') => ({name, value, dataset: {type}});

test('untyped catalog parameters retain native numbers, booleans, arrays and plain text', () => {
  const params = commandParams([field('comp', '1'), field('duration', '2'), field('name', 'Media check'),
    field('preserveFrameRate', 'false'), field('background', '[0.1,0.2,0.3]'), field('unused', '')]);
  assert.deepEqual(params, {comp: 1, duration: 2, name: 'Media check', preserveFrameRate: false, background: [0.1,0.2,0.3]});
  assert.equal(commandValue('18446744073709551615'), 18446744073709551615n);
  assert.equal(commandValue('"123"'), '123', 'quoted numeric names remain names');
  assert.equal(commandValue('123', 'string'), '123', 'explicit string schemas remain authoritative');
});

test('malformed structured and explicitly typed input is refused before sending an edit', () => {
  for (const text of ['[1,', '{broken}', '"unfinished']) assert.throws(() => commandValue(text), /valid JSON/);
  for (const [text, type] of [['no', 'number'], ['2.5', 'integer'], ['1', 'boolean'], ['null', 'object'], ['{}', 'array']]) {
    assert.throws(() => commandValue(text, type), /Enter a valid/);
  }
});

function engine(input) {
  const binary = process.env.MOTION_ENGINE_BINARY;
  if (!binary) throw new Error('Set MOTION_ENGINE_BINARY to the reviewed native Motion worker.');
  return new Promise((resolve, reject) => {
    const child = spawn(binary, [], {env: {PATH:'/usr/bin:/bin', HOME:'/tmp', LANG:'C.UTF-8'}, stdio:['pipe','pipe','pipe']});
    let stdout = '', stderr = '';
    const timer = setTimeout(() => {child.kill('SIGKILL'); reject(new Error('native command fixture timed out'));}, 15000);
    child.stdout.on('data', bytes => {stdout += bytes; if (stdout.length > 8 * 1024 * 1024) child.kill('SIGKILL');});
    child.stderr.on('data', bytes => {stderr += bytes;});
    child.once('error', error => {clearTimeout(timer); reject(error);});
    child.once('close', code => {
      clearTimeout(timer);
      try {const result = parseNative(stdout); assert.equal(code, 0, stringifyNative(result) + stderr); resolve(result.result);}
      catch (error) {reject(error);}
    });
    child.stdin.end(stringifyNative(input));
  });
}

test('the real catalog form renames and resizes the actual native composition', async () => {
  const catalog = await engine({op:'catalog', filter:'comp.settings'});
  const schema = catalog.commands.find(command => command.id === 'comp.settings').schema;
  assert.equal(schema.properties.duration.type, undefined, 'the actual catalog has descriptions without types');
  const empty = await engine({op:'create'});
  const created = await engine({op:'edit', document:empty.document,
    commands:[{command:'comp.new',params:{name:'Before form edit',width:320,height:180,frameRate:30,duration:5}}]});
  const initial = Object.values(created.document.items).find(item => item.kind.type === 'Comp');
  const params = commandParams([field('comp', String(initial.id)), field('duration', '2'), field('name', 'After form edit')]);
  const changed = await engine({op:'edit', document:created.document, comp:initial.id,
    commands:[{command:'comp.settings',params}]});
  const composition = changed.document.items[initial.id];
  assert.equal(composition.name, 'After form edit');
  assert.ok(BigInt(composition.kind.duration) < BigInt(initial.kind.duration));
  assert.equal(composition.kind.width, 320, 'an omitted optional setting stays unchanged');
});
