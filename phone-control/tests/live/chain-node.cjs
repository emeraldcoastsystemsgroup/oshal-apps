/** CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | phone-control 1.1.0 T5, the computer's side, run inside chain-desktop: the real OSHAL Node app (the published AppImage) on a plain desktop signs in to the throwaway kernel as its login page does, asks Let Jarvis control this computer, and the real Allow button is clicked from outside the app. Then it stays up, taking whatever commands the kernel sends, until the browser half on the host writes /out/done. Uses the kernel's own proof helpers (desktop/oshal-node/scripts/computer-proof-support.cjs), unchanged. */
'use strict';
const fs = require('node:fs');
const S = require('/app/scripts/computer-proof-support.cjs');
(async () => {
  await S.desktop();
  S.launch('phone-proof-computer');
  const signed = await S.signIn();
  if (signed !== 201) throw new Error(`sign-in answered ${signed}`);
  await S.until(() => S.windowExists('Let Jarvis control'), 'the Let Jarvis control question on screen', 60000);
  await S.pressAllow();
  const [computer] = await S.until(async () => { const list = await S.computers(); return list.length && list[0].can_control && list; }, 'the computer connected with control on', 45000);
  fs.writeFileSync('/out/computer.json', JSON.stringify(computer));
  console.log('computer ready', computer.id);
  await S.until(() => fs.existsSync('/out/done'), 'the browser half to finish', 900000);
  S.finish();
})().catch((error) => { console.error(error); fs.writeFileSync('/out/computer-failed.txt', String(error.stack || error)); S.finish(); process.exitCode = 1; });
