const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {execFileSync}=require('node:child_process');
test('Source and compiled Vids pages agree and every script parses in its declared grammar',()=>{
 const pages=['src-routes/vids-routes.ts','routes/vids-routes.js'].map(file=>{const source=fs.readFileSync(path.join(__dirname,'..',file),'utf8'),match=source.match(/`(<!doctype html>[\s\S]*?<\/html>)`/i);assert.ok(match);return new Function('return `'+match[1]+'`;')();});
 assert.equal(pages[0],pages[1]);
 for(const match of pages[0].matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/gi)){
  if(!match[2].trim())continue;
  if(/type="module"/.test(match[1]))execFileSync(process.execPath,['--check','--input-type=module'],{input:match[2],stdio:'pipe'});
  else new vm.Script(match[2]);
 }
});
