/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Resolution shim: src-routes/trading-research-routes.ts imports './trading-archive-news' (plain JavaScript under routes/). Test runners that do not read this package's vitest aliases (the installed Test Lab's runner) found no module, so every suite loading the research routes ran zero tests. The compiled routes require routes/trading-archive-news.js directly.
 *
 * @module trading-archive-news
 */
'use strict';

module.exports = require('../routes/trading-archive-news');
