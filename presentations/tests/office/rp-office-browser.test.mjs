/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 2.20.0 (RP-OFF-01..07): end-to-end Chromium browser verification at 412x743 (touch phone) and 1440x900 (desktop) for Highlight, Comments, Suggest changes, Find and replace (with single-undo-step Replace all), PDF and plain-text export, non-mutating Mobile reflow view, and two-person sharing.
 */
import{test}from'node:test';
import assert from'node:assert/strict';
import{mkdtempSync,readFileSync,rmSync}from'node:fs';
import{tmpdir}from'node:os';
import{join}from'node:path';
import{createRequire}from'node:module';
import{fixture}from'./fixture.mjs';

const{chromium}=createRequire(import.meta.url)('playwright');
const PHONE={viewport:{width:412,height:743},isMobile:true,hasTouch:true,deviceScaleFactor:2.625};
const DESKTOP={viewport:{width:1440,height:900}};

async function launchActorPage(browser,f,size,{actor='alice',query='?kind=docx',errors=[]}={}){
 const context=await browser.newContext({...size,acceptDownloads:true,extraHTTPHeaders:{'x-office-test-owner':actor}});
 const page=await context.newPage();
 page.on('pageerror',err=>errors.push(err.message));
 await page.goto(f.origin+'/api/presentations/editor/app'+query);
 await page.locator('html[data-office-ready=true]').waitFor();
 await page.waitForTimeout(250);
 return{context,page,errors};
}

async function openMoreItem(page,isPhone,menuId){
 if(isPhone)await page.locator('.office-bottom-bar').getByRole('button',{name:'More',exact:true}).tap();
 else await page.locator('#office-desktop-tools button[aria-label="More"]').click();
 await page.locator(`dialog.ds-layer[open] [data-office-menu="${menuId}"]`).click();
}

async function closeTopLayer(page){
 const closeBtn=page.locator('dialog.ds-layer[open] .ds-layer-done').last();
 if(await closeBtn.isVisible().catch(()=>false)){
  await closeBtn.click();
  await page.waitForTimeout(150);
 }
}

async function readEditorState(page){
 return page.evaluate(()=>import('/api/presentations/editor/assets/state.mjs').then(({state,dirty})=>({
  id:state.id,revision:state.revision,dirty:dirty(),mobileView:state.mobileView,suggesting:state.suggesting,
  pageWidth:state.model.pageWidth,comments:state.model.comments?.length??0,changes:state.model.changes?.length??0,
  texts:state.model.pages[0].blocks.filter(b=>b.runs).map(b=>b.runs.map(r=>r.text).join(''))
 })));
}

async function verifyHighlightAndComments(page,isPhone){
 const p=page.locator('.office-word-page [contenteditable=true]').first();
 await p.click();
 await page.keyboard.type('Alpha Beta Gamma');
 await page.keyboard.down('Shift');
 for(let i=0;i<5;i++)await page.keyboard.press('ArrowLeft');
 await page.keyboard.up('Shift');
 if(isPhone){
  await page.locator('.office-bottom-bar').getByRole('button',{name:'Format',exact:true}).tap();
  await page.locator('dialog.ds-layer[open] [data-editor-property="highlight"]').selectOption('#fef08a');
  await closeTopLayer(page);
 }else{
  await page.locator('.office-pane-tabs [data-pane="format"]').click();
  await page.locator('[data-editor-property="highlight"]').selectOption('#fef08a');
 }
 const hlBg=await page.evaluate(()=>[...document.querySelectorAll('.office-word-page span')].map(n=>getComputedStyle(n).backgroundColor).find(c=>c==='rgb(254, 240, 138)')??null);
 assert.equal(hlBg,'rgb(254, 240, 138)','RP-OFF-01 highlight renders on page');
 if(isPhone)await page.locator('.office-bottom-bar').getByRole('button',{name:'Comment',exact:true}).tap();
 else await page.locator('#office-desktop-tools').getByRole('button',{name:'Comment',exact:true}).click();
 await page.locator('dialog.ds-layer[open] [data-office-field="new-comment"]').fill('Check Gamma term');
 await page.locator('dialog.ds-layer[open] [data-office-action="add-comment"]').click();
 assert.equal(await page.locator('.office-word-page .office-comment-mark').count()>0,true,'RP-OFF-02 comment mark anchored on page');
 await page.locator('dialog.ds-layer[open] [data-office-field="reply-comment"]').fill('Verified');
 await page.locator('dialog.ds-layer[open] [data-office-action="reply-comment"]').click();
 await page.locator('dialog.ds-layer[open] [data-office-action="resolve-comment"]').click();
 assert.match(await page.locator('dialog.ds-layer[open] .office-thread-card').innerText(),/Resolved/);
 await closeTopLayer(page);
}

async function verifySuggestAndFindReplace(page,isPhone){
 await openMoreItem(page,isPhone,'suggest-changes');
 await page.locator('dialog.ds-layer[open] [data-office-action="toggle-suggest"]').check();
 await closeTopLayer(page);
 const p=page.locator('.office-word-page [contenteditable=true]').first();
 await p.click();await page.keyboard.press('End');
 await page.keyboard.press('Backspace');await page.keyboard.type('Z');
 await p.evaluate(node=>node.blur());await page.waitForTimeout(150);
 assert.equal(await page.locator('.office-word-page .office-change-ins').count(),1,'RP-OFF-03 tracked insertion rendered');
 assert.equal(await page.locator('.office-word-page .office-change-del').count(),1,'RP-OFF-03 tracked deletion rendered');
 await openMoreItem(page,isPhone,'suggest-changes');
 await page.locator('dialog.ds-layer[open] [data-office-action="accept-all-changes"]').click();
 await page.locator('dialog.ds-layer[open] [data-office-action="toggle-suggest"]').uncheck();
 await closeTopLayer(page);
 assert.equal((await readEditorState(page)).changes,0);

 if(isPhone){await page.locator('.office-bottom-bar').getByRole('button',{name:'Insert',exact:true}).tap();await page.getByRole('menuitem',{name:'Paragraph',exact:true}).tap();}
 else{await page.getByRole('button',{name:'Insert ▾'}).click();await page.getByRole('menuitem',{name:'Paragraph',exact:true}).click();}
 await page.locator('.office-word-page [contenteditable=true]').nth(1).click();
 await page.keyboard.type('alpha and Alpha');
 await openMoreItem(page,isPhone,'find-replace');
 await page.locator('dialog.ds-layer[open] [data-office-field="find-query"]').fill('alpha');
 assert.equal(await page.locator('.office-word-page mark.office-find-hit').count(),3,'RP-OFF-04 case-insensitive hits marked');
 await page.locator('dialog.ds-layer[open] [data-office-field="find-match-case"]').check();
 assert.equal(await page.locator('.office-word-page mark.office-find-hit').count(),1,'RP-OFF-04 Match case filters hits');
 await page.locator('dialog.ds-layer[open] [data-office-field="find-match-case"]').uncheck();
 await page.locator('dialog.ds-layer[open] [data-office-action="find-next"]').click();
 await page.locator('dialog.ds-layer[open] [data-office-field="find-replace"]').fill('OMEGA');
 await page.locator('dialog.ds-layer[open] [data-office-action="replace-all"]').click();
 await closeTopLayer(page);
 assert.deepEqual((await readEditorState(page)).texts,['OMEGA Beta GammZ','OMEGA and OMEGA']);
 await page.locator('#undo').click();
 assert.deepEqual((await readEditorState(page)).texts,['Alpha Beta GammZ','alpha and Alpha'],'RP-OFF-04 Replace all undone in one undo step');
}

async function verifyExportAndMobileReflow(page,isPhone){
 await page.locator('#save-document').click();
 await page.waitForFunction(()=>import('/api/presentations/editor/assets/state.mjs').then(({state,dirty})=>Boolean(state.id)&&!dirty()));
 await openMoreItem(page,isPhone,'mobile-view');
 await page.waitForTimeout(150);
 const reflowed=await readEditorState(page);
 assert.equal(reflowed.mobileView,true,'RP-OFF-06 mobile view enabled');
 assert.equal(reflowed.dirty,false,'RP-OFF-06 mobile view does not mutate document model');
 assert.equal(reflowed.pageWidth,595.28,'page width preserved in model');
 const box=await page.locator('.office-word-page').first().boundingBox();
 assert.ok(box.width<=page.viewportSize().width,'RP-OFF-06 reflows within frame width');
 await page.locator('.office-word-page [contenteditable=true]').first().click();
 await page.keyboard.press('End');await page.keyboard.type('!');
 await openMoreItem(page,isPhone,'mobile-view');
 await page.waitForTimeout(150);
 assert.equal((await readEditorState(page)).mobileView,false,'RP-OFF-06 restores page layout');

 await page.locator('#office-export').click();
 const[pdfDl]=await Promise.all([page.waitForEvent('download'),page.locator('dialog.ds-layer[open] .office-export-row',{hasText:'PDF (.pdf)'}).locator('button').click()]);
 const pdfBytes=readFileSync(await pdfDl.path());
 assert.equal(pdfBytes.subarray(0,8).toString('ascii'),'%PDF-1.7','RP-OFF-05 downloads real %PDF-1.7');
 await page.locator('#office-export').click();
 const[txtDl]=await Promise.all([page.waitForEvent('download'),page.locator('dialog.ds-layer[open] .office-export-row',{hasText:'Plain text (.txt)'}).locator('button').click()]);
 assert.match(readFileSync(await txtDl.path(),'utf8'),/Alpha Beta GammZ!/,'RP-OFF-05 downloads plain text');
 await closeTopLayer(page);
}

for(const[label,size,isPhone]of [['phone 412x743',PHONE,true],['desktop 1440x900',DESKTOP,false]]){
 test(`browser (${label}): RP-OFF-01..06 controls work in place with zero RP-OFF-* placeholders and zero overflow`,{timeout:150000},async t=>{
  const f=await fixture({http:true});
  const browser=await chromium.launch({headless:true});
  const errors=[];
  t.after(async()=>{await browser.close();await f.close();assert.deepEqual(errors,[],'zero page errors');});
  const{page}=await launchActorPage(browser,f,size,{actor:'alice',errors});
  assert.equal(await page.locator('[data-ds-backlog^="RP-OFF-"]').count(),0,'zero RP-OFF-* backlog attributes');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true,'no horizontal overflow');
  await verifyHighlightAndComments(page,isPhone);
  await verifySuggestAndFindReplace(page,isPhone);
  await verifyExportAndMobileReflow(page,isPhone);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true,'no horizontal overflow after edits');
 });
}

test('browser (two-person RP-OFF-07): owner shares with collaborator in UI, collaborator edits shared doc, owner views audit and revokes',{timeout:150000},async t=>{
 const mirrorRoot=mkdtempSync(join(tmpdir(),'office-browser-share-'));
 const prevDir=process.env.OSHAL_PACKAGE_DATA_DIR;process.env.OSHAL_PACKAGE_DATA_DIR=mirrorRoot;
 const f=await fixture({http:true});
 const browser=await chromium.launch({headless:true});
 const errors=[];
 t.after(async()=>{if(prevDir===undefined)delete process.env.OSHAL_PACKAGE_DATA_DIR;else process.env.OSHAL_PACKAGE_DATA_DIR=prevDir;rmSync(mirrorRoot,{recursive:true,force:true});await browser.close();await f.close();assert.deepEqual(errors,[],'zero page errors');});

 const{page:alice}=await launchActorPage(browser,f,DESKTOP,{actor:'alice',errors});
 await alice.locator('.office-word-page [contenteditable=true]').first().click();
 await alice.keyboard.type('Shared Q4 Roadmap');
 await openMoreItem(alice,false,'share');
 await alice.locator('dialog.ds-layer[open] [data-office-field="share-grantee"]').fill('bob');
 await alice.locator('dialog.ds-layer[open] [data-office-field="share-role"]').selectOption('edit');
 await alice.locator('dialog.ds-layer[open] [data-office-action="grant-share"]').click();
 await alice.locator('dialog.ds-layer[open] [data-share-grantee="bob"]').waitFor();
 await closeTopLayer(alice);

 const{page:bob}=await launchActorPage(browser,f,PHONE,{actor:'bob',query:'',errors});
 await bob.locator('#office-home').waitFor({state:'visible'});
 assert.match(await bob.locator('.office-doc-card').first().innerText(),/Shared by alice \(edit\)/);
 await bob.locator('.office-doc-card').first().tap();
 await bob.locator('#office-edit').tap();
 await bob.locator('.office-word-page [contenteditable=true]').first().click();
 await bob.keyboard.press('End');await bob.keyboard.type(' - Bob signed off');
 await bob.locator('#save-document').tap();
 await bob.waitForFunction(()=>import('/api/presentations/editor/assets/state.mjs').then(({dirty})=>!dirty()));

 await openMoreItem(alice,false,'share');
 assert.match(await alice.locator('dialog.ds-layer[open] .office-audit-list').innerText(),/bob · edit \(edit\)/);
 await alice.locator('dialog.ds-layer[open] [data-office-action="revoke-share"]').click();
 await alice.waitForFunction(()=>!document.querySelector('dialog.ds-layer[open] [data-share-grantee="bob"]'));
 await bob.goto(f.origin+'/api/presentations/editor/app');
 await bob.locator('html[data-office-ready=true]').waitFor();
 assert.equal(await bob.locator('.office-doc-card').count(),0,'revoking removes shared document from recipient');
});
