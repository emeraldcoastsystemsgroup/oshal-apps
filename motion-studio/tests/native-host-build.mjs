/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Build an isolated fixture against the actual kernel crates and lockfile without editing or sharing its Cargo target.
 */
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
const kernel = process.env.OSHAL_KERNEL_ROOT;
if (!kernel) throw new Error('Explicit OSHAL_KERNEL_ROOT required.');
const build = process.env.MOTION_NATIVE_BUILD_DIR || '/tmp/oshal-creative-motion-native-host';
const target = process.env.MOTION_NATIVE_TARGET_DIR || '/tmp/oshal-creative-motion-native-target';
await mkdir(resolve(build, 'src'), { recursive: true, mode: 0o700 });
const workspace = await readFile(resolve(kernel, 'Cargo.toml'), 'utf8');
const section = workspace.split('[workspace.dependencies]')[1]?.split(/^\[/m)[0];
if (!section) throw new Error('Missing actual workspace dependency pins');
const external = ['async-trait', 'serde_json', 'sha2', 'tokio', 'tokio-postgres'];
const dependencies = external.map(name => {
  const line = section.split('\n').find(line => line.startsWith(name + ' ='));
  if (!line || line.includes('path')) throw new Error('Missing external dependency pin: ' + name);
  return line;
});
for (const name of ['control', 'kernel-types', 'observe', 'packages', 'sdk', 'store']) {
  dependencies.push(name + ' = { path = ' + JSON.stringify(resolve(kernel, 'crates', name)) + ' }');
}
const manifest = '[package]\nname = "oshal-motion-native-fixture"\nversion = "0.1.0"\nedition = "2024"\n\n[dependencies]\n' + dependencies.join('\n') + '\n';
await writeFile(resolve(build, 'Cargo.toml'), manifest, { mode: 0o600 });
await copyFile(resolve(kernel, 'Cargo.lock'), resolve(build, 'Cargo.lock'));
await copyFile(new URL('./native-host.rs', import.meta.url), resolve(build, 'src/main.rs'));
const child = spawn('cargo', ['build', '--offline', '--manifest-path', resolve(build, 'Cargo.toml')],
  { env: { ...process.env, CARGO_TARGET_DIR: target }, stdio: 'inherit' });
const code = await new Promise((done, reject) => { child.on('error', reject); child.on('close', done); });
if (code) throw new Error('Native fixture build failed: ' + code);
console.log('Native fixture: ' + resolve(target, 'debug/oshal-motion-native-fixture'));
