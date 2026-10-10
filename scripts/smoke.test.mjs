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
