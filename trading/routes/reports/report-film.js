/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | The OSHAL report film, rendered inside Trading's own sandbox: themed slides drawn by the installation's ffmpeg (drawtext with the image's DejaVu fonts), narration from the kernel's voice.speak (the installation's own speech settings), the owner's silent presenter clip in the corner, one mp4 per connected account written into the package's lasting storage. Nothing is installed on the host, nothing leaves the installation.
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');

const W = 1280, H = 720, VOICE = 'am_michael', FPS = 30;
const COLOR = { bg: '0x0b1322', ink: '0xe8eef9', dim: '0x8ea0bf', accent: '0x37d29a', rule: '0x223150' };
const FONT_DIR = '/usr/share/fonts/truetype/dejavu';
const FONT = { sans: `${FONT_DIR}/DejaVuSans.ttf`, bold: `${FONT_DIR}/DejaVuSans-Bold.ttf`, mono: `${FONT_DIR}/DejaVuSansMono.ttf` };
const LABEL_X = 64, VALUE_RIGHT = 905, PAIR_GAP = 28;
// Widths are estimated, never measured: DejaVu Sans stays under 0.62 em per character and DejaVu Sans Mono is
// exactly 0.6021 em, so a value placed by these figures can only end up further from its label than planned.
const SANS_EM = 0.62, MONO_EM = 0.6021;
const SPEECH_MAX = 2900, STEP_MS = 40_000;

/**
 * @description Text as drawtext must receive it. The kernel image's ffmpeg (6.1) drops one trailing character per
 * extra UTF-8 byte (a "·" costs one, a "—" two); the same number of trailing spaces absorbs exactly that loss and
 * is not measured into `tw`, so right-aligned values keep their edge.
 */
const drawable = (text) => text + ' '.repeat(Buffer.byteLength(text) - [...text].length);
const commas = (digits) => digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
/** @description A dollar figure for a slide: exact cents, thousands separated. */
function money(value) {
  if (value == null || !Number.isFinite(Number(value))) return '—';
  const [whole, cents] = Math.abs(Number(value)).toFixed(2).split('.');
  return `${Number(value) < 0 ? '$-' : '$'}${commas(whole)}.${cents}`;
}
/** @description A dollar figure the voice reads smoothly; the slide keeps the exact cents. */
function spokenMoney(value) {
  if (value == null || !Number.isFinite(Number(value))) return 'an unknown amount';
  const whole = Math.round(Number(value));
  return `${whole < 0 ? 'minus ' : ''}${commas(String(Math.abs(whole)))} dollars`;
}
/** @description A short all-letter ticker is spelled out so the voice never guesses a word. */
function spokenSymbol(symbol) {
  const s = String(symbol || '');
  return /^[A-Za-z]{1,4}$/.test(s) ? s.split('').join(' ') : s.replace(/\./g, ' dot ');
}
const titleCase = (s) => String(s || '').charAt(0).toUpperCase() + String(s || '').slice(1).toLowerCase();
const shares = (q) => String(Number(q));
const clip = (text) => (text.length <= SPEECH_MAX ? text : `${text.slice(0, SPEECH_MAX).replace(/[^.]*$/, '')}`.trim() || text.slice(0, SPEECH_MAX));

/**
 * @description The slide deck and narration for one connected account, from the saved OSHAL report payload.
 * @param {object} report - The saved report (sessionDate, presenter, headlines).
 * @param {object} account - One entry of report.live.
 * @returns {Array<{kind:string,title:string,lines:Array,say:string}>} Five slides.
 */
function accountSlides(report, account) {
  const label = account.label || 'Connected account', session = report.sessionDate || '';
  const act = account.activity || {}, today = act.today || {}, fills = act.todayFills || [];
  const positions = [...(account.positions || [])].sort((a, b) => (b.marketValue || 0) - (a.marketValue || 0));
  const equity = account.equity, presenter = report.presenter || 'the OSHAL market desk';
  const authority = account.authority || 'off', watcher = account.protectionAuthority || 'off';
  const slides = [{ kind: 'title', title: 'The OSHAL report', lines: [label, session],
    say: `This is the OSHAL report for ${session}. I'm ${presenter}, with the ${label} account.` }];
  slides.push({ kind: 'rows', title: 'The account', lines: [['Current equity', money(equity)], ['Cash', money(account.cash)],
    ['Assigned research', account.strategyName || '—'], ['Native strategy authority', authority], ['Watcher exit authority', watcher]],
  say: `${label} stands at ${spokenMoney(equity)} current equity, with ${spokenMoney(account.cash)} in cash. `
    + `Assigned research: ${account.strategyName || 'none'}. Strategy authority is ${authority}; watcher exits are ${watcher}.` });
  let fillRows = fills.slice(0, 11).map((f) => [`${titleCase(f.side)} ${f.quantity} ${f.symbol}`, `${money(f.price)} · ${money(f.notional)}`]);
  if (fills.length > 11) fillRows.push([`… and ${fills.length - 11} more`, '']);
  const spokenFills = fills.slice(0, 5).map((f) => `${f.side === 'BUY' ? 'Bought' : 'Sold'} ${f.quantity} ${spokenSymbol(f.symbol)} at ${spokenMoney(f.price)}`).join('. ');
  let say = `Today the account reported ${today.fills || 0} executions across ${today.orders || 0} orders: `
    + `buys ${spokenMoney(today.buyGross)}, sells ${spokenMoney(today.sellGross)}, before fees.`;
  if (act.status === 'unavailable') {
    say = 'Broker execution history could not be verified for this account today. No zero-trade day is inferred.';
    fillRows = [['Broker trade history unavailable', '']];
  } else if (spokenFills) say += ` ${spokenFills}.${fills.length > 5 ? ' The remaining fills are on screen.' : ''}`;
  slides.push({ kind: 'rows', title: `Today's trades — ${session}`, lines: fillRows.length ? fillRows : [['No executions reported today', '']], say });
  const posRows = positions.slice(0, 12).map((p) => [`${p.symbol} · ${shares(p.qty)} shares`,
    `${money(p.marketValue)}${equity ? ` · ${Math.round((100 * p.marketValue) / equity)}%` : ''}`]);
  if (positions.length > 12) posRows.push([`… and ${positions.length - 12} more`, '']);
  const top = positions.slice(0, 3).map((p) => `${spokenSymbol(p.symbol)} at ${spokenMoney(p.marketValue)}`).join(', ');
  slides.push({ kind: 'rows', title: 'Positions', lines: posRows.length ? posRows : [['No positions', '']],
    say: `The account holds ${positions.length} positions.${top ? ` The largest: ${top}.` : ''}` });
  const headlines = report.headlines || [];
  slides.push({ kind: 'rows', title: 'The desk', lines: headlines.map((h) => [h, '']),
    say: `${headlines.join(' ')} Backtests are historical simulations, not live results or a forecast. A balance snapshot is not a measured investment return.` });
  return slides.map((s) => ({ ...s, say: clip(s.say) }));
}

/**
 * @description Where one label/value row goes. A value that clears its label shares the row; a longer one drops to
 * its own row in a smaller face, cut with an ellipsis if it still does not fit (the presenter overlay owns the
 * space right of the value column).
 * @param {string} left - The label.
 * @param {string} right - The value.
 * @returns {{texts:Array<{text:string,x:number|string,dy:number,size:number,font:string,color:string}>, height:number}} Placement.
 */
function pairLayout(left, right) {
  const labelEnd = LABEL_X + left.length * 26 * SANS_EM;
  const label = { text: left, x: LABEL_X, dy: 0, size: 26, font: FONT.sans, color: COLOR.ink };
  if (VALUE_RIGHT - right.length * 26 * MONO_EM >= labelEnd + PAIR_GAP) {
    return { texts: [label, { text: right, x: `${VALUE_RIGHT}-tw`, dy: 0, size: 26, font: FONT.mono, color: COLOR.accent }], height: 42 };
  }
  const fit = Math.floor((VALUE_RIGHT - LABEL_X - 32) / (22 * MONO_EM));
  const value = right.length <= fit ? right : `${right.slice(0, fit - 1).trimEnd()}…`;
  return { texts: [label, { text: value, x: `${VALUE_RIGHT}-tw`, dy: 36, size: 22, font: FONT.mono, color: COLOR.accent }], height: 78 };
}

/** @description Break a paragraph into lines that fit `width` pixels of 26 px DejaVu Sans. */
function wrap(text, width) {
  const max = Math.floor(width / (26 * SANS_EM)), lines = [];
  let line = '';
  for (const word of String(text).split(/\s+/).filter(Boolean)) {
    const trial = line ? `${line} ${word}` : word;
    if (trial.length <= max) line = trial;
    else { if (line) lines.push(line); line = word; }
  }
  return line ? [...lines, line] : lines;
}

/**
 * @description Every text a slide draws, with its place, face and color, in the report theme.
 * @param {object} slide - One entry of accountSlides.
 * @param {string} session - The session date for the header.
 * @returns {Array<object>} Text placements (x may be an ffmpeg expression such as "905-tw").
 */
function slideTexts(slide, session) {
  const texts = [{ text: slide.title, x: 64, y: 44, size: 44, font: FONT.bold, color: COLOR.ink },
    { text: `The OSHAL report · ${session}`, x: `${W - 64}-tw`, y: 58, size: 22, font: FONT.sans, color: COLOR.dim },
    { text: 'Private to the account owner · generated by your oshal installation', x: 64, y: H - 44, size: 18, font: FONT.sans, color: COLOR.dim }];
  if (slide.kind === 'title') {
    texts.push({ text: slide.lines[0], x: 64, y: 230, size: 58, font: FONT.bold, color: COLOR.accent },
      { text: slide.lines[1], x: 64, y: 320, size: 34, font: FONT.sans, color: COLOR.ink },
      { text: 'A private briefing, generated by your oshal installation', x: 64, y: 390, size: 26, font: FONT.sans, color: COLOR.dim });
    return texts;
  }
  let y = 152;
  for (const [left, right] of slide.lines.slice(0, 14)) {
    if (right) {
      const { texts: row, height } = pairLayout(String(left), String(right));
      for (const t of row) texts.push({ ...t, y: y + t.dy });
      y += height;
    } else {
      for (const line of wrap(left, 1100).slice(0, 3)) { texts.push({ text: line, x: 64, y, size: 26, font: FONT.sans, color: COLOR.ink }); y += 40; }
      y += 4;
    }
    if (y > H - 80) break;
  }
  return texts;
}

/** @description The real length of a WAV from the bytes present (the speech service's header may not say). */
function wavSeconds(data) {
  let pos = 12, rate = 0, channels = 0, bits = 0;
  while (pos + 8 <= data.length) {
    const chunk = data.toString('latin1', pos, pos + 4), size = data.readUInt32LE(pos + 4);
    if (chunk === 'fmt ') { channels = data.readUInt16LE(pos + 10); rate = data.readUInt32LE(pos + 12); bits = data.readUInt16LE(pos + 22); }
    else if (chunk === 'data') return rate && channels && bits ? (data.length - pos - 8) / (rate * channels * (bits / 8)) : 0;
    pos += 8 + size + (size & 1);
  }
  return 0;
}

/** @description Run one ffmpeg/ffprobe step with a deadline; the error carries ffmpeg's own last words. */
function tool(binary, args, timeout = STEP_MS) {
  return new Promise((resolve, reject) => {
    execFile(binary, args, { timeout, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(new Error(`${path.basename(binary)} failed: ${String(stderr || err.message).trim().slice(-500)}`));
      else resolve(String(stdout));
    });
  });
}

async function paintSlide(slide, session, work, n) {
  const filters = [`drawbox=x=0:y=0:w=${W}:h=7:color=${COLOR.accent}:t=fill`, `drawbox=x=64:y=116:w=${W - 128}:h=2:color=${COLOR.rule}:t=fill`];
  slideTexts(slide, session).forEach((t, k) => {
    const file = path.join(work, `t${n}-${k}.txt`);
    fs.writeFileSync(file, drawable(t.text));
    filters.push(`drawtext=fontfile=${t.font}:textfile=${file}:expansion=none:fontsize=${t.size}:fontcolor=${t.color}:x=${t.x}:y=${t.y}`);
  });
  const png = path.join(work, `s${n}.png`);
  await tool('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', `color=c=${COLOR.bg}:s=${W}x${H}:d=1`,
    '-vf', filters.join(','), '-frames:v', '1', png]);
  return png;
}

/**
 * @description Render one account's film into the owner's session directory.
 * @param {object} job - {report, account, dir (owner session dir), presenter (path or null), speak(text, voice) → Buffer}.
 * @returns {Promise<{file:string,bytes:number,seconds:number}>} The finished file.
 */
async function renderAccount(job) {
  const { report, account, dir, presenter, speak, file } = job;
  const session = report.sessionDate || '';
  const work = path.join(dir, `.work-${file.replace(/\.mp4$/, '')}`);
  fs.rmSync(work, { recursive: true, force: true });
  fs.mkdirSync(work, { recursive: true, mode: 0o700 });
  try {
    const segments = [];
    for (const [n, slide] of accountSlides(report, account).entries()) {
      const png = await paintSlide(slide, session, work, n);
      const wav = path.join(work, `s${n}.wav`), seg = path.join(work, `s${n}.mp4`);
      const audio = await speak(slide.say, VOICE);
      const spoken = wavSeconds(audio);
      if (!(spoken > 0 && spoken < 600)) throw new Error(`narration came back ${Math.round(spoken)}s long; refusing to encode it`);
      fs.writeFileSync(wav, audio);
      const seconds = (spoken + 0.8).toFixed(2);
      await tool('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-loop', '1', '-framerate', String(FPS), '-i', png, '-i', wav,
        '-af', `apad=whole_dur=${seconds}`, '-t', seconds, '-c:v', 'libx264', '-tune', 'stillimage', '-preset', 'veryfast',
        '-crf', '23', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-ar', '44100', seg]);
      segments.push(seg);
    }
    const list = path.join(work, 'join.txt'), joined = path.join(work, 'joined.mp4'), out = path.join(work, 'out.mp4');
    fs.writeFileSync(list, segments.map((s) => `file '${s}'\n`).join(''));
    await tool('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', joined]);
    if (presenter && fs.existsSync(presenter)) {
      await tool('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', joined, '-stream_loop', '-1', '-i', presenter,
        '-filter_complex', '[1:v]scale=300:-2[p];[0:v][p]overlay=W-w-28:H-h-28[v]', '-map', '[v]', '-map', '0:a',
        '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '21', '-pix_fmt', 'yuv420p', '-c:a', 'copy', '-shortest', out]);
    } else fs.renameSync(joined, out);
    const target = path.join(dir, file);
    fs.renameSync(out, target);
    fs.chmodSync(target, 0o600);
    return { file, bytes: fs.statSync(target).size, seconds: await probeSeconds(target) };
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

/** @description A finished file's playing time, from ffprobe. */
async function probeSeconds(file) {
  const out = await tool('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], 15_000);
  return Math.round(Number(out.trim() || 0) * 10) / 10;
}

module.exports = { accountSlides, pairLayout, slideTexts, wavSeconds, renderAccount, probeSeconds, drawable, money, spokenMoney, spokenSymbol, FONT, VOICE };
