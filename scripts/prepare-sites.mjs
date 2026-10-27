import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const apiUrl = process.argv[2];
if (!apiUrl || !apiUrl.startsWith('https://')) {
  throw new Error('Usage: node scripts/prepare-sites.mjs https://YOUR-API.onrender.com');
}
const parsed = new URL(apiUrl);
if (parsed.username || parsed.password || parsed.search || parsed.hash) {
  throw new Error('Supply a public HTTPS API URL without credentials, query, or fragment.');
}
const site = path.join(root, 'sites', 'ascertain-dashboard');
const manifestPath = path.join(site, '.openai', 'hosting.json');
if (!existsSync(manifestPath)) {
  throw new Error('Register the Site and persist its hosting manifest before preparing a release.');
}
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
if (!manifest.project_id) throw new Error('Missing registered Sites project ID.');
const result = spawnSync('npm', ['run', 'build'], {
  cwd: path.join(root, 'frontend'),
  env: { ...process.env, VITE_API_URL: apiUrl.replace(/\/$/, '') },
  stdio: 'inherit',
});
if (result.status !== 0) process.exit(result.status || 1);
mkdirSync(site, { recursive: true });
rmSync(path.join(site, 'dist'), { recursive: true, force: true });
cpSync(path.join(root, 'frontend', 'dist'), path.join(site, 'dist'), { recursive: true });
writeFileSync(path.join(site, 'README.md'), [
  '# Ascertain Care frontend release',
  '',
  'Static React/Vite build for ChatGPT Sites.',
  'Source: https://github.com/liamcox/ascertain-full-stack-take-home',
  `API: ${apiUrl.replace(/\/$/, '')}`,
  '',
  'The FastAPI API uses a managed PostgreSQL database. No patient records or secrets are packaged here.',
  '',
].join('\n'));
console.log(`Prepared Sites assets in ${site}`);
