/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Resolution shim: src-routes/trading-autopilot-routes.ts imports './futures/native' (the native Futures study is plain JavaScript under routes/futures/). Test runners that do not read this package's vitest aliases (the installed Test Lab's runner) found no module, so every suite loading the autopilot routes ran zero tests. The compiled routes require routes/futures/native.js directly; this file is only the source-tree resolution.
 *
 * @module futures/native
 */
'use strict';

module.exports = require('../../routes/futures/native');
