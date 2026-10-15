/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Resolve genuine pinned Store dependencies before application imports in clean source-test processes.
 */
import Module,{createRequire} from 'node:module';
import {resolve,join} from 'node:path';
import {existsSync} from 'node:fs';
const repository=resolve(import.meta.dirname,'../../..');
const toolchain=resolve(process.env.STORE_CI_TOOLCHAIN??join(repository,'scripts/toolchain'));
if(!existsSync(join(toolchain,'package-lock.json')))throw new Error('Pinned Store toolchain package-lock.json is required');
export const requireRuntime=createRequire(join(toolchain,'package.json'));
// Only this disposable test process changes resolution. Application code and its
// native runtime remain unchanged; no dependency link or fake module is installed.
for(const module of ['express','multer'])requireRuntime.resolve(module);
process.env.NODE_PATH=join(toolchain,'node_modules');
Module._initPaths();
