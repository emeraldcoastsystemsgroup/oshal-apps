/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Share the explicitly configured framework fixture across genuine browser and Office renderer contracts on Linux and Windows.
 */
import { existsSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import Module, { createRequire } from 'node:module';
import { join, resolve } from 'node:path';

/** The fixture must contain the authored renderer and its locked test dependencies. */
export function frameworkFixture(env = process.env) {
  const root = env.OSHAL_FRAMEWORK || env.OSHAL_CORE_ROOT || env.OSHAL_CORE_DIR || env.OSHAL_ROOT;
  if (!root) throw new Error('Presentations contracts require an explicit OSHAL_FRAMEWORK framework fixture');
  const absolute = resolve(root);
  for (const file of ['src/features/presentation-generation/index.ts', 'node_modules/typescript/package.json', 'node_modules/playwright/package.json']) {
    if (!existsSync(join(absolute, file))) throw new Error(`Presentations framework fixture is missing ${file}`);
  }
  return absolute;
}

/** Compile the framework's actual Office renderer, retaining only the declared seams. */
export function presentationEngine(root, seams) {
  const frameworkRequire = createRequire(join(root, 'package.json'));
  const ts = frameworkRequire('typescript');
  const loaded = new Map();
  const sourceFile = (base) => {
    const file = [base + '.ts', join(base, 'index.ts')].find(existsSync);
    if (!file) throw new Error('Cannot resolve authored framework renderer source');
    return file;
  };
  function load(filename) {
    if (loaded.has(filename)) return loaded.get(filename).exports;
    const subject = new Module(filename);
    subject.filename = filename;
    loaded.set(filename, subject);
    subject.require = (name) => {
      if (Object.hasOwn(seams, name)) return seams[name];
      if (name.startsWith('@/')) return load(sourceFile(join(root, 'src', name.slice(2))));
      if (name.startsWith('.')) return load(sourceFile(resolve(filename, '..', name)));
      return frameworkRequire(name);
    };
    const source = ts.transpileModule(readFileSync(filename, 'utf8'), {
      compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true},
    }).outputText;
    subject._compile(source, filename);
    return subject.exports;
  }
  return load(sourceFile(join(root, 'src/features/presentation-generation')));
}
