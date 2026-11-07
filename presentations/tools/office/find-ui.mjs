/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 2.20.0 (RP-OFF-04): Find and replace sheet with next/previous navigation, Match case, visible page hit markers and single-undo-step Replace all.
 */
import{plain}from'./model.mjs';
import{state,editable,edit,notify,status}from'./state.mjs';
import{invalidate}from'./render.mjs';

const make=(tag,className,text)=>{const node=document.createElement(tag);if(className)node.className=className;if(text!==undefined)node.textContent=text;return node;};

export function computeFindHits(model,query,matchCase){
 if(!query||model.kind==='xlsx')return[];
 const needle=matchCase?query:query.toLowerCase(),hits=[];
 for(const page of model.pages??[]){
  for(const item of (model.kind==='pptx'?page.objects:page.blocks)??[]){
   if(!item.runs)continue;
   const raw=plain(item.runs),hay=matchCase?raw:raw.toLowerCase();
   let from=0;
   while(from<=hay.length-needle.length){
    const at=hay.indexOf(needle,from);
    if(at<0)break;
    hits.push({pageId:page.id,itemId:item.id,start:at,end:at+needle.length});
    from=at+Math.max(1,needle.length);
   }
  }
 }
 return hits;
}

export function syncFindState({jump=false}={}){
 const f=state.find;
 if(!f.open||!f.query){f.hits=[];f.index=0;return;}
 f.hits=computeFindHits(state.model,f.query,f.matchCase);
 if(!f.hits.length){f.index=0;return;}
 f.index=((f.index%f.hits.length)+f.hits.length)%f.hits.length;
 if(jump){
  const active=f.hits[f.index];
  if(active&&state.page!==active.pageId)state.page=active.pageId;
 }
}

export function blockFindDecorations(pageId,itemId){
 const f=state.find;
 if(!f.open||!f.hits.length)return[];
 return f.hits.map((hit,idx)=>({...hit,active:idx===f.index})).filter(hit=>hit.pageId===pageId&&hit.itemId===itemId);
}

function replaceSingle(){
 const f=state.find;
 if(!editable())throw new Error('This document is currently read-only.');
 syncFindState();
 const hit=f.hits[f.index];
 if(!hit)throw new Error('No match selected to replace.');
 edit([{op:'text-range',page:hit.pageId,id:hit.itemId,start:hit.start,end:hit.end,text:f.replace}],{keepCaret:true});
 syncFindState({jump:true});
 invalidate();notify();
 status('Replaced 1 match');
}

function replaceAllMatches(){
 const f=state.find;
 if(!editable())throw new Error('This document is currently read-only.');
 syncFindState();
 if(!f.hits.length)throw new Error('No matches found to replace.');
 const count=f.hits.length,byBlock=new Map();
 for(const hit of f.hits){
  const key=hit.pageId+':'+hit.itemId,list=byBlock.get(key)??[];
  list.push(hit);byBlock.set(key,list);
 }
 const ops=[];
 for(const list of byBlock.values()){
  list.sort((a,b)=>b.start-a.start);
  for(const hit of list)ops.push({op:'text-range',page:hit.pageId,id:hit.itemId,start:hit.start,end:hit.end,text:f.replace});
 }
 edit(ops,{keepCaret:true});
 syncFindState({jump:true});
 invalidate();notify();
 status(`Replaced ${count} match${count===1?'':'es'}`);
}

export function openFindAndReplace(layers,guard){
 if(state.model.kind==='xlsx'){status('Use cell selection to inspect spreadsheet values.',true);return null;}
 state.find.open=true;
 const layer=layers.create('Find and replace','ds-sheet ds-half ds-find-sheet');
 const findLabel=make('label','office-field','Find'),findInput=make('input','');
 findInput.type='search';findInput.placeholder='Find in document';findInput.value=state.find.query;findInput.dataset.officeField='find-query';
 findLabel.append(findInput);
 const repLabel=make('label','office-field','Replace with'),repInput=make('input','');
 repInput.type='text';repInput.placeholder='Replacement text';repInput.value=state.find.replace;repInput.disabled=!editable();repInput.dataset.officeField='find-replace';
 repLabel.append(repInput);
 const caseRow=make('label','office-check-row'),caseBox=make('input','');
 caseBox.type='checkbox';caseBox.checked=state.find.matchCase;caseBox.dataset.officeField='find-match-case';
 caseRow.append(caseBox,make('span','','Match case'));
 const countOut=make('p','office-find-count','Type to search');countOut.setAttribute('role','status');countOut.dataset.officeFindCount='';
 const navRow=make('div','office-find-actions');
 const prevBtn=make('button','','Previous'),nextBtn=make('button','','Next'),repBtn=make('button','','Replace'),allBtn=make('button','primary','Replace all');
 for(const b of [prevBtn,nextBtn,repBtn,allBtn])b.type='button';
 prevBtn.dataset.officeAction='find-prev';nextBtn.dataset.officeAction='find-next';
 repBtn.dataset.officeAction='replace-one';allBtn.dataset.officeAction='replace-all';
 navRow.append(prevBtn,nextBtn,repBtn,allBtn);
 const updateUi=({jump=false}={})=>{
  syncFindState({jump});
  const total=state.find.hits.length,canEdit=editable();
  countOut.textContent=!state.find.query?'Type to search':total?`${state.find.index+1} of ${total}`:'0 matches';
  prevBtn.disabled=nextBtn.disabled=total===0;
  repInput.disabled=!canEdit;
  repBtn.disabled=allBtn.disabled=!canEdit||total===0;
  invalidate();notify();
 };
 findInput.oninput=()=>{state.find.query=findInput.value;state.find.index=0;updateUi({jump:true});};
 repInput.oninput=()=>{state.find.replace=repInput.value;};
 caseBox.onchange=()=>{state.find.matchCase=caseBox.checked;state.find.index=0;updateUi({jump:true});};
 prevBtn.onclick=guard(()=>{state.find.index-=1;updateUi({jump:true});});
 nextBtn.onclick=guard(()=>{state.find.index+=1;updateUi({jump:true});});
 repBtn.onclick=guard(()=>{replaceSingle();updateUi();});
 allBtn.onclick=guard(()=>{replaceAllMatches();updateUi();});
 layer.body.append(findLabel,repLabel,caseRow,countOut,navRow);
 updateUi({jump:true});
 const opened=layers.open(layer,{onClose:()=>{state.find.open=false;invalidate();notify();}});
 requestAnimationFrame(()=>findInput.focus({preventScroll:true}));
 return opened;
}
