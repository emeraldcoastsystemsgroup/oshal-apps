/** CHANGE LOG
 * SEQ | AUTHOR | DESCRIPTION
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Group explicit employer/client records for presentation without changing their stored order or identity.
 */
(function(root){
 'use strict';
 const HEADING='Selected Client Engagements';
 /** Pure one-level presentation; source indexes and independent records remain unchanged. */
 function ordered(roles){
  const out=[],items=Array.isArray(roles)?roles:[];
  items.forEach((role,index)=>{
   if(role.parent_role_id)return;
   out.push({role,index,child:false,heading:''});
   if(role.id)items.forEach((child,at)=>{
    if(child.parent_role_id===role.id)out.push({role:child,index:at,child:true,
     heading:role.engagements_heading===HEADING&&!out.some(row=>row.child&&row.role.parent_role_id===role.id)?HEADING:''});
   });
  });
  if(out.length!==items.length)throw Error('An employer relationship cannot be read. Open Work history again.');
  return out;
 }
 /** Select only root employers; a parent with existing children cannot itself become a client. */
 function parents(roles,index){
  return roles.map((role,at)=>({role,index:at})).filter(row=>row.index!==index&&!row.role.parent_role_id);
 }
 const api={HEADING,ordered,parents};root.CareerRoleHierarchy=api;
 if(typeof module==='object'&&module.exports)module.exports=api;
})(typeof window==='object'?window:globalThis);
