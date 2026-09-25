#!/usr/bin/env node
/*
 * dct-pay CLI — zero-dependency wrapper over the dct-pay HTTP API (sp_001 §3).
 * Node >= 18 (global fetch). Config: ~/.dct-pay/config.json (chmod 600).
 *
 * Exit codes: 0 ok · 1 usage · 2 network/API error (server message printed) · 3 not registered
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const VERSION = '1.1.0';
const TIMEOUT_MS = 15000;
const DEFAULT_API = 'https://pay.docenty.ai';
const API = (process.env.DCT_PAY_API || DEFAULT_API).replace(/\/+$/, '');
const CONFIG_PATH = process.env.DCT_EARN_CONFIG || path.join(os.homedir(), '.dct-pay', 'config.json');
const EXIT = { OK: 0, USAGE: 1, API: 2, NOT_REGISTERED: 3 };

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
  dct-pay template list | inspect <fruit|consulting> | apply <fruit|consulting> --app <appId> [--name] [--inventory] [--dry-run]
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
  dct-pay dashboard | open
  dct-pay whoami                              # verifies the saved key against the API

GLOBAL FLAGS
  --json        machine-readable output
  --api <url>   override API base (env DCT_PAY_API, default ${DEFAULT_API})
  --help, -h    this text
  --version

CONFIG   ${CONFIG_PATH}   (creator secret lives here; never printed)
EXIT     0 ok · 1 usage · 2 network/API error · 3 not logged in (or key revoked)
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
  const cfg = requireRegistered();
  const base = apiBase(cfg);
  const r = await api('POST', base, '/products', {
    secretKey: cfg.secretKey,
    body: {
      appId: opts.app,
      name: opts.name || (opts.kind === 'tip' ? '후원' : undefined),
      kind: opts.kind,
      priceKrw: price,
      credits: opts.credits ? Number(opts.credits) : undefined,
      entitlementKey: opts.entitlement || undefined,
    },
  });
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
  const cfg = requireRegistered();
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

// ---------- main ----------
async function main() {
  const { positional, opts } = parseArgs(process.argv.slice(2));
  JSON_MODE = !!opts.json;
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

main().catch((e) => fail(EXIT.API, e && e.message ? e.message : String(e)));
