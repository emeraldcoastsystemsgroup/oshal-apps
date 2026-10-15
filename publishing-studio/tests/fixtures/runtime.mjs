/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Resolve genuine pinned dependencies in disposable Source test processes only.
 */
import Module,{createRequire} from 'node:module';
import {resolve,join} from 'node:path';
import {existsSync} from 'node:fs';
const repository=resolve(import.meta.dirname,'../../..'),toolchain=resolve(process.env.STORE_CI_TOOLCHAIN??join(repository,'scripts/toolchain'));
if(!existsSync(join(toolchain,'package-lock.json')))throw new Error('Pinned Store toolchain package-lock.json required');
export const requireRuntime=createRequire(join(toolchain,'package.json'));
for(const dependency of ['pg','express','multer'])requireRuntime.resolve(dependency);
process.env.NODE_PATH=join(toolchain,'node_modules');Module._initPaths();
