import test from 'node:test';
import assert from 'node:assert/strict';
import {legacyAccess,permissions} from '../../routes/office-editor/authorization.mjs';

test('legacy generation entry refreshes its own named authority and original identity',async()=>{
 let identity={isActive:true,issuer:'native-test',sub:'owner',principalId:'principal',tenantIds:['tenant']},allowed=true,changeIdentity=false;
 const ctx={authorization:{currentActor:()=>({...identity}),authorize:async({permission})=>{if(changeIdentity)identity={...identity,sub:'different'};return{allowed:permission!=='legacy.access'||allowed};}}};
 assert.equal(await legacyAccess(ctx),true);
 allowed=false;assert.equal(await legacyAccess(ctx),false);
 const current=await permissions(ctx);assert.equal(current.view,true);assert.equal(current.legacyAccess,false);
 allowed=true;changeIdentity=true;assert.equal(await legacyAccess(ctx),false);
 identity={...identity,isActive:false};assert.equal(await legacyAccess(ctx),false);
 assert.equal(await legacyAccess({}),false);
});
