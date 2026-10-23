/* CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | Refuse SQL forms the native package interpreter rejects (row-value/tuple comparisons, found on the installed lab 2026-10-22 as "unsupported SQL expression: Tuple"); the installed live anomaly run is the boundary proof, this guard stops the form from returning in any route. */
'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const routes=path.resolve(__dirname,'../routes');
// A parenthesized column list compared with a parenthesized bind-parameter list, anywhere in the route source (SQL is often concatenated, so fragments need not start with a verb).
const TUPLE=/\(\s*[a-z_][a-z0-9_.]*(?:\s*,\s*[a-z_][a-z0-9_.]*)+\s*\)\s*(?:[<>]=?|=|IN)\s*\(\s*\$/gi;
test('package SQL avoids row-value comparisons the native interpreter refuses',()=>{
 const offenders=[];
 for(const file of fs.readdirSync(routes).filter(f=>f.endsWith('.js'))){
  const source=fs.readFileSync(path.join(routes,file),'utf8');
  for(const match of source.matchAll(TUPLE))offenders.push(file+': '+match[0]);
 }
 assert.deepEqual(offenders,[]);
 assert.equal(" AND (observed_at, id) > ($3::timestamptz, $4) AND".match(TUPLE)?.length,1,'the guard recognizes the refused form inside a concatenated fragment');
});
