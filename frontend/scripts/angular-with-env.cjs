const { existsSync, readFileSync } = require('node:fs');
const { spawnSync } = require('node:child_process');
const { parseEnv } = require('node:util');
const { join } = require('node:path');

const root = join(__dirname, '..');
const envFile = join(root, '.env');
const exampleFile = join(root, '.env.example');
const defaults = parseEnv(readFileSync(exampleFile, 'utf8'));
const local = existsSync(envFile) ? parseEnv(readFileSync(envFile, 'utf8')) : {};
const url = process.env.TERMS_AND_CONDITIONS_URL ?? local.TERMS_AND_CONDITIONS_URL ?? defaults.TERMS_AND_CONDITIONS_URL;

if (!/^https?:\/\/\S+$/.test(url)) {
  console.error('TERMS_AND_CONDITIONS_URL must be an absolute HTTP(S) URL.');
  process.exit(1);
}

const [command, ...args] = process.argv.slice(2);
const result = spawnSync(
  process.execPath,
  [require.resolve('@angular/cli/bin/ng.js'), command, ...args, '--define', `TERMS_AND_CONDITIONS_URL=${JSON.stringify(url)}`],
  { cwd: root, stdio: 'inherit' },
);
if (result.error) throw result.error;
process.exit(result.status ?? 1);