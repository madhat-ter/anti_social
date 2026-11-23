/**
 * Builds the cPanel package: `.cpanel/anti-cpanel.zip` (see docs/deploy-cpanel.md).
 *
 *   bun scripts/build-cpanel.ts            # site address defaults to https://tryanti.social
 *   SITE=https://example.org bun scripts/build-cpanel.ts
 *   bun scripts/build-cpanel.ts --publish             # and push it to the cpanel-site branch
 *   bun scripts/build-cpanel.ts --publish --no-push   # stage it in .cpanel/site-repo only, to look
 *
 * What's inside (unzipped into the Node.js app's folder in cPanel):
 *   app.cjs            the startup file cPanel runs; it loads anti/server.mjs
 *   package.json       tiny, so cPanel's Node.js page is happy (no packages to install)
 *   anti/server.mjs    a web copy: pages from Next.js, /api/… passed to the keeper
 *   anti/keeper.mjs    the one process that owns the database (started by a web copy)
 *   anti/common.mjs    shared by both
 *   anti/web/…         Next.js "standalone" build (its own node_modules, plain files)
 *   anti/api/…         the API bundled into one file + PGlite and sharp built for Linux
 *   anti/drizzle, anti/sql   migrations and SQL functions, applied on every start
 *
 * Built on Windows for Linux: nothing in it is a Windows binary. The repo here uses Bun's
 * "isolated" node_modules (links); Next.js copies those as links that only work on this PC, so the
 * build runs in a copy of the repo (.cpanel/src) installed with plain folders ("hoisted").
 */
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';

const ROOT = resolve(import.meta.dir, '..');
const OUT = join(ROOT, '.cpanel');
const SRC = join(OUT, 'src');
const PKG = join(OUT, 'pkg');
const SITE = (process.env.SITE ?? 'https://tryanti.social').replace(/\/$/, '');

function run(cmd: string, args: string[], cwd: string, env: Record<string, string> = {}) {
  console.log(`\n$ ${cmd} ${args.join(' ')}   (in ${cwd.replace(ROOT, '.')})`);
  const r = spawnSync(cmd, args, { cwd, stdio: 'inherit', shell: process.platform === 'win32', env: { ...process.env, ...env } });
  if (r.status !== 0) throw new Error(`${cmd} failed (${r.status})`);
}

// 1. a copy of the working tree (tracked + new files, nothing ignored), keeping its node_modules
const files = execFileSync('git', ['ls-files', '-co', '--exclude-standard', '-z'], { cwd: ROOT, encoding: 'utf8' })
  .split('\0').filter(Boolean)
  .filter((f) => !/^(COST\.xlsx|reports\/|research_notes\/|\.claude\/|\.commandcode\/)/.test(f));
for (const d of ['apps', 'packages', 'scripts', 'deploy']) rmSync(join(SRC, d), { recursive: true, force: true, maxRetries: 3 });
for (const f of files) {
  const from = join(ROOT, f);
  if (!existsSync(from)) continue; // deleted in the working tree
  mkdirSync(dirname(join(SRC, f)), { recursive: true });
  cpSync(from, join(SRC, f));
}
console.log(`copied ${files.length} files to ${SRC}`);

// 2. plain-folder install, then the web build
run('bun', ['install', '--linker', 'hoisted'], SRC);
const web = join(SRC, 'apps/web');
rmSync(join(web, '.next'), { recursive: true, force: true });
run('bun', ['run', 'build'], web, { NEXT_OUTPUT: 'standalone', API_URL: `${SITE}/api`, NEXT_TELEMETRY_DISABLED: '1', NEXT_DIST_DIR: '.next' });

// 3. the package
rmSync(PKG, { recursive: true, force: true, maxRetries: 3 });
const anti = join(PKG, 'anti');
mkdirSync(anti, { recursive: true });
cpSync(join(web, '.next/standalone'), join(anti, 'web'), { recursive: true, dereference: true, verbatimSymlinks: false });
cpSync(join(web, '.next/static'), join(anti, 'web/apps/web/.next/static'), { recursive: true });
if (existsSync(join(web, 'public'))) cpSync(join(web, 'public'), join(anti, 'web/apps/web/public'), { recursive: true });
// sharp came along for Next's image optimiser, which the site doesn't use (no next/image); its
// binaries are for this PC anyway. The API has its own Linux sharp in anti/api.
for (const d of ['sharp', '@img']) rmSync(join(anti, 'web/node_modules', d), { recursive: true, force: true });
// standalone's own server.js is replaced by anti/server.mjs; its config is read from required-server-files.json
rmSync(join(anti, 'web/apps/web/server.js'), { force: true });

run('bun', ['build', join(SRC, 'apps/api/src/embedded.ts'), '--target=node', '--format=esm',
  `--outfile=${join(anti, 'api/index.mjs')}`, '--external=@electric-sql/pglite', '--external=sharp', '--external=bun'], SRC);
cpSync(join(SRC, 'packages/db/drizzle'), join(anti, 'drizzle'), { recursive: true });
cpSync(join(SRC, 'packages/db/sql'), join(anti, 'sql'), { recursive: true });

// PGlite (WASM) and sharp (Linux x64 binaries) for the API, fetched for the server's system
const lock = readFileSync(join(ROOT, 'bun.lock'), 'utf8');
const version = (name: string) => {
  const m = lock.match(new RegExp(`"${name.replace('/', '\\/')}": \\["${name.replace('/', '\\/')}@([^"]+)"`));
  if (!m) throw new Error(`no version of ${name} in bun.lock`);
  return m[1];
};
const apiDeps = { '@electric-sql/pglite': version('@electric-sql/pglite'), sharp: version('sharp') };
writeFileSync(join(anti, 'api/package.json'), JSON.stringify({ name: 'anti-api', private: true, type: 'module', dependencies: apiDeps }, null, 2));
run('npm', ['install', '--omit=dev', '--no-package-lock', '--no-audit', '--no-fund', '--os=linux', '--cpu=x64', '--libc=glibc'], join(anti, 'api'));

for (const f of ['server.mjs', 'keeper.mjs', 'common.mjs']) cpSync(join(ROOT, 'deploy/cpanel', f), join(anti, f));
cpSync(join(ROOT, 'deploy/cpanel/app.cjs'), join(PKG, 'app.cjs'));
const commit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
const dirty = execFileSync('git', ['status', '--porcelain'], { cwd: ROOT, encoding: 'utf8' }).trim() ? '+changes' : '';
writeFileSync(join(anti, 'BUILD.txt'), `built ${new Date().toISOString()} from ${commit}${dirty} for ${SITE}\n`);
writeFileSync(join(PKG, 'package.json'), JSON.stringify({ name: 'anti', private: true, main: 'app.cjs', scripts: { start: 'node app.cjs' } }, null, 2));

// 4. zip (Windows' tar is bsdtar, which writes zip with -a)
const zip = join(OUT, 'anti-cpanel.zip');
rmSync(zip, { force: true });
run('tar', ['-a', '-cf', zip, 'app.cjs', 'package.json', 'anti'], PKG);
console.log(`\nready: ${zip}`);

// 5. --publish: the package becomes the newest commit of the `cpanel-site` branch, which cPanel's
// Git Version Control pulls into ~/anti-app (a browser upload is capped at 10 MB, and cPanel
// sessions drop when the owner's connection changes address). The branch holds only built files.
if (process.argv.includes('--publish')) {
  const BRANCH = 'cpanel-site';
  const repo = join(OUT, 'site-repo');
  const origin = execFileSync('git', ['remote', 'get-url', 'origin'], { cwd: ROOT, encoding: 'utf8' }).trim();
  const git = (...a: string[]) => run('git', ['-c', 'core.autocrlf=false', '-c', 'core.safecrlf=false', ...a], repo);
  if (!existsSync(join(repo, '.git'))) {
    mkdirSync(repo, { recursive: true });
    run('git', ['init', '-q'], repo);
    git('remote', 'add', 'origin', origin);
    // the same author as the main repo (whose identity may be set only there)
    for (const k of ['user.name', 'user.email']) {
      const v = spawnSync('git', ['config', k], { cwd: ROOT, encoding: 'utf8' }).stdout.trim();
      if (v) execFileSync('git', ['config', k, v], { cwd: repo });
    }
  }
  const remoteHas = spawnSync('git', ['ls-remote', '--exit-code', '--heads', 'origin', BRANCH], { cwd: repo }).status === 0;
  if (remoteHas) { git('fetch', '-q', 'origin', BRANCH); git('checkout', '-q', '-B', BRANCH, `origin/${BRANCH}`); }
  else git('checkout', '-q', '--orphan', BRANCH);

  // The previous build's own static files (css/js, named by their contents) stay beside the new
  // ones. LiteSpeed can keep an old web copy running after an update, and the pages it serves
  // still link those files: on 2026-11-23 every page lost its CSS until the old copy was ended.
  // Only one build back is kept (anti/STATIC.txt lists a build's own files), so nothing piles up.
  const STATIC_DIR = 'anti/web/apps/web/.next/static';
  const STATIC_LIST = 'anti/STATIC.txt';
  const filesIn = (dir: string) => !existsSync(dir) ? [] : (readdirSync(dir, { recursive: true }) as string[])
    .map((f) => f.replaceAll('\\', '/'))
    .filter((f) => statSync(join(dir, f)).isFile());
  const before = join(OUT, 'static-before');
  rmSync(before, { recursive: true, force: true, maxRetries: 3 });
  const listed = join(repo, STATIC_LIST);
  const prevOwn = existsSync(listed) ? readFileSync(listed, 'utf8').split('\n').filter(Boolean) : filesIn(join(repo, STATIC_DIR));
  for (const f of prevOwn) {
    const from = join(repo, STATIC_DIR, f);
    if (!existsSync(from)) continue;
    mkdirSync(dirname(join(before, f)), { recursive: true });
    cpSync(from, join(before, f));
  }

  for (const f of ['app.cjs', 'package.json', 'anti', 'apps', 'README.md']) rmSync(join(repo, f), { recursive: true, force: true, maxRetries: 3 });
  for (const f of ['app.cjs', 'package.json', 'anti']) cpSync(join(PKG, f), join(repo, f), { recursive: true });

  writeFileSync(listed, filesIn(join(repo, STATIC_DIR)).join('\n') + '\n');
  let kept = 0;
  for (const f of filesIn(before)) {
    const to = join(repo, STATIC_DIR, f);
    if (existsSync(to)) continue;
    mkdirSync(dirname(to), { recursive: true });
    cpSync(join(before, f), to);
    kept++;
  }
  rmSync(before, { recursive: true, force: true, maxRetries: 3 });
  console.log(`kept ${kept} static files of the previous build beside the new ones`);
  // Vercel builds every branch from apps/web: tell it there is nothing to build here
  mkdirSync(join(repo, 'apps/web'), { recursive: true });
  writeFileSync(join(repo, 'apps/web/vercel.json'), JSON.stringify({ ignoreCommand: 'exit 0', git: { deploymentEnabled: false } }, null, 2));
  writeFileSync(join(repo, 'README.md'), `# Built site for cPanel\n\nMade by \`bun scripts/build-cpanel.ts --publish\` on main. Don't edit by hand.\nSee docs/deploy-cpanel.md on main.\n\n${readFileSync(join(anti, 'BUILD.txt'), 'utf8')}`);
  writeFileSync(join(repo, '.gitattributes'), '* -text\n');
  git('add', '-A');
  if (spawnSync('git', ['diff', '--cached', '--quiet'], { cwd: repo }).status === 0) console.log('cpanel-site: nothing changed');
  else if (process.argv.includes('--no-push')) {
    // a dry run: the change is staged in .cpanel/site-repo for a look, nothing is committed or pushed
    run('git', ['diff', '--cached', '--stat'], repo);
    console.log(`--no-push: staged in ${repo}, not committed`);
  } else {
    // the message goes through a file: with shell on Windows, -m "a b" arrives as separate words
    const msg = join(OUT, 'site-commit.txt');
    writeFileSync(msg, `Site build: ${readFileSync(join(anti, 'BUILD.txt'), 'utf8').trim()}\n`);
    git('commit', '-q', '-F', msg);
    git('push', '-q', 'origin', `${BRANCH}:${BRANCH}`);
    console.log(`pushed ${BRANCH}`);
  }
}
