/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 1.68.8 (lane MARQUEE1; the one-chat-window live check on the test slot, 2026-11-17 02:44Z, at 412: Career's Concierge pressed and no chat window). Real Chromium over the shipped Career page and the kernel's shared assistant: Career's concierge module is held back, Concierge is pressed while it is on its way (the bar already shows the button), and the concierge opens once the module arrives, its chat window framed for Career; the button says it is busy meanwhile. Red on 1.68.7 (the press reached no handler and the pane stayed hidden). Phone 412 with touch and desktop 1280, in the cockpit host and the native host.
 */
import {test,after,before} from 'node:test';
import assert from 'node:assert/strict';
import {startConciergeFixture,chromium,sharedRoot} from './helpers/career-concierge-fixture.mjs';

/** How long the concierge module is held back: long enough that the press always comes before it. */
const HELD_MS=2500;
let browser,fixture;
before(async()=>{fixture=await startConciergeFixture();browser=await chromium.launch({headless:true});});
after(async()=>{await browser?.close();await fixture?.close();});

/**
 * @description Open Career in a host with its concierge module held back, press Concierge while it is on its way, then read
 * the pane once the module has arrived.
 * @param {string} host The fixture host page (cockpit or native). @param {number} width Viewport width.
 * @returns {Promise<{early:boolean,busy:string|null,open:object}>} Whether the press came first, the button's busy mark, the pane.
 */
async function pressEarly(host,width){
 const phone=width<640;
 const context=await browser.newContext({viewport:{width,height:915},...(phone?{isMobile:true,hasTouch:true}:{})}),page=await context.newPage();
 try{
  await context.route('**/*',route=>(new URL(route.request().url()).origin===fixture.origin?route.continue():route.abort()));
  let release;const held=new Promise(done=>{release=done;});
  await context.route('**/api/career-hunter/static/career-concierge.mjs',async route=>{await held;await route.continue();});
  await page.goto(fixture.origin+'/fixture/'+host);
  const career=page.frameLocator('iframe').first();
  const toggle=career.getByRole('button',{name:'Concierge',exact:true}).first();
  await toggle.waitFor({timeout:8000});
  const early=await career.locator('body').evaluate(()=>!document.querySelector('.cf-concierge'));
  if(phone)await toggle.tap();else await toggle.click();
  const busy=await toggle.getAttribute('aria-busy');
  setTimeout(release,HELD_MS);
  await career.locator('.cf-concierge').waitFor({state:'visible',timeout:HELD_MS+8000}).catch(()=>{});
  const open=await career.locator('body').evaluate(()=>{
   const host=document.querySelector('.cf-concierge'),chat=host&&host.querySelector('iframe.jarvis-chat-frame');
   return{mounted:Boolean(host),shown:Boolean(host&&!host.hidden&&host.getClientRects().length),state:document.documentElement.dataset.careerConcierge||'',
    chat:chat?(chat.getAttribute('src')||''):null,busy:[...document.querySelectorAll('.cf-concierge-toggle')].some(button=>button.hasAttribute('aria-busy'))};
  });
  return{early,busy,open};
 }finally{await context.close();}
}

for(const host of ['cockpit','native'])for(const width of [412,1280])test(`${host} ${width}: a Concierge press before the concierge is ready opens it once ready`,{skip:!sharedRoot&&'OSHAL_KERNEL_PLATFORM must name the kernel platform folder (read only)'},async()=>{
 const {early,busy,open}=await pressEarly(host,width);
 assert.equal(early,true,'the press came before the concierge mounted (else this case proves nothing)');
 assert.deepEqual([open.mounted,open.shown,open.state],[true,true,'open'],'the concierge opened once it mounted: the press was not lost');
 // A kernel whose shared pane frames the one chat window (00c62f98 and later) frames it for Career; an older one draws its own.
 if(open.chat!==null)assert.match(open.chat,/^\/api\/jarvis\/\?concierge=career-hunter&bot=career-concierge/,'its chat window is framed for Career');
 assert.equal(busy,'true','while the concierge was on its way the button said it was busy');
 assert.equal(open.busy,false,'the busy mark is gone once it is open');
});
