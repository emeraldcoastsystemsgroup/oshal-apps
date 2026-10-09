/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Own the bounded context-host child process and verify cleanup before completing an experience audit.
 */
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * @description Start the real source host inside the audit's disposable directory.
 * @param {object} ctx - Extracted exact-source audit context.
 * @param {object} env - Sanitized environment supplied by the audit runner.
 * @returns {Promise<{baseUrl:string,close:Function}>} Loopback origin and awaited cleanup.
 */
export async function startExperienceSurfaceHost(ctx, env) {
  const workspace = join(ctx.tmp, 'experience-surface-host'); mkdirSync(workspace, { recursive: true });
  const child = spawn(process.execPath, [join(ctx.framework, 'node_modules/tsx/dist/cli.mjs'), '--tsconfig', join(ctx.framework, 'tsconfig.json'),
    join(ctx.tree, 'scripts/security/experience-surface-host.ts'), ctx.pkgDir, workspace, ctx.framework], { cwd: ctx.tmp,
    env: { ...env, APP_PACKAGE_DYNAMIC_ROUTES: 'true', APP_PACKAGE_MIGRATIONS: 'false', OSHAL_APPLICATION_AUTHORIZATION_MODE: 'enforce', APP_ACCESS_ENFORCEMENT: 'enforce' }, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  let output = '', errors = '';
  child.stderr.on('data', chunk => { errors = (errors + chunk).slice(-8000); });
  const exit = new Promise(resolve => { child.once('exit', code => resolve(code)); });
  try {
    const baseUrl = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Context audit host startup timed out')), 90000);
      const failed = code => { clearTimeout(timer); reject(new Error(`Context audit host exited ${code}: ${errors}`)); };
      child.once('error', error => { clearTimeout(timer); reject(error); }); child.once('exit', failed);
      child.stdout.on('data', chunk => {
        output = (output + chunk).slice(-16000);
        for (const line of output.split(/\r?\n/)) {
          try {
            const message = JSON.parse(line);
            if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(message.baseUrl || '')) continue;
            clearTimeout(timer); child.removeListener('exit', failed); resolve(message.baseUrl); return;
          } catch { /* Framework log lines are not host readiness. */ }
        }
      });
    });
    return { baseUrl, close: async () => {
      if (child.exitCode !== null) throw new Error(`Context audit host exited early ${child.exitCode}: ${errors}`);
      child.send({ action: 'close' });
      let timer;
      const code = await Promise.race([exit, new Promise(resolve => { timer = setTimeout(() => { child.kill(); resolve(-1); }, 10000); })]);
      clearTimeout(timer);
      if (code !== 0) throw new Error(`Context audit host cleanup failed ${code}: ${errors}`);
    } };
  } catch (error) { child.kill(); await exit; throw error; }
}
