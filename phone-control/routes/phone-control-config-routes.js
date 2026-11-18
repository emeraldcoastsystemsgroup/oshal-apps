/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Pairing and hardware probe routes for iPhone BLE HID, TBS / AirPlay receiver keys, and Android Wireless ADB.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | 1.1.0: only the configuration screen. Every pairing and verify route here wrote a row and answered success without reaching a phone; pairing now runs on the person's own computer (adb pair, the Bluetooth pairing window), started from the page.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | 1.20.3: use lib/router.js resolveRouter() for Express 5 / raw http.createServer compatibility.
 */

'use strict';

const path = require('node:path');
const createRouter = require('../lib/router.js').resolveRouter();

/**
 * @description Serve the Connect a device screen (the same page, opened on its configuration view).
 * @param {object} ctx The package context with appPackageDir.
 * @returns {object} The router.
 */
function createPhoneControlConfigRoutes(ctx) {
  const router = createRouter();
  const page = path.join(ctx?.appPackageDir || path.resolve(__dirname, '..'), 'tools', 'phone-control.html');
  router.get('/ui', (req, res) => res.sendFile(page));
  return router;
}

module.exports = { createPhoneControlConfigRoutes };
