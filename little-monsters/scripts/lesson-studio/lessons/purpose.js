/*
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com | Match the writing goal: a pile of true-fact cards, a target that darts hit or miss as each fact is judged, off-target choice cards knocked off the board, and a magnifier searching the notes for a claim that is not there
 */
(function () {
  const DARK = '#1d3a31', PAPER = '#f5f3ea', MINT = '#8fe6cf', SUN = '#ffd66b', CORAL = '#ff8080';

  const TARGET = `<circle cx="100" cy="100" r="96" fill="#ff8080"/><circle cx="100" cy="100" r="66" fill="#f5f3ea"/><circle cx="100" cy="100" r="36" fill="#ff8080"/><circle cx="100" cy="100" r="12" fill="#ffd66b"/>`;
  const DART_W = 220, DART_H = 76;
  const DART = `<path d="M2,4 L70,38 L2,72 L24,38 Z" fill="${SUN}" stroke="${DARK}" stroke-width="4" stroke-linejoin="round"/>
    <rect x="58" y="25" width="100" height="26" rx="10" fill="#9fd0ff" stroke="${DARK}" stroke-width="4"/>
    <path d="M154,27 L220,38 L154,49 Z" fill="#eef2f6" stroke="${DARK}" stroke-width="4" stroke-linejoin="round"/>`;
  const TICK = (x, y) => `<path class="tick" d="M${x},${y} l22,24 l42,-54" fill="none" stroke="#1f9e80" stroke-width="13" stroke-linecap="round" stroke-linejoin="round"/>`;
  const FACT_CARD = `<rect class="glow" x="-8" y="-8" width="266" height="166" rx="22" fill="none" stroke="${SUN}" stroke-width="10" style="opacity:0"/>
    <rect x="3" y="3" width="244" height="144" rx="14" fill="${PAPER}" stroke="${DARK}" stroke-width="3"/>${TICK(26, 76)}
    <text x="102" y="94" font-family="Fredoka" font-weight="600" font-size="60" fill="${DARK}">True</text>`;
  const NOTES = `<g transform="rotate(1 230 145)"><rect x="3" y="3" width="454" height="284" rx="12" fill="${PAPER}" stroke="${DARK}" stroke-width="3"/>
    <text x="230" y="56" text-anchor="middle" font-family="Fredoka" font-weight="600" font-size="46" fill="#b23a63">The notes</text>
    <g font-family="Chalk" font-size="60" fill="${DARK}"><text x="26" y="124">brick walls</text><text x="26" y="194">evening hours</text><text x="26" y="264">step-free entrance</text></g></g>`;
  const LENS = `<circle cx="60" cy="60" r="54" fill="rgba(159,208,255,.3)" stroke="${DARK}" stroke-width="12"/><path d="M100,100 L150,150" stroke="${DARK}" stroke-width="19" stroke-linecap="round"/>`;
  const PILE = [[320, 440, -14], [610, 370, 9], [900, 440, 16], [450, 550, 7], [780, 560, -9], [600, 470, -4]];

  const angleTo = (a, b) => (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;

  /** Where a written line ends, so what follows it can sit right after its last word. */
  function endOf(line) {
    const last = line.w[line.w.length - 1];
    return { x: line.offsetLeft + last.offsetLeft + last.offsetWidth, y: line.offsetTop + line.offsetHeight / 2 };
  }

  /** A target centered on a board point. */
  function target(s, x, y, r, at) {
    const g = s.shape(TARGET, { x: x - r, y: y - r, w: 2 * r, h: 2 * r });
    g.setAttribute('viewBox', '0 0 200 200');
    s.pop(g, at, { gain: 0.8 });
    return g;
  }

  /** A dart with its nose on a board point, already aimed at the next. It grows out of that point. */
  function dart(s, nose, toward, at) {
    const d = s.shape(DART, { x: nose.x - DART_W, y: nose.y - DART_H / 2, w: DART_W, h: DART_H });
    s.pop(d, at, { gain: 0.3 });
    d.style.transformOrigin = '100% 50%';
    d._nose = nose;
    d._at = nose;
    d._angle = angleTo(nose, toward);
    d.style.rotate = d._angle + 'deg';
    return d;
  }

  /** Throw a dart through board points, turning along its path. */
  function fly(s, d, points, t, dur) {
    const frames = [{ translate: '0px 0px', rotate: d._angle + 'deg' }];
    points.forEach((p) => {
      d._angle = angleTo(d._at, p);
      d._at = p;
      frames.push({ translate: `${p.x - d._nose.x}px ${p.y - d._nose.y}px`, rotate: d._angle + 'deg' });
    });
    s.anim(d, frames, t, dur, 'linear');
    s.sfx('whoosh', t, 0.6);
  }

  /** A dart that sticks: it shivers and the target jolts. */
  function stick(s, d, g, t) {
    const a = d._angle;
    s.anim(d, [{ rotate: `${a + 9}deg` }, { rotate: `${a - 5}deg`, offset: 0.45 }, { rotate: `${a}deg` }], t, 0.36, 'ease-out');
    s.pulse(g, t, { to: 1.07, dur: 0.3 });
    s.sfx('pop', t, 0.8);
  }

  /** A dart that missed drops off the board. */
  function fall(s, d, t) {
    const dx = d._at.x - d._nose.x, dy = d._at.y - d._nose.y;
    s.anim(d, [{ translate: `${dx}px ${dy}px`, rotate: `${d._angle}deg` }, { translate: `${dx + 24}px ${dy + 900}px`, rotate: `${d._angle + 130}deg` }], t, 0.8, 'cubic-bezier(.5,0,.9,.6)');
  }

  /** The pile of true facts: cards drop onto the board one after another. */
  function factPile(s, at) {
    return PILE.map(([x, y, r], i) => {
      const n = s.shape(FACT_CARD, { x: x - 125, y: y - 75, w: 250, h: 150 });
      const when = at + i * 0.13;
      n.style.translate = '0px -900px';
      s.anim(n, [{ translate: '0px -900px', rotate: `${r + 50}deg` }, { translate: '0px 0px', rotate: `${r}deg` }], when, 0.4, 'cubic-bezier(.4,.7,.5,1)');
      s.sfx('pop', when + 0.3, 0.3);
      n._rest = { x, y, r };
      return n;
    });
  }

  /** One lettered answer choice, with a tick that can draw itself. */
  function choice(s, letter, x, y, at) {
    const n = s.shape(`<rect x="3" y="3" width="224" height="170" rx="16" fill="${PAPER}" stroke="${DARK}" stroke-width="3"/>
      <text x="74" y="124" text-anchor="middle" font-family="Fredoka" font-weight="600" font-size="104" fill="${DARK}">${letter}</text>${TICK(136, 96)}`, { x, y, w: 230, h: 176 });
    s.pop(n, at, { gain: 0.5 });
    return n;
  }

  /** Knock a card off the board: it tumbles away sideways, clear of the line being read below it. */
  function knockOff(s, n, t, dir) {
    s.anim(n, [{ translate: '0px 0px', rotate: '0deg' }, { translate: `${dir * 1100}px -70px`, rotate: `${dir * 70}deg` }], t, 0.6, 'cubic-bezier(.5,0,.9,.6)');
    s.sfx('whoosh', t, 0.4);
  }

  LessonStudio.define({
    id: 'purpose',
    teacher: 'bluebold',
    title: 'Match the writing goal',
    beats: [
      {
        say: `{hi}Hi, Bluebold here! {pile}These questions give you a pile of true choices. {only}But only one of them does the job.`,
        run(s, c) {
          s.m.act('enter', c.start - 0.75, 0.4);
          s.faceCam(0, 0.01);
          s.m.act('wave', c.hi, 1.2);
          s.wideCam(c.pile - 0.3, 1.1);
          s.text('Match the writing goal', { y: 84, size: 96, color: s.ink.yellow, at: c.pile + 0.3, dur: 1.1 });
          const cards = factPile(s, c.word('pile'));
          const best = cards[cards.length - 1];
          cards.slice(0, -1).forEach((n) => s.anim(n, [{ opacity: 1 }, { opacity: 0.22 }], c.only, 0.35));
          const { x, y, r } = best._rest;
          s.anim(best, [{ translate: '0px 0px', rotate: `${r}deg`, scale: 1 }, { translate: `${614 - x}px ${400 - y}px`, rotate: '0deg', scale: 1.3 }], c.word('one'), 0.5, 'cubic-bezier(.3,1.4,.5,1)');
          s.appear(best.get('.glow'), c.word('one'), 0.25);
          s.tag('does the job', { x: 614, y: 540, at: c.word('does'), bg: SUN, size: 64 });
          s.m.point({ x: 614, y: 400 }, c.only, 1.4);
          s.m.mood('sly', c.only, 1.8);
        },
      },
      {
        page: 'The idea',
        say: `{goal}The writer has a goal. {serve}The right answer has to serve that exact goal, {fact}using facts that are actually supported.`,
        run(s, c) {
          const AIM = { x: 1000, y: 270 };
          const first = s.spoken('The writer has a goal.', c, c.goal, { x: 50, y: 84, size: 92, align: 'left' });
          const g = target(s, AIM.x, AIM.y, 135, c.word('goal'));
          s.mark(first.find('goal'), c.word('goal') + 0.1);
          s.tag('the goal', { x: AIM.x, y: 412, at: c.word('goal') + 0.1, bg: CORAL, size: 50 });
          s.tag('The right answer', { x: 50, y: 216, at: c.serve, bg: SUN, size: 58, align: 'left' });
          const d = dart(s, { x: 815, y: 262 }, AIM, c.serve);
          const job = s.spoken('Serve that exact goal,', c, c.word('serve'), { x: 50, y: 334, size: 96, align: 'left' });
          s.mark(job.find('exact'), c.word('exact'));
          fly(s, d, [AIM], c.word('exact'), 0.34);
          stick(s, d, g, c.word('exact') + 0.34);
          s.m.point(g, c.serve, 1.6);
          const facts = s.spoken('using facts that are actually supported.', c, c.fact, { x: 50, y: 510, size: 72, align: 'left' });
          s.mark(facts.find('supported'), c.word('supported') + 0.15, { color: MINT });
          s.m.look('board', c.fact, 1.6);
        },
      },
      {
        page: 'Watch me',
        say: `{goal}Goal: emphasize that a library is accessible. {three}Now, here are the notes: three true facts. {a}It has brick walls. {b}It is open in the evening. {d}It has a step-free entrance.`,
        run(s, c, v) {
          s.spoken('Goal: emphasize that', c, c.goal, { x: 50, y: 76, size: 80, align: 'left', color: s.ink.yellow });
          v.goal = s.spoken('a library is accessible.', c, c.word('a'), { x: 50, y: 160, size: 80, align: 'left', color: s.ink.yellow });
          v.g = target(s, 1000, 235, 135, c.goal);
          s.mark(v.goal.find('accessible'), c.word('accessible') + 0.3);
          s.m.point(v.g, c.goal, 1.2);
          v.header = s.tag('Three true facts', { x: 50, y: 262, at: c.word('three'), bg: MINT, size: 46, align: 'left' });
          v.a = s.spoken('It has brick walls.', c, c.a, { x: 50, y: 340, size: 76, align: 'left' });
          v.b = s.spoken('It is open in the evening.', c, c.b, { x: 50, y: 440, size: 76, align: 'left' });
          v.d = s.spoken('It has a step-free entrance.', c, c.d, { x: 50, y: 540, size: 76, align: 'left' });
          s.m.look('board', c.three, 4);
        },
      },
      {
        say: `{br}Brick walls? {tr}True. {but}But do they make the library easier to visit? {no}No. {gone}Gone. {ev}Evening hours {st}and a step-free entrance? {yes}Those do the job.`,
        run(s, c, v) {
          s.hide(v.header, c.br);
          s.m.point(v.a, c.br, 1.2);
          s.mark(v.a.find('brick'), c.word('brick'), { hold: c.gone - c.word('brick') });
          s.mark(v.a.find('walls'), c.word('walls'), { hold: c.gone - c.word('walls') });
          const end = endOf(v.a);
          s.tag('True', { x: end.x + 30, y: end.y - 36, at: c.tr, bg: MINT, size: 46, align: 'left' });
          const ring = s.circle(v.goal.find('accessible'), c.word('easier'), { pad: 7 });
          const miss = dart(s, { x: 800, y: 396 }, { x: 1000, y: 430 }, c.no - 0.4);
          fly(s, miss, [{ x: 1000, y: 430 }, { x: 1192, y: 440 }], c.no - 0.4, 0.5);
          s.sfx('boing', c.no + 0.1, 0.6);
          s.m.act('shake', c.no, 0.7);
          s.m.mood('oops', c.no, 0.9);
          s.strike(v.a, c.gone, { dim: 0.3 });
          s.hide(ring, c.gone);
          s.sfx('poof', c.gone, 0.8);
          fall(s, miss, c.gone);

          s.m.point(v.b, c.ev, 0.9);
          s.mark(v.b.find('evening'), c.word('evening'), { color: MINT });
          s.mark(v.b.find('open'), c.word('hours'), { color: MINT });
          s.m.point(v.d, c.st, 1);
          s.mark(v.d.w[3], c.word('step-free'), { color: MINT });
          s.mark(v.d.w[4], c.word('entrance'), { color: MINT });
          const bEnd = endOf(v.b), dEnd = endOf(v.d);
          const one = dart(s, { x: bEnd.x + 20, y: bEnd.y }, { x: 990, y: 226 }, c.yes);
          fly(s, one, [{ x: 990, y: 226 }], c.yes, 0.3);
          stick(s, one, v.g, c.yes + 0.3);
          const two = dart(s, { x: dEnd.x + 20, y: dEnd.y }, { x: 1012, y: 244 }, c.yes + 0.22);
          fly(s, two, [{ x: 1012, y: 244 }], c.yes + 0.22, 0.3);
          stick(s, two, v.g, c.yes + 0.52);
          s.stars({ x: 1000, y: 235 }, c.yes + 0.55, 10);
          s.m.look(v.g, c.yes, 1.2);
          s.m.act('thumbs', c.yes, 1.2);
          s.m.mood('proud', c.yes, 1.4);
        },
      },
      {
        page: 'Your turn',
        chipColor: '#ff9ccf',
        say: `{go}Your turn. {g}Goal: show that a park is good for families. Choice {a}A: it was built in nineteen fifty. Choice {b}B: it has a playground and picnic tables. {ask}Which one? {try}Go.`,
        pause: 5.2,
        run(s, c, v) {
          const letter = (l) => `<span style="color:${s.ink.pink}">${l}</span>`;
          s.spoken('Goal: show that a park', c, c.g, { x: 50, y: 76, size: 84, align: 'left', color: s.ink.yellow });
          const goal = s.spoken('is good for families.', c, c.word('is'), { x: 50, y: 160, size: 84, align: 'left', color: s.ink.yellow });
          s.mark(goal.find('families'), c.word('families') + 0.3);
          v.g = target(s, 1000, 300, 120, c.g);
          const times = c.from(c.a, 6).map((w) => w.t0);
          v.a = s.words([letter('A'), 'It', 'was', 'built', 'in', '1950.'], { x: 50, y: 285, size: 76, align: 'left', times });
          v.b = s.spoken([letter('B'), 'It', 'has', 'a', 'playground'], c, c.b, { x: 50, y: 395, size: 76, align: 'left' });
          v.b2 = s.spoken('and picnic tables.', c, c.word('and'), { x: 50 + v.b.w[1].offsetLeft, y: 480, size: 76, align: 'left' });
          s.m.point(v.a, c.a, 1);
          s.m.point(v.b, c.b, 1.2);
          v.which = s.tag('Which one?', { x: 400, y: 590, at: c.ask, bg: SUN, size: 60 });
          s.m.act('think', c.try + 0.2, 4.6);
          s.m.mood('hmm', c.try + 0.2, 4.6);
          s.countdown(c.end + 0.3, 5, { x: 1080, y: 18 });
        },
      },
      {
        gap: 0.1,
        say: `{ans}B! {why}The date is true, {but}but it doesn't do the job.`,
        run(s, c, v) {
          s.hide(v.which, c.ans - 0.1, 0.1);
          s.tag('B does the job', { x: 400, y: 590, at: c.ans, bg: MINT, size: 60 });
          s.mark(v.b.find('playground'), c.ans, { color: MINT });
          s.mark(v.b2.find('picnic'), c.ans + 0.12, { color: MINT });
          s.mark(v.b2.find('tables'), c.ans + 0.22, { color: MINT });
          const bEnd = endOf(v.b2);
          const good = dart(s, { x: bEnd.x + 20, y: bEnd.y }, { x: 1000, y: 300 }, c.ans);
          fly(s, good, [{ x: 1000, y: 300 }], c.ans, 0.36);
          stick(s, good, v.g, c.ans + 0.36);
          s.stars({ x: 1000, y: 300 }, c.ans + 0.38, 10);
          s.m.look(v.g, c.ans, 0.6);
          s.m.act('cheer', c.ans, 1);
          s.m.mood('proud', c.ans, 2);

          s.mark(v.a.find('1950'), c.word('date'), { hold: c.word('job') - c.word('date') });
          s.m.point(v.a, c.why, 1.1);
          const end = endOf(v.a);
          s.tag('True', { x: end.x + 30, y: end.y - 36, at: c.word('true'), bg: MINT, size: 46, align: 'left' });
          const miss = dart(s, { x: 836, y: 394 }, { x: 1000, y: 456 }, c.but);
          fly(s, miss, [{ x: 1000, y: 456 }, { x: 1192, y: 462 }], c.but, 0.5);
          s.sfx('boing', c.but + 0.5, 0.6);
          s.strike(v.a, c.word('job'), { dim: 0.35 });
          fall(s, miss, c.word('job') + 0.2);
        },
      },
      {
        page: 'A faster way',
        chipColor: '#8fe6cf',
        say: `{read}So read the goal first, {before}before the choices. {then}Then eliminate anything that's accurate, but off target.`,
        run(s, c) {
          target(s, 130, 150, 70, c.word('goal'));
          const first = s.spoken('Read the goal first', c, c.word('read'), { x: 224, y: 94, size: 100, align: 'left', color: s.ink.yellow });
          s.mark(first.find('first'), c.word('first') + 0.2);
          s.m.point(first, c.read, 1.2);
          const cards = ['A', 'B', 'C', 'D'].map((l, i) => choice(s, l, 70 + i * 270, 244, c.word('choices') + i * 0.12));
          s.m.look('board', c.before, 2);
          s.m.point(cards[2], c.then, 1.1);
          cards.forEach((n, i) => s.draw(n.get('.tick'), c.word('accurate') + i * 0.1, 0.22));
          s.spoken(['Accurate,', 'but', 'off', 'target?'], c, c.word('accurate'), { x: 50, y: 470, size: 92, align: 'left' });
          [[3, 1], [2, 1], [0, -1]].forEach(([i, dir], k) => knockOff(s, cards[i], c.word('off') + k * 0.12, dir));
          s.tag('Out!', { x: 900, y: 476, at: c.word('target') + 0.2, bg: CORAL, size: 72, align: 'left' });
          s.pulse(cards[1], c.word('target') + 0.3, { to: 1.12, dur: 0.5 });
          s.m.mood('sly', c.word('accurate'), 1.8);
        },
      },
      {
        page: 'Watch out',
        chipColor: '#ff8080',
        say: `{but}But relevant isn't enough either. Back at the library, one choice says {ev}everyone can attend. {per}Sounds perfect for accessibility, right? {no}But nothing in the notes says that. {cant}You can't add a claim without evidence.`,
        run(s, c) {
          s.spoken(['Relevant', "isn't", 'enough'], c, c.word('relevant'), { x: 50, y: 80, size: 84, align: 'left', color: s.ink.yellow });
          const claim = s.spoken('Everyone can attend', c, c.ev, { x: 50, y: 190, size: 104, align: 'left', color: s.ink.teal });
          s.mark(claim.find('everyone'), c.ev + 0.15, { color: s.ink.pink, hold: c.word('add') - c.ev - 0.15 });
          const nice = s.tag('Sounds perfect', { x: 540, y: 324, at: c.word('perfect'), bg: MINT, size: 60, align: 'left' });
          s.m.mood('sly', c.per, 1.8);
          const notes = s.shape(NOTES, { x: 50, y: 316, w: 460, h: 290 });
          s.pop(notes, c.word('notes'));
          s.m.point(notes, c.word('notes'), 1.2);
          const lens = s.shape(LENS, { x: 60, y: 366, w: 160, h: 160 });
          s.pop(lens, c.word('notes'), { gain: 0.3 });
          const sweep = [[0, 0], [290, 0], [0, 70], [290, 70], [0, 140], [290, 140]];
          s.anim(lens, sweep.map(([x, y]) => ({ translate: `${x}px ${y}px` })), c.word('notes'), c.cant - c.word('notes'), 'linear');
          s.hide(nice, c.word('that') - 0.1, 0.1);
          s.tag('Not in the notes', { x: 540, y: 324, at: c.word('that'), bg: CORAL, size: 60, align: 'left' });
          s.hide(lens, c.cant);
          s.strike(claim, c.word('add'), { dim: 0.35 });
          s.spoken("You can't add a claim without evidence.", c, c.cant, { x: 50, y: 620, size: 72, align: 'left', color: s.ink.yellow });
          s.m.act('shake', c.cant, 0.8);
        },
      },
      {
        page: 'Remember',
        chipColor: '#ffd66b',
        say: `{tr}True is necessary. {job}But the answer must also do the requested job. {bye}Now hit Try this skill, and go hit the target!`,
        run(s, c) {
          const AIM = { x: 900, y: 530 };
          const line = s.spoken('True is necessary.', c, c.tr, { x: 50, y: 84, size: 92, align: 'left' });
          s.mark(line.find('true'), c.tr + 0.15, { color: MINT });
          s.spoken('But the answer must also', c, c.job, { x: 50, y: 196, size: 88, align: 'left' });
          const also = s.spoken('do the requested job.', c, c.word('do'), { x: 50, y: 288, size: 88, align: 'left' });
          s.mark(also.find('job'), c.word('job') + 0.15);
          s.m.mood('proud', c.job, 3);
          const g = target(s, AIM.x, AIM.y, 125, c.word('job'));
          s.tag('Next: Try this skill', { x: 340, y: 440, at: c.word('try'), bg: SUN, size: 60 });
          s.m.act('wave', c.bye, 2.2);
          const hit = c.word('hit', 1);
          const d = dart(s, { x: 480, y: 640 }, AIM, hit);
          fly(s, d, [AIM], hit, 0.42);
          stick(s, d, g, hit + 0.42);
          s.stars(AIM, hit + 0.44, 10);
          s.m.look(g, hit, 1.4);
          s.confetti(c.word('target'));
        },
      },
    ],
  });
})();
