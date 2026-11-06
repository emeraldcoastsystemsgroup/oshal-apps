/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Keep foundation review documents in an isolated atomic JSON store using the actual Create model.
 */
import {randomUUID} from 'node:crypto';
import {mkdirSync,readFileSync,writeFileSync,renameSync,existsSync,lstatSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {createProject,applyOperation,validateProject} from '../../create/tools/editor/model.mjs';
const clone=structuredClone;
export class ReviewError extends Error {constructor(status,message){super(message);this.status=status;}}
export class ReviewStore {
 constructor(file){
  this.file=resolve(file);mkdirSync(dirname(this.file),{recursive:true,mode:0o700});
  if(lstatSync(dirname(this.file)).isSymbolicLink()||(existsSync(this.file)&&lstatSync(this.file).isSymbolicLink()))throw new Error('Review state must not use symbolic links');
  this.state=existsSync(this.file)?JSON.parse(readFileSync(this.file,'utf8')):{version:1,projects:{}};
  if(this.state.version!==1||typeof this.state.projects!=='object')throw new Error('Unsupported review store');
  for(const record of Object.values(this.state.projects))for(const revision of record.history)validateProject(revision.document,{assetMode:'reference'});
  if(!Object.keys(this.state.projects).length){
   let document=createProject({name:'Foundation review — image',width:1000,height:700,background:'#ffffff'});
   document=applyOperation(document,{type:'add',layer:{id:'review-shape',type:'rect',name:'Select this shape',x:100,y:100,w:440,h:220,fill:'#3b82f6',stroke:'#1e3a8a',strokeWidth:3}});
   document=applyOperation(document,{type:'add',layer:{id:'review-heading',type:'text',name:'Editable title',x:100,y:380,w:750,h:100,text:'Make something together',fontSize:46,fontWeight:700,fill:'#172554'}});
   this.create(document);
  }
 }
 transaction(change){const next=clone(this.state),answer=change(next),temporary=this.file+'.'+randomUUID()+'.tmp';writeFileSync(temporary,JSON.stringify(next),{mode:0o600,flag:'wx'});renameSync(temporary,this.file);this.state=next;return clone(answer);}
 list(){return Object.values(this.state.projects).map(record=>this.metadata(record.history.at(-1)));}
 metadata(record){return Object.fromEntries(['id','title','revision','createdAt','updatedAt'].map(key=>[key,record[key]]));}
 read(id,revision){const project=this.state.projects[id];if(!project)throw new ReviewError(404,'review_project_not_found');const record=revision?project.history.find(row=>row.revision===Number(revision)):project.history.at(-1);if(!record)throw new ReviewError(404,'review_revision_not_found');return clone(record);}
 validate(document,title){const result=validateProject(document,{assetMode:'reference'});if(title!==undefined&&result.name!==title)throw new ReviewError(400,'review_title_mismatch');if(Object.keys(result.images).length)throw new ReviewError(503,'Review image upload is unavailable; shape, text and vector editing remain available.');return result;}
 create(document,title){const validated=this.validate(document,title);return this.transaction(next=>{if(Object.keys(next.projects).length>=32)throw new ReviewError(413,'review_project_limit');const now=new Date().toISOString(),record={id:randomUUID(),title:validated.name,document:validated,revision:1,createdAt:now,updatedAt:now};next.projects[record.id]={history:[record]};return record;});}
 save(id,body){const validated=this.validate(body.document,body.title);return this.transaction(next=>{const history=next.projects[id]?.history;if(!history)throw new ReviewError(404,'review_project_not_found');const prior=history.at(-1);if(prior.revision!==body.baseRevision)throw new ReviewError(409,'project_revision_conflict');if(history.length>=100)throw new ReviewError(413,'review_revision_limit');const record={...prior,document:validated,title:validated.name,revision:prior.revision+1,updatedAt:new Date().toISOString()};history.push(record);return record;});}
 remove(id,baseRevision){return this.transaction(next=>{const prior=next.projects[id]?.history.at(-1);if(!prior)throw new ReviewError(404,'review_project_not_found');if(baseRevision!==prior.revision)throw new ReviewError(409,'project_revision_conflict');delete next.projects[id];return{deleted:true};});}
}
