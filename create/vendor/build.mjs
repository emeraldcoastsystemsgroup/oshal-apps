/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Bundle pinned polygon booleans locally with explicit sweep/queue ceilings and retained license notices.
 */
import { build } from 'esbuild';
await build({ entryPoints: ['polygon-clipping'], bundle: true, format: 'esm', platform: 'browser',
  minify: true, legalComments: 'eof', outfile: '../tools/editor/polygon-clipping.mjs',
  define: { process: '{"env":{"POLYGON_CLIPPING_MAX_QUEUE_SIZE":50000,"POLYGON_CLIPPING_MAX_SWEEPLINE_SEGMENTS":50000}}' } });
