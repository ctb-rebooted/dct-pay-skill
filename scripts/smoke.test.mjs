// Smoke test for the dct-pay CLI. Run: node --test skills/dct-pay/scripts/smoke.test.mjs
// No network: uses --key for snippet and an isolated config path.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdtempSync } from 'node:fs';
import * as fsMod from 'node:fs';
import { tmpdir } from 'node:os';

const cli = join(dirname(fileURLToPath(import.meta.url)), 'dct-pay.mjs');
const isolated = { ...process.env, DCT_EARN_CONFIG: join(mkdtempSync(join(tmpdir(), 'dct-pay-')), 'config.json'), DCT_PAY_API: 'http://127.0.0.1:9' };
const run = (...args) => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', env: isolated });

test('--help exits 0 and lists both flows', () => {
  const r = run('--help');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /register/);
  assert.match(r.stdout, /slot add/);
});

test('snippet --key renders a <script data-app-key> without config or network', () => {
  const r = run('snippet', '--key', 'dce_pk_test123', '--app', 'app_demo', '--kind', 'script');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /data-app-key="dce_pk_test123"/);
  assert.match(r.stdout, /earn\.iife\.js/);
});

test('snippet --json returns all snippet kinds incl. tip-button and a framework file', () => {
  const r = run('snippet', '--key', 'dce_pk_x', '--app', 'app_1', '--json');
  assert.equal(r.status, 0, r.stderr);
  const j = JSON.parse(r.stdout);
  assert.deepEqual(Object.keys(j.snippets), ['script', 'pay-button', 'tip-button', 'slot', 'policy', 'file']);
  assert.match(j.snippets.script, /\/sdk\/v1\/earn\.iife\.js/);
  assert.match(j.snippets['pay-button'], /Pro 구매/);
  assert.match(j.snippets['tip-button'], /DocentyEarn\.tipButton/);
  assert.match(j.snippets.slot, /DocentyEarn\.slot/);
  assert.match(j.snippets.file, /DocentyEarn\.identify|earn\.identify/);
});

test('snippet --framework next emits a complete client component file', () => {
  const r = run('snippet', '--key', 'dce_pk_x', '--app', 'app_1', '--kind', 'file', '--framework', 'next');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /'use client'/);
  assert.match(r.stdout, /waitForCheckout/);
  assert.match(r.stdout, /entitled\('pro'\)/);
});

test('commands needing auth exit 3 with a fix line when not logged in', () => {
  const r = run('dashboard');
  assert.equal(r.status, 3);
  assert.match(r.stderr, /NOT_REGISTERED — not logged in/);
  assert.match(r.stderr, /→ run `dct-pay login`/);
});

test('login --key rejects a non-key value without network', () => {
  const r = spawnSync(process.execPath, [cli, 'login', '--key'], { encoding: 'utf8', env: isolated, input: 'nope\n' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /dce_sk_/);
});

test('unreachable API exits 2 with a network message', () => {
  const r = run('register', '--handle', 'x', '--email', 'x@y.z', '--name', 'X');
  assert.equal(r.status, 2);
  assert.match(r.stderr, /network error/);
});


test('product add --kind physical --dry-run validates variants and prints the body without network', () => {
  const r = run('product', 'add', '--app', 'app_1', '--name', '사과', '--kind', 'physical', '--variants', '3kg:15000,5kg:24000', '--shipping', '3000', '--inventory', '20', '--dry-run', '--json');
  assert.equal(r.status, 0, r.stderr);
  const j = JSON.parse(r.stdout);
  assert.equal(j.dryRun, true);
  assert.equal(j.body.kind, 'physical');
  assert.deepEqual(j.body.variants.map((v) => v.priceKrw), [15000, 24000]);
  assert.equal(j.body.shippingKrw, 3000);
  assert.deepEqual(j.body.fulfillment.fields, ['recipient', 'phone', 'address', 'desiredDate']);
  const bad = run('product', 'add', '--app', 'app_1', '--name', 'x', '--kind', 'physical', '--variants', '3kg:12', '--dry-run');
  assert.equal(bad.status, 1);
});

test('product add --input validates JSON and --dry-run needs no login', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dct-pay-in-'));
  const f = join(dir, 'p.json');
  require_fs().writeFileSync(f, JSON.stringify({ appId: 'app_1', kind: 'service', name: '상담', variants: [{ name: '30분', priceKrw: 50000 }], fulfillment: { fields: ['slot', 'method', 'phone'] } }));
  const r = run('product', 'add', '--input', f, '--dry-run', '--json');
  assert.equal(r.status, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).body.kind, 'service');
  require_fs().writeFileSync(f, JSON.stringify({ appId: 'app_1', kind: 'service', name: '상담' }));
  assert.equal(run('product', 'add', '--input', f, '--dry-run').status, 1);
});

test('init --dry-run detects the framework and writes nothing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dct-pay-init-'));
  require_fs().writeFileSync(join(dir, 'package.json'), JSON.stringify({ dependencies: { next: '15.0.0', react: '19.0.0' } }));
  const r = run('init', '--dir', dir, '--key', 'dce_pk_test_abc', '--dry-run', '--json');
  assert.equal(r.status, 0, r.stderr);
  const j = JSON.parse(r.stdout);
  assert.equal(j.framework, 'next');
  assert.ok(j.files.some((f) => f.startsWith('components/EarnPro.tsx')));
  assert.equal(require_fs().existsSync(join(dir, 'components')), false);
});

test('snippet --kind product-card renders the product detail link', () => {
  const r = run('snippet', '--kind', 'product-card', '--product', 'p1', '--handle', 'farm', '--json');
  assert.equal(r.status, 0, r.stderr);
  assert.match(JSON.parse(r.stdout).snippets['product-card'], /\/u\/farm\/p\/p1/);
});

test('--help lists v1.1 commands', () => {
  const r = run('--help');
  assert.match(r.stdout, /template list/);
  assert.match(r.stdout, /invoice send/);
  assert.match(r.stdout, /order fulfill/);
  assert.match(r.stdout, /dct-pay init/);
});

function require_fs() {
  return fsMod;
}

// Every CLI command printed on the landing and case pages must run (validated with --dry-run, no network).
const platformSrc = join(dirname(fileURLToPath(import.meta.url)), '../../../apps/platform/src');
test('landing & case-page dct-pay commands are valid (dry-run)', { skip: !fsMod.existsSync(platformSrc) && 'public mirror: platform sources not present' }, () => {
  const root = platformSrc;
  const cmds = [];
  const page = fsMod.readFileSync(join(root, 'app/page.tsx'), 'utf8');
  for (const m of page.matchAll(/<pre>\{`([^`]*)`\}<\/pre>/g)) cmds.push(...m[1].split('\\n'));
  for (const f of ['components/landing/case-intents.ts', 'components/landing/cases.tsx']) {
    const src = fsMod.readFileSync(join(root, f), 'utf8');
    for (const m of src.matchAll(/code: "((?:\\.|[^"\\])*)"/g)) cmds.push(...JSON.parse(`"${m[1]}"`).split('\n'));
  }
  const runnable = cmds.map((c) => c.trim()).filter((c) => /^dct-pay (product add|template apply|invoice send)\b/.test(c));
  assert.ok(runnable.length >= 15, `found ${runnable.length} commands`);
  const words = (c) => [...c.matchAll(/"([^"]*)"|(\S+)/g)].map((m) => m[1] ?? m[2]);
  for (const c of runnable) {
    const args = words(c).slice(1).map((w) => w.replace(/^<appId>$/, 'app_1').replace(/^<[^>]+>$/, 'p_1'));
    const r = run(...args, '--dry-run', '--json');
    assert.equal(r.status, 0, `${c}\n${r.stderr}${r.stdout}`);
    assert.equal(JSON.parse(r.stdout).dryRun, true, c);
  }
});

test('template apply: a bare --inventory is refused instead of silently meaning 1', () => {
  const r = run('template', 'apply', 'fruit', '--app', 'app_1', '--inventory', '--dry-run');
  assert.equal(r.status, 1);
  assert.match(r.stderr + r.stdout, /--inventory needs a number/);
});

test('tip: one short stderr line at most once a day, never with --json or DCT_PAY_NO_TIPS', () => {
  const env = { ...process.env, DCT_EARN_CONFIG: join(mkdtempSync(join(tmpdir(), 'dct-pay-tip-')), 'config.json'), DCT_PAY_API: 'http://127.0.0.1:9' };
  delete env.DCT_PAY_NO_TIPS;
  const go = (extra = [], e = env) => spawnSync(process.execPath, [cli, 'snippet', '--key', 'dce_pk_test1', '--app', 'app_1', '--kind', 'script', ...extra], { encoding: 'utf8', env: e });
  assert.equal(go(['--json']).stderr, '');
  assert.equal(go([], { ...env, DCT_PAY_NO_TIPS: '1' }).stderr, '');
  const first = go();
  assert.equal(first.status, 0);
  assert.match(first.stderr, /tip: .*utm_source=dct-pay-cli/);
  assert.doesNotMatch(first.stdout, /tip:/); // stdout stays clean for pipes
  assert.equal(go().stderr, ''); // same day → quiet
});

// ---------- ai-block (ad4ai AI 노출 협찬 블록) ----------
import { spawn } from 'node:child_process';
import http from 'node:http';

/** async run (the fake API / page server lives in this process, so spawnSync would deadlock) */
function runAsync(args, { env = {}, cwd } = {}) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [cli, ...args], { env: { ...process.env, DCT_PAY_NO_TIPS: '1', ...env }, cwd });
    let stdout = '';
    let stderr = '';
    p.stdout.on('data', (d) => (stdout += d));
    p.stderr.on('data', (d) => (stderr += d));
    p.on('close', (status) => resolve({ status, stdout, stderr }));
  });
}
function serve(handler) {
  return new Promise((resolve) => {
    const srv = http.createServer(handler);
    srv.listen(0, '127.0.0.1', () => resolve({ srv, base: `http://127.0.0.1:${srv.address().port}` }));
  });
}
function loggedIn(apiBase) {
  const dir = mkdtempSync(join(tmpdir(), 'dct-pay-ai-'));
  const config = join(dir, 'config.json');
  fsMod.writeFileSync(config, JSON.stringify({ version: 2, apiBase, secretKey: 'dce_sk_live_test_only', apps: {} }), { mode: 0o600 });
  return { DCT_EARN_CONFIG: config, DCT_PAY_API: apiBase };
}
const SECRET = 'ss_TOP_SECRET_value_123';
function fakeEarn(calls, { secret = true } = {}) {
  return serve((req, res) => {
    let body = '';
    req.on('data', (d) => (body += d));
    req.on('end', () => {
      calls.push({ method: req.method, url: req.url, auth: req.headers.authorization, body: body ? JSON.parse(body) : null });
      res.setHeader('content-type', 'application/json');
      if (req.method === 'POST') res.end(JSON.stringify({ status: 'pending_review', siteKey: 'sk_site_1', ...(secret ? { secret: SECRET } : {}), hubBase: 'https://ad4ai.docenty.ai/l/answers', mediaId: 'm_1' }));
      else res.end(JSON.stringify({ mediaId: 'm_1', status: 'approved', siteKey: 'sk_site_1', placements: 2, lastVerifiedAt: '2026-10-10T00:00:00.000Z', lastVerdict: 'ok', crawlerVisits30d: 17 }));
    });
  });
}

test('ai-block snippet: every framework renders; build/edge use the marker, the hub tgz honours AD4AI_HUB_BASE', () => {
  for (const fw of ['next-app', 'next-pages', 'astro', 'sveltekit', 'remix', 'nuxt', 'express', 'vite', 'static', 'cloudflare', 'vercel-edge', 'netlify-edge']) {
    const r = spawnSync(process.execPath, [cli, 'ai-block', 'snippet', '--framework', fw, '--site-url', 'https://photo.app', '--json'], { encoding: 'utf8', env: { ...isolated, AD4AI_HUB_BASE: 'http://localhost:4000/l/answers' } });
    assert.equal(r.status, 0, `${fw}: ${r.stderr}`);
    const j = JSON.parse(r.stdout);
    assert.match(j.install, /ai-block install/);
    const code = j.files.map((f) => f.content).join('\n');
    if (j.method === 'build-inject') assert.match(code, /<div data-docenty-slot><\/div>[\s\S]*agent-ads inject \S+ --site-url https:\/\/photo\.app/, fw);
    if (j.method === 'edge') assert.match(code, /injectBlocks[\s\S]*@docenty\/agent-ads\/edge|@docenty\/agent-ads\/edge[\s\S]*injectBlocks/, fw);
    if (j.method === 'ssr') assert.match(code, /AgentAdsBlock|renderHtml/, fw);
    assert.doesNotMatch(code, /user-?agent\)?\s*\?|isBot|crawler\s*\?/i, `${fw} must not branch on UA`);
  }
  const nx = run('ai-block', 'snippet', '--framework', 'next-app');
  assert.match(nx.stdout, /import \{ AgentAdsBlock \} from "@docenty\/agent-ads\/next"/);
  assert.match(nx.stdout, /ai-block install/);
  const vite = run('ai-block', 'snippet', '--framework', 'vite');
  assert.match(vite.stdout, /"postbuild": "agent-ads inject dist --site-url/);
  assert.equal(run('ai-block', 'snippet', '--framework', 'django').status, 1);
});

test('ai-block add --env-path: writes both keys (mode 600, gitignored), never prints the secret', async () => {
  const calls = [];
  const { srv, base } = await fakeEarn(calls);
  try {
    const dir = mkdtempSync(join(tmpdir(), 'dct-pay-repo-'));
    spawnSync('git', ['init', '-q'], { cwd: dir });
    fsMod.writeFileSync(join(dir, '.env.local'), 'OTHER=1\nDOCENTY_SITE_KEY=old\n');
    const r = await runAsync(['ai-block', 'add', '--app', 'app_1', '--categories', '사진 편집,도구', '--env-path', '.env.local'], { env: loggedIn(base), cwd: dir });
    assert.equal(r.status, 0, r.stderr);
    assert.doesNotMatch(r.stdout + r.stderr, new RegExp(SECRET));
    assert.match(r.stdout, /pending_review — 운영자 검토 후 블록이 나옵니다/);
    assert.equal(calls[0].url, '/api/apps/app_1/ai-blocks');
    assert.equal(calls[0].auth, 'Bearer dce_sk_live_test_only');
    assert.deepEqual(calls[0].body, { categories: ['사진 편집', '도구'] });
    const env = fsMod.readFileSync(join(dir, '.env.local'), 'utf8');
    assert.equal(env, `OTHER=1\nDOCENTY_SITE_KEY=sk_site_1\nDOCENTY_SDK_SECRET=${SECRET}\n`);
    assert.equal(fsMod.statSync(join(dir, '.env.local')).mode & 0o777, 0o600);
    assert.match(fsMod.readFileSync(join(dir, '.gitignore'), 'utf8'), /^\.env\.local$/m);
    assert.equal(spawnSync('git', ['check-ignore', '-q', '.env.local'], { cwd: dir }).status, 0);
    // --json carries no secret either
    const j = await runAsync(['ai-block', 'add', '--app', 'app_1', '--rotate', '--json'], { env: loggedIn(base), cwd: dir });
    assert.equal(j.status, 0, j.stderr);
    assert.doesNotMatch(j.stdout, new RegExp(SECRET));
    assert.equal(JSON.parse(j.stdout).secretIssued, true);
    assert.deepEqual(calls[1].body, { rotate: true });
  } finally {
    srv.close();
  }
});

test('ai-block add refuses a git-tracked env file before calling the API', async () => {
  const calls = [];
  const { srv, base } = await fakeEarn(calls);
  try {
    const dir = mkdtempSync(join(tmpdir(), 'dct-pay-repo-'));
    spawnSync('git', ['init', '-q'], { cwd: dir });
    fsMod.writeFileSync(join(dir, '.env'), 'A=1\n');
    spawnSync('git', ['add', '.env'], { cwd: dir });
    const r = await runAsync(['ai-block', 'add', '--app', 'app_1', '--env-path', '.env'], { env: loggedIn(base), cwd: dir });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /tracked by git/);
    assert.equal(calls.length, 0);
  } finally {
    srv.close();
  }
});

test('ai-block add --vercel pipes values via stdin (never argv); repeat without secret writes only the site key', async () => {
  const calls = [];
  const { srv, base } = await fakeEarn(calls);
  const dir = mkdtempSync(join(tmpdir(), 'dct-pay-vercel-'));
  const log = join(dir, 'vercel.log');
  const bin = join(dir, 'vercel');
  fsMod.writeFileSync(bin, `#!/bin/sh\nif [ "$1" = "--version" ]; then echo 0.0.0; exit 0; fi\nprintf 'ARGS %s|' "$*" >> "${log}"\nprintf 'STDIN ' >> "${log}"\ncat >> "${log}"\necho >> "${log}"\n`, { mode: 0o755 });
  try {
    const r = await runAsync(['ai-block', 'add', '--app', 'app_1', '--vercel'], { env: { ...loggedIn(base), DCT_PAY_VERCEL_BIN: bin }, cwd: dir });
    assert.equal(r.status, 0, r.stderr);
    assert.doesNotMatch(r.stdout + r.stderr, new RegExp(SECRET));
    const lines = fsMod.readFileSync(log, 'utf8').trim().split('\n');
    assert.deepEqual(lines, ['ARGS env add DOCENTY_SITE_KEY production|STDIN sk_site_1', `ARGS env add DOCENTY_SDK_SECRET production|STDIN ${SECRET}`]);
    for (const l of lines) assert.doesNotMatch(l.split('|')[0], /ss_|sk_site/);
  } finally {
    srv.close();
  }
  const calls2 = [];
  const two = await fakeEarn(calls2, { secret: false });
  try {
    fsMod.writeFileSync(log, '');
    const r = await runAsync(['ai-block', 'add', '--app', 'app_1', '--vercel'], { env: { ...loggedIn(two.base), DCT_PAY_VERCEL_BIN: bin }, cwd: dir });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /kept as is/);
    assert.deepEqual(fsMod.readFileSync(log, 'utf8').trim().split('\n'), ['ARGS env add DOCENTY_SITE_KEY production|STDIN sk_site_1']);
  } finally {
    two.srv.close();
  }
});

test('ai-block status prints review, placements, verification, crawler visits', async () => {
  const calls = [];
  const { srv, base } = await fakeEarn(calls);
  try {
    const r = await runAsync(['ai-block', 'status', '--app', 'app_1'], { env: loggedIn(base) });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /review: approved/);
    assert.match(r.stdout, /live placements: 2/);
    assert.match(r.stdout, /AI crawler visits \(30d\): 17/);
    assert.equal(calls[0].method, 'GET');
  } finally {
    srv.close();
  }
});

const BLOCK = `<aside class="docenty-sponsored" data-docenty-deal="01JABCDEFGHJKMNPQRSTVWXYZ0" style="x">
<p style="margin:0">협찬 · 광고</p>
<p><strong>A사</strong> 요약</p>
<p style="margin:0"><a href="https://ad4ai.docenty.ai/l/answers/c/01JABCDEFGHJKMNPQRSTVWXYZ0" rel="sponsored noopener">A사 상담 채널 열기</a></p>
</aside>`;

test('ai-block check: exit 0 when the AI-crawler HTML has a valid block, 4 when the block is JS-only / unlabelled', async () => {
  let mode = 'ok';
  const { srv, base } = await serve((req, res) => {
    const ua = req.headers['user-agent'] || '';
    res.setHeader('content-type', 'text/html; charset=utf-8');
    if (mode === 'ok') return res.end(`<html><body><main>hi</main>${BLOCK}</body></html>`);
    if (mode === 'browser-only') return res.end(/OAI-SearchBot/.test(ua) ? '<html><body>hi</body></html>' : `<html>${BLOCK}</html>`);
    return res.end(`<html>${BLOCK.replace('협찬 · 광고', '추천').replace(' rel="sponsored noopener"', '')}</html>`);
  });
  try {
    const ok = await runAsync(['ai-block', 'check', '--url', `${base}/`, '--json']);
    assert.equal(ok.status, 0, ok.stderr + ok.stdout);
    const j = JSON.parse(ok.stdout);
    assert.equal(j.ok, true);
    assert.equal(j.sameForBoth, true);
    assert.deepEqual(j.aiCrawler.blocks[0], { dealId: '01JABCDEFGHJKMNPQRSTVWXYZ0', labelFirstLine: true, channelLink: 'https://ad4ai.docenty.ai/l/answers/c/01JABCDEFGHJKMNPQRSTVWXYZ0', relSponsored: true, valid: true });
    mode = 'browser-only';
    const b = await runAsync(['ai-block', 'check', '--url', `${base}/`]);
    assert.equal(b.status, 4);
    assert.match(b.stdout, /same block for both: NO/);
    assert.match(b.stdout, /FAIL — AI 크롤러가 받는 첫 HTML 에 블록이 없습니다/);
    mode = 'bad';
    const bad = await runAsync(['ai-block', 'check', '--url', `${base}/`, '--json']);
    assert.equal(bad.status, 4);
    assert.equal(JSON.parse(bad.stdout).aiCrawler.blocks[0].labelFirstLine, false);
    assert.equal((await runAsync(['ai-block', 'check', '--url', 'ftp://x'])).status, 1);
  } finally {
    srv.close();
  }
});

test('ai-block install: versioned tarball from latest.json into vendor/, then the package manager installs the file', async () => {
  const { gzipSync } = await import('node:zlib');
  const tgz = gzipSync((await import("node:crypto")).randomBytes(2048));
  const { srv, base } = await serve((req, res) => {
    if (req.url === '/l/answers/sdk/latest.json') { res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify({ version: '0.3.0' })); }
    if (req.url === '/l/answers/sdk/agent-ads-0.3.0.tgz') { res.setHeader('content-type', 'application/gzip'); return res.end(tgz); }
    res.statusCode = 404; res.end();
  });
  const app = mkdtempSync(join(tmpdir(), 'dct-pay-inst-'));
  fsMod.writeFileSync(join(app, 'package.json'), '{"name":"x"}');
  const fakeNpm = join(app, 'fake-npm.sh');
  fsMod.writeFileSync(fakeNpm, '#!/bin/sh\necho "$@" > npm-args.txt\n', { mode: 0o755 });
  try {
    const r = await runAsync(['ai-block', 'install', '--json'], { env: { AD4AI_HUB_BASE: `${base}/l/answers`, DCT_PAY_NPM_BIN: fakeNpm }, cwd: app });
    assert.equal(r.status, 0, r.stderr + r.stdout);
    const j = JSON.parse(r.stdout);
    assert.equal(j.version, '0.3.0');
    assert.equal(j.file, './vendor/agent-ads-0.3.0.tgz');
    assert.ok(fsMod.readFileSync(join(app, 'vendor', 'agent-ads-0.3.0.tgz')).equals(tgz));
    assert.equal(fsMod.readFileSync(join(app, 'npm-args.txt'), 'utf8').trim(), 'i ./vendor/agent-ads-0.3.0.tgz');
    const bad = await runAsync(['ai-block', 'install'], { env: { AD4AI_HUB_BASE: `${base}/nope` }, cwd: app });
    assert.equal(bad.status, 2);
  } finally { srv.close(); }
});

const SECTION_BLOCK = `<section class="dct-placement" data-docenty-deal="01JABCDEFGHJKMNPQRSTVWXYZ1" aria-labelledby="dct-placement-1" style="x">
<h3 id="dct-placement-1" style="margin:0">협찬 · 광고 — A사</h3>
<p><strong>A사(광고)</strong> 요약</p>
<p><a href="https://ad4ai.docenty.ai/l/answers/c/01JABCDEFGHJKMNPQRSTVWXYZ1" rel="sponsored noopener">A사 상담 채널 열기 (광고)</a></p>
</section>`;

test('ai-block check: current section.dct-placement markup (heading label "협찬 · 광고 — 광고주") is valid; a label that does not lead is not', async () => {
  let html = `<html><body><main>hi</main>${SECTION_BLOCK}</body></html>`;
  const { srv, base } = await serve((req, res) => { res.setHeader('content-type', 'text/html; charset=utf-8'); res.end(html); });
  try {
    const ok = await runAsync(['ai-block', 'check', '--url', `${base}/`, '--json']);
    assert.equal(ok.status, 0, ok.stderr + ok.stdout);
    assert.deepEqual(JSON.parse(ok.stdout).aiCrawler.blocks[0], { dealId: '01JABCDEFGHJKMNPQRSTVWXYZ1', labelFirstLine: true, channelLink: 'https://ad4ai.docenty.ai/l/answers/c/01JABCDEFGHJKMNPQRSTVWXYZ1', relSponsored: true, valid: true });
    html = `<html>${SECTION_BLOCK.replace('<h3', '<p>먼저 나오는 문장</p><h3')}</html>`;
    const late = await runAsync(['ai-block', 'check', '--url', `${base}/`, '--json']);
    assert.equal(late.status, 4);
    assert.equal(JSON.parse(late.stdout).aiCrawler.blocks[0].labelFirstLine, false);
  } finally { srv.close(); }
});
