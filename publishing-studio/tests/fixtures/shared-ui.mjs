/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Mount actual shared editor assets and the native public card alias in disposable Publishing browser fixtures.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Pass explicit root to sendFile so platform roots under dot-prefixed state directories (e.g. ~/.local/state) serve cleanly.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Mount /cockpit/css/themes alongside /shared/ui so surface-themes.css @import rules resolve in browser fixtures.
 * 4 | maintainer@emeraldcoastsystemsgroup.com | The shared UI comes from the kernel platform the store gate pins (OSHAL_KERNEL_PLATFORM, which the publishing-studio step now declares; STORE_CI_KERNEL_PLATFORM on the gate machine) or from one named by hand (OSHAL_PLATFORM_ROOT), and the cases refuse a folder that holds no shared editor. They used to fall back to <clone>/../oshal-kernel/platform, on the gate machine a link to the live kernel checkout: kernel 00c62f98 (the one chat window) made the old concierge box a hidden stand-in there, and workbench-browser case 39 failed two FULL gates with no store change.
 * 5 | maintainer@emeraldcoastsystemsgroup.com | The concierge pane is the kernel's one chat window (kernel 00c62f98: the shared editor pane frames the Jarvis page as Publishing's concierge; Roger, 2026-11-16: every concierge is the core Jarvis chat window, with its model menu). The shared editor mount also serves that window from the same platform folder with its stand-in kernel (scripts/one-chat-window/kernel-window.mjs: the model menu's rails, the conversations, and the bot's door, which answers at once and then with the steps and the answer). sharedEditor({answer}) hands a suite its own stand-in (`kernel.asks` keeps every turn as the door received it) and the extend that mounts it; a suite's page.route still sees each turn first.
 */
import {existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {requireRuntime} from './runtime.mjs';
import {mountWindow,windowKernel} from '../../../scripts/one-chat-window/kernel-window.mjs';
const express=requireRuntime('express');
// Named, never looked for: the platform beside a clone is whatever that checkout holds at the moment, not the platform production runs.
const named=process.env.OSHAL_KERNEL_PLATFORM||process.env.OSHAL_PLATFORM_ROOT;
if(!named||!existsSync(resolve(named,'src/shared/ui/js/editor-foundation.js')))throw new Error('Publishing browser cases need a kernel platform folder holding src/shared/ui (got '+JSON.stringify(named??null)+'): OSHAL_KERNEL_PLATFORM, which the store gate sets to its pin, or OSHAL_PLATFORM_ROOT by hand');
const platform=resolve(named);

/**
 * @description Mount the shared editor assets, the native card alias and the one chat window with its stand-in kernel.
 * The native alias serves the existing presenter; it is not a file under src/shared/ui.
 * @param {object} app The fixture's Express app.
 * @param {object} [kernel] The stand-in kernel behind the window (windowKernel); a fresh one answering "Done." by default.
 * @returns {object} The stand-in kernel.
 */
export function mountSharedEditor(app,kernel=windowKernel()){
 app.get('/shared/ui/js/package-tool-cards.js',(_request,response)=>response.sendFile('src/api/jarvis-package-tools.js',{root:platform}));
 app.use('/shared/ui',express.static(resolve(platform,'src/shared/ui')));
 app.use('/cockpit/css/themes',express.static(resolve(platform,'src/pages/cockpit/css/themes')));
 mountWindow(app,{platform,kernel});
 return kernel;
}

/**
 * @description A suite's own stand-in kernel for the one chat window, and the fixture extend that mounts it.
 * @param {{answer?:function(object):(string|object)}} [options] The stand-in's answer to a turn (windowKernel).
 * @returns {{kernel:object,extend:function(object):object}} The stand-in and the extend for fixture({extend}).
 */
export function sharedEditor(options){
 const kernel=windowKernel(options);
 return{kernel,extend:app=>mountSharedEditor(app,kernel)};
}
