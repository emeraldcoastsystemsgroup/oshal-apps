'use strict';
// CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | Accept exact native and legacy selected account IDs while retaining UUID-only run/request identities.
const crypto = require('node:crypto');
const phone = /^\+[1-9]\d{6,14}$/;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
/** Connection IDs are opaque metadata identifiers, separate from run UUIDs. */
function connectionId(value) { return typeof value==='string' && (uuid.test(value) || /^[a-f0-9]{64}$/.test(value)); }
const defaults = Object.freeze({ enabled: false, connectionId: null, from: '', transferPhone: '', publicOrigin: '',
  sttProvider: 'local-stt', maxMinutes: 10, maxTurns: 40, chunkSeconds: 12, maxCostCents: 300,
  estimatedCentsPerMinute: 10, allowedNumbers: [], consent: false, introduction: '', voice: 'alice' });
function fault(code, status = 400) { return Object.assign(new Error(code), { code, status }); }
function config(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(k => !Object.hasOwn(defaults,k))) throw fault('invalid_configuration');
  const c = { ...defaults, ...input };
  for (const k of ['enabled', 'consent']) if (typeof c[k] !== 'boolean') throw fault('invalid_' + k);
  for (const k of ['from', 'transferPhone']) if (typeof c[k] !== 'string' || (c[k] && !phone.test(c[k]))) throw fault('invalid_' + k);
  if (c.connectionId !== null && !connectionId(c.connectionId)) throw fault('invalid_connection');
  if (typeof c.publicOrigin !== 'string' || c.publicOrigin.length > 250) throw fault('invalid_public_origin');
  if (c.publicOrigin) {
    let u; try { u = new URL(c.publicOrigin); } catch { throw fault('invalid_public_origin'); }
    if (u.protocol !== 'https:' || u.username || u.password || u.pathname !== '/' || u.search || u.hash || /^(localhost|127\.|\[|10\.|192\.168\.)/i.test(u.hostname)) throw fault('public_https_origin_required');
    c.publicOrigin = u.origin;
  }
  for (const [k, min, max] of [['maxMinutes',1,60],['maxTurns',1,100],['chunkSeconds',4,25],['maxCostCents',1,50000],['estimatedCentsPerMinute',1,1000]]) {
    if (!Number.isInteger(c[k]) || c[k] < min || c[k] > max) throw fault('invalid_' + k);
  }
  if (!['local-stt','google-cloud-stt','gemini-stt'].includes(c.sttProvider)) throw fault('invalid_stt_provider');
  if (!Array.isArray(c.allowedNumbers) || c.allowedNumbers.length > 30 || c.allowedNumbers.some(n => typeof n !== 'string' || !phone.test(n))) throw fault('invalid_allowed_numbers');
  if (typeof c.introduction !== 'string' || c.introduction.length > 400 || typeof c.voice !== 'string' || !['alice','man','woman'].includes(c.voice)) throw fault('invalid_voice_settings');
  if (c.enabled && (!c.connectionId || !c.from || !c.transferPhone || !c.publicOrigin || !c.consent || !c.introduction.trim() || !c.allowedNumbers.length)) throw fault('setup_incomplete');
  return c;
}
function plan(input) {
  if (!input || Object.keys(input).some(k => !['to','objective','keywords','responses','idempotencyKey'].includes(k))) throw fault('invalid_task');
  if (!phone.test(input.to) || typeof input.objective !== 'string' || !input.objective.trim() || input.objective.length > 500) throw fault('destination_and_objective_required');
  if (!uuid.test(input.idempotencyKey)) throw fault('idempotency_key_required');
  if (!Array.isArray(input.keywords) || !input.keywords.length || input.keywords.length > 12 || input.keywords.some(s => typeof s !== 'string' || !/^[a-zA-Z][a-zA-Z -]{1,60}$/.test(s))) throw fault('invalid_menu_keywords');
  const responses = input.responses ?? [];
  if (!Array.isArray(responses) || responses.length > 12) throw fault('invalid_responses');
  for (const r of responses) {
    if (!r || Object.keys(r).some(k => !['prompt','say','digits'].includes(k)) || typeof r.prompt !== 'string' || r.prompt.length < 4 || r.prompt.length > 120
      || (!!r.say === !!r.digits) || (r.say && (typeof r.say !== 'string' || r.say.length > 200)) || (r.digits && !/^[0-9*#w]{1,30}$/.test(r.digits))) throw fault('invalid_response');
  }
  return { to: input.to, objective: input.objective.trim(), keywords: input.keywords, responses, idempotencyKey: input.idempotencyKey };
}
const numbers = {zero:'0',one:'1',two:'2',three:'3',four:'4',five:'5',six:'6',seven:'7',eight:'8',nine:'9',star:'*',pound:'#',hash:'#'};
function normalize(t) { return String(t || '').toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9*# ]/g, ' ').replace(/\s+/g,' ').trim(); }
function decide(transcript, task) {
  const t = normalize(transcript);
  if (!t) return { kind: 'wait', reason: 'no_speech' };
  if (/\b(ignore|disregard|override)\b.*\b(instruction|rule|previous|system)\b/.test(t)) return {kind:'stop', reason:'untrusted_instruction'};
  if (/\b(password|social security|credit card|payment card|one time code|verification code)\b/.test(t)) return {kind:'transfer',reason:'sensitive_request'};
  // Menus must be interpreted before greetings and hold messages in the same audio turn.
  let options = [];
  const digit = '(zero|one|two|three|four|five|six|seven|eight|nine|star|pound|hash|[0-9*#])';
  const after = new RegExp('(?:press|dial|enter) ' + digit + ' (?:for|four|4|to) (.*?)(?= (?:press|dial|enter) |$)', 'g');
  const before = new RegExp('(?:for|four|4|to) (.*?) (?:press|dial) ' + digit, 'g');
  let m;
  const following=[], preceding=[];
  while ((m = after.exec(t))) following.push({digits:numbers[m[1]] ?? m[1], label:m[2], index:m.index});
  while ((m = before.exec(t))) preceding.push({digits:numbers[m[2]] ?? m[2], label:m[1], index:m.index});
  // A boundary between two "for X press N" options also resembles "press N for Y".
  // Use the grammar anchored first in the menu instead of inventing a second meaning.
  options = preceding.length && (!following.length || preceding[0].index < following[0].index) ? preceding : following;
  const matches = options.filter(o => task.keywords.some(k => new RegExp('\\b' + normalize(k) + '\\b').test(o.label)));
  const choices = [...new Set(matches.map(o => o.digits))];
  if (choices.length === 1) return {kind:'digits', digits:choices[0], reason:'matched_menu_option'};
  if (choices.length > 1) return {kind:'wait', reason:'ambiguous_menu'};
  for (const r of task.responses) if (t.includes(normalize(r.prompt))) return r.say
    ? {kind:'say',text:r.say,reason:'approved_response'} : {kind:'digits',digits:r.digits,reason:'approved_response'};
  if (/\b(say|tell me|briefly describe)\b/.test(t) && /\b(reason|calling about|help you|claims|claim|service|department)\b/.test(t)) {
    return {kind:'wait',reason:'spoken_response_not_configured'};
  }
  if (/\b(please hold|hold the line|your call is|all (our )?(agents|representatives)|estimated wait|recorded|recording|leave (a|your) message|after the (tone|beep))\b/.test(t)) return {kind:'wait',reason:'hold_or_announcement'};
  if (/\b(my name is|this is|youre speaking (with|to)) [a-z]+\b/.test(t) && /\b(how (can|may) i (help|assist)|help you|claim number)\b/.test(t)) return {kind:'transfer',reason:'human_greeting'};
  return {kind:'wait',reason: options.length ? 'no_matching_option' : 'unrecognized_audio'};
}
const xml = s => String(s).replace(/[<>&"']/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&apos;'}[c]));
const wrap = body => '<?xml version="1.0" encoding="UTF-8"?><Response>' + body + '</Response>';
function hook(c,id,action,turn=0) { return `${c.publicOrigin}/api/calling-callbacks/run/${id}/${action}/${turn}`; }
function listen(c,id,turn) { return `<Record action="${xml(hook(c,id,'recorded',turn))}" recordingStatusCallback="${xml(hook(c,id,'audio',turn))}" recordingStatusCallbackEvent="completed absent" maxLength="${c.chunkSeconds}" timeout="2" playBeep="false" finishOnKey="" trim="do-not-trim"/>`; }
function twiml(action,c,id,turn) {
  if (action.kind === 'stop') return wrap('<Hangup/>');
  if (action.kind === 'pending') return wrap(`<Pause length="2"/><Redirect method="POST">${xml(hook(c,id,'poll',turn))}</Redirect>`);
  if (action.kind === 'transfer') return wrap(`<Say voice="${xml(c.voice)}">I will connect you with the person who requested this call.</Say><Dial callerId="${xml(c.from)}" timeout="25" timeLimit="${c.remainingSeconds ?? c.maxMinutes*60}" action="${xml(hook(c,id,'transfer',turn))}"><Number>${xml(c.transferPhone)}</Number></Dial>`);
  const output = action.kind === 'digits' ? `<Play digits="${xml(action.digits)}"/>` : action.kind === 'say' ? `<Say voice="${xml(c.voice)}">${xml(action.text)}</Say>` : '';
  return wrap(output + listen(c,id,turn));
}
function fingerprint(value) { return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
// The package's ADR-145 home summary, answered with GET /tasks: readiness from the saved configuration and the caller's
// own connections, then the newest runs. Every value is a saved state; a run marked done says nothing about what the
// destination heard or did. Pure, so the shape is testable without a database.
function summary(config, connections, runs, now = new Date()) {
  const c = { ...defaults, ...(config && typeof config === 'object' && !Array.isArray(config) ? config : {}) };
  const linked = Array.isArray(connections) && connections.some(x => x && x.id === c.connectionId);
  const ready = Boolean(c.enabled && linked);
  const list = Array.isArray(runs) ? runs.filter(r => r && typeof r === 'object') : [];
  const when = v => { const d = new Date(v); return Number.isNaN(d.getTime()) ? 'time not recorded' : d.toISOString(); };
  const last = list[0];
  const tiles = [
    { id: 'calling', label: 'Calling', value: ready ? 'Ready' : c.enabled ? 'No connection' : 'Off', tone: ready ? 'good' : 'neutral' },
    { id: 'runs', label: 'Saved runs', value: String(list.length), tone: 'neutral' },
    { id: 'last', label: 'Last outcome', value: last ? String(last.outcome || last.status || 'unknown').slice(0, 16) : 'None', tone: last && last.status === 'failed' ? 'warn' : 'neutral' }
  ];
  const items = list.slice(0, 3).map(r => ({ text: `Call ${String(r.status || 'unknown')}`, detail: `${String(r.outcome || 'no outcome recorded')} · ${when(r.created_at)}`, tone: r.status === 'failed' ? 'warn' : 'neutral', fix: 'calling-settings' }));
  items.push({ text: ready ? `Calls go out from ${c.from || 'the saved sender'} over your own Twilio connection, to approved destinations only.` : 'Calling is off until a connection, a sender number and the other required settings are saved and calling is enabled.', tone: 'neutral', fix: 'calling-settings' });
  items.push({ text: 'Saved run states, newest 50. A run marked done is not proof of what the destination heard or did.', tone: 'neutral', fix: 'calling-settings' });
  return { tiles, metrics: tiles, items, asOf: now.toISOString(), partial: false };
}
module.exports = {defaults, config, plan, decide, twiml, hook, wrap, xml, phone, uuid, connectionId, fingerprint, fault, summary};
