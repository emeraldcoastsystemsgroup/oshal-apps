#!/usr/bin/env node
/** Deterministic package-owned runtime and PostgreSQL/native DDL. --check never writes. */
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {sourceSchema} from './schema.mjs';
export const consumers=[['portrait-studio','portrait_source'],['brand-graphics','brand_source'],['creative-studio','story_source'],['vids','vids_source']];
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const canonical=await readFile(new URL('./source-project-store.mjs',import.meta.url),'utf8');
const sha=createHash('sha256').update(canonical).digest('hex');
const output=`// GENERATED from scripts/editor-source-projects/source-project-store.mjs; sha256=${sha}\n// Regenerate: node scripts/editor-source-projects/vendor.mjs\n${canonical}`;
const fixtureCanonical=await readFile(new URL('./postgres.fixture.mjs',import.meta.url),'utf8');
const fixtureHash=createHash('sha256').update(fixtureCanonical).digest('hex');
const fixtureOutput=`// GENERATED from scripts/editor-source-projects/postgres.fixture.mjs; sha256=${fixtureHash}\n`+fixtureCanonical.replace("import {sourceSchema} from './schema.mjs';", "import {readFile} from 'node:fs/promises';\nconst sourceSchema=()=>readFile(new URL('../../migrations/006-editor-source-projects.sql',import.meta.url),'utf8');");
let failed=false;
for(const [app,prefix] of consumers)for(const [path,content] of [[`${app}/tests/fixtures/editor-source-postgres.fixture.mjs`,fixtureOutput],[`${app}/routes/vendor/source-project-store.mjs`,output],[`${app}/migrations/006-editor-source-projects.sql`,sourceSchema(prefix)],[`${app}/migrations/native/006-editor-source-projects.sql`,sourceSchema(prefix,{native:true})]]){
 const destination=resolve(root,path),old=await readFile(destination,'utf8').catch(()=>null);
 if(old===content)continue;
 if(process.argv.includes('--check')){process.stderr.write(`Outdated generated editor source: ${path}\n`);failed=true;}
 else{await mkdir(dirname(destination),{recursive:true});await writeFile(destination,content);process.stdout.write(`Generated ${path}\n`);}
}
if(failed)process.exitCode=1;
