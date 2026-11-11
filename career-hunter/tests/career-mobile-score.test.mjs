/** CHANGE LOG
 * 5 | maintainer@emeraldcoastsystemsgroup.com | The card reads the page's otherExperience flag (whether Additional experience has something the approve route can add), so the runtime supplies it, off.
 * 4 | maintainer@emeraldcoastsystemsgroup.com | UX audit 2026-11-06: Ready reads the caller's submission records through nativeQueue (with queueAlert for a failed read), so the runtime loads both.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Load the real unit-aware salary helper while testing the mobile score renderers.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Verify all mobile views label AI and keyword scores distinctly and retain saved assessment dates.
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Execute all three mobile fit renderers with zero, missing and keyword-fallback scores.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const html = readFileSync(new URL('../tools/career-mobile.html', import.meta.url), 'utf8');
function source(name) {
  const match = html.match(new RegExp(`(?:async )?function ${name}\\([^]*?\\n}`));
  assert.ok(match, `missing ${name}`);
  return match[0];
}
const cases = [
  [{ai_fit_score:0,fit_score:88},0], [{ai_fit_score:0},0],
  [{ai_fit_score:null,fit_score:0},0], [{fit_score:0},0],
  [{ai_fit_score:null,fit_score:42.4},42], [{fit_score:63.6},64],
  [{ai_fit_score:65.6,fit_score:88},66], [{},null], [{ai_fit_score:null,fit_score:null},null],
];
function runtime(scores) {
  const elements = new Map();
  const job = {id:1,title:'Fixture',company:'Example',...scores};
  const context = {CH:'/career',AP:'/apply',jobCache:new Map(),otherExperience:false,
    $: selector => {
      if (!elements.has(selector)) elements.set(selector,{dataset:{},style:{},innerHTML:'',classList:{add(){}}});
      return elements.get(selector);
    }, $$:()=>[], esc:value=>String(value), money:()=>'',
    jget:async path=>path.includes('/applications')?{applications:[]}
      :path.includes('/queue')?{items:[]}:path.includes('/jobs?')?{jobs:[job]}:{job},
    stopReadyPoll(){},draftInFlight:()=>false,selectTab(){},renderPacketPane(){},renderReviewFoot(){},
  };
  vm.createContext(context);
  vm.runInContext([source('salary'),source('fitEvidence'),source('cardHTML'),source('section'),source('nativeQueue'),source('queueAlert'),source('loadReady'),source('openReview')].join('\n'),context);
  return {context,elements,job};
}

test('mobile swipe cards render an AI zero and keep missing scores absent', () => {
  for (const [scores, expected] of cases) {
    const {context,job} = runtime(scores);
    const rendered = context.cardHTML({posting_id:1,detail:job},true);
    if (expected === null) assert.doesNotMatch(rendered, /class="fit"/);
    else {assert.match(rendered,new RegExp(`<i>${expected}</i>`));assert.match(rendered,scores.ai_fit_score!=null?/AI fit/:/Keyword fit/);}
  }
});

test('mobile ready rows render zero rather than a keyword replacement or missing marker', async () => {
  for (const [scores, expected] of cases) {
    const {context,elements} = runtime(scores);
    await context.loadReady();
    const rendered=elements.get('#readyList').innerHTML;
    assert.match(rendered,new RegExp(`<div class="rfit">${expected ?? '—'}(?:<small>[^<]*</small>)?</div>`));
    if(expected!==null)assert.match(rendered,scores.ai_fit_score!=null?/AI fit/:/Keyword fit/);
  }
});

test('mobile selected review renders an AI zero and uses keyword fit only when AI is missing', async () => {
  for (const [scores, expected] of cases) {
    const {context,elements} = runtime(scores);
    await context.openReview(1);
    const rendered = elements.get('#pane-posting').innerHTML;
    if (expected === null) assert.doesNotMatch(rendered,/fit \d/);
    else assert.match(rendered,new RegExp(`>${scores.ai_fit_score!=null?'AI fit':'Keyword fit'} ${expected}</span>`));
  }
});

test('mobile cards and selected review retain a dated saved assessment without calling it current',async()=>{
  const {context,elements,job}=runtime({ai_fit_score:70,fit_assessment:{kind:'ai',assessedAt:'2020-01-02T03:04:05Z'}});
  const card=context.cardHTML({posting_id:1,detail:job},true);assert.match(card,/Assessed/);assert.match(card,/2020/);
  await context.openReview(1);const review=elements.get('#pane-posting').innerHTML;
  assert.match(review,/Assessed/);assert.match(review,/2020/);assert.match(review,/need a new assessment/);
});
