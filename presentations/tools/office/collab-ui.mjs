/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 2.20.0 (RP-OFF-02, RP-OFF-03, RP-OFF-07): Comments sheet (add, reply, resolve), Suggest changes sheet (mode toggle, per-change and bulk accept/reject), and Share sheet (invite, role update, revoke and access audit log).
 */
import{uid,plain}from'./model.mjs';
import{state,editable,currentPage,currentItem,edit,adopt,api,save,dirty,notify,status}from'./state.mjs';
import{refreshDocuments,updateHistory}from'./files.mjs';
import{invalidate}from'./render.mjs';

const make=(tag,className,text)=>{const node=document.createElement(tag);if(className)node.className=className;if(text!==undefined)node.textContent=text;return node;};
const shortTime=iso=>{const d=new Date(iso);return Number.isNaN(d.getTime())?iso:d.toLocaleString(undefined,{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});};

async function applyCommentOperations(ops){
 if(editable()){edit(ops,{keepCaret:true});invalidate();notify();return;}
 if(!state.id||!state.canComment)throw new Error('You do not have comment permission on this document.');
 const result=await api(`/documents/${state.id}/collaborate`,{method:'POST',body:{baseRevision:state.revision,requestKey:uid(),operations:ops}});
 adopt(result.document);await updateHistory();invalidate();notify();
}

function defaultCommentAnchor(){
 const page=currentPage(),items=(page?.objects??page?.blocks??[]).filter(i=>i.runs);
 const item=(currentItem()?.runs?currentItem():items[0])??null;
 if(!page||!item)return null;
 const len=plain(item.runs).length,start=state.selected===item.id&&state.range?Math.min(state.range.start,len):0;
 const end=state.selected===item.id&&state.range&&state.range.end>start?Math.min(state.range.end,len):len;
 return{pageId:page.id,targetId:item.id,start,end,quote:plain(item.runs).slice(start,end)};
}

function renderCommentCard(comment,canComment,refreshList,guard){
 const card=make('article','office-thread-card'+(comment.resolved?' is-resolved':''));
 card.dataset.commentCard=comment.id;
 const head=make('div','office-thread-head'),who=make('strong','',comment.author),when=make('span','office-thread-meta',shortTime(comment.createdAt)+(comment.resolved?' · Resolved':''));
 head.append(who,when);card.append(head);
 if(comment.quote){
  const quoteBtn=make('button','office-thread-quote','“'+comment.quote.slice(0,80)+'”');quoteBtn.type='button';
  quoteBtn.onclick=()=>{state.page=comment.page;state.selected=comment.targetId;invalidate();notify();};
  card.append(quoteBtn);
 }
 card.append(make('p','office-thread-body',comment.text));
 for(const reply of comment.replies??[]){
  const rNode=make('div','office-thread-reply');
  rNode.append(make('span','office-thread-meta',`${reply.author} · ${shortTime(reply.createdAt)}`),make('p','office-thread-body',reply.text));
  card.append(rNode);
 }
 if(canComment){
  const actions=make('div','office-thread-actions');
  const toggle=make('button','',comment.resolved?'Reopen':'Resolve');toggle.type='button';toggle.dataset.officeAction='resolve-comment';
  toggle.onclick=guard(async()=>{await applyCommentOperations([{op:'resolve-comment',id:comment.id,resolved:!comment.resolved}]);refreshList();});
  actions.append(toggle);
  if(editable()){
   const del=make('button','ds-danger','Delete');del.type='button';del.dataset.officeAction='remove-comment';
   del.onclick=guard(async()=>{await applyCommentOperations([{op:'remove-comment',id:comment.id}]);refreshList();});
   actions.append(del);
  }
  const replyForm=make('form','office-reply-row'),replyInput=make('input',''),replyBtn=make('button','','Reply');
  replyInput.type='text';replyInput.placeholder='Reply…';replyInput.required=true;replyInput.setAttribute('aria-label','Reply to comment');replyInput.dataset.officeField='reply-comment';
  replyBtn.type='submit';replyBtn.dataset.officeAction='reply-comment';
  replyForm.append(replyInput,replyBtn);
  replyForm.onsubmit=guard(async event=>{
   event?.preventDefault();const val=replyInput.value.trim();if(!val)return;
   await applyCommentOperations([{op:'reply-comment',id:comment.id,reply:{author:state.actorSub||'Author',text:val}}]);
   replyInput.value='';refreshList();
  });
  card.append(actions,replyForm);
 }
 return card;
}

export function openCommentsSheet(layers,guard,{focusCommentId=null}={}){
 if(state.model.kind==='xlsx'){status('Comments apply to documents and presentations.',true);return null;}
 const layer=layers.create('Comments','ds-sheet ds-half'),canComment=editable()||Boolean(state.id&&state.canComment);
 const anchor=defaultCommentAnchor(),listHost=make('div','office-thread-list');
 const refreshList=()=>{
  const items=[...(state.model.comments??[])].sort((a,b)=>Number(a.resolved)-Number(b.resolved));
  listHost.replaceChildren(...items.map(c=>renderCommentCard(c,canComment,refreshList,guard)));
  if(!items.length)listHost.append(make('p','office-help','No comments yet.'));
 };
 if(canComment&&anchor){
  const form=make('form','office-comment-form'),note=make('p','office-thread-meta',anchor.quote?`Commenting on “${anchor.quote.slice(0,60)}”`:'Commenting on selected block');
  const box=make('textarea',''),submit=make('button','primary','Add comment');
  box.rows=2;box.required=true;box.placeholder='Add a comment…';box.setAttribute('aria-label','Comment text');box.dataset.officeField='new-comment';
  submit.type='submit';submit.dataset.officeAction='add-comment';
  form.append(note,box,submit);
  form.onsubmit=guard(async event=>{
   event?.preventDefault();const val=box.value.trim();if(!val)return;
   await applyCommentOperations([{op:'add-comment',comment:{page:anchor.pageId,targetId:anchor.targetId,start:anchor.start,end:anchor.end,quote:anchor.quote,author:state.actorSub||'Author',text:val}}]);
   box.value='';refreshList();status('Comment added');
  });
  layer.body.append(form);
 }
 refreshList();layer.body.append(listHost);
 const opened=layers.open(layer);
 requestAnimationFrame(()=>{
  if(focusCommentId)layer.body.querySelector(`[data-comment-card="${CSS.escape(focusCommentId)}"]`)?.scrollIntoView({block:'nearest'});
  else layer.body.querySelector('[data-office-field="new-comment"]')?.focus({preventScroll:true});
 });
 return opened;
}

function renderChangeCard(change,refreshList,guard){
 const card=make('article','office-thread-card');card.dataset.changeCard=change.id;
 const kindLabel=change.type==='insert'?'Inserted':'Deleted';
 const head=make('div','office-thread-head');
 head.append(make('strong','',`${kindLabel} by ${change.author}`),make('span','office-thread-meta',shortTime(change.createdAt)));
 const preview=make('p',change.type==='insert'?'office-change-preview-ins':'office-change-preview-del','“'+change.text+'”');
 card.append(head,preview);
 if(editable()){
  const row=make('div','office-thread-actions');
  const accept=make('button','primary','Accept'),reject=make('button','','Reject');
  accept.type=reject.type='button';accept.dataset.officeAction='accept-change';reject.dataset.officeAction='reject-change';
  accept.onclick=guard(()=>{edit([{op:'accept-change',id:change.id}],{keepCaret:true});invalidate();notify();refreshList();});
  reject.onclick=guard(()=>{edit([{op:'reject-change',id:change.id}],{keepCaret:true});invalidate();notify();refreshList();});
  row.append(accept,reject);card.append(row);
 }
 return card;
}

export function openSuggestChangesSheet(layers,guard){
 if(state.model.kind!=='docx'){status('Tracked changes apply to Word documents.',true);return null;}
 const layer=layers.create('Suggest changes','ds-sheet ds-half');
 const toggleRow=make('label','office-check-row'),box=make('input','');
 box.type='checkbox';box.checked=Boolean(state.suggesting);box.disabled=!editable();box.dataset.officeAction='toggle-suggest';
 toggleRow.append(box,make('span','','Record edits as tracked suggestions'));
 const bulkRow=make('div','office-thread-actions'),acceptAll=make('button','','Accept all'),rejectAll=make('button','','Reject all');
 acceptAll.type=rejectAll.type='button';acceptAll.dataset.officeAction='accept-all-changes';rejectAll.dataset.officeAction='reject-all-changes';
 bulkRow.append(acceptAll,rejectAll);
 const listHost=make('div','office-thread-list');
 const refreshList=()=>{
  const changes=state.model.changes??[];
  bulkRow.hidden=!changes.length||!editable();
  listHost.replaceChildren(...changes.map(ch=>renderChangeCard(ch,refreshList,guard)));
  if(!changes.length)listHost.append(make('p','office-help',state.suggesting?'Suggest mode is on. Type or delete on the page to record changes.':'No tracked changes in this document.'));
 };
 box.onchange=()=>{state.suggesting=box.checked;status(state.suggesting?'Suggesting changes':'Editing directly');notify();refreshList();};
 acceptAll.onclick=guard(()=>{edit([{op:'accept-all-changes'}],{keepCaret:true});invalidate();notify();refreshList();status('Accepted all tracked changes');});
 rejectAll.onclick=guard(()=>{edit([{op:'reject-all-changes'}],{keepCaret:true});invalidate();notify();refreshList();status('Rejected all tracked changes');});
 layer.body.append(toggleRow);
 if(!editable()&&state.id&&state.canComment){
  const anchor=defaultCommentAnchor();
  if(anchor){
   const form=make('form','office-comment-form'),inp=make('input',''),btn=make('button','primary','Suggest change');
   inp.type='text';inp.value=anchor.quote;inp.placeholder='Suggested text…';inp.dataset.officeField='propose-change-text';btn.type='submit';btn.dataset.officeAction='propose-change';
   form.append(make('p','office-thread-meta','Suggest replacement for current paragraph:'),inp,btn);
   form.onsubmit=guard(async e=>{e?.preventDefault();await applyCommentOperations([{op:'propose-change',page:anchor.pageId,id:anchor.targetId,start:anchor.start,end:anchor.end,text:inp.value,author:state.actorSub||'Reviewer'}]);refreshList();status('Suggested change recorded');});
   layer.body.append(form);
  }
 }
 refreshList();
 layer.body.append(bulkRow,listHost);
 return layers.open(layer);
}

export async function openShareSheet(layers,guard){
 if(!state.id||dirty()){
  if(!editable())throw new Error('Save this document before sharing it.');
  await save();await refreshDocuments();await updateHistory();
 }
 const layer=layers.create('Share','ds-sheet');
 if(state.accessRole!=='owner'){
  layer.body.append(make('p','office-help',`Shared by ${state.ownerSub||'owner'} · Your permission: ${state.accessRole}. Only the owner can change sharing.`));
  return layers.open(layer);
 }
 const form=make('form','office-share-form');
 const subLabel=make('label','office-field','Person ID or email'),subInput=make('input','');
 subInput.type='text';subInput.required=true;subInput.placeholder='bob';subInput.dataset.officeField='share-grantee';subLabel.append(subInput);
 const roleLabel=make('label','office-field','Permission'),roleSelect=make('select','');roleSelect.dataset.officeField='share-role';
 for(const[val,txt]of [['view','Can view'],['comment','Can comment'],['edit','Can edit']]){const opt=make('option','',txt);opt.value=val;roleSelect.append(opt);}
 roleLabel.append(roleSelect);
 const submit=make('button','primary','Share');submit.type='submit';submit.dataset.officeAction='grant-share';
 form.append(subLabel,roleLabel,submit);
 const shareList=make('div','office-thread-list'),auditTitle=make('h3','','Recent access activity'),auditList=make('div','office-audit-list');
 const loadShares=async()=>{
  const data=await api(`/documents/${state.id}/shares`);
  shareList.replaceChildren(...data.shares.map(entry=>{
   const row=make('div','office-share-row');row.dataset.shareGrantee=entry.granteeSub;
   const info=make('span','',`${entry.granteeSub} · ${entry.role}`),revoke=make('button','ds-danger','Revoke');
   revoke.type='button';revoke.dataset.officeAction='revoke-share';revoke.dataset.shareId=entry.id;
   revoke.onclick=guard(async()=>{await api(`/documents/${state.id}/shares/${entry.id}`,{method:'DELETE'});await loadShares();status(`Revoked access for ${entry.granteeSub}`);});
   row.append(info,revoke);return row;
  }));
  if(!data.shares.length)shareList.append(make('p','office-help','Only you have access right now.'));
  auditList.replaceChildren(...data.audit.slice(0,12).map(a=>make('div','office-audit-row',`${a.actorSub} · ${a.action} (${a.role}) · ${shortTime(a.createdAt)}`)));
  if(!data.audit.length)auditList.append(make('p','office-help','No shared activity recorded yet.'));
 };
 form.onsubmit=guard(async event=>{
  event?.preventDefault();const granteeSub=subInput.value.trim();if(!granteeSub)return;
  await api(`/documents/${state.id}/shares`,{method:'POST',body:{granteeSub,role:roleSelect.value,requestKey:uid()}});
  subInput.value='';await loadShares();status(`Shared with ${granteeSub} (${roleSelect.value})`);
 });
 layer.body.append(form,shareList,auditTitle,auditList);
 await loadShares();
 const opened=layers.open(layer);
 requestAnimationFrame(()=>subInput.focus({preventScroll:true}));
 return opened;
}
