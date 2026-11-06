/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Mount actual shared editor assets and the native public card alias in disposable Publishing browser fixtures.
 */
import {resolve} from 'node:path';
import {requireRuntime} from './runtime.mjs';
const express=requireRuntime('express');
const platform=resolve(process.env.OSHAL_PLATFORM_ROOT || resolve(import.meta.dirname,'../../../../oshal-kernel/platform'));

/** The native alias serves the existing presenter; it is not a file under src/shared/ui. */
export function mountSharedEditor(app){
 app.get('/shared/ui/js/package-tool-cards.js',(_request,response)=>response.sendFile(resolve(platform,'src/api/jarvis-package-tools.js')));
 app.use('/shared/ui',express.static(resolve(platform,'src/shared/ui')));
}
