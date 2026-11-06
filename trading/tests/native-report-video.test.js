/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Guards the report films: the real report studio bridge over the real engine.exchange wire shape (hello line, one request, one reply), a speech service that lies about its WAV length exactly like Kokoro streams, the render pipeline end to end into real files, the owner-scoped index against a real disposable PostgreSQL, the stream route's refusals and owner isolation, the two-sided file-name contract, and the honest answers when the engine or the report is missing.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | 1.50.1: guards the slide layout against a long value (the assigned research strategy name) printing over its label, measured with the real Pillow text boxes.
 * 4 | maintainer@emeraldcoastsystemsgroup.com | 1.51.1: a press without a session finds the newest saved report after the session rolled; a report with no connected accounts says so.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | 1.51.0: the films render inside the package. Real ffmpeg (the installation's), a real disposable PostgreSQL, and a double of the kernel's voice.speak at the intent seam (the kernel's own side is guarded by crates/oshald/tests/package_voice_speak.rs): one account per pass, finished files indexed rather than refilmed, Film again, a failing speech service, presenter clip refusals, missing lasting storage, and the stream route's owner isolation.
 */
'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { execFileSync } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const { createRequire } = require('node:module');
const { Pool, Client } = createRequire(path.resolve(__dirname, '../../scripts/toolchain/package.json'))('pg');
const video = require('../routes/reports/report-video');
const film = require('../routes/reports/report-film');
const root = path.resolve(__dirname, '..');

const SESSION = '2026-11-02';
const LONG_STRATEGY = 'Congress long-term trend — whole shares — review';

/** A saved report with two connected accounts, one carrying fills and a long strategy name. */
function savedReport() {
  return { version: 2, title: 'The OSHAL report', presenter: 'Jamie Lee', sessionDate: SESSION,
    generatedAt: '2026-11-02T23:05:00.000Z',
    headlines: ['2 connected real accounts · $20,000.00 current equity.'],
    live: [{ label: 'Trading …9999', equity: 10000, cash: 500, strategyName: LONG_STRATEGY, authority: 'active',
      protectionAuthority: 'active',
      activity: { status: 'available', today: { fills: 2, orders: 2, buyGross: 100, sellGross: 200 },
        todayFills: [{ symbol: 'SPY', side: 'BUY', quantity: 1, price: 100, notional: 100 },
          { symbol: 'BIL', side: 'SELL', quantity: 2, price: 100, notional: 200 }] },
      positions: [{ symbol: 'SPY', qty: 10, marketValue: 7000 }, { symbol: 'BIL', qty: 30, marketValue: 2500 }] },
    { label: 'Rollover retirement …1234', equity: 10000, cash: 10000, strategyName: null, authority: 'off',
      activity: { status: 'available', today: {}, todayFills: [] }, positions: [] }],
    paper: [], errors: [], narration: 'n/a', storyboard: [] };
}

/** A WAV of `seconds`; `lying` writes Kokoro's unknown streamed lengths into the header. */
function wav(seconds, lying = false) {
  const rate = 24000, data = Buffer.alloc(Math.round(seconds * rate) * 2);
  const header = Buffer.alloc(44);
  header.write('RIFF', 0); header.writeUInt32LE(lying ? 0xffffffff : 36 + data.length, 4); header.write('WAVE', 8);
  header.write('fmt ', 12); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
  header.writeUInt32LE(rate, 24); header.writeUInt32LE(rate * 2, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34);
  header.write('data', 36); header.writeUInt32LE(lying ? 0xffffffff : data.length, 40);
  return Buffer.concat([header, data]);
}

/** The kernel seam: voice.speak answers canonical WAV; every call is recorded. */
function speechIntent(calls) {
  return async (name, input) => {
    calls.push({ name, ...input });
    assert.equal(name, 'voice.speak', 'the films use no kernel service but voice.speak');
    return { contentType: 'audio/wav', audioBase64: wav(0.3).toString('base64'), bytes: 0 };
  };
}

/** A real disposable database with the report and film migrations applied. */
async function database(t) {
  const dsn = process.env.OSHAL_TEST_POSTGRES;
  assert.ok(dsn, 'OSHAL_TEST_POSTGRES must name an explicitly disposable PostgreSQL fixture.');
  const base = new URL(dsn);
  assert.ok(['127.0.0.1', 'localhost'].includes(base.hostname) && ['35689', '32768'].includes(base.port), 'Require the declared disposable PostgreSQL fixture');
  const admin = new Client({ connectionString: dsn }); await admin.connect();
  const name = 'films_' + randomUUID().replaceAll('-', ''); await admin.query('CREATE DATABASE ' + name); base.pathname = '/' + name;
  const pool = new Pool({ connectionString: base.toString() });
  t.after(async () => { await pool.end(); await admin.query('DROP DATABASE ' + name); await admin.end(); });
  for (const file of ['009-native-oshal-reports.sql', '014-report-videos.sql'])
    await pool.query(fs.readFileSync(path.join(root, 'migrations', file), 'utf8'));
  return pool;
}

async function saveReport(pool, owner) {
  await pool.query('INSERT INTO trading_oshal_reports (user_sub,report_id,session_date,payload,created_at) VALUES ($1,$2,$3,$4,now())',
    [owner, 'daily-' + SESSION, SESSION, JSON.stringify(savedReport())]);
}

function lastingDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'report-films-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function prerequisites() {
  try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); execFileSync('ffprobe', ['-version'], { stdio: 'ignore' }); }
  catch (err) { return 'the report film tests need the installation toolchain (ffmpeg, ffprobe) on this host: ' + err.message; }
  return fs.existsSync('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf') ? null : 'the report film tests need the DejaVu fonts the kernel image ships';
}
const MISSING = prerequisites();
assert.equal(MISSING, null, MISSING || 'toolchain present');

const probe = (file) => JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,width,height', '-of', 'json', file], { encoding: 'utf8' })).streams;

test('the slides say the day and a long value never prints over its label', () => {
  const slides = film.accountSlides(savedReport(), savedReport().live[0]);
  assert.deepEqual(slides.map((s) => s.title), ['The OSHAL report', 'The account', `Today's trades — ${SESSION}`, 'Positions', 'The desk']);
  assert.match(slides[2].say, /Bought 1 S P Y at 100 dollars\. Sold 2 B I L at 100 dollars/);
  assert.deepEqual(slides[2].lines[0], ['Buy 1 SPY', '$100.00 · $100.00']);
  assert.deepEqual(slides[3].lines[0], ['SPY · 10 shares', '$7,000.00 · 70%']);
  const short = film.pairLayout('Cash', '$9,225.40');
  assert.equal(short.height, 42);
  assert.equal(short.texts[1].dy, 0);
  const long = film.pairLayout('Assigned research', LONG_STRATEGY);
  assert.equal(long.height, 78, 'a value that cannot clear its label drops to its own row');
  assert.equal(long.texts[1].text, LONG_STRATEGY);
  assert.ok(long.texts[1].dy >= 26 + 8, 'the dropped value starts below the label line');
  const huge = film.pairLayout('Assigned research', 'x'.repeat(200));
  assert.ok(huge.texts[1].text.endsWith('…') && huge.texts[1].text.length < 70);
  for (const slide of slides) {
    const texts = film.slideTexts(slide, SESSION);
    assert.ok(texts.some((x) => x.text === slide.title) && texts.some((x) => /^Private to the account owner/.test(x.text)));
    assert.ok(texts.every((x) => x.y < 720 - 20), 'nothing is drawn off the frame');
  }
  assert.equal(film.money(-1234.5), '$-1,234.50');
  assert.equal(film.spokenMoney(465854.09), '465,854 dollars');
});

/** The lit columns of one line drawn by the real ffmpeg, as [first, last]. */
function litColumns(dir, name, text, x) {
  const file = path.join(dir, `${name}.txt`), width = 1000, height = 60;
  fs.writeFileSync(file, film.drawable(text));
  const raw = execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', `color=c=black:s=${width}x${height}:d=1`,
    '-vf', `drawtext=fontfile=${film.FONT.mono}:textfile=${file}:expansion=none:fontsize=30:fontcolor=white:x=${x}:y=10`,
    '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'gray', '-'], { maxBuffer: 1 << 20 });
  let first = width, last = -1;
  for (let i = 0; i < raw.length; i += 1) if (raw[i] > 128) { const col = i % width; first = Math.min(first, col); last = Math.max(last, col); }
  return [first, last];
}

test('the installation\'s ffmpeg draws every character of a multi-byte line, aligned like plain text', (t) => {
  const dir = lastingDir(t);
  const fancy = 'A · B — 2026-11-03', plain = 'A x B x 2026-11-03';
  for (const x of ['10', '900-tw']) {
    const [f0, f1] = litColumns(dir, 'fancy', fancy, x), [p0, p1] = litColumns(dir, 'plain', plain, x);
    assert.ok(Math.abs(f1 - p1) <= 2 && Math.abs(f0 - p0) <= 2, `at x=${x} the multi-byte line spans ${f0}-${f1}, plain ${p0}-${p1}`);
  }
});

test('narration length is measured from the bytes present, never a streamed header', () => {
  assert.equal(film.wavSeconds(wav(1.5, true)), 1.5);
  assert.equal(film.wavSeconds(wav(0.25)), 0.25);
});

test('each pass films one account into a real file the owner alone is served', async (t) => {
  const pool = await database(t), lasting = lastingDir(t), owner = 'films-owner-' + randomUUID();
  await saveReport(pool, owner);
  const calls = [], env = { OSHAL_PACKAGE_DATA_DIR: lasting };
  const deps = { pool, intent: speechIntent(calls), env };
  const clip = path.join(lasting, 'clip.mp4');
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=25:duration=1', '-pix_fmt', 'yuv420p', clip]);
  assert.equal((await video.savePresenterClip(deps, owner, { dataBase64: fs.readFileSync(clip).toString('base64') })).body.ok, true);

  const waiting = await video.tickVideos(deps, 'someone-else', {}, new Date('2026-11-02T23:20:00Z'));
  assert.equal(waiting.body.waiting, 'report', 'no saved report answers waiting, not an error');

  const first = (await video.tickVideos(deps, owner, { session: SESSION }, new Date('2026-11-02T23:20:00Z'))).body;
  assert.equal(first.done, false);
  assert.deepEqual(first.videos.map((v) => v.status).sort(), ['pending', 'ready'], 'one account per pass');
  assert.equal(calls.length, 5, 'one narration per slide');
  assert.ok(calls.every((c) => c.voice === 'am_michael' && c.text.length > 0 && c.text.length <= 3000));
  const second = (await video.tickVideos(deps, owner, { session: SESSION }, new Date('2026-11-02T23:25:00Z'))).body;
  assert.equal(second.done, true);
  assert.ok(second.videos.every((v) => v.status === 'ready'), JSON.stringify(second.videos));

  const row = second.videos.find((v) => v.file === 'trading-9999.mp4');
  const filmed = path.join(lasting, 'report-videos', video.dirOf(owner), SESSION, row.file);
  assert.equal(fs.statSync(filmed).size, row.bytes, 'the index row matches the file');
  assert.ok(row.seconds > 4, JSON.stringify(row));
  const streams = probe(filmed);
  assert.deepEqual(streams.map((s) => s.codec_type).sort(), ['audio', 'video']);
  assert.equal(streams.find((s) => s.codec_type === 'video').width, 1280);
  assert.deepEqual(fs.readdirSync(path.dirname(filmed)).sort(), ['rollover-retirement-1234.mp4', 'trading-9999.mp4'], 'no work files are left behind');

  const again = await video.tickVideos(deps, owner, { session: SESSION }, new Date('2026-11-02T23:30:00Z'));
  assert.equal(again.body.done, true);
  assert.equal(calls.length, 10, 'a finished day is not filmed again');

  const handler = video.streamVideo({ pool }, (req) => req.sub, env);
  const answer = (sub, session, file) => new Promise((resolve) => {
    const res = { headers: {}, body: null, statusCode: 200,
      setHeader(k, v) { this.headers[k] = v; }, status(code) { this.statusCode = code; return this; },
      json(body) { this.body = body; resolve(this); },
      lastingFile(relative) { this.sent = fs.statSync(path.join(lasting, relative)).size; resolve(this); } };
    handler({ sub, params: { session, file } }, res);
  });
  assert.equal((await answer(null, SESSION, row.file)).statusCode, 401);
  assert.equal((await answer(owner, SESSION, '../../etc/passwd')).statusCode, 400);
  assert.equal((await answer('someone-else', SESSION, row.file)).statusCode, 404, 'another caller has no index row');
  assert.equal((await answer(owner, SESSION, row.file)).sent, row.bytes, 'the owner is served the exact file');

  await pool.query('DELETE FROM trading_report_videos WHERE user_sub=$1', [owner]);
  const indexed = (await video.tickVideos(deps, owner, { session: SESSION }, new Date('2026-11-02T23:35:00Z'))).body;
  assert.equal(calls.length, 10, 'a complete file on disk is indexed, never filmed twice');
  assert.equal(indexed.videos.filter((v) => v.status === 'ready').length, 1);

  const forced = (await video.tickVideos(deps, owner, { session: SESSION, force: true }, new Date('2026-11-02T23:40:00Z'))).body;
  assert.equal(calls.length, 15, 'Film again films anew');
  assert.deepEqual(forced.videos.map((v) => v.status).sort(), ['pending', 'ready']);
});

test('a press after the session rolled films the newest saved report; an exact session stays exact', async (t) => {
  const pool = await database(t), lasting = lastingDir(t), owner = 'films-owner-' + randomUUID();
  await saveReport(pool, owner);
  const deps = { pool, intent: speechIntent([]), env: { OSHAL_PACKAGE_DATA_DIR: lasting } };
  const exact = (await video.tickVideos(deps, owner, { session: '2026-11-03' }, new Date('2026-11-04T05:00:00Z'))).body;
  assert.equal(exact.waiting, 'report', 'a named session never falls back to another day');
  const rolled = (await video.tickVideos(deps, owner, {}, new Date('2026-11-04T05:00:00Z'))).body;
  assert.equal(rolled.session, SESSION);
  assert.deepEqual(rolled.videos.map((v) => v.status).sort(), ['pending', 'ready']);
  assert.ok(rolled.videos.every((v) => v.session === SESSION));
});

test('a report with no connected accounts says there is nothing to film', async (t) => {
  const pool = await database(t), lasting = lastingDir(t), owner = 'films-owner-' + randomUUID();
  await pool.query('INSERT INTO trading_oshal_reports (user_sub,report_id,session_date,payload,created_at) VALUES ($1,$2,$3,$4,now())',
    [owner, 'daily-' + SESSION, SESSION, JSON.stringify({ ...savedReport(), live: [] })]);
  const calls = [];
  const body = (await video.tickVideos({ pool, intent: speechIntent(calls), env: { OSHAL_PACKAGE_DATA_DIR: lasting } }, owner, { session: SESSION }, new Date())).body;
  assert.equal(body.waiting, 'accounts');
  assert.match(body.message, /no connected accounts/);
  assert.equal(body.done, undefined, 'never reported as films ready');
  assert.deepEqual(body.videos, []);
  assert.equal(calls.length, 0);
});

test('a failing speech service fails the account with its reason and leaves no file', async (t) => {
  const pool = await database(t), lasting = lastingDir(t), owner = 'films-owner-' + randomUUID();
  await saveReport(pool, owner);
  const deps = { pool, env: { OSHAL_PACKAGE_DATA_DIR: lasting }, intent: async () => { throw new Error('the installation\'s speech service is unavailable'); } };
  const state = (await video.tickVideos(deps, owner, { session: SESSION }, new Date())).body;
  const failed = state.videos.find((v) => v.status === 'failed');
  assert.ok(failed && /narration failed: the installation's speech service is unavailable/.test(failed.detail), JSON.stringify(state.videos));
  assert.deepEqual(fs.readdirSync(path.join(lasting, 'report-videos', video.dirOf(owner), SESSION)), []);
  const listing = await video.listVideos(deps, owner);
  assert.equal(listing.body.ok, true);
  assert.equal(listing.body.presenter.present, false);
});

test('the presenter clip is an MP4 of at most 4 MiB in the caller\'s own directory, and storage must exist', async (t) => {
  const lasting = lastingDir(t), owner = 'films-owner-' + randomUUID(), deps = { env: { OSHAL_PACKAGE_DATA_DIR: lasting } };
  await assert.rejects(video.savePresenterClip(deps, owner, { dataBase64: Buffer.from('not a video at all').toString('base64') }),
    (err) => err.status === 400 && err.code === 'clip_not_mp4');
  await assert.rejects(video.savePresenterClip(deps, owner, { dataBase64: 'A'.repeat(5_600_001) }), (err) => err.status === 413);
  const mp4 = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypisom'), Buffer.alloc(32)]);
  assert.equal((await video.savePresenterClip(deps, owner, { dataBase64: mp4.toString('base64') })).body.bytes, mp4.length);
  assert.deepEqual(fs.readdirSync(path.join(lasting, 'report-videos')), [video.dirOf(owner)]);
  await assert.rejects(video.savePresenterClip({ env: {} }, owner, { dataBase64: mp4.toString('base64') }),
    (err) => err.status === 503 && err.code === 'no_lasting_store');
});
