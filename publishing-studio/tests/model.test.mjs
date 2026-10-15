import test from 'node:test';import assert from 'node:assert/strict';import{validate,apply,initial,LIMITS}from'../routes/model.mjs';import{brochure}from'./fixtures/brochure.mjs';
test('shared model keeps exact four-page links/master/styles/bleed and rejects malformed authority/path/model fields',()=>{const{model}=brochure();assert.deepEqual(validate(model),model);assert.deepEqual(initial('Owned brochure',4).pages.map(p=>p.id),['page1','page2','page3','page4']);assert.throws(()=>validate({...model,owner:'foreign'}),e=>e.code==='publishing_model_invalid');assert.throws(()=>validate({...model,title:'bad😀'}),e=>e.code==='publishing_text_profile_unsupported');assert.equal(LIMITS.ownerMetadataBytes,8388608);});
test('human and agent operation list preserves immutable input and enforces link cycles/style/font/profile boundaries',()=>{const{model}=brochure(),original=structuredClone(model);const edited=apply(model,[{op:'set-frame',frame:'main1',values:{x:40}},{op:'set-character-style',name:'default',values:{...model.characterStyles.default,size:12}},{op:'set-view',pageView:'single'}]);assert.equal(edited.pages[0].frames[0].x,40);assert.equal(edited.characterStyles.default.size,12);assert.equal(edited.pageView,'single');assert.deepEqual(model,original);assert.throws(()=>apply(model,[{op:'set-link',frame:'main4',nextFrame:'main1'}]),e=>e.code==='publishing_link_cycle_or_branch');assert.throws(()=>apply(model,[{op:'set-frame',frame:'main1',values:{width:350}}]),e=>e.code==='publishing_linked_frame_size_unsupported');assert.throws(()=>apply(model,[{op:'set-character-style',name:'default',values:{...model.characterStyles.default,font:'Missing font'}}]),e=>e.code==='publishing_font_missing'&&e.details.requiresExplicitSubstitution);assert.throws(()=>apply(model,[{op:'set-frame',frame:'main1',values:{owner:'other'}}]),e=>e.code==='publishing_model_invalid');assert.throws(()=>apply(model,[{op:'rewrite-kernel'}]),e=>e.code==='publishing_operation_unsupported');});

test('actual Python validator and JS accept the same bounded JSON models under adversarial field mutations',async()=>{
 const {spawnSync}=await import('node:child_process');const {fileURLToPath}=await import('node:url');
 const python=process.env.OSHAL_PUBLISHING_PYTHON;assert.ok(python,'OSHAL_PUBLISHING_PYTHON is mandatory for genuine validator parity, no skip');
 const cases=[];const add=(name,edit)=>{const m=brochure().model;edit(m);cases.push({name,model:m});};
 add('valid',()=>{});add('valid initial',m=>Object.assign(m,initial('Initial',1)));
 const invalid=[null,true,0,'',[],{},'constructor'];
 for(const value of invalid){
  for(const field of ['version','title','pageView','pages','masters','stories','assets','characterStyles','paragraphStyles'])add(field+JSON.stringify(value),m=>m[field]=value);
  for(const field of ['id','width','height','bleed','margin','guides','masterId','objects','frames'])add('page.'+field+JSON.stringify(value),m=>m.pages[0][field]=value);
  for(const field of ['id','storyId','nextFrame','x','y','width','height'])add('frame.'+field+JSON.stringify(value),m=>m.pages[0].frames[0][field]=value);
  for(const field of ['font','size','weight','style','color'])add('style.'+field+JSON.stringify(value),m=>m.characterStyles.default[field]=value);
  for(const field of ['id','sha256','bytes','mime'])add('asset.'+field+JSON.stringify(value),m=>m.assets[0][field]=value);
 }
 add('null run style',m=>m.stories[0].paragraphs[0].runs[0].style=null);
 add('missing style',m=>m.stories[0].paragraphs[0].runs[0].style='constructor');
 add('own constructor style',m=>{Object.defineProperty(m.characterStyles,'constructor',{value:structuredClone(m.characterStyles.default),enumerable:true});m.stories[0].paragraphs[0].runs[0].style='constructor';});
 add('empty title',m=>m.title=' \n\t');add('unsupported glyph',m=>m.title='é');
 add('unknown field',m=>m.owner='injected');add('duplicate page',m=>m.pages[1].id=m.pages[0].id);
 add('cycle',m=>m.pages[3].frames[0].nextFrame='main1');add('unequal frame',m=>m.pages[2].frames[0].width=350);
 add('backwards flow',m=>{m.pages[0].frames[0].nextFrame='main3';m.pages[2].frames[0].nextFrame='main2';});
 add('outside bleed',m=>m.pages[0].objects[0].x=-10);add('outside trim',m=>m.pages[0].frames[0].x=400);
 const result=spawnSync(python,['-c',`import sys,json\nsys.path.insert(0,sys.argv[1])\nfrom worker import validate,Refusal\nresults=[]\nfor row in json.load(sys.stdin):\n try:\n  validate(row['model']);results.append({'accepted':True})\n except Refusal as e:results.append({'accepted':False,'code':e.code})\n except Exception as e:results.append({'crash':type(e).__name__})\nprint(json.dumps(results))`,fileURLToPath(new URL('../engine/',import.meta.url))],{input:JSON.stringify(cases),encoding:'utf8',timeout:10000,maxBuffer:8*1024*1024});
 assert.equal(result.status,0,result.stderr);const native=JSON.parse(result.stdout);assert.equal(native.length,cases.length);
 for(const [i,row]of cases.entries()){let accepted=true;try{validate(row.model);}catch(e){assert.ok(e.code,`${row.name}: JS must give a closed refusal`);accepted=false;}assert.equal(native[i].crash,undefined,`${row.name}: Python must give a closed refusal`);assert.equal(native[i].accepted,accepted,`${row.name}: actual Python/JS acceptance differs`);}
 assert.ok(cases.length>250);
});
