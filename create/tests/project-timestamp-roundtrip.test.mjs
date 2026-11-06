/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Exercise the actual project store with a deterministic advancing statement clock; require full create/append/read/list/history equality and preserve immutable owned image references, owner fences and optimistic revision refusal.
 */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {CreateProjectStore}=require('../routes/create-project-store.js');
const alice={issuer:'https://create-time.fixture.invalid',sub:'alice'};
const bob={issuer:alice.issuer,sub:'bob'};
const assetId='b1500000-0000-4000-8000-000000000001';
const clone=value=>structuredClone(value);
const key=(issuer,sub,id)=>JSON.stringify([issuer,sub,id]);

/** Strict stateful SQL seam: defaults advance per statement, as native8cf does.
 * It evaluates declared INSERT columns and UPDATE assignments rather than supplying
 * prearranged return timestamps, so the old production store fails the round trip.
 * This is a unit seam, not a PostgreSQL/kernel permission or image-file acceptance.
 */
function advancingClockPool(){
 const projects=new Map(),revisions=new Map(),references=[];
 const assets=new Map([[key(alice.issuer,alice.sub,assetId),{asset_id:assetId,width:16,height:16,byte_length:24,sha256:'a'.repeat(64)}]]);
 let clock=Date.parse('2026-11-04T12:00:00.000Z');
 const pool={projects,revisions,references,assets,queries:[],connect:async()=>{
  let owner;
  return {release(){},query:async(raw,values=[])=>{
   const sql=raw.replace(/\s+/g,' ').trim(),now=new Date(clock+=10).toISOString();pool.queries.push({sql,values:clone(values)});
   const result=rows=>({rows:clone(rows),rowCount:rows.length});
   if(sql.startsWith('SELECT set_config')){owner=values.slice(0,2);return result([]);}
   if(/^(BEGIN|COMMIT|ROLLBACK|SET LOCAL)\b/.test(sql))return result([]);
   if(sql.startsWith('SELECT pg_advisory_xact_lock')){assert.equal(values[0],JSON.stringify(owner));return result([]);}
   assert.deepEqual(values.slice(0,2),owner,'each business query stays on the admitted owner');
   const own=rows=>[...rows.values()].filter(row=>row.owner_issuer===owner[0]&&row.owner_sub===owner[1]);
   const expression=token=>{
    token=token.trim();const parameter=/^\$(\d+)(::jsonb)?$/.exec(token);
    if(parameter){const value=values[Number(parameter[1])-1];return parameter[2]?JSON.parse(value):value;}
    if(/^\d+$/.test(token))return Number(token);
    if(token==='NOW()')return now;
    throw Error('Unreviewed fixture SQL expression: '+token);
   };
   if(sql.startsWith('INSERT INTO create_project_revision_assets')){
    assert.equal(sql.includes('SELECT $3,$4,$1,$2,unnest($5::uuid[])'),true);
    for(const id of values[4]){assert(assets.has(key(...owner,id)));references.push({owner:clone(owner),project:values[2],revision:values[3],asset:id});}
    return result([]);
   }
   const insert=/^INSERT INTO (create_projects|create_project_revisions) \(([^)]+)\) VALUES \(([^)]+)\)(?: RETURNING .+)?$/.exec(sql);
   if(insert){
    const row=Object.fromEntries(insert[2].split(',').map((column,index)=>[column.trim(),expression(insert[3].split(',')[index])]));
    assert.equal(row.owner_issuer,owner[0]);assert.equal(row.owner_sub,owner[1]);
    row.created_at??=now;
    if(insert[1]==='create_projects'){row.updated_at??=now;row.current_revision??=1;projects.set(key(...owner,row.project_id),row);}
    else revisions.set(key(...owner,row.project_id)+':'+row.revision,row);
    return result(sql.includes(' RETURNING ')?[row]:[]);
   }
   if(sql.startsWith('UPDATE create_projects SET ')){
    assert(sql.includes('WHERE owner_issuer=$1 AND owner_sub=$2 AND project_id=$3 AND current_revision=$6'));
    const row=projects.get(key(...owner,values[2]));if(!row||row.current_revision!==values[5])return result([]);
    const assignments=sql.split(' SET ')[1].split(' WHERE ')[0].split(',');
    for(const assignment of assignments){const [name,value]=assignment.split('=');row[name]=expression(value);}
    return result([row]);
   }
   assert(sql.startsWith('SELECT ')&&sql.includes('owner_issuer=$1')&&sql.includes('owner_sub=$2'),'reads require exact owner predicates');
   if(sql.startsWith('SELECT COUNT(*)'))return result([{count:own(projects).length}]);
   if(sql.includes('FROM create_project_assets'))return result(values[2].flatMap(id=>{const row=assets.get(key(...owner,id));return row?[row]:[];}));
   if(sql.includes('JOIN create_project_revisions')){
    const project=projects.get(key(...owner,values[2]));if(!project)return result([]);
    const revision=revisions.get(key(...owner,values[2])+':'+(values[3]??project.current_revision));
    return result(revision?[{...project,title:revision.title,current_revision:revision.revision,updated_at:revision.created_at,document:revision.document}]:[]);
   }
   if(sql.includes('FROM create_project_revisions'))return result(own(revisions).filter(row=>row.project_id===values[2]).sort((a,b)=>b.revision-a.revision));
   if(sql.includes('FROM create_projects'))return result(values.length>=3?own(projects).filter(row=>row.project_id===values[2]):own(projects));
   throw Error('Unreviewed fixture query: '+sql);
  }};
 }};
 return pool;
}
function input(title){return {title,document:{version:1,name:title,width:16,height:16,background:'transparent',
 images:{photo:{src:'/api/create/project-assets/'+assetId,width:16,height:16}},
 layers:[{id:'photo',type:'image',assetId:'photo',x:0,y:0,w:16,h:16}]}};}
const metadata=({document,...rest})=>rest;
const confirm=async()=>{};

test('create has one canonical timestamp across exact read/list/revision snapshots',async()=>{
 const pool=advancingClockPool(),store=new CreateProjectStore(pool),assetBefore=clone([...pool.assets]);
 const created=await store.create(alice,input('First owned image'),confirm);
 assert.deepEqual(await store.get(alice,created.id),created);
 assert.deepEqual(await store.list(alice),[metadata(created)]);
 assert.deepEqual(await store.revisions(alice,created.id),[{revision:1,title:created.title,createdAt:created.updatedAt}]);
 assert.deepEqual(created.document,input('First owned image').document);
 assert.deepEqual([...pool.assets],assetBefore);
 assert.deepEqual(await store.list(bob),[]);
 await assert.rejects(store.get(bob,created.id),error=>error.status===404&&error.code==='project_not_found');
});

test('append keeps current/history timestamps canonical without widening owner or revision locks',async()=>{
 const pool=advancingClockPool(),store=new CreateProjectStore(pool),assetBefore=clone([...pool.assets]);
 const first=await store.create(alice,input('First owned image'),confirm);
 const second=await store.save(alice,first.id,1,input('Second owned image'),confirm);
 assert.deepEqual(await store.get(alice,first.id),second);
 assert.deepEqual(await store.get(alice,first.id,1),first);
 assert.deepEqual(await store.list(alice),[metadata(second)]);
 assert.deepEqual(await store.revisions(alice,first.id),[
  {revision:2,title:second.title,createdAt:second.updatedAt},{revision:1,title:first.title,createdAt:first.updatedAt}]);
 assert(second.updatedAt>first.updatedAt);assert.equal(second.createdAt,first.createdAt);
 assert.deepEqual(second.document,input('Second owned image').document);
 await assert.rejects(store.save(alice,first.id,1,input('Stale save'),confirm),error=>error.status===409&&error.code==='project_revision_conflict');
 await assert.rejects(store.save(bob,first.id,2,input('Foreign save'),confirm),error=>error.status===404&&error.code==='project_not_found');
 assert.deepEqual(await store.get(alice,first.id),second);
 assert.deepEqual([...pool.assets],assetBefore);
 assert.equal(pool.references.length,2);
});
