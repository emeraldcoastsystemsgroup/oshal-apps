// GENERATED from scripts/editor-source-projects/postgres.fixture.mjs; sha256=c8f97695af436d3258d736ad078368504969ce52c754b03e6bd06b6a1a600a8e
/** Isolated local-image disposable PG; tests never read installed connection strings. */
import {execFileSync} from 'node:child_process';
import Module,{createRequire} from 'node:module';
import {resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const sourceSchema=()=>readFile(new URL('../../migrations/006-editor-source-projects.sql',import.meta.url),'utf8');
export function dependencies(){const root=process.env.STORE_CI_TOOLCHAIN;if(!root)throw Error('STORE_CI_TOOLCHAIN must select the canonical pinned Store toolchain');process.env.NODE_PATH=[resolve(root,'node_modules'),process.env.NODE_PATH].filter(Boolean).join(':');Module._initPaths();return createRequire(resolve(root,'package.json'));}
const docker=args=>execFileSync('docker',args,{encoding:'utf8',timeout:30000,stdio:['ignore','pipe','pipe']}).trim();
export async function fixture(t,prefix='brand_source'){
 const token=randomUUID(),name='oshal-editor-source-'+token.replaceAll('-',''),{Pool}=dependencies()('pg');
 const image=docker(['image','inspect','postgres:16-alpine','--format','{{.Id}}']);assert.match(image,/^sha256:[a-f0-9]{64}$/);
 let admin,pool;
 t.after(async()=>{try{await pool?.end();await admin?.end();}finally{const inspected=JSON.parse(docker(['inspect',name]))[0];assert.equal(inspected.Config.Labels['oshal.editor-source-fixture'],token);docker(['rm','--force','--volumes',name]);assert.equal(docker(['ps','--all','--filter',`name=^/${name}$`,'--format','{{.ID}}']),'');}});
 docker(['run','--detach','--pull=never','--name',name,'--label',`oshal.editor-source-fixture=${token}`,'--memory','512m','--cpus','1','--tmpfs','/var/lib/postgresql/data:rw,size=256m','--publish','127.0.0.1::5432','--env','POSTGRES_PASSWORD=synthetic-only',image]);
 const port=docker(['port',name,'5432/tcp']);assert.match(port,/^127\.0\.0\.1:\d+$/);
 const common={host:'127.0.0.1',port:Number(port.split(':')[1]),database:'postgres',connectionTimeoutMillis:1000,query_timeout:10000,max:8};
 admin=new Pool({...common,user:'postgres',password:'synthetic-only'});
 const end=Date.now()+15000;for(;;){try{await admin.query('SELECT 1');break;}catch(error){if(Date.now()>end)throw error;await new Promise(done=>setTimeout(done,100));}}
 await admin.query("CREATE ROLE editor_source_app LOGIN PASSWORD 'synthetic-app-only' NOSUPERUSER NOBYPASSRLS");await admin.query('GRANT USAGE,CREATE ON SCHEMA public TO editor_source_app');
 pool=new Pool({...common,user:'editor_source_app',password:'synthetic-app-only'});await pool.query(await sourceSchema(prefix));await pool.query(await sourceSchema(prefix));
 return{pool,admin,image};
}
