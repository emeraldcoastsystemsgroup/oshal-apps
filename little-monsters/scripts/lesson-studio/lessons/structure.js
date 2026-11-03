/*
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com | Find each sentence's job: sentence cards slide in, job stickers fly onto them as each job is named, a reading frame walks down a passage, and a limitation bumps a claim that wobbles but stays standing
 */
(function () {
  const YELLOW = '#ffd66b', TEAL = '#8fe6cf', PINK = '#ff9ccf', BLUE = '#9fd0ff';
  /** Card rows on the Watch me page: top of each card. */
  const ROWS = [112, 320, 528];
  const CARD = { x: 60, w: 1030, h: 194 };

  /** Three empty cards, drawn as chalk outlines. Returns the shape. */
  function cards(s, at) {
    const g = s.shape(ROWS.map((y, i) => `<rect class="c${i}" x="${CARD.x}" y="${y}" width="${CARD.w}" height="${CARD.h}" rx="18" fill="rgba(245,243,234,.06)" stroke="rgba(245,243,234,.55)" stroke-width="5"/>`).join(''));
    ROWS.forEach((_, i) => s.draw(g.get(`.c${i}`), at + i * 0.15, 0.45, { gain: 0.3 }));
    return g;
  }

  /** A job sticker that flies in from the monster's side and lands at its spot. */
  function fly(s, text, { x, y, at, bg, size = 46, align = 'left' }) {
    const tag = s.tag(text, { x, y, at, bg, size, align });
    s.anim(tag, [{ translate: '720px 160px', rotate: '18deg' }, { translate: '0px 0px', rotate: '-3deg' }], at, 0.55, 'cubic-bezier(.3,1.25,.5,1)');
    s.sfx('whoosh', at, 0.5);
    return tag;
  }

  LessonStudio.define({
    id: 'structure',
    teacher: 'tealy',
    title: 'Find each sentence’s job',
    beats: [
      {
        say: `{hi}Tealy here. {job}Every sentence in a passage has a job. {ask}And test questions love to ask what that job is.`,
        run(s, c) {
          s.m.act('enter', c.start - 0.75, 0.4);
          s.faceCam(0, 0.01);
          s.m.act('wave', c.hi, 1);
          s.wideCam(c.job - 0.3, 1.1);
          s.text('Find each sentence’s job', { y: 90, size: 100, color: YELLOW, at: c.job + 0.2, dur: 1.1 });
          const strips = s.shape([300, 420, 540].map((y, i) => `<g class="s${i}"><rect x="120" y="${y}" width="820" height="84" rx="14" fill="rgba(245,243,234,.08)" stroke="rgba(245,243,234,.5)" stroke-width="5"/>
            <rect x="160" y="${y + 30}" width="${520 - i * 90}" height="22" rx="11" fill="rgba(245,243,234,.45)"/></g>`).join(''));
          [0, 1, 2].forEach((i) => s.anim(strips.get(`.s${i}`), [{ translate: '-1300px 0px' }, { translate: '0px 0px' }], c.word('sentence') + i * 0.18, 0.6, 'cubic-bezier(.3,1.1,.5,1)'));
          s.sfx('whoosh', c.word('sentence'), 0.5);
          ['Job?', 'Job?', 'Job?'].forEach((t, i) => s.tag(t, { x: 1040, y: 312 + i * 120, at: c.ask + 0.3 + i * 0.2, bg: PINK, size: 48 }));
          s.m.mood('sly', c.ask, 2);
        },
      },
      {
        page: 'The idea',
        say: `{four}Mostly, sentences do four jobs. {a}They introduce a claim. {b}They give evidence. {d}They admit a limitation. {e}Or they contrast ideas.`,
        run(s, c) {
          const jobs = [['Claim', 'what the writer says', 320, 110, c.a, YELLOW], ['Evidence', 'what backs it up', 900, 110, c.b, TEAL],
            ['Limitation', 'what holds it back', 320, 400, c.d, PINK], ['Contrast', 'what pushes against it', 900, 400, c.e, BLUE]];
          jobs.forEach(([t, sub, x, y, at, bg]) => {
            const tag = s.tag(t, { x, y, at, bg, size: 76 });
            s.anim(tag, [{ translate: '0px -220px' }, { translate: '0px 0px' }], at, 0.45, 'cubic-bezier(.4,1.6,.5,1)');
            s.text(sub, { x, y: y + 130, size: 60, at: at + 0.35, dur: 0.6 });
          });
          s.m.look('board', c.four, 3);
          s.m.point({ x: 900, y: 450 }, c.e, 1.2);
        },
      },
      {
        page: 'Watch me',
        say: `{r}Here's a report. {a}A new fertilizer may help tomatoes grow. {b}Treated plants grew taller than untreated ones. {d}However, only six plants were tested.`,
        run(s, c, v) {
          v.cards = cards(s, c.r);
          const line = { x: CARD.x + 30, size: 62, align: 'left', wrap: CARD.w - 60, leading: 1.2 };
          v.a = s.spoken('A new fertilizer may help tomatoes grow.', c, c.a, { ...line, y: ROWS[0] + 40 });
          v.b = s.spoken('Treated plants grew taller than untreated ones.', c, c.b, { ...line, y: ROWS[1] + 40 });
          v.d = s.spoken('However, only six plants were tested.', c, c.d, { ...line, y: ROWS[2] + 40 });
          s.m.look('board', c.a, 4);
        },
      },
      {
        say: `{f}First sentence: {cl}that's the claim. {s0}Second: {ev}that's the evidence. {t}Third: only six plants. {li}That's a limitation. {its}Its job is to say: don't get too excited.`,
        run(s, c, v) {
          s.mark(v.a.find('may'), c.f + 0.2, { soft: true });
          s.mark(v.a.find('help'), c.f + 0.3, { soft: true });
          v.claim = fly(s, 'Claim', { x: CARD.x + 20, y: ROWS[0] - 30, at: c.cl, bg: YELLOW });
          s.m.point(v.a, c.f, 1.4);
          s.mark(v.b.find('taller'), c.s0 + 0.3, { color: TEAL, soft: true });
          v.ev = fly(s, 'Evidence', { x: CARD.x + 20, y: ROWS[1] - 30, at: c.ev, bg: TEAL });
          s.m.point(v.b, c.s0, 1.3);
          s.mark(v.d.find('only'), c.word('only') - 0.05, { color: PINK, soft: true });
          s.mark(v.d.find('six'), c.word('six') - 0.05, { color: PINK, soft: true });
          v.limit = fly(s, 'Limitation', { x: CARD.x + 20, y: ROWS[2] - 30, at: c.li, bg: PINK });
          s.m.point(v.d.find('six'), c.t, 1.3);
          s.pulse(v.limit, c.its + 0.2, { to: 1.15 });
          s.under(v.d.find('only'), c.word('excited') - 0.2, { color: PINK });
          s.under(v.d.find('six'), c.word('excited') - 0.05, { color: PINK });
          s.m.mood('sly', c.its, 2.2);
        },
      },
      {
        page: 'Your turn',
        chipColor: '#ff9ccf',
        say: `{go}Your turn. {a}Trees can cool city streets. {b}In one study, shaded streets were three degrees cooler. {ask}What's the job of the second sentence? {try}Go.`,
        pause: 5.2,
        run(s, c, v) {
          const line = { x: 340, size: 66, align: 'left', wrap: 760, leading: 1.2 };
          v.t1 = s.spoken('Trees can cool city streets.', c, c.a, { ...line, y: 120 });
          v.t2 = s.spoken('In one study, shaded streets were three degrees cooler.', c, c.b, { ...line, y: 300 });
          v.claim2 = s.tag('Claim', { x: 190, y: 126, at: c.a + 1.1, bg: YELLOW, size: 46 });
          const slot = s.shape('<rect class="slot" x="80" y="300" width="220" height="70" rx="16" fill="none" stroke="#ffd66b" stroke-width="5" stroke-dasharray="14 10"/>');
          s.appear(slot.get('.slot'), c.ask, 0.2);
          s.pulse(slot, c.ask + 0.3, { to: 1.08 });
          s.text('Its job?', { x: 614, y: 520, size: 100, color: TEAL, at: c.ask + 0.3, dur: 0.5 });
          s.m.point({ x: 190, y: 335 }, c.ask, 1.3);
          s.m.act('think', c.try + 0.2, 4.6);
          s.m.mood('hmm', c.try + 0.2, 4.6);
          s.countdown(c.end + 0.3, 5, { x: 1080, y: 18 });
        },
      },
      {
        gap: 0.1,
        say: `{ans}Evidence! {why}It backs up the claim.`,
        run(s, c, v) {
          const t = fly(s, 'Evidence', { x: 190, y: 304, at: c.ans, bg: TEAL, align: 'center' });
          s.m.act('cheer', c.ans, 1);
          s.m.mood('proud', c.ans, 1.8);
          s.stars({ x: 190, y: 335 }, c.ans + 0.4, 9);
          s.arrow(t, v.claim2, c.why + 0.2, { color: YELLOW, curve: 0.35 });
          s.mark(v.t2.find('study'), c.word('backs'), { soft: true });
        },
      },
      {
        page: 'A faster way',
        chipColor: '#8fe6cf',
        say: `{fast}The fast way: label as you read. {a}Claim. {b}Evidence. {d}Limitation. {just}Just little arrows in your head.`,
        run(s, c) {
          const rows = [150, 330, 510];
          const g = s.shape(rows.map((y, i) => `<g class="r${i}"><rect x="360" y="${y}" width="${720 - i * 60}" height="24" rx="12" fill="rgba(245,243,234,.5)"/>
            <rect x="360" y="${y + 48}" width="${520 - i * 40}" height="24" rx="12" fill="rgba(245,243,234,.5)"/></g>`).join(''));
          rows.forEach((_, i) => s.appear(g.get(`.r${i}`), c.fast + 0.2 + i * 0.15, 0.3));
          const frame = s.frame({ x: 330, y: rows[0] - 26, w: 790, h: 128 }, c.a - 0.25, { color: YELLOW });
          frame.to({ x: 330, y: rows[1] - 26, w: 790, h: 128 }, c.b - 0.15, 0.4);
          frame.to({ x: 330, y: rows[2] - 26, w: 790, h: 128 }, c.d - 0.15, 0.4);
          const a = fly(s, 'Claim', { x: 190, y: rows[0] - 4, at: c.a, bg: YELLOW, align: 'center' });
          const b = fly(s, 'Evidence', { x: 190, y: rows[1] - 4, at: c.b, bg: TEAL, align: 'center' });
          const d = fly(s, 'Limitation', { x: 190, y: rows[2] - 4, at: c.d, bg: PINK, align: 'center' });
          s.arrow(a, b, c.just, { curve: 0.3, color: YELLOW });
          s.arrow(b, d, c.just + 0.4, { curve: 0.3, color: TEAL });
          s.m.look('board', c.a, 2.4);
          s.m.mood('happy', c.just, 1.6);
        },
      },
      {
        page: 'Watch out',
        chipColor: '#ff8080',
        say: `{but}But a limitation doesn't overturn the result. {not}It doesn't say the fertilizer failed. {avoid}So avoid answers that exaggerate the disagreement.`,
        run(s, c) {
          const g = s.shape(`<g class="claim"><rect x="120" y="110" width="560" height="250" rx="20" fill="rgba(255,214,107,.16)" stroke="${YELLOW}" stroke-width="6"/>
              <text x="400" y="190" text-anchor="middle" font-size="64" font-family="Fredoka" font-weight="600" fill="${YELLOW}">Claim</text>
              <text x="400" y="290" text-anchor="middle" font-size="64" font-family="Chalk" fill="#f5f3ea">Fertilizer may help</text></g>
            <g class="limit"><rect x="760" y="170" width="380" height="190" rx="20" fill="rgba(255,156,207,.16)" stroke="${PINK}" stroke-width="6"/>
              <text x="950" y="240" text-anchor="middle" font-size="58" font-family="Fredoka" font-weight="600" fill="${PINK}">Limitation</text>
              <text x="950" y="320" text-anchor="middle" font-size="60" font-family="Chalk" fill="#f5f3ea">Only six plants</text></g>`);
          const claim = g.get('.claim'), limit = g.get('.limit');
          s.appear(claim, c.but, 0.3);
          s.appear(limit, c.but + 0.3, 0.3);
          s.move(limit, -70, 0, c.word('overturn') - 0.2, 0.25, 'cubic-bezier(.5,0,1,.5)');
          s.turn(claim, -8, c.word('overturn') + 0.05, 0.3, { origin: '120px 360px', easing: 'cubic-bezier(.2,.8,.4,1)' });
          s.sfx('boing', c.word('overturn') + 0.05, 0.6);
          s.turn(claim, 0, c.word('overturn') + 0.4, 0.7, { origin: '120px 360px' });
          s.move(limit, 70, 0, c.word('result'), 0.4);
          s.tag('Still standing', { x: 400, y: 380, at: c.word('result') + 0.1, bg: YELLOW, size: 48 });
          s.m.mood('wow', c.word('overturn'), 1.2);
          const f = s.text('The fertilizer failed', { y: 490, size: 96, color: PINK, at: c.word('fertilizer') - 0.1, dur: 0.7 });
          s.strike(f, c.word('failed') + 0.4);
          s.m.act('shake', c.word('failed') + 0.3, 0.8);
          s.text('Do not exaggerate', { y: 620, size: 96, color: YELLOW, at: c.word('exaggerate'), dur: 0.8 });
        },
      },
      {
        page: 'Remember',
        chipColor: '#ffd66b',
        say: `{why}And explain why the sentence is there, {top}not just what topic it mentions. {bye}Now hit Try this skill!`,
        run(s, c) {
          const a = s.text('Why is it there?', { y: 130, size: 124, color: YELLOW, at: c.why + 0.3, dur: 0.8 });
          s.under(a, c.word('there') + 0.1);
          const b = s.text('not just its topic', { y: 300, size: 96, at: c.top + 0.2, dur: 0.8 });
          s.m.mood('proud', c.top, 2.6);
          s.tag('Next: Try this skill', { x: 614, y: 500, at: c.bye + 0.2, bg: YELLOW, size: 52 });
          s.m.act('wave', c.bye, 1.8);
          s.confetti(c.bye + 0.5);
        },
      },
    ],
  });
})();
