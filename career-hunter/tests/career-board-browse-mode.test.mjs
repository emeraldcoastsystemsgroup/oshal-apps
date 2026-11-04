/** The redesigned search is available before résumé upload; the board stays a shortlist.
 * The former inline-board VM is superseded by real-screen cases in browser/career-journey-proof.mjs. */
import test from 'node:test';import assert from 'node:assert/strict';import {basename} from 'node:path';import {loadCompiledModules} from './helpers/career-route-harness.mjs';
const {modules}=loadCompiledModules({surface:'routes/career-surface-routes.js'});
function handlers(){const routes=new Map();modules.surface.registerCareerSurfaceRoutes({get:(route,handler)=>routes.set(route,handler)});return routes;}
function serve(route,query={}){let file,cache;handlers().get(route)({query},{setHeader:(name,value)=>{if(name==='Cache-Control')cache=value;},sendFile:value=>file=value});return {file:basename(file),cache};}
test('search stays an open-jobs surface without any résumé or score prerequisite',()=>{assert.equal(serve('/search-ui').file,'career-search.html');});
test('the Job Board and its root aliases render the saved-job list rather than a scored-to-corpus fallback',()=>{for(const route of ['/board-native','/',''])assert.equal(serve(route).file,'career-job-lists.html');});
test('recommendations remain under Search while one selected job has a dedicated application page',()=>{assert.equal(serve('/search-ui',{view:'matches'}).file,'career-job-lists.html');assert.equal(serve('/board-native',{view:'queue',application:'81'}).file,'career-application.html');assert.equal(serve('/board-native',{view:'status',application:'81'}).file,'career-application.html');});
test('selected-job routing cannot become arbitrary file access and all surfaces forbid caching',()=>{for(const application of ['../career_db.json','<script>','0','-1']){const result=serve('/board-native',{application});assert.equal(result.file,'career-job-lists.html');assert.match(result.cache,/no-store/);}});
