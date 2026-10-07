import { spawn } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const commands = [
  ['api', ['--watch', resolve(root, 'server/index.mjs')]],
  ['web', [resolve(root, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1']]
];
const children = commands.map(([name, args]) => {
  const child = spawn(process.execPath, args, { cwd: root, stdio: 'inherit', windowsHide: true });
  child.on('error', e => { console.error(`${name}: ${e.message}`); stop(1); });
  child.on('exit', code => { if (!stopping) stop(code || 0); });
  return child;
});
let stopping = false;
function stop(code = 0) { if (stopping) return; stopping = true; for (const child of children) child.kill('SIGTERM'); process.exitCode = code; }
process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());
