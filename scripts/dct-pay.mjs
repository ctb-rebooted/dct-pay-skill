#!/usr/bin/env node
/*
 * dct-pay CLI — zero-dependency wrapper over the dct-pay HTTP API (sp_001 §3).
 * Node >= 18 (global fetch). Config: ~/.dct-pay/config.json (chmod 600).
 *
 * Exit codes: 0 ok · 1 usage · 2 network/API error (server message printed) · 3 not registered · 4 ai-block check failed
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const VERSION = '1.3.0';
const TIMEOUT_MS = 15000;
const DEFAULT_API = 'https://pay.docenty.ai';
const API = (process.env.DCT_PAY_API || DEFAULT_API).replace(/\/+$/, '');
const CONFIG_PATH = process.env.DCT_EARN_CONFIG || path.join(os.homedir(), '.dct-pay', 'config.json');
const EXIT = { OK: 0, USAGE: 1, API: 2, NOT_REGISTERED: 3, CHECK: 4 };

const HELP = `dct-pay ${VERSION} — attach payments / sponsor slots to a web app via pay.docenty.ai

USAGE
  dct-pay login     [--email <e>]            # device-code login: click the mail link, the key lands here
  dct-pay login --key                        # fallback: paste a key from dashboard → 설정 (masked prompt)
  dct-pay register  --handle <h> --email <e> --name <display name>   # 202: verify mail, then run login
  dct-pay app add   --name <n> --url <https://…> --category <c> --contact <email> [--description <d>]
                     [--buyer-ref-mode email|app_user_id]
  dct-pay app list
  dct-pay app add   … [--test]                # test app: dce_pk_test_ key, fake pay page, no 사업자/PG
  dct-pay product add --app <appId> --name <n> --kind one_time|credit_pack|tip --price <KRW>
                       [--credits <n>] [--entitlement <key>]
  dct-pay product add --app <appId> --name <n> --kind physical --variants "3kg:15000,5kg:24000"
                       [--shipping 3000] [--inventory 20] [--image <https url>] [--description <md>]
  dct-pay product add --app <appId> --name <n> --kind service --variants "30분:50000,60분:90000" [--method video|visit|phone]
  dct-pay product add --input file.json [--dry-run]   # validated JSON (appId, kind, variants[], fulfillment{fields})
  dct-pay template list | inspect <fruit|consulting> | apply <fruit|consulting> --app <appId> [--name <n>] [--inventory <n>] [--dry-run]
  dct-pay invoice send --app <appId> (--to 010-…|--email <e>) (--product <id>|--amount <KRW>) [--note <t>]
  dct-pay invoice list | get <invoiceId>
  dct-pay order list [--status paid|pending|…] | order fulfill <checkoutId> [--event ship|fulfill] [--tracking <no>]
  dct-pay init      [--app <appId>] [--dir .] [--framework next|vite|react|static]   # tutorial-compatible files (no secret in browser)
  dct-pay slot add  --app <appId> [--campaign <campaignId>]
  dct-pay readiness --app <appId>
  dct-pay policy fill --app <appId>          # insert default 환불·약관·개인정보 texts (editable later)
  dct-pay snippet   --app <appId> [--kind script|pay-button|tip-button|slot|policy|file|all]
                     [--product <productId>] [--slot <slotCode>] [--framework static|react|next|vite]
                     [--kind product-card --product <productId> --handle <h>]   # 상품 카드 (상품 상세 링크)
                     [--key <dce_pk_…>]        # render without config/network
  dct-pay ai-block add    --app <appId> [--categories a,b] [--env-path .env.local | --vercel] [--rotate]
                          # AI 노출 협찬 블록 (ad4ai): writes DOCENTY_SITE_KEY + DOCENTY_SDK_SECRET, secret never printed
  dct-pay ai-block status --app <appId>      # review status, live placements, last verification, AI crawler visits
  dct-pay ai-block snippet --framework <next-app|next-pages|astro|sveltekit|remix|nuxt|express|vite|static|cloudflare|vercel-edge|netlify-edge> [--site-url <url>]
  dct-pay ai-block install [--dir <app root>] [--no-npm]   # vendor/agent-ads-<version>.tgz from the hub, then npm i
  dct-pay ai-block check  --url <deployed url>   # block in the initial HTML for an AI crawler? (exit 4 if not)
  dct-pay dashboard | open
  dct-pay whoami                              # verifies the saved key against the API

GLOBAL FLAGS
  --json        machine-readable output
  --api <url>   override API base (env DCT_PAY_API, default ${DEFAULT_API})
  --help, -h    this text
  --version
  AD4AI_HUB_BASE  ad4ai hub for the SDK tarball URL (default https://ad4ai.docenty.ai/l/answers)
  DCT_PAY_NO_TIPS=1  hide the once-a-day Docenty Pay tip line (stderr, human mode only)

CONFIG   ${CONFIG_PATH}   (creator secret lives here; never printed)
EXIT     0 ok · 1 usage · 2 network/API error · 3 not logged in (or key revoked) · 4 ai-block check: no valid block
`;

// ---------- args ----------
function parseArgs(argv) {
  const positional = [];
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h') opts.help = true;
    else if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq > 0) opts[a.slice(2, eq)] = a.slice(eq + 1);
      else if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) opts[a.slice(2)] = argv[++i];
      else opts[a.slice(2)] = true;
    } else positional.push(a);
  }
  return { positional, opts };
}

// ---------- output ----------
let JSON_MODE = false;
function print(human, data) {
  if (JSON_MODE) process.stdout.write(JSON.stringify(data ?? {}, null, 2) + '\n');
  else process.stdout.write(human.endsWith('\n') ? human : human + '\n');
}
function fail(code, message, extra) {
  if (JSON_MODE) process.stdout.write(JSON.stringify({ error: { code: codeName(code), message, ...extra } }, null, 2) + '\n');
  else {
    const c = (extra && extra.serverCode) || codeName(code);
    process.stderr.write(`${c} — ${message}\n` + (extra && extra.fix ? `→ ${extra.fix}\n` : ''));
  }
  process.exit(code);
}
function codeName(c) {
  return c === EXIT.USAGE ? 'USAGE' : c === EXIT.API ? 'API_ERROR' : c === EXIT.NOT_REGISTERED ? 'NOT_REGISTERED' : 'ERROR';
}
function need(opts, keys) {
  const missing = keys.filter((k) => opts[k] === undefined || opts[k] === true || opts[k] === '');
  if (missing.length) fail(EXIT.USAGE, `missing ${missing.map((k) => '--' + k).join(', ')}\n\n${HELP}`);
}

// ---------- config ----------
function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  } catch {
    return null;
  }
}
function saveConfig(cfg) {
  const dir = path.dirname(CONFIG_PATH);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2) + '\n', { mode: 0o600 });
  try {
    fs.chmodSync(CONFIG_PATH, 0o600);
  } catch {
    /* best effort (Windows) */
  }
}
function requireRegistered() {
  const cfg = loadConfig();
  if (!cfg || !cfg.secretKey) {
    fail(EXIT.NOT_REGISTERED, `not logged in (config: ${CONFIG_PATH})`, { fix: 'run `dct-pay login` (mail link) or `dct-pay login --key` (paste from dashboard → 설정)' });
  }
  return cfg;
}
function apiBase(cfg) {
  return (process.env.DCT_PAY_API || (cfg && cfg.apiBase) || DEFAULT_API).replace(/\/+$/, '');
}
/** Redacted view of the config — the secret never leaves the file after registration. */
function publicView(cfg) {
  if (!cfg) return null;
  const { secretKey, ...rest } = cfg;
  return { ...rest, secretKey: secretKey ? '(saved in ' + CONFIG_PATH + ')' : undefined };
}

// ---------- http ----------
async function api(method, base, p, { body, secretKey, appKey, allow } = {}) {
  const headers = { accept: 'application/json' };
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (secretKey) headers.authorization = `Bearer ${secretKey}`;
  if (appKey) headers['x-app-key'] = appKey;
  let res;
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    res = await fetch(base + '/api' + p, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: ctl.signal });
  } catch (e) {
    const timedOut = e && e.name === 'AbortError';
    fail(EXIT.API, timedOut ? `timeout after ${TIMEOUT_MS / 1000}s calling ${base}/api${p}` : `network error calling ${base}/api${p}: ${e && e.message ? e.message : e}`, { fix: `check DCT_PAY_API (${base}) and your network` });
  } finally {
    clearTimeout(t);
  }
  const text = await res.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  if (!res.ok) {
    const err = (data && data.error) || {};
    if (allow && allow.includes(err.code)) return { __error: err, __status: res.status };
    if (res.status === 401 && secretKey) {
      fail(EXIT.NOT_REGISTERED, 'saved key was rejected (expired or rotated)', { status: 401, serverCode: 'UNAUTHORIZED', fix: 'dashboard → 설정에서 재발급 후 `dct-pay login`' });
    }
    const retry = err.retryAfterSec ? ` (retry in ${err.retryAfterSec}s)` : '';
    fail(EXIT.API, `${res.status} ${err.message || text.slice(0, 300) || res.statusText}${retry}`.replace(/\s+/g, ' ').trim(), {
      status: res.status,
      serverCode: err.code,
      fix: err.fix,
      retryAfterSec: err.retryAfterSec,
    });
  }
  return data;
}

// ---------- commands ----------
async function cmdRegister(opts) {
  need(opts, ['handle', 'email', 'name']);
  const existing = loadConfig();
  if (existing && existing.secretKey) {
    print(`already logged in as @${existing.creator?.handle} (${existing.creator?.email}). Config: ${CONFIG_PATH}`, { status: 'already_registered', ...publicView(existing) });
    return;
  }
  const base = API;
  const r = await api('POST', base, '/creators', { body: { handle: opts.handle, email: opts.email, displayName: opts.name } });
  // v1: 202 {status:'verify_email'} — no secret is returned; the key arrives via `login` (device code)
  saveConfig({ version: 2, apiBase: base, registeredAt: new Date().toISOString(), pendingEmail: opts.email, handle: opts.handle, apps: {} });
  print(
    `registration accepted for ${opts.email} (@${opts.handle}).\n` +
      `Check your mail and click the login link to verify the email.\n` +
      `Then run:  dct-pay login --email ${opts.email}   (the secret key is delivered to this terminal, nothing to paste)`,
    { status: r.status || 'verify_email', email: opts.email, handle: opts.handle, dashboardUrl: r.dashboardUrl, config: CONFIG_PATH },
  );
}

function maskedPrompt(question) {
  return new Promise((resolve) => {
    const stdin = process.stdin;
    process.stderr.write(question);
    if (!stdin.isTTY) {
      let buf = '';
      stdin.setEncoding('utf8');
      stdin.on('data', (d) => (buf += d));
      stdin.on('end', () => resolve(buf.trim()));
      return;
    }
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    let val = '';
    const onData = (ch) => {
      if (ch === '\r' || ch === '\n' || ch === '\u0004') {
        stdin.setRawMode(false);
        stdin.pause();
        stdin.removeListener('data', onData);
        process.stderr.write('\n');
        resolve(val.trim());
      } else if (ch === '\u0003') process.exit(EXIT.USAGE);
      else if (ch === '\u007f' || ch === '\b') val = val.slice(0, -1);
      else val += ch;
    };
    stdin.on('data', onData);
  });
}

async function finishLogin(base, secretKey, creatorHint) {
  const me = await api('GET', base, '/creators/me', { secretKey });
  const creator = me.creator || creatorHint || {};
  const prev = loadConfig() || {};
  const cfg = { version: 2, apiBase: base, registeredAt: prev.registeredAt || new Date().toISOString(), loggedInAt: new Date().toISOString(), creator, secretKey, apps: prev.apps || {} };
  for (const a of me.apps || []) cfg.apps[a.id] = { ...(cfg.apps[a.id] || {}), id: a.id, name: a.name, url: a.url, publicKey: a.publicKey, products: (cfg.apps[a.id] || {}).products || {}, slots: (cfg.apps[a.id] || {}).slots || {} };
  saveConfig(cfg);
  print(`logged in as @${creator.handle} (${creator.email}) — key saved to ${CONFIG_PATH} (mode 600, not shown)` + (creator.emailVerified === false ? '\nNOTE: email not verified yet — click the link in your mail before other commands.' : ''), { status: 'logged_in', creator, config: CONFIG_PATH, apps: Object.keys(cfg.apps).length });
}

async function cmdLogin(opts) {
  const base = API;
  if (opts.key !== undefined) {
    if (typeof opts.key === 'string' && opts.key.startsWith('dce_sk_')) {
      process.stderr.write('warning: passing the key as an argument leaves it in shell history; prefer `dct-pay login --key` and paste at the prompt\n');
      return finishLogin(base, opts.key);
    }
    const key = await maskedPrompt('secret key (dce_sk_…, input hidden): ');
    if (!key.startsWith('dce_sk_')) fail(EXIT.USAGE, 'that does not look like a dce_sk_ key');
    return finishLogin(base, key);
  }
  const prev = loadConfig();
  const email = opts.email || (prev && (prev.pendingEmail || (prev.creator && prev.creator.email)));
  if (!email) fail(EXIT.USAGE, 'login needs --email <e> (or run register first)');
  const start = await api('POST', base, '/auth/cli/start', { body: { email } });
  print(
    `code ${start.code} — check ${email} and click the login link (valid 15 min).\n` +
      `The mail shows the same code; approve only if it matches.` +
      (start.devUrl ? `\n(dev) ${start.devUrl}` : '') +
      `\nwaiting…`,
    { status: 'pending', code: start.code, email, devUrl: start.devUrl },
  );
  const deadline = Date.now() + (start.expiresInSec || 900) * 1000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 2000));
    const p = await api('POST', base, '/auth/cli/poll', { body: { pollToken: start.pollToken }, allow: ['NOT_FOUND'] });
    if (p.__error) fail(EXIT.API, p.__error.message, { fix: 'run `dct-pay login` again' });
    if (p.status === 'approved') return finishLogin(base, p.secretKey, p.creator);
    if (p.status === 'expired') fail(EXIT.API, 'login request expired', { fix: 'run `dct-pay login` again and click the link within 15 minutes' });
  }
  fail(EXIT.API, 'timed out waiting for approval', { fix: 'run `dct-pay login` again' });
}

async function cmdApp(sub, opts) {
  const cfg = requireRegistered();
  const base = apiBase(cfg);
  if (sub === 'list') {
    const me = await api('GET', base, '/creators/me', { secretKey: cfg.secretKey });
    const apps = me.apps || Object.values(cfg.apps || {});
    print(apps.map((a) => `${a.id}  ${a.name}  ${a.url || ''}  ${a.publicKey || ''}`).join('\n') || '(no apps yet)', { apps });
    return;
  }
  if (sub !== 'add') fail(EXIT.USAGE, `unknown: app ${sub}\n\n${HELP}`);
  need(opts, ['name', 'url', 'category', 'contact']);
  const r = await api('POST', base, '/apps', {
    secretKey: cfg.secretKey,
    body: {
      name: opts.name,
      url: opts.url,
      category: opts.category,
      description: opts.description || '',
      contactEmail: opts.contact,
      refundPolicyMd: opts['refund-md'],
      termsMd: opts['terms-md'],
      privacyMd: opts['privacy-md'],
      buyerRefMode: opts['buyer-ref-mode'] || 'email',
      mode: opts.test ? 'test' : 'live',
    },
  });
  const app = r.app || r;
  cfg.apps = cfg.apps || {};
  cfg.apps[app.id] = { id: app.id, name: app.name, url: app.url, publicKey: app.publicKey, products: {}, slots: {} };
  saveConfig(cfg);
  print(
    `app created\n  id:         ${app.id}\n  publicKey:  ${app.publicKey}\n  policies:   ${base}/p/${app.id}/{terms,refund,privacy}`,
    { app },
  );
}

function parseVariants(v) {
  if (!v) return [];
  return String(v)
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean)
    .map((x) => {
      const [name, price] = x.split(':').map((y) => y.trim());
      const priceKrw = Number(price);
      if (!name || !Number.isInteger(priceKrw) || priceKrw < 100) fail(EXIT.USAGE, `bad variant "${x}" — use name:price (price ≥ 100)`);
      return { name, priceKrw };
    });
}

const COMMERCE_KINDS = ['physical', 'service', 'digital_file', 'ticket'];

async function cmdProduct(sub, opts) {
  if (sub !== 'add') fail(EXIT.USAGE, `unknown: product ${sub}\n\n${HELP}`);
  if (opts.input) {
    let spec;
    try {
      spec = JSON.parse(fs.readFileSync(String(opts.input), 'utf8'));
    } catch (e) {
      fail(EXIT.USAGE, `--input: cannot read/parse ${opts.input}: ${e && e.message ? e.message : e}`);
    }
    const errs = [];
    if (!spec.appId) errs.push('appId required');
    if (!spec.kind || !['one_time', 'credit_pack', 'tip', ...COMMERCE_KINDS].includes(spec.kind)) errs.push('kind must be one_time|credit_pack|tip|physical|service|digital_file|ticket');
    if (!spec.name) errs.push('name required');
    if (spec.variants && !Array.isArray(spec.variants)) errs.push('variants must be an array of {name, priceKrw}');
    if (Array.isArray(spec.variants)) for (const v of spec.variants) if (!v.name || !Number.isInteger(v.priceKrw) || v.priceKrw < 100) errs.push(`variant ${JSON.stringify(v)} needs name + priceKrw ≥ 100`);
    if (!spec.variants?.length && !Number.isInteger(spec.priceKrw)) errs.push('priceKrw required when no variants');
    if (spec.fulfillment && (!Array.isArray(spec.fulfillment.fields) || spec.fulfillment.fields.some((f) => !/^[a-zA-Z][a-zA-Z0-9_]{0,31}$/.test(String(f))))) errs.push('fulfillment.fields must be identifiers');
    if (errs.length) fail(EXIT.USAGE, `--input validation failed:\n  - ${errs.join('\n  - ')}`);
    if (opts['dry-run']) return print(`dry-run OK — would POST /api/products\n${JSON.stringify(spec, null, 2)}`, { dryRun: true, body: spec });
    const cfg = requireRegistered();
    const r = await api('POST', apiBase(cfg), '/products', { secretKey: cfg.secretKey, body: spec });
    const product = r.product || r;
    return print(`product created\n  id: ${product.id}\n  ${product.name} · ${product.kind}`, { product });
  }
  if (COMMERCE_KINDS.includes(opts.kind)) {
    need(opts, ['app', 'name']);
    const variants = parseVariants(opts.variants);
    const priceKrw = variants[0] ? variants[0].priceKrw : Number(opts.price);
    if (!Number.isInteger(priceKrw) || priceKrw < 100) fail(EXIT.USAGE, '--price (≥100) or --variants required');
    const fieldsByKind = { physical: ['recipient', 'phone', 'address', 'desiredDate'], service: ['slot', 'method', 'phone', 'question'], digital_file: [], ticket: ['name', 'phone'] };
    const body = {
      appId: opts.app,
      name: opts.name,
      kind: opts.kind,
      priceKrw,
      variants,
      shippingKrw: opts.kind === 'physical' ? Number(opts.shipping || 0) : 0,
      inventory: opts.inventory !== undefined ? Number(opts.inventory) : null,
      images: opts.image ? [String(opts.image)] : [],
      descriptionMd: opts.description ? String(opts.description) : '',
      fulfillment: { fields: fieldsByKind[opts.kind], note: opts.kind === 'physical' ? '희망 수령일은 참고용이며 확정일이 아닙니다.' : opts.kind === 'service' ? `희망 일시이며 확정이 아닙니다.${opts.method ? ` 상담 방식: ${opts.method}` : ''}` : undefined },
      templateKey: opts.kind === 'physical' ? 'fruit' : opts.kind === 'service' ? 'consulting' : undefined,
    };
    if (opts['dry-run']) return print(`dry-run OK — would POST /api/products\n${JSON.stringify(body, null, 2)}`, { dryRun: true, body });
    const cfg = requireRegistered();
    const r = await api('POST', apiBase(cfg), '/products', { secretKey: cfg.secretKey, body });
    const product = r.product || r;
    if (cfg.apps && cfg.apps[opts.app]) {
      cfg.apps[opts.app].products = cfg.apps[opts.app].products || {};
      cfg.apps[opts.app].products[product.id] = { id: product.id, name: product.name, kind: product.kind, priceKrw: product.priceKrw };
      cfg.apps[opts.app].lastProductId = product.id;
      saveConfig(cfg);
    }
    return print(`product created\n  id: ${product.id}\n  ${product.name} · ${product.kind} · ${variants.length ? variants.map((v) => `${v.name} ${v.priceKrw.toLocaleString('ko-KR')}원`).join(' / ') : `${priceKrw.toLocaleString('ko-KR')}원`}\n  page: ${apiBase(cfg)}/u/<handle>/p/${product.id}`, { product });
  }
  need(opts, opts.kind === 'tip' ? ['app'] : ['app', 'name', 'kind', 'price']);
  if (!['one_time', 'credit_pack', 'tip'].includes(opts.kind)) fail(EXIT.USAGE, '--kind must be one_time, credit_pack, tip, physical, service, digital_file or ticket');
  const price = opts.kind === 'tip' ? Number(opts.price || 3000) : Number(opts.price);
  if (!Number.isInteger(price) || price <= 0) fail(EXIT.USAGE, '--price must be a positive integer (KRW)');
  if (opts.kind === 'tip' && (price < 1000 || price > 100000)) fail(EXIT.USAGE, 'tip default must be 1,000~100,000 KRW');
  if (opts.kind === 'credit_pack' && !opts.credits) fail(EXIT.USAGE, '--credits required for credit_pack');
  if (opts.kind === 'one_time' && !opts.entitlement) fail(EXIT.USAGE, '--entitlement required for one_time (e.g. pro)');
  const body = {
    appId: opts.app,
    name: opts.name || (opts.kind === 'tip' ? '후원' : undefined),
    kind: opts.kind,
    priceKrw: price,
    credits: opts.credits ? Number(opts.credits) : undefined,
    entitlementKey: opts.entitlement || undefined,
  };
  if (opts['dry-run']) return print(`dry-run OK — would POST /api/products\n${JSON.stringify(body, null, 2)}`, { dryRun: true, body });
  const cfg = requireRegistered();
  const base = apiBase(cfg);
  const r = await api('POST', base, '/products', { secretKey: cfg.secretKey, body });
  const product = r.product || r;
  if (cfg.apps && cfg.apps[opts.app]) {
    cfg.apps[opts.app].products = cfg.apps[opts.app].products || {};
    cfg.apps[opts.app].products[product.id] = {
      id: product.id,
      name: product.name,
      kind: product.kind,
      priceKrw: product.priceKrw ?? price,
      entitlementKey: product.entitlementKey,
    };
    cfg.apps[opts.app].lastProductId = product.id;
    saveConfig(cfg);
  }
  print(`product created\n  id: ${product.id}\n  ${product.name} · ${product.kind} · ${price.toLocaleString('ko-KR')}원`, { product });
}

async function cmdTemplate(sub, opts) {
  const base = apiBase(loadConfig());
  if (sub === 'list' || !sub) {
    const r = await api('GET', base, '/templates');
    return print(r.templates.map((t) => `${t.available ? '✓' : '·'} ${t.key.padEnd(12)} ${t.title} — ${t.who}${t.available ? '' : ' (준비 중)'}`).join('\n'), r);
  }
  const key = opts._key || (Array.isArray(opts._rest) ? opts._rest[0] : undefined);
  if (sub === 'inspect') {
    need(opts, ['key']);
    const r = await api('GET', base, `/templates?key=${encodeURIComponent(opts.key)}`);
    return print(JSON.stringify(r.template, null, 2), r);
  }
  if (sub === 'apply') {
    need(opts, ['key', 'app']);
    if (opts.inventory !== undefined && !/^\d+$/.test(String(opts.inventory))) fail(EXIT.USAGE, '--inventory needs a number (e.g. --inventory 20)');
    const body = { appId: opts.app, template: opts.key, name: opts.name, priceKrw: opts.price ? Number(opts.price) : undefined, variants: opts.variants ? parseVariants(opts.variants) : undefined, shippingKrw: opts.shipping !== undefined ? Number(opts.shipping) : undefined, inventory: opts.inventory !== undefined ? Number(opts.inventory) : undefined, images: opts.image ? [String(opts.image)] : undefined, descriptionMd: opts.description };
    if (opts['dry-run']) return print(`dry-run OK — would POST /api/templates/apply\n${JSON.stringify(body, null, 2)}`, { dryRun: true, body });
    const cfg = requireRegistered();
    const r = await api('POST', apiBase(cfg), '/templates/apply', { secretKey: cfg.secretKey, body });
    return print(`product created from template ${opts.key}\n  id: ${r.product.id}\n  ${r.product.name}${r.policiesFilled ? '\n  policies: 환불·약관 기본 문안 채움' : ''}\n  page: ${apiBase(cfg)}/u/<handle>/p/${r.product.id}`, r);
  }
  void key;
  fail(EXIT.USAGE, `unknown: template ${sub}\n\n${HELP}`);
}

async function cmdInvoice(sub, opts) {
  // --dry-run validates and prints the request without a saved key (docs/landing examples are tested this way)
  const cfg = sub === 'send' && opts['dry-run'] ? loadConfig() : requireRegistered();
  const base = apiBase(cfg);
  if (sub === 'send') {
    need(opts, ['app']);
    if (!opts.to && !opts.email) fail(EXIT.USAGE, '--to <phone> or --email <e> required');
    if (!opts.product && !opts.amount) fail(EXIT.USAGE, '--product <id> or --amount <KRW> required');
    const body = { appId: opts.app, to: opts.to ? { phone: String(opts.to) } : { email: String(opts.email) }, productId: opts.product, amountKrw: opts.amount ? Number(opts.amount) : undefined, note: opts.note };
    if (opts['dry-run']) return print(`dry-run OK — would POST /api/invoices\n${JSON.stringify(body, null, 2)}`, { dryRun: true, body });
    const r = await api('POST', base, '/invoices', { secretKey: cfg.secretKey, body });
    return print(`invoice ${r.deliveryStatus === 'noop' ? 'created (NOT sent — preview mode: no 알림톡 channel / test app)' : 'queued'}\n  invoiceId: ${r.invoiceId}\n  orderUrl:  ${r.orderUrl}\n  status:    ${r.deliveryStatus}`, r);
  }
  if (sub === 'list' || !sub) {
    const r = await api('GET', base, '/invoices', { secretKey: cfg.secretKey });
    return print(r.invoices.map((i) => `${i.id}  ${(i.status || '').padEnd(8)} ${(i.delivery || '').padEnd(7)} ${i.amountKrw ?? '-'}원  ${i.checkoutStatus || ''}  ${i.note || ''}`).join('\n') || '(no invoices)', r);
  }
  if (sub === 'get') {
    need(opts, ['id']);
    const r = await api('GET', base, '/invoices', { secretKey: cfg.secretKey });
    const inv = r.invoices.find((i) => i.id === opts.id);
    if (!inv) fail(EXIT.API, `invoice ${opts.id} not found`);
    return print(JSON.stringify(inv, null, 2), { invoice: inv });
  }
  fail(EXIT.USAGE, `unknown: invoice ${sub}\n\n${HELP}`);
}

async function cmdOrder(sub, opts) {
  const cfg = requireRegistered();
  const base = apiBase(cfg);
  if (sub === 'list' || !sub) {
    const r = await api('GET', base, `/orders${opts.status ? `?status=${encodeURIComponent(opts.status)}` : ''}`, { secretKey: cfg.secretKey });
    return print(r.orders.map((o) => `${o.id}  ${(o.status || '').padEnd(17)} ${(o.fulfillmentStatus || '').padEnd(10)} ${o.amountKrw}원  ${o.productName}${o.variant ? ` (${o.variant.name})` : ''}${o.qty > 1 ? ` ×${o.qty}` : ''}  ${o.buyerRef || ''}`).join('\n') || '(no orders)', r);
  }
  if (sub === 'fulfill') {
    need(opts, ['id']);
    const body = { event: opts.event || 'ship', tracking: opts.tracking };
    if (opts['dry-run']) return print(`dry-run OK — would POST /api/orders/${opts.id}/fulfill ${JSON.stringify(body)}`, { dryRun: true, body });
    const r = await api('POST', base, `/orders/${encodeURIComponent(opts.id)}/fulfill`, { secretKey: cfg.secretKey, body });
    return print(`order ${opts.id}: fulfillment=${r.order.fulfillmentStatus} hold=${r.order.holdStatus}${r.order.releaseAt ? ` auto-confirm ${r.order.releaseAt}` : ''}`, r);
  }
  fail(EXIT.USAGE, `unknown: order ${sub}\n\n${HELP}`);
}

/** Tutorial-compatible bootstrap (pl_002 §1′-2): detect framework, write snippet + server check + env placeholders. Public key only in the browser. */
async function cmdInit(opts) {
  const dir = path.resolve(String(opts.dir || '.'));
  const pkgPath = path.join(dir, 'package.json');
  let pkg = {};
  try {
    pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  } catch {
    /* no package.json → static */
  }
  const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
  const framework = opts.framework || (deps.next ? 'next' : deps.vite ? 'vite' : deps.react ? 'react' : 'static');
  const cfg = loadConfig();
  const app = opts.app && cfg && cfg.apps ? cfg.apps[opts.app] : cfg && cfg.apps ? Object.values(cfg.apps)[0] : null;
  const key = opts.key || (app && app.publicKey) || 'dce_pk_test_REPLACE_ME';
  const base = apiBase(cfg);
  const files = {};
  const script = `<script src="${base}/sdk/v1/earn.iife.js" data-app-key="${key}"></script>`;
  if (framework === 'next') {
    files['components/EarnPro.tsx'] = `"use client";
// dct-pay init — replaces the "Supabase + Stripe" tutorial pattern. Public key only; verify on the server.
import Script from "next/script";
declare global { interface Window { DocentyEarn?: any } }
export function EarnScript() { return <Script src="${base}/sdk/v1/earn.iife.js" data-app-key={process.env.NEXT_PUBLIC_DCT_EARN_APP_KEY} strategy="afterInteractive" />; }
export function EarnPro({ productId, buyerRef }: { productId: string; buyerRef?: string }) {
  return <button onClick={async () => { if (buyerRef) window.DocentyEarn?.identify(buyerRef); const r = await window.DocentyEarn?.checkout(productId); console.log("checkout", r); }}>Pro 구매</button>;
}
`;
    files['lib/earn-server.ts'] = `// Server-side entitlement check (secret stays in env — never in the browser)
import { verifyEntitlement } from "@docenty/earn-sdk/node";
export async function hasPro(buyerRef: string) {
  const r = await verifyEntitlement({ appKey: process.env.NEXT_PUBLIC_DCT_EARN_APP_KEY!, secretKey: process.env.DCT_EARN_SECRET_KEY, buyerRef, entitlementKey: "pro" });
  return r.ok;
}
`;
    files['.env.local.example'] = `NEXT_PUBLIC_DCT_EARN_APP_KEY=${key}\nDCT_EARN_SECRET_KEY=dce_sk_…   # from dashboard → 설정 (server only)\n`;
  } else if (framework === 'vite' || framework === 'react') {
    files['src/earn.ts'] = `// dct-pay init — loads the SDK once; call earnCheckout(productId) from any button.
declare global { interface Window { DocentyEarn?: any } }
export function loadEarn(appKey = import.meta.env.VITE_DCT_EARN_APP_KEY as string) {
  if (document.querySelector("script[data-app-key]")) return;
  const s = document.createElement("script"); s.src = "${base}/sdk/v1/earn.iife.js"; s.dataset.appKey = appKey; document.head.appendChild(s);
}
export const earnCheckout = (productId: string) => window.DocentyEarn?.checkout(productId);
`;
    files['.env.example'] = `VITE_DCT_EARN_APP_KEY=${key}\n`;
  } else {
    files['earn-snippet.html'] = `${script}\n<button onclick="DocentyEarn.checkout('PRODUCT_ID')">Pro 구매</button>\n`;
  }
  const written = [];
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    if (fs.existsSync(abs) && !opts.force) {
      written.push(`${rel} (exists — skipped; use --force)`);
      continue;
    }
    if (opts['dry-run']) {
      written.push(`${rel} (dry-run)`);
      continue;
    }
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
    written.push(rel);
  }
  print(`dct-pay init — framework: ${framework}\n  app key: ${key}${key.startsWith('dce_pk_test_') ? ' (test mode: fake pay page, no 사업자/PG)' : ''}\n  files:\n    ${written.join('\n    ')}\n  next: put a product id in the button, run the app, click → /pay (test apps show 성공/실패 buttons)`, { framework, key, files: written });
}

async function cmdSlot(sub, opts) {
  if (sub !== 'add') fail(EXIT.USAGE, `unknown: slot ${sub}\n\n${HELP}`);
  need(opts, ['app']);
  const cfg = requireRegistered();
  const base = apiBase(cfg);
  const r = await api('POST', base, '/slots', {
    secretKey: cfg.secretKey,
    body: { appId: opts.app, campaignId: opts.campaign || undefined },
    allow: ['NO_CAMPAIGN'],
  });
  if (r.__error) {
    print(
      `no sponsor campaign available yet — 스폰서 캠페인 대기 중.\n` +
        `Insert DocentyEarn.slot() with a placeholder now; re-run \`dct-pay slot add --app ${opts.app}\` when a campaign opens.`,
      { status: 'waiting', code: 'NO_CAMPAIGN', message: r.__error.message },
    );
    return;
  }
  const slot = r.slot || r;
  if (cfg.apps && cfg.apps[opts.app]) {
    cfg.apps[opts.app].slots = cfg.apps[opts.app].slots || {};
    cfg.apps[opts.app].slots[slot.code] = { id: slot.id, code: slot.code, campaignId: slot.campaignId, label: slot.label };
    cfg.apps[opts.app].lastSlotCode = slot.code;
    saveConfig(cfg);
  }
  print(`slot created\n  code: ${slot.code}\n  link: ${base}/r/${slot.code}` + (slot.snippet ? `\n\n${slot.snippet}` : ''), { slot });
}

async function cmdReadiness(opts) {
  need(opts, ['app']);
  const cfg = requireRegistered();
  const base = apiBase(cfg);
  const r = await api('GET', base, `/apps/${encodeURIComponent(opts.app)}/readiness`, { secretKey: cfg.secretKey });
  const checks = r.checks || [];
  const lines = checks.map((c) => `  [${c.ok ? 'ok' : '--'}] ${c.key}${c.ok || !c.fix ? '' : ' — ' + c.fix}`);
  print(`readiness ${r.score ?? '?'}/100\n${lines.join('\n')}`, r);
}

async function cmdDashboard() {
  const cfg = requireRegistered();
  const base = apiBase(cfg);
  const r = await api('GET', base, '/creators/me/dashboard-url', { secretKey: cfg.secretKey });
  cfg.dashboardUrl = r.url;
  saveConfig(cfg);
  print(r.url, { url: r.url });
}

async function cmdWhoami() {
  const cfg = requireRegistered();
  const base = apiBase(cfg);
  const me = await api('GET', base, '/creators/me', { secretKey: cfg.secretKey }); // 401 → exit 3 with fix
  const c = me.creator || cfg.creator || {};
  cfg.creator = c;
  saveConfig(cfg);
  print(`@${c.handle} (${c.email}) · verified ${c.emailVerified ? 'yes' : 'NO'} · api ${base} · ${(me.apps || []).length} app(s)`, { ...publicView(cfg), creator: c, apps: me.apps });
}

async function cmdPolicy(sub, opts) {
  if (sub !== 'fill') fail(EXIT.USAGE, `unknown: policy ${sub}`);
  need(opts, ['app']);
  const cfg = requireRegistered();
  const base = apiBase(cfg);
  const r = await api('POST', base, `/apps/${encodeURIComponent(opts.app)}/policies/fill`, { secretKey: cfg.secretKey, body: {} });
  print(`policies filled for app ${opts.app}: ${r.filled ? r.filled.join(', ') : 'nothing to do'}\n  ${base}/p/${opts.app}/{terms,refund,privacy}`, r);
}

function productCardSnippet(base, handle, productId) {
  return `<!-- dct-pay 상품 카드: 상세 페이지(옵션·수량·배송비 합계)로 보냅니다 -->
<a class="dct-pay-product" href="${base}/u/${handle}/p/${productId}" target="_blank" rel="noopener">상품 보기 · 구매</a>`;
}

function cmdSnippet(opts) {
  if (opts.kind === 'product-card') {
    const cfg = loadConfig();
    need(opts, ['product', 'handle']);
    const base = apiBase(cfg);
    return print(productCardSnippet(base, opts.handle, opts.product), { snippets: { 'product-card': productCardSnippet(base, opts.handle, opts.product) } });
  }
  const cfg = loadConfig();
  const base = apiBase(cfg);
  let appId = opts.app;
  let appKey = opts.key;
  let app = null;
  if (!appKey) {
    if (!appId) fail(EXIT.USAGE, 'snippet needs --app <appId> (or --key <dce_pk_…>)');
    app = cfg && cfg.apps && cfg.apps[appId];
    if (!app || !app.publicKey) {
      if (!cfg || !cfg.secretKey) fail(EXIT.NOT_REGISTERED, `app ${appId} not in ${CONFIG_PATH}; register + app add first, or pass --key`);
      fail(EXIT.USAGE, `app ${appId} not found in ${CONFIG_PATH}. Run \`dct-pay app add\` or pass --key <dce_pk_…>`);
    }
    appKey = app.publicKey;
  }
  const productId = opts.product || (app && app.lastProductId) || 'PRODUCT_ID';
  const slotCode = opts.slot || (app && app.lastSlotCode) || 'SLOT_CODE';
  const fw = opts.framework || 'static';
  const kind = opts.kind || 'all';
  const idAttr = appId ? ` data-app-id="${appId}"` : '';

  const sdkUrl = `${base}/sdk/v1/earn.iife.js`;
  const script =
    fw === 'next'
      ? `{/* app/layout.tsx — inside <body>, before {children} */}\n<Script src="${sdkUrl}" data-app-key="${appKey}"${idAttr} strategy="afterInteractive" />\n// import Script from 'next/script'`
      : `<script src="${sdkUrl}" data-app-key="${appKey}"${idAttr}></script>`;
  const tipButton = `<script>DocentyEarn.tipButton({ amounts: [1000, 3000, 5000] });</script>`;
  const file = frameworkFile(fw, { sdkUrl, appKey, productId, idAttr });

  const payButton =
    fw === 'react' || fw === 'next' || fw === 'vite'
      ? `<button type="button" onClick={() => window.DocentyEarn.checkout('${productId}', { buyerRef: currentUser.email })}>\n  Pro 구매\n</button>`
      : `<button type="button" id="dct-buy-pro">Pro 구매</button>\n<script>\n  document.getElementById('dct-buy-pro').addEventListener('click', function () {\n    DocentyEarn.checkout('${productId}', { buyerRef: 'USER_ID_OR_EMAIL' });\n  });\n</script>`;

  const slot =
    fw === 'react' || fw === 'next' || fw === 'vite'
      ? `const slotRef = useRef<HTMLDivElement>(null);\nuseEffect(() => { window.DocentyEarn?.slot(slotRef.current!, { slotCode: '${slotCode}', label: '스폰서 제안 보기' }); }, []);\n// …\n<div ref={slotRef} />`
      : `<div id="dct-slot"></div>\n<script>DocentyEarn.slot('#dct-slot', { slotCode: '${slotCode}', label: '스폰서 제안 보기' });</script>`;

  const policy = appId
    ? `<footer>\n  <a href="${base}/p/${appId}/terms">이용약관</a> · <a href="${base}/p/${appId}/refund">환불정책</a> · <a href="${base}/p/${appId}/privacy">개인정보처리방침</a>\n</footer>`
    : `(policy links need --app <appId>)`;

  const parts = { script, 'pay-button': payButton, 'tip-button': tipButton, slot, policy, file };
  if (kind !== 'all' && !parts[kind]) fail(EXIT.USAGE, '--kind must be script|pay-button|tip-button|slot|policy|file|all');
  const chosen = kind === 'all' ? Object.keys(parts) : [kind];
  const human = chosen.map((k) => `## ${k}\n${parts[k]}`).join('\n\n');
  print(human, { appId, appKey, framework: fw, snippets: Object.fromEntries(chosen.map((k) => [k, parts[k]])) });
}

/** X4: one complete, working file per framework — buyerRef bound once in init, entitled() reuses it. */
function frameworkFile(fw, { sdkUrl, appKey, productId }) {
  if (fw === 'next' || fw === 'react' || fw === 'vite') {
    return `// components/EarnPro.tsx — ${fw}: 'use client' component; SDK loads via <script> (see "script") or lazily here
'use client';
import { useEffect, useState } from 'react';

declare global { interface Window { DocentyEarn?: any } }

const SDK_URL = '${sdkUrl}';
const APP_KEY = '${appKey}';
const PRODUCT_ID = '${productId}';

function loadSdk(): Promise<any> {
  return new Promise((resolve, reject) => {
    if (window.DocentyEarn) return resolve(window.DocentyEarn);
    const s = document.createElement('script');
    s.src = SDK_URL; s.async = true;
    s.onload = () => { window.DocentyEarn.init({ appKey: APP_KEY }); resolve(window.DocentyEarn); };
    s.onerror = () => reject(new Error('Docenty Pay SDK 로드 실패'));
    document.head.appendChild(s);
  });
}

export function EarnPro({ buyerEmail, children }: { buyerEmail: string; children: React.ReactNode }) {
  const [entitled, setEntitled] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    loadSdk()
      .then(async (earn) => { earn.identify(buyerEmail); const ok = await earn.entitled('pro'); if (alive) setEntitled(ok); })
      .catch((e) => alive && setError(e.message));
    return () => { alive = false; };
  }, [buyerEmail]);

  async function buy() {
    try {
      const earn = await loadSdk();
      const { checkoutId } = await earn.checkout(PRODUCT_ID);          // opens /pay in a new tab
      const s = await earn.waitForCheckout(checkoutId);               // poll until paid/expired (≤2 min)
      if (s.status === 'paid') setEntitled(await earn.entitled('pro')); // re-query after the buyer returns
    } catch (e: any) { setError(e.fix ? e.message + ' — ' + e.fix : e.message); }
  }

  if (error) return <p role="alert">{error}</p>;
  if (entitled === null) return <p>확인 중…</p>;
  if (!entitled) return <button type="button" onClick={buy}>Pro 구매</button>;
  return <>{children}</>;
}
`;
  }
  return `<!-- index.html — static: paste before </body> -->
<script src="${sdkUrl}" data-app-key="${appKey}"></script>
<button type="button" id="dct-buy-pro">Pro 구매</button>
<div id="pro-feature" hidden>… Pro 기능 …</div>
<script>
  (async () => {
    await DocentyEarn.ready();
    const email = prompt('이용권을 확인할 이메일'); // or your own auth
    DocentyEarn.identify(email);
    const show = async () => { document.getElementById('pro-feature').hidden = !(await DocentyEarn.entitled('pro')); };
    document.getElementById('dct-buy-pro').addEventListener('click', async () => {
      try {
        const { checkoutId } = await DocentyEarn.checkout('${productId}');
        const s = await DocentyEarn.waitForCheckout(checkoutId);
        if (s.status === 'paid') await show();
      } catch (e) { alert(e.message + (e.fix ? ' — ' + e.fix : '')); }
    });
    await show();
  })();
</script>
`;
}

// ---------- ai-block: ad4ai AI-visible sponsored blocks (server/build/edge HTML, never JS-only) ----------
// add/status go through pay.docenty.ai (Bearer dce_sk_); earn provisions the ad4ai media server-to-server.
// The media SDK secret is written straight into the env target and NEVER printed (not in --json either).
const AD4AI_HUB_BASE = () => (process.env.AD4AI_HUB_BASE || 'https://ad4ai.docenty.ai/l/answers').replace(/\/+$/, '');
const SDK_TGZ = () => `${AD4AI_HUB_BASE()}/sdk/agent-ads-latest.tgz`;
// Install = vendored, versioned tarball: lockfiles keep a stable integrity and deploy builds need no network to the hub.
const SDK_INSTALL_CMD = 'node <dct-pay skill>/scripts/dct-pay.mjs ai-block install   # → vendor/agent-ads-<version>.tgz + npm i';
const SPONSOR_LABEL = '협찬 · 광고';
const AI_FRAMEWORKS = ['next-app', 'next-pages', 'astro', 'sveltekit', 'remix', 'nuxt', 'express', 'vite', 'static', 'cloudflare', 'vercel-edge', 'netlify-edge'];
const ENV_VALUE = /^[A-Za-z0-9_.:+/=-]{1,512}$/;

function gitRun(args, cwd) {
  return spawnSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}
/** Make sure the env file can never be committed: refuse a tracked file, add it to .gitignore when not ignored. */
function ensureEnvFileSafe(abs) {
  const dir = path.dirname(abs);
  fs.mkdirSync(dir, { recursive: true });
  const tracked = gitRun(['ls-files', '--error-unmatch', abs], dir);
  if (tracked.status === 0) fail(EXIT.USAGE, `${path.relative(process.cwd(), abs) || abs} is tracked by git — refusing to write a secret into it`, { fix: `use --env-path .env.local (or run: git rm --cached ${path.basename(abs)})` });
  const ig = gitRun(['check-ignore', '-q', abs], dir);
  if (ig.status === 0) return { gitignored: true, addedToGitignore: false };
  const gi = path.join(dir, '.gitignore');
  const name = path.basename(abs);
  let cur = '';
  try {
    cur = fs.readFileSync(gi, 'utf8');
  } catch {
    /* none yet */
  }
  const has = cur.split(/\r?\n/).some((l) => l.trim() === name || l.trim() === '/' + name);
  if (!has) fs.writeFileSync(gi, `${cur}${cur && !cur.endsWith('\n') ? '\n' : ''}${name}\n`);
  if (ig.status === 1 && gitRun(['check-ignore', '-q', abs], dir).status !== 0) {
    fail(EXIT.USAGE, `${name} is still not ignored by git (a negation rule?) — refusing to write a secret into it`, { fix: 'fix .gitignore so the env file is ignored, then re-run' });
  }
  return { gitignored: true, addedToGitignore: !has };
}
function upsertEnvFile(abs, pairs) {
  let text = '';
  try {
    text = fs.readFileSync(abs, 'utf8');
  } catch {
    /* new file */
  }
  const lines = text ? text.split('\n') : [];
  if (lines.length && lines[lines.length - 1] === '') lines.pop();
  for (const [k, v] of Object.entries(pairs)) {
    const i = lines.findIndex((l) => new RegExp(`^\\s*(export\\s+)?${k}\\s*=`).test(l));
    if (i >= 0) lines[i] = `${k}=${v}`;
    else lines.push(`${k}=${v}`);
  }
  fs.writeFileSync(abs, lines.join('\n') + '\n', { mode: 0o600 });
  try {
    fs.chmodSync(abs, 0o600);
  } catch {
    /* best effort (Windows) */
  }
}
const VERCEL_BIN = () => process.env.DCT_PAY_VERCEL_BIN || 'vercel';
function vercelSpawn(args, input) {
  return spawnSync(VERCEL_BIN(), args, { input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], shell: process.platform === 'win32' });
}
/** value goes through stdin only — never argv, never echoed */
function vercelEnvAdd(name, value) {
  const scrub = (s) => String(s || '').split(value).join('***').trim().split('\n').slice(-2).join(' ');
  let r = vercelSpawn(['env', 'add', name, 'production'], value);
  if (r.status !== 0 && /already exists/i.test(`${r.stderr}${r.stdout}`)) r = vercelSpawn(['env', 'add', name, 'production', '--force'], value);
  if (r.error || r.status !== 0) {
    return { ok: false, message: r.error ? r.error.code || 'spawn failed' : scrub(r.stderr || r.stdout) };
  }
  return { ok: true };
}

async function cmdAiBlock(sub, opts) {
  switch (sub) {
    case 'add':
      return aiBlockAdd(opts);
    case 'status':
      return aiBlockStatus(opts);
    case 'snippet':
      return aiBlockSnippet(opts);
    case 'check':
      return aiBlockCheck(opts);
    case 'install':
      return aiBlockInstall(opts);
    default:
      fail(EXIT.USAGE, `unknown: ai-block ${sub || ''} (add|status|snippet|check|install)\n\n${HELP}`);
  }
}

/** Download the current SDK tarball into vendor/ (versioned name from {hub}/sdk/latest.json) and install it from the file. */
async function aiBlockInstall(opts) {
  const dir = path.resolve(opts.dir || process.cwd());
  if (!fs.existsSync(path.join(dir, 'package.json'))) fail(EXIT.USAGE, `no package.json in ${dir}`, { fix: 'run in the app root or pass --dir <app root>' });
  const base = AD4AI_HUB_BASE();
  const metaRes = await fetch(`${base}/sdk/latest.json`, { signal: AbortSignal.timeout(15000) }).catch((e) => fail(EXIT.API, `cannot reach ${base}/sdk/latest.json — ${e.message}`));
  if (!metaRes.ok) fail(EXIT.API, `${base}/sdk/latest.json → HTTP ${metaRes.status}`);
  const meta = await metaRes.json();
  const version = String(meta.version || '');
  if (!/^\d+\.\d+\.\d+$/.test(version)) fail(EXIT.API, 'latest.json has no valid version');
  const name = `agent-ads-${version}.tgz`;
  const res = await fetch(`${base}/sdk/${name}`, { signal: AbortSignal.timeout(30000) }).catch((e) => fail(EXIT.API, `download failed — ${e.message}`));
  if (!res.ok) fail(EXIT.API, `${base}/sdk/${name} → HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 100 || buf[0] !== 0x1f || buf[1] !== 0x8b) fail(EXIT.API, `${name} is not a gzip tarball`);
  const vendor = path.join(dir, 'vendor');
  fs.mkdirSync(vendor, { recursive: true });
  const file = path.join(vendor, name);
  fs.writeFileSync(file, buf);
  const rel = `./vendor/${name}`;
  if (opts['no-npm']) return print(`saved ${rel} (${buf.length} bytes) — install with: npm i ${rel}`, { version, file: rel, installed: false });
  const pm = fs.existsSync(path.join(dir, 'pnpm-lock.yaml')) ? 'pnpm' : fs.existsSync(path.join(dir, 'yarn.lock')) ? 'yarn' : 'npm';
  const args = pm === 'npm' ? ['i', rel] : ['add', rel];
  const r = spawnSync(process.env.DCT_PAY_NPM_BIN || pm, args, { cwd: dir, stdio: 'inherit' });
  if (r.status !== 0) fail(EXIT.API, `${pm} ${args.join(' ')} failed (exit ${r.status})`, { fix: `run it yourself in ${dir}` });
  print(`installed @docenty/agent-ads ${version} from ${rel} — commit vendor/${name} with the app so deploy builds install it offline`, { version, file: rel, installed: true, packageManager: pm });
}

async function aiBlockAdd(opts) {
  need(opts, ['app']);
  // --env-path is the documented flag: Node >= 20 swallows `--env-file` as its own option even after the script name.
  // --env-file stays as an alias for invocations where Node does not intercept it (e.g. a wrapper binary).
  if (opts['env-path'] !== undefined) opts['env-file'] = opts['env-path'];
  if (opts.vercel && opts['env-file']) fail(EXIT.USAGE, 'use either --env-path or --vercel, not both');
  if (opts['env-file'] === true) fail(EXIT.USAGE, '--env-path needs a path (e.g. --env-path .env.local)');
  let categories;
  if (opts.categories !== undefined) {
    if (opts.categories === true) fail(EXIT.USAGE, '--categories needs a value (e.g. --categories "사진 편집,도구")');
    categories = String(opts.categories).split(',').map((s) => s.trim()).filter(Boolean);
  }
  // pre-flight the env target BEFORE asking for a secret (ad4ai hands it out once)
  let target;
  if (opts.vercel) {
    const v = vercelSpawn(['--version'], '');
    if (v.error || v.status !== 0) fail(EXIT.USAGE, 'vercel CLI not available (needed for --vercel)', { fix: 'npm i -g vercel && vercel link, or use --env-path .env.local' });
    target = { kind: 'vercel', environment: 'production' };
  } else {
    const abs = path.resolve(String(opts['env-file'] || '.env.local'));
    target = { kind: 'env-file', path: abs, ...ensureEnvFileSafe(abs) };
  }
  const cfg = requireRegistered();
  const base = apiBase(cfg);
  const body = { ...(categories ? { categories } : {}), ...(opts.rotate ? { rotate: true } : {}) };
  const r = await api('POST', base, `/apps/${encodeURIComponent(opts.app)}/ai-blocks`, { secretKey: cfg.secretKey, body });
  const values = { DOCENTY_SITE_KEY: r.siteKey };
  if (r.secret) values.DOCENTY_SDK_SECRET = r.secret;
  for (const [k, v] of Object.entries(values)) if (typeof v !== 'string' || !ENV_VALUE.test(v)) fail(EXIT.API, `unexpected ${k} format from the API (not written)`, { fix: 're-run with --rotate later; report this to Docenty' });
  const wrote = [];
  if (target.kind === 'vercel') {
    for (const [k, v] of Object.entries(values)) {
      const w = vercelEnvAdd(k, v);
      if (!w.ok) fail(EXIT.API, `vercel env add ${k} production failed: ${w.message}`, { fix: `fix the Vercel link, then: dct-pay ai-block add --app ${opts.app} --vercel${r.secret ? ' --rotate (the old secret was not saved)' : ''}` });
      wrote.push(k);
    }
  } else {
    upsertEnvFile(target.path, values);
    wrote.push(...Object.keys(values));
  }
  const where = target.kind === 'vercel' ? 'Vercel env (production)' : `${path.relative(process.cwd(), target.path) || target.path} (mode 600, gitignored${target.addedToGitignore ? ' — added to .gitignore' : ''})`;
  const review = r.status === 'approved' ? 'approved — 블록이 노출됩니다' : r.status === 'pending_review' ? 'pending_review — 운영자 검토 후 블록이 나옵니다' : `${r.status} — 블록이 나오지 않습니다 (dct-pay ai-block status 로 확인)`;
  const noSecret = r.secret ? '' : `\n  DOCENTY_SDK_SECRET was issued earlier and is kept as is (not shown again). Lost it? re-run with --rotate (the old one stops working).`;
  print(
    `ai-block linked — app ${opts.app}\n  media: ${r.mediaId} · status: ${review}\n  wrote ${wrote.join(', ')} → ${where}${noSecret}\n  next: dct-pay ai-block snippet --framework <${AI_FRAMEWORKS.join('|')}>`,
    { status: r.status, siteKey: r.siteKey, mediaId: r.mediaId, hubBase: r.hubBase, secretIssued: !!r.secret, wrote, target: target.kind === 'vercel' ? target : { kind: 'env-file', path: target.path, gitignored: true, addedToGitignore: target.addedToGitignore } },
  );
}

async function aiBlockStatus(opts) {
  need(opts, ['app']);
  const cfg = requireRegistered();
  const r = await api('GET', apiBase(cfg), `/apps/${encodeURIComponent(opts.app)}/ai-blocks`, { secretKey: cfg.secretKey });
  const review = r.status === 'pending_review' ? 'pending_review (운영자 검토 후 블록이 나옵니다)' : r.status;
  print(
    `ai-block status — app ${opts.app}\n  review: ${review}\n  live placements: ${r.placements ?? 0}\n  last verification: ${r.lastVerifiedAt || '—'}${r.lastVerdict ? ` (${r.lastVerdict})` : ''}\n  AI crawler visits (30d): ${r.crawlerVisits30d ?? 0}`,
    r,
  );
}

function aiSnippetFor(framework, siteUrl) {
  const site = siteUrl || 'https://your-site.example';
  const install = SDK_INSTALL_CMD;
  const env = 'DOCENTY_SITE_KEY / DOCENTY_SDK_SECRET (server env only — written by `dct-pay ai-block add`)';
  const marker = '<div data-docenty-slot></div>';
  const ssrCfg = `{ siteKey: process.env.DOCENTY_SITE_KEY, secret: process.env.DOCENTY_SDK_SECRET }`;
  const S = {
    'next-app': {
      method: 'ssr',
      files: [
        {
          path: 'app/<page>/page.tsx (server component)',
          content: `import { headers } from "next/headers";
import { AgentAdsBlock } from "@docenty/agent-ads/next";

export default async function Page() {
  const h = await headers();
  return (
    <main>
      {/* … page content … */}
      <AgentAdsBlock
        siteKey={process.env.DOCENTY_SITE_KEY!}
        secret={process.env.DOCENTY_SDK_SECRET!}
        pageUrl="${site}/<page>"
        userAgent={h.get("user-agent")}
      />
    </main>
  );
}`,
        },
      ],
    },
    'next-pages': {
      method: 'ssr',
      files: [
        {
          path: 'pages/<page>.tsx',
          content: `import type { GetServerSideProps } from "next";
import { createAgentAds } from "@docenty/agent-ads";

const ads = createAgentAds(${ssrCfg.replace('process.env.DOCENTY_SITE_KEY', 'process.env.DOCENTY_SITE_KEY!').replace('process.env.DOCENTY_SDK_SECRET', 'process.env.DOCENTY_SDK_SECRET!')});

export const getServerSideProps: GetServerSideProps = async ({ req, resolvedUrl }) => {
  ads.observe(req.headers["user-agent"]);
  return { props: { adsHtml: await ads.renderHtml("${site}" + resolvedUrl) } };
};

export default function Page({ adsHtml }: { adsHtml: string }) {
  return (
    <main>
      {/* … page content … */}
      <div data-docenty-sdk="1" dangerouslySetInnerHTML={{ __html: adsHtml }} />
    </main>
  );
}`,
        },
      ],
    },
    astro: {
      method: 'ssr',
      files: [
        {
          path: 'src/pages/<page>.astro',
          content: `---
import { createAgentAds } from "@docenty/agent-ads";
const ads = createAgentAds({ siteKey: import.meta.env.DOCENTY_SITE_KEY, secret: import.meta.env.DOCENTY_SDK_SECRET });
const adsHtml = await ads.renderHtml(new URL(Astro.url.pathname, "${site}").href);
---
<main>
  <!-- … page content … -->
  <div data-docenty-sdk="1" set:html={adsHtml} />
</main>`,
        },
      ],
      note: 'Works for SSR and prerendered pages (prerendered: the block is fixed at build time — rebuild to refresh).',
    },
    sveltekit: {
      method: 'ssr',
      files: [
        {
          path: 'src/routes/<page>/+page.server.ts',
          content: `import { env } from "$env/dynamic/private";
import { createAgentAds } from "@docenty/agent-ads";

const ads = createAgentAds({ siteKey: env.DOCENTY_SITE_KEY!, secret: env.DOCENTY_SDK_SECRET! });

export async function load({ url, request }) {
  ads.observe(request.headers.get("user-agent"));
  return { adsHtml: await ads.renderHtml(new URL(url.pathname, "${site}").href) };
}`,
        },
        { path: 'src/routes/<page>/+page.svelte', content: `<script>\n  export let data;\n</script>\n\n<!-- … page content … -->\n<div data-docenty-sdk="1">{@html data.adsHtml}</div>` },
      ],
    },
    remix: {
      method: 'ssr',
      files: [
        {
          path: 'app/routes/<page>.tsx',
          content: `import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { createAgentAds } from "@docenty/agent-ads";

const ads = createAgentAds(${ssrCfg.replace('process.env.DOCENTY_SITE_KEY', 'process.env.DOCENTY_SITE_KEY!').replace('process.env.DOCENTY_SDK_SECRET', 'process.env.DOCENTY_SDK_SECRET!')});

export async function loader({ request }: LoaderFunctionArgs) {
  ads.observe(request.headers.get("user-agent"));
  return json({ adsHtml: await ads.renderHtml(new URL(new URL(request.url).pathname, "${site}").href) });
}

export default function Page() {
  const { adsHtml } = useLoaderData<typeof loader>();
  return (
    <main>
      {/* … page content … */}
      <div data-docenty-sdk="1" dangerouslySetInnerHTML={{ __html: adsHtml }} />
    </main>
  );
}`,
        },
      ],
    },
    nuxt: {
      method: 'ssr',
      files: [
        {
          path: 'server/api/agent-ads.get.ts',
          content: `import { createAgentAds } from "@docenty/agent-ads";

const ads = createAgentAds(${ssrCfg.replace('process.env.DOCENTY_SITE_KEY', 'process.env.DOCENTY_SITE_KEY!').replace('process.env.DOCENTY_SDK_SECRET', 'process.env.DOCENTY_SDK_SECRET!')});

export default defineEventHandler(async (event) => {
  const path = String(getQuery(event).path || "/");
  return { html: await ads.renderHtml(new URL(path, "${site}").href) };
});`,
        },
        {
          path: 'pages/<page>.vue',
          content: `<script setup lang="ts">
const route = useRoute();
// runs during SSR: the block is in the initial HTML (the secret stays in the server route)
const { data } = await useFetch("/api/agent-ads", { query: { path: route.path } });
</script>

<template>
  <main>
    <!-- … page content … -->
    <div data-docenty-sdk="1" v-html="data?.html" />
  </main>
</template>`,
        },
      ],
    },
    express: {
      method: 'ssr',
      files: [
        {
          path: 'server.js',
          content: `import express from "express";
import { createAgentAds } from "@docenty/agent-ads";

const ads = createAgentAds(${ssrCfg});
const app = express();

app.get("/<page>", async (req, res) => {
  ads.observe(req.get("user-agent"));
  const adsHtml = await ads.renderHtml(new URL(req.path, "${site}").href);
  res.send(renderPage().replace('${marker}', adsHtml)); // renderPage(): your HTML with the marker where the block goes
});`,
        },
      ],
    },
    vite: {
      method: 'build-inject',
      files: [
        { path: 'index.html (and any other page)', content: `<!-- where the sponsored block goes (optionally data-docenty-slot="name") -->\n${marker}` },
        { path: 'package.json scripts', content: `"postbuild": "agent-ads inject dist --site-url ${site}"` },
      ],
      note: 'pnpm/yarn berry skip post-scripts: use "build": "vite build && agent-ads inject dist --site-url …" instead. DOCENTY_SITE_KEY / DOCENTY_SDK_SECRET must be set in the BUILD env (e.g. Vercel production env). The block is fixed at build time — rebuild (or use an edge method) to refresh. Fail-open: no block → marker stays empty, build still passes.',
    },
    static: {
      method: 'build-inject',
      files: [
        { path: '<page>.html', content: `<!-- where the sponsored block goes (optionally data-docenty-slot="name") -->\n${marker}` },
        { path: 'package.json scripts', content: `"build": "agent-ads inject <outDir> --site-url ${site}"` },
      ],
      note: 'Run on the deploy build (not by hand): <outDir> is the folder you publish. Hosted on Cloudflare/Vercel/Netlify without a build step? use --framework cloudflare|vercel-edge|netlify-edge.',
    },
    cloudflare: {
      method: 'edge',
      files: [
        {
          path: 'src/worker.js (Cloudflare Worker in front of the site; secrets: wrangler secret put DOCENTY_SITE_KEY / DOCENTY_SDK_SECRET)',
          content: `import { injectBlocks } from "@docenty/agent-ads/edge";

export default {
  async fetch(request, env) {
    const res = await fetch(request);
    if (!(res.headers.get("content-type") || "").includes("text/html")) return res;
    const html = await injectBlocks(await res.text(), { siteKey: env.DOCENTY_SITE_KEY, secret: env.DOCENTY_SDK_SECRET, pageUrl: request.url });
    return new Response(html, res);
  },
};`,
        },
        { path: '<page>.html', content: marker },
      ],
      note: 'The SDK repo also ships a ready HTMLRewriter template; same HTML for every visitor (never branch on User-Agent).',
    },
    'vercel-edge': {
      method: 'edge',
      files: [
        {
          path: 'middleware.js (Vercel Routing Middleware, non-Next projects)',
          content: `import { injectBlocks } from "@docenty/agent-ads/edge";

export const config = { matcher: ["/((?!api/|.*\\\\.[a-z0-9]+$).*)"] };

export default async function middleware(request) {
  if (request.headers.get("x-docenty-inject")) return; // the origin fetch below re-enters middleware
  const res = await fetch(request.url, { headers: { "x-docenty-inject": "1" } });
  if (!(res.headers.get("content-type") || "").includes("text/html")) return res;
  const html = await injectBlocks(await res.text(), { siteKey: process.env.DOCENTY_SITE_KEY, secret: process.env.DOCENTY_SDK_SECRET, pageUrl: request.url });
  return new Response(html, res);
}`,
        },
        { path: '<page>.html', content: marker },
      ],
      note: 'Next.js on Vercel: use --framework next-app instead. Prefer the template shipped in the SDK repo if it differs.',
    },
    'netlify-edge': {
      method: 'edge',
      files: [
        {
          path: 'netlify/edge-functions/agent-ads.js',
          content: `import { injectBlocks } from "@docenty/agent-ads/edge";

export default async (request, context) => {
  const res = await context.next();
  if (!(res.headers.get("content-type") || "").includes("text/html")) return res;
  const html = await injectBlocks(await res.text(), { siteKey: Netlify.env.get("DOCENTY_SITE_KEY"), secret: Netlify.env.get("DOCENTY_SDK_SECRET"), pageUrl: request.url });
  return new Response(html, res);
};

export const config = { path: "/*", excludedPath: ["/*.css", "/*.js", "/*.png", "/*.jpg", "/*.svg", "/*.ico"] };`,
        },
        { path: '<page>.html', content: marker },
      ],
    },
  };
  const s = S[framework];
  return { framework, method: s.method, install, env, files: s.files, note: s.note || '', rule: `Every visitor (human or bot) gets the same HTML — never branch on User-Agent. The block always starts with "${SPONSOR_LABEL}".` };
}

function aiBlockSnippet(opts) {
  need(opts, ['framework']);
  const fw = String(opts.framework);
  if (!AI_FRAMEWORKS.includes(fw)) fail(EXIT.USAGE, `--framework must be one of ${AI_FRAMEWORKS.join('|')}`);
  const siteUrl = typeof opts['site-url'] === 'string' ? opts['site-url'].replace(/\/+$/, '') : '';
  const s = aiSnippetFor(fw, siteUrl);
  const methodName = { ssr: 'server render (SSR adapter)', 'build-inject': 'build-time injection (postbuild)', edge: 'edge injection' }[s.method];
  const files = s.files.map((f) => `── ${f.path}\n${f.content}`).join('\n\n');
  print(`# ai-block · ${fw} · ${methodName}\n# 1) install (no GitHub auth):\n${s.install}\n# 2) env: ${s.env}\n# 3) code:\n\n${files}\n${s.note ? `\n# note: ${s.note}\n` : ''}# rule: ${s.rule}\n# 4) after deploy: dct-pay ai-block check --url ${siteUrl || '<deployed url>'}`, s);
}

// ---- check (same report as `agent-ads check`, zero-dep) ----
const AI_CRAWLER_UA = 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; OAI-SearchBot/1.3; +https://openai.com/searchbot';
const BROWSER_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
const decodeEntities = (s) => s.replace(/&(amp|lt|gt|quot|#39|middot|nbsp|#x?[0-9a-f]+);/gi, (m, e) => {
  const k = e.toLowerCase();
  if (k === 'amp') return '&';
  if (k === 'lt') return '<';
  if (k === 'gt') return '>';
  if (k === 'quot') return '"';
  if (k === '#39') return "'";
  if (k === 'middot') return '·';
  if (k === 'nbsp') return ' ';
  const n = k.startsWith('#x') ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10);
  return Number.isFinite(n) ? String.fromCodePoint(n) : m;
});
const textOf = (html) => decodeEntities(html.replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim();
const attr = (tag, name) => {
  const m = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag);
  return m ? decodeEntities(m[1] ?? m[2] ?? m[3] ?? '') : null;
};
/**
 * ad4ai blocks in raw HTML. Current markup: <section class="dct-placement" data-docenty-deal> whose first element is
 * <h3>협찬 · 광고 — {광고주}</h3>; legacy markup (still valid for blocks published before 2026-10-11):
 * <aside class="docenty-sponsored"> with "협찬 · 광고" as the first <p>.
 */
function analyzeAiBlocks(html) {
  const blocks = [];
  const roots = [
    { re: /<section\b[^>]*>[\s\S]*?<\/section>/gi, cls: /\bdct-placement\b/, close: '</section>', first: /<h[1-6]\b[^>]*>([\s\S]*?)<\/h[1-6]>/i },
    { re: /<aside\b[^>]*>[\s\S]*?<\/aside>/gi, cls: /\bdocenty-sponsored\b/, close: '</aside>', first: /<p\b[^>]*>([\s\S]*?)<\/p>/i },
  ];
  for (const r of roots) {
    for (const m of html.matchAll(r.re)) {
      const open = m[0].slice(0, m[0].indexOf('>') + 1);
      if (!r.cls.test(attr(open, 'class') || '')) continue;
      const inner = m[0].slice(open.length, -r.close.length);
      const first = r.first.exec(inner);
      const label = first ? textOf(first[1]) : '';
      // the label must lead the block: nothing but whitespace before the first heading/paragraph
      const leads = !!first && textOf(inner.slice(0, first.index)) === '';
      const anchors = [...inner.matchAll(/<a\b[^>]*>/gi)].map((a) => a[0]);
      const channel = anchors.find((a) => /\/c\/[^/?#"']+/.test(attr(a, 'href') || ''));
      const rel = channel ? (attr(channel, 'rel') || '').toLowerCase().split(/\s+/) : [];
      const b = { dealId: attr(open, 'data-docenty-deal'), labelFirstLine: leads && (label === SPONSOR_LABEL || label.startsWith(`${SPONSOR_LABEL} — `)), channelLink: channel ? attr(channel, 'href') : null, relSponsored: rel.includes('sponsored'), html: m[0] };
      b.valid = b.labelFirstLine && !!b.channelLink && b.relSponsored;
      blocks.push(b);
    }
  }
  return blocks;
}
async function fetchPage(url, ua) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { headers: { 'user-agent': ua, accept: 'text/html,application/xhtml+xml' }, redirect: 'follow', signal: ctl.signal });
    return { status: res.status, html: await res.text() };
  } catch (e) {
    return { status: 0, html: '', error: e && e.name === 'AbortError' ? `timeout after ${TIMEOUT_MS / 1000}s` : (e && e.message) || String(e) };
  } finally {
    clearTimeout(t);
  }
}
async function aiBlockCheck(opts) {
  need(opts, ['url']);
  let u;
  try {
    u = new URL(String(opts.url));
  } catch {
    u = null;
  }
  if (!u || (u.protocol !== 'https:' && u.protocol !== 'http:')) fail(EXIT.USAGE, '--url must be an absolute http(s) URL of the deployed page');
  const [ai, browser] = await Promise.all([fetchPage(u.toString(), AI_CRAWLER_UA), fetchPage(u.toString(), BROWSER_UA)]);
  if (ai.error && browser.error) fail(EXIT.API, `could not fetch ${u}: ${ai.error}`, { fix: 'check the URL is deployed and public' });
  const view = (r) => {
    const blocks = analyzeAiBlocks(r.html);
    return { status: r.status, error: r.error || null, blockPresent: blocks.length > 0, valid: blocks.some((b) => b.valid), blocks: blocks.map(({ html, ...b }) => b) };
  };
  const aiView = view(ai);
  const brView = view(browser);
  const sig = (r) => analyzeAiBlocks(r.html).map((b) => b.html.replace(/\s+/g, ' ')).join('\n');
  const sameForBoth = sig(ai) === sig(browser);
  const ok = aiView.valid;
  const yn = (b) => (b ? 'yes' : 'NO');
  const line = (name, v) => {
    const b = v.blocks.find((x) => x.valid) || v.blocks[0];
    return `  ${name}: ${v.error ? `fetch failed (${v.error})` : `HTTP ${v.status}`} · block in initial HTML: ${yn(v.blockPresent)} · label "${SPONSOR_LABEL}" first: ${yn(!!b && b.labelFirstLine)} · channel link rel=sponsored: ${yn(!!b && !!b.channelLink && b.relSponsored)}`;
  };
  const verdict = ok
    ? 'OK — AI 답변 엔진이 보는 첫 HTML 에 협찬 블록이 있습니다'
    : aiView.blockPresent
      ? 'FAIL — 블록은 있지만 표시 규칙(라벨 첫 줄·rel=sponsored 채널 링크)이 맞지 않습니다'
      : 'FAIL — AI 크롤러가 받는 첫 HTML 에 블록이 없습니다 (JS 로만 넣었거나, 검토 대기(pending_review)·배치 없음일 수 있음: dct-pay ai-block status)';
  const data = { url: u.toString(), ok, aiCrawler: { userAgent: 'OAI-SearchBot', ...aiView }, browser: { userAgent: 'browser', ...brView }, sameForBoth };
  if (JSON_MODE) process.stdout.write(JSON.stringify(data, null, 2) + '\n');
  else process.stdout.write(`ai-block check ${u}\n${line('AI crawler (OAI-SearchBot)', aiView)}\n${line('browser                   ', brView)}\n  same block for both: ${yn(sameForBoth)}\n  result: ${verdict}\n`);
  if (!ok) process.exit(EXIT.CHECK);
}

// ---------- tips (one short Docenty Pay line, at most once a day, human mode only) ----------
// Factual product notes with a utm link so Docenty can tell the CLI helped. Never in --json, never on errors,
// never in --dry-run; written to stderr so piped stdout stays clean. Off: DCT_PAY_NO_TIPS=1.
const TIP_LINK = (p, c) => `https://pay.docenty.ai${p}?utm_source=dct-pay-cli&utm_medium=cli&utm_campaign=${c}`;
const TIPS = [
  { after: ['app', 'product', 'template'], text: `상품 링크는 카톡에 붙여도 바로 결제됩니다. 업종별 사례·체크리스트 → ${TIP_LINK('/cases', 'cases')}` },
  { after: ['invoice', 'order'], text: `청구서·입금 확인·발송 안내는 대시보드에서도 한눈에 봅니다 → ${TIP_LINK('/dashboard', 'dashboard')}` },
  { after: ['readiness', 'snippet', 'init'], text: `랜딩·상품 페이지가 없다면 NvLand가 AI로 만들어 줍니다 → https://nvland.docenty.ai/?utm_source=dct-pay-cli&utm_medium=cli&utm_campaign=nvland` },
  { after: ['app', 'product', 'readiness', 'dashboard', 'whoami'], text: `적립금은 매월 무료 출금하거나 클라우드·LLM·광고비 대납에 쓸 수 있습니다(크레딧 자체는 현금 아님) → ${TIP_LINK('/', 'payout')}#pricing` },
];
function pickTip(cmd, now = Date.now()) {
  const pool = TIPS.filter((t) => t.after.includes(cmd));
  return pool.length ? pool[Math.floor(now / 86_400_000) % pool.length] : null;
}
function maybeTip(cmd, opts) {
  if (JSON_MODE || opts['dry-run'] || process.env.DCT_PAY_NO_TIPS) return;
  const tip = pickTip(cmd);
  if (!tip) return;
  const statePath = path.join(path.dirname(CONFIG_PATH), 'tips.json');
  let last = 0;
  try {
    last = JSON.parse(fs.readFileSync(statePath, 'utf8')).lastTipAt || 0;
  } catch {
    /* first run */
  }
  if (Date.now() - last < 86_400_000) return;
  try {
    fs.mkdirSync(path.dirname(statePath), { recursive: true, mode: 0o700 });
    fs.writeFileSync(statePath, JSON.stringify({ lastTipAt: Date.now() }) + '\n');
  } catch {
    return; // cannot remember → stay quiet rather than repeat every run
  }
  process.stderr.write(`\n· tip: ${tip.text}  (끄기: DCT_PAY_NO_TIPS=1)\n`);
}

// ---------- main ----------
let LAST = { cmd: '', opts: {} };
async function main() {
  const { positional, opts } = parseArgs(process.argv.slice(2));
  JSON_MODE = !!opts.json;
  LAST = { cmd: positional[0] || '', opts };
  if (opts.api) process.env.DCT_PAY_API = String(opts.api);
  if (opts.version) return print(VERSION, { version: VERSION });
  const [cmd, sub] = positional;
  if (!cmd || opts.help) {
    print(HELP, { help: HELP.trim().split('\n') });
    return process.exit(cmd || opts.help ? EXIT.OK : EXIT.USAGE);
  }
  switch (cmd) {
    case 'register':
      return cmdRegister(opts);
    case 'login':
      return cmdLogin(opts);
    case 'policy':
      return cmdPolicy(sub, opts);
    case 'open':
      return cmdDashboard();
    case 'app':
      return cmdApp(sub || 'list', opts);
    case 'product':
      return cmdProduct(sub, opts);
    case 'template':
      return cmdTemplate(sub, { ...opts, key: opts.key || positional[2] });
    case 'invoice':
      return cmdInvoice(sub, { ...opts, id: opts.id || positional[2] });
    case 'order':
      return cmdOrder(sub, { ...opts, id: opts.id || positional[2] });
    case 'init':
      return cmdInit(opts);
    case 'slot':
      return cmdSlot(sub, opts);
    case 'readiness':
      return cmdReadiness(opts);
    case 'snippet':
      return cmdSnippet(opts);
    case 'ai-block':
      return cmdAiBlock(sub, opts);
    case 'dashboard':
      return cmdDashboard();
    case 'whoami':
      return cmdWhoami();
    case 'help':
      return print(HELP, { help: HELP.trim().split('\n') });
    default:
      fail(EXIT.USAGE, `unknown command "${cmd}"\n\n${HELP}`);
  }
}

main()
  .then(() => maybeTip(LAST.cmd, LAST.opts))
  .catch((e) => fail(EXIT.API, e && e.message ? e.message : String(e)));
