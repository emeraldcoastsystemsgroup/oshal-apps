/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Genuine Chromium walks the exact slide controller and existing parser/draft/action functions through explicitly named root DOM adapters.
 * This is source UI evidence. The in-memory outline, deterministic Guide action
 * input and export-payload capture are named seams, not backend/provider/native proof.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createServer} from 'node:http';
import {createRequire} from 'node:module';
import {resolve, join} from 'node:path';
const packageRoot = new URL('../', import.meta.url);
const toolchain = resolve(process.env.STORE_CI_TOOLCHAIN ?? new URL('../scripts/toolchain/', packageRoot).pathname);
const {chromium} = createRequire(join(toolchain, 'package.json'))('playwright');
const source = readFileSync(new URL('tools/presentations.html', packageRoot), 'utf8');
const code = name => source.split('\n').find(line => line.startsWith(name));
const parserStart = source.indexOf('function parseOutline(');
const parser = source.slice(parserStart, source.indexOf('// ADR-043 item A:', parserStart));
const draft = source.slice(source.indexOf('function pvLines('), source.indexOf('function renderPreview('));
const applier = source.slice(source.indexOf('function readEditorSlides('), source.indexOf('// Cockpit relay hookup:'));
const theme = {id:'executive',name:'Executive',headingCase:'normal',colors:{canvas:'ffffff',ink:'17202b',accent:'4cc9f0',canvasAlt:'eef4f8',line:'cbd5e1'}};
const sections=[{title:'Overview',content:'First point\nSecond point'}, {title:'Numbers',content:'#layout: table\n| Name | Value |\n| A | 5 |'}, {title:'Next steps',content:'Review\nShip'}];
function html(){return `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="/slide-workspace.css"><style>body{margin:0;background:#101c2a;color:#e6edf5;--bg:#101c2a;--panel:#1d2938;--panel2:#263449;--text:#e6edf5;--line:#344458;--accent:#53b8fa;--muted:#9dacc0}#host{height:calc(100vh - 16px);padding:8px;box-sizing:border-box}.pvSlide .body{padding:14px}.pvSlide ul{padding-left:22px}.pvSlide .ttl{font-weight:700}.pvSlide .kick{font-size:10px}.pvSlide table{border-collapse:collapse}.pvSlide td,.pvSlide th{border:1px solid;padding:4px}</style></head><body><div id="host"></div><input id="title" hidden><textarea id="outline" hidden></textarea><script type="module">
import{createSlideWorkspace,serializeSections}from'/slide-workspace.mjs';
const $=id=>document.getElementById(id);${code('function esc(')}${code('const hx =')}${code('function lum(')}
${parser}${draft}
let THEMES=[${JSON.stringify(theme)}],THEME='executive',SEL=null,workspace;const changes=[];
function pickTheme(id){THEME=id;}function renderTemplates(){}function pvKick(){workspace?.refresh();}
${applier}
$('outline').value=serializeSections(${JSON.stringify(sections)});
workspace=createSlideWorkspace({host:$('host'),readSections:()=>parseOutline($('outline').value),writeSections:next=>{$('outline').value=serializeSections(next);pvKick();},getTheme:()=>THEMES[0],renderDraft:(section,index)=>slideCards([section],THEMES[0],'slide'),onChange:event=>{changes.push(event);}});
window.officeFixture={read:()=>parseOutline($('outline').value),selection:()=>workspace.getSelection(),guide:actions=>applyActions(actions),refresh:()=>workspace.refresh(),theme:next=>{THEMES=[next];workspace.refresh();},exportPayload:()=>({sections:parseOutline($('outline').value)}),destroy:()=>workspace.destroy(),changes};
</script></body></html>`;}
async function fixture(t){
 const server=createServer((req,res)=>{const name=req.url?.split('?')[0];if(name==='/'){res.writeHead(200,{'content-type':'text/html'});res.end(html());}else if(name==='/slide-workspace.mjs'||name==='/slide-workspace.css'){res.writeHead(200,{'content-type':name.endsWith('.mjs')?'text/javascript':'text/css'});res.end(readFileSync(new URL('tools'+name,packageRoot)));}else{res.writeHead(404);res.end();}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));return'http://127.0.0.1:'+server.address().port;
}
async function browserPage(t,width=1280){const url=await fixture(t),browser=await chromium.launch({headless:true});t.after(()=>browser.close());const page=await browser.newPage({viewport:{width,height:900}}),errors=[];page.on('pageerror',error=>errors.push(error.message));await page.goto(url);await page.waitForFunction(()=>!!window.officeFixture);t.after(()=>assert.deepEqual(errors,[]));return page;}

test('desktop selected canvas edits preserve every other slide, DSL and actual export payload while Guide actions refresh the same model',async t=>{
 const page=await browserPage(t);
 assert.equal(await page.locator('.office-slide-thumbnail').count(),3);assert.equal(await page.locator('.office-slide-canvas .pvSlide').count(),1);
 assert.deepEqual(await page.evaluate(()=>officeFixture.selection()),{kind:'pptx',index:1,title:'Overview'});
 const title=page.getByRole('textbox',{name:'Edit slide title on canvas'});await title.fill('Edited overview');await title.press('End');await title.press('!');
 assert.equal(await title.textContent(),'Edited overview!');assert.equal(await title.evaluate(node=>document.activeElement===node),true,'Canvas input keeps focus/caret across synchronous authoritative refresh');
 const point=page.getByRole('textbox',{name:'Edit slide point 1'});await point.fill('Human edited point');
 const model=await page.evaluate(()=>officeFixture.read());assert.deepEqual(model,[{title:'Edited overview!',content:'Human edited point\nSecond point'},sections[1],sections[2]]);
 await page.getByRole('button',{name:'Slide 2: Numbers',exact:true}).click();assert.equal(await page.locator('.office-slide-canvas .kick').textContent(),'Slide 2');assert.equal(await page.locator('.office-slide-canvas table').count(),1);
 await page.getByRole('button',{name:'Edit text',exact:true}).click();const content=page.getByRole('textbox',{name:'Slide text',exact:true});assert.equal(await content.inputValue(),sections[1].content);
 await content.fill('#layout: table\n| Name | Value |\n| A | 8 |');assert.equal(await content.evaluate(node=>document.activeElement===node),true);assert.equal((await page.evaluate(()=>officeFixture.read()))[0].title,'Edited overview!');
 await page.evaluate(()=>officeFixture.guide([{op:'update_slide',index:3,title:'Guide updated',bullets:['Keep this actual action contract']}])) ;
 assert.equal(await page.getByRole('button',{name:'Slide 3: Guide updated',exact:true}).count(),1);assert.deepEqual(await page.evaluate(()=>officeFixture.selection()),{kind:'pptx',index:2,title:'Numbers'});
 const payload=await page.evaluate(()=>officeFixture.exportPayload());assert.equal(payload.sections[1].content,'#layout: table\n| Name | Value |\n| A | 8 |');assert.equal(payload.sections[2].title,'Guide updated');
 const changed={...theme,colors:{...theme.colors,canvas:'16324f',ink:'ffffff'}};await page.evaluate(value=>officeFixture.theme(value),changed);assert.equal(await page.locator('.office-slide-canvas .pvSlide').evaluate(node=>getComputedStyle(node).backgroundColor),'rgb(22, 50, 79)');
});

test('real thumbnail keyboard selection, duplicate/reorder/delete and undo/redo keep the source outline authoritative',async t=>{
 const page=await browserPage(t,1000);await page.getByRole('button',{name:'Slide 1: Overview',exact:true}).focus();await page.keyboard.press('ArrowDown');assert.equal((await page.evaluate(()=>officeFixture.selection())).index,2);
 await page.getByRole('button',{name:'Duplicate',exact:true}).click();assert.equal(await page.locator('.office-slide-thumbnail').count(),4);assert.equal((await page.evaluate(()=>officeFixture.selection())).index,3);assert.deepEqual((await page.evaluate(()=>officeFixture.read()))[2],sections[1]);
 await page.getByRole('button',{name:'Move later',exact:true}).click();assert.equal((await page.evaluate(()=>officeFixture.selection())).index,4);
 await page.getByRole('button',{name:'Delete',exact:true}).click();assert.equal(await page.locator('.office-slide-thumbnail').count(),3);
 await page.getByRole('button',{name:'Undo',exact:true}).click();assert.equal(await page.locator('.office-slide-thumbnail').count(),4);await page.getByRole('button',{name:'Redo',exact:true}).click();assert.equal(await page.locator('.office-slide-thumbnail').count(),3);
 await page.getByRole('button',{name:'Add slide',exact:true}).click();assert.equal((await page.evaluate(()=>officeFixture.selection())).title,'New slide');
 await page.getByRole('button',{name:'Edit text',exact:true}).click();const input=page.getByRole('textbox',{name:'Slide text',exact:true});await input.fill('One\n\nAnother');assert.match(await page.locator('.office-slide-status').textContent(),/last valid text is retained/);assert.equal((await page.evaluate(()=>officeFixture.read())).at(-1).content,'');
 await page.evaluate(()=>officeFixture.destroy());assert.equal(await page.locator('#host').textContent(),'');
});

test('phone keeps thumbnails reachable and selected title editing visible without horizontal page overflow',async t=>{
 const page=await browserPage(t,412);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 await page.getByRole('button',{name:'Slide 3: Next steps',exact:true}).click();assert.equal((await page.evaluate(()=>officeFixture.selection())).index,3);assert.equal(await page.locator('.office-slide-canvas .pvSlide').count(),1);
 const title=page.getByRole('textbox',{name:'Edit slide title on canvas'});await title.fill('Phone title');await title.blur();assert.equal((await page.evaluate(()=>officeFixture.read()))[2].title,'Phone title');assert.equal(await page.locator('.office-slide-canvas').isVisible(),true);
});
