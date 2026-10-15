/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | The page speaks in sentences, not codes or JSON. The Plain helper is executed out of the shipped ui/index.html: every refusal code the routes raise toward this page reads as what to do (select_connection was shown as "select connection"), an unknown code is still a sentence, the audio test reads as what was heard and what the assistant would do on a call (the page printed the raw result JSON), and malformed approved replies say how to write them. client.js routes the audio result, refusals and the replies field through Plain and never prints the audio result as JSON.
 * -----------------------------------------------------------------------------
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '../ui/index.html'), 'utf8');
const client = fs.readFileSync(path.join(__dirname, '../ui/client.js'), 'utf8');
const inline = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]).find((code) => code.includes('var Plain'));
const sandbox = {};
vm.runInNewContext(`${inline}; this.Plain = Plain;`, sandbox);
const { Plain } = sandbox;

test('the codes the configuration and audio routes raise read as instructions', () => {
  for (const code of ['select_connection', 'connection_unavailable', 'speech_provider_unavailable', 'invalid_audio', 'setup_incomplete', 'destination_not_allowed', 'deny_tier']) {
    const text = Plain.refusal({ code, message: code });
    assert.ok(!/_/.test(text), `${code} still shows a code: ${text}`);
    assert.ok(/^[A-Z]/.test(text) && /\.$/.test(text), `${code} is not a sentence: ${text}`);
  }
  assert.match(Plain.refusal({ code: 'select_connection' }), /Choose a Twilio connection/);
});

test('an unknown code is still a sentence, and a server sentence passes through', () => {
  assert.equal(Plain.refusal({ code: 'brand_new_code', message: 'brand_new_code' }), 'Calling Assistant could not do that (brand new code).');
  assert.equal(Plain.refusal({ message: 'The carrier said no.' }), 'The carrier said no.');
});

test('the audio test reads as what was heard and what would happen, never JSON', () => {
  const text = Plain.interpretation({ transcript: 'for claims press 2', decision: { kind: 'digits', digits: '2', reason: 'matched_menu_option' }, provider: 'local-stt', sha256: 'ab', bytes: 9, transport: 'uploaded_audio', liveCall: false });
  assert.equal(text, 'Heard: "for claims press 2"\nOn a call: A menu option matched your keywords, so the assistant would press 2.\nTranscribed by local-stt. This test played no call and contacted no one.');
  assert.ok(!/[{}]|_/.test(text));
  assert.match(Plain.interpretation({ transcript: 'say claims', decision: { kind: 'say', text: 'claims', reason: 'approved_response' } }), /would say "claims"/);
  assert.match(Plain.interpretation({ transcript: '', decision: { kind: 'wait', reason: 'no_speech' } }), /^Heard: nothing\nOn a call: Nothing was heard/);
});

test('malformed approved replies say how to write them', () => {
  assert.deepEqual(JSON.parse(JSON.stringify(Plain.responses('[{"prompt":"say claims","say":"claims"}]'))), [{ prompt: 'say claims', say: 'claims' }]);
  assert.throws(() => Plain.responses('{oops'), /Approved replies must be a list like/);
  assert.throws(() => Plain.responses('{"prompt":"x"}'), /Approved replies must be a list like/);
});

test('client.js uses Plain for refusals, the audio result and the replies field, and has no connection says so', () => {
  assert.ok(/\$\('audioResult'\)\.textContent=Plain\.interpretation\(/.test(client), 'the audio result is a sentence');
  assert.ok(!/audioResult'\)\.textContent=JSON\.stringify/.test(client), 'the audio result is never JSON');
  assert.ok(/message\(Plain\.refusal\(e\)\)/.test(client), 'refusals are sentences');
  assert.ok(/responses:Plain\.responses\(/.test(client) && !/JSON\.parse\(\$\('responses'\)/.test(client));
  assert.ok(/if\(!data\.connections\.length\) message\(Plain\.NO_CONNECTION\)/.test(client));
  assert.match(Plain.NO_CONNECTION, /Connections page \(\/utilities\)/);
});
