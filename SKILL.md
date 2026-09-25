---
name: dct-pay
description: dct-pay — attach payments and sponsor-slot monetisation to a vibe-coded web app in one session, via pay.docenty.ai (Docenty is the merchant of record; you get a hosted /pay page, entitlements, app-scoped credits and sponsor slots that earn build credits). Use when a user says "attach payments to my app", "add a Pro button", "sell this as a one-time purchase", "monetise my app", "add a sponsor slot", "/dct-pay pay", "/dct-pay earn", or in Korean "내 앱에 결제 붙여줘", "수익화 붙여줘", "돈 벌게 해줘", "Pro 구매 버튼 넣어줘", "스폰서 슬롯 넣어줘". Web apps only (Next.js, React, Vite, static HTML); refuses CLIs, bots, mobile and backend-only repos with an explanation. Never fabricates keys, never sends anything without showing it first, never calls build credits cash.
license: (c) Docenty. Evaluation use. Credits (BC) are not cash and are not refundable.
metadata:
  version: 1.0.0
  homepage: https://pay.docenty.ai
  repository: https://github.com/ctb-rebooted/dct-pay-skill
  api: https://pay.docenty.ai/api
  contract: docs/ai-gen/gstack/specs/sp_001_dct-earn-v0-contract.md + docs/ai-gen/gstack/plans/pl_001_dct-earn-saas-v1.md (§1, §3, §6, §10)
---

# dct-pay — 결제 붙이기 · 수익화 붙이기

Two flows, one CLI. `scripts/dct-pay.mjs` is a zero-dependency Node >= 18 wrapper over the
pay.docenty.ai API; the SDK is one `<script>` tag. You (the agent) do the repo analysis, the
edits and the explaining; the CLI does the API calls. Every network call goes through the CLI so
the user can see exactly what is sent.

```bash
node scripts/dct-pay.mjs --help          # run from this skill's directory
export DCT_PAY_API=http://localhost:3000 # dev platform (default https://pay.docenty.ai)
```

Config lives in `~/.dct-pay/config.json` (mode 600). It holds the creator secret `dce_sk_…`.
**The secret is never printed.** `dct-pay login` uses a device-code flow: the user clicks the
link in their mail and the key is delivered straight to the terminal. Never read the file aloud,
never paste the secret into the user's repo or chat. Only the app **public** key `dce_pk_…` goes in the page.

Accounts: if the user has no account, `register` creates one and returns **202 verify_email**
(no key). They click the mail link, then `login`. If they already signed up at
https://pay.docenty.ai, skip `register` and just `login --email <e>` (or `login --key` to paste a
key copied from 대시보드 → 설정 into a masked prompt).

## Step 0 — analyse the repo (both flows)

Detect the app type before anything else and say what you found in one line.

| Signal | Type | Where the SDK snippet goes |
|---|---|---|
| `next` in package.json, `app/layout.tsx` or `pages/_app.tsx` | Next.js | `app/layout.tsx` (`<Script src=… strategy="afterInteractive">`) or `pages/_document.tsx` |
| `react` + `vite` in package.json, `index.html` at root | Vite/React | `index.html` `<head>`; button/slot in the top-level page component |
| `react` without vite (CRA etc.) | React | `public/index.html`; button/slot in `App.tsx` |
| `index.html` and no bundler | Static HTML | `index.html` before `</body>` |
| Only `*.py`, `bin/`, `Dockerfile` w/o web UI, Telegram/Discord bot, Expo/Flutter, Electron | **not a web app** | **Refuse** (see below) |

Also note: existing pricing/paywall code, an auth layer (what identifies a user → that is
`buyerRef`), and an existing footer (policy links go there). Record the framework in the
transcript (`framework: next`), the CLI does not store it.

**Refusing non-web repos** — say: "dct-pay v0 only supports web apps (Next.js/React/Vite/static
HTML); this repo is a `<type>` so a hosted /pay page and a browser SDK cannot be attached. Options:
add a small web front, or wait for a later version." Record `type: <type>, refused` and stop.

## Flow `pay` — `/dct-pay pay` · "내 앱에 결제 붙여줘"

Ask exactly **one** question, then run everything:

> 무엇을 얼마에 팔까요? (예: "Pro 기능 9,900원 1회 구매", "크레딧 100개 5,000원", "사과 3kg 15,000원·5kg 24,000원 배송비 3,000원", "60분 상담 90,000원")

Branch on the answer (pl_002 §3 templates, 2026-09-25): software → `--kind one_time|credit_pack` as before;
**농산물·실물** → `template apply fruit --app <appId> --variants "3kg:15000,5kg:24000" --shipping 3000 --inventory 20`;
**상담·서비스** → `template apply consulting --app <appId> --variants "30분:50000,60분:90000"`. The product page is
`/u/<handle>/p/<productId>` (options, qty, shipping total); the buyer fills 배송지/희망 일시 on /pay before paying.
For a non-developer seller prefer `invoice send --to 010-… --product <id>` (알림톡/이메일 link) over SDK snippets.
Use `--dry-run` to show the exact request first. Never promise "발송됨" when the API returns `deliveryStatus: noop`.

Derive: `--kind one_time --entitlement pro` for a feature unlock, or `--kind credit_pack --credits N`
for metered use. Price is integer KRW. If the user is vague, propose one default and confirm.

1. **Log in once** (check with `whoami`; exit 3 = not logged in or key revoked).
   Ask email (and handle/name for a brand-new account) if not inferable from git config; show the command before running.
   ```bash
   node scripts/dct-pay.mjs register --handle <handle> --email <email> --name "<name>"   # new account → 202, mail sent
   node scripts/dct-pay.mjs login --email <email>     # waits for the mail click; key lands in the terminal, nothing to paste
   ```
   Tell the user the mail shows the same code as the terminal and to approve only if it matches.
2. **Create the app** (name/url/category from the repo; contact = the registered email unless told otherwise).
   ```bash
   node scripts/dct-pay.mjs app add --name "<app>" --url https://<deployed-url> --category <tools|game|content|edu|other> --contact <email>
   ```
   Note the `id` and `publicKey`.
3. **Create the product.**
   ```bash
   node scripts/dct-pay.mjs product add --app <appId> --name "Pro" --kind one_time --price 9900 --entitlement pro
   ```
4. **Insert the SDK + button.** `node scripts/dct-pay.mjs snippet --app <appId> --framework <static|react|next|vite>`
   prints the exact snippets; `--kind file` prints one complete, working component file
   (`components/EarnPro.tsx` for React/Next/Vite, an `index.html` block for static). Put the
   `<script data-app-key>` (pinned `/sdk/v1/` URL) in the file from the table, bind the buyer once with
   `DocentyEarn.identify(user.email)` (email-mode apps) and gate the feature with
   `await DocentyEarn.entitled('pro')` (or `credits()` / `consume(n, reason)`). After `checkout()`,
   `waitForCheckout()` then re-query `entitled()`. If the app has no accounts, omit `buyerRef`: the
   buyer types their email on `/pay`. A tip button is one line: `DocentyEarn.tipButton()`.
   **Show the diff and say which file/line and why before writing.**
5. **Policy links.** Add the `policy` snippet (이용약관 · 환불정책 · 개인정보처리방침 →
   `/p/<appId>/…`) to the footer. Docenty is the seller of record in v0; the pages already say so.
6. **Readiness + dashboard.**
   ```bash
   node scripts/dct-pay.mjs readiness --app <appId>     # fix any [--] item it lists
   node scripts/dct-pay.mjs dashboard                    # print this URL to the user
   ```
   "PG 미연결(계좌이체만 가능)" is normal until Docenty connects the PG for that app; manual
   transfer works today.

## Flow `earn` — `/dct-pay earn` · "수익화 붙여줘" · "돈 벌게 해줘"

No question needed unless the repo has no obvious place for a sponsor CTA.

1. Register + app add as above (skip what already exists; `app list` shows registered apps).
2. **Create the slot.**
   ```bash
   node scripts/dct-pay.mjs slot add --app <appId>
   ```
   Two outcomes: a slot `code` (proceed), or `status: waiting / NO_CAMPAIGN` ("스폰서 캠페인 대기 중").
   In the waiting state still insert the slot with `slotCode: 'SLOT_CODE'` placeholder and tell the
   user to re-run `slot add` when a campaign opens; nothing is sent until a real code exists.
3. **Insert `DocentyEarn.slot()`** where a user has just finished something (result screen,
   post-export, end of a session): `snippet --kind slot`. The SDK renders the CTA **and** the
   consent notice "스폰서 액션 및 사용 통계가 Docenty로 전송됩니다 · 개인정보처리방침". Do not style
   the notice away and do not remove it — the SDK sends no events without it. Show the diff first.
4. Add policy links to the footer (as in `pay` step 5) and run `readiness`.
5. Print the dashboard URL (`dashboard`); the ledger (pending → spendable build credits) is on it.
   Explain once: conversions become **build credits (BC)** usable for Docenty services;
   BC is not cash and cannot be withdrawn.

## What the user must be told (in your words, every time)

- What was sent to pay.docenty.ai: creator handle/email/name, app name/url/category/contact,
  product name/price. Nothing else. Show each CLI command before running it.
- Where the public key is (page) and where the secret is (`~/.dct-pay/config.json`, mode 600).
- Buyers pay on a Docenty-hosted `/pay` page; Docenty is the seller of record in v0; refund
  policy lives at `/p/<appId>/refund`.
- Sponsor slots pay in build credits, not cash.

## Hard rules

- **Never fabricate** app ids, keys, slot codes, prices, dashboard URLs. Only values printed by the CLI.
  If the CLI exits 2, show its message and stop; do not guess.
- **Never send anything without showing it**: print the exact `dct-pay …` command, then run it.
- **Never print or copy the creator secret.** Never pass it as a CLI argument. Never commit `~/.dct-pay`.
- **Never tell a creator their own confirm accrues credits**: creator confirm only grants the buyer;
  BC accrues when Docenty verifies the deposit (or on a PortOne-verified card payment).
- **Never claim credits are cash**, refundable, or withdrawable. Say "빌드 크레딧(현금 아님)".
- **Never remove or hide the consent notice** rendered by `DocentyEarn.slot()`.
- Do not edit `apps/platform` or the hosted `/pay` page; the app only links to it.
- One question per flow. If the answer is enough, do not ask more.

## When NOT to use

- The repo is not a web app (CLI, bot, mobile, API-only, desktop). Refuse as described.
- The user wants subscriptions, cash payouts, their own PG contract, x402/crypto, or non-KRW pricing:
  v0 does not do these. Say so; do not improvise.
- The user asks whether their app will make money or how much: no forecasts; point at the dashboard.
- The user only wants a price change on an existing product: use `product add` for a new product
  and tell them the old one stays until the dashboard deactivates it. (No `product edit` in v0.)
- The user has no deployed URL yet: still fine for `pay` (use the planned URL), but say readiness
  will flag SDK detection until deployed.

## CLI reference (`scripts/dct-pay.mjs`)

| Command | API (sp_001 §3) | Notes |
|---|---|---|
| `login [--email] \| --key` | `POST /auth/cli/start`+`/poll` \| `GET /creators/me` | device code; key never printed |
| `register --handle --email --name` | `POST /creators` | 202 verify_email; then `login` |
| `app add --name --url --category --contact [--description]` | `POST /apps` | prints id + publicKey |
| `app list` | `GET /creators/me` | |
| `product add --app --name --kind --price [--credits] [--entitlement]` | `POST /products` | kind one_time\|credit_pack\|tip (tip: one per app) |
| `product add --kind physical\|service --variants "n:p,…" [--shipping] [--inventory] [--image]` · `--input f.json --dry-run` | `POST /products` | 실물·상담 (변형·재고·배송비·이행 폼 필드) |
| `template list\|inspect\|apply <fruit\|consulting> --app` | `GET/POST /templates` | 상품 + 정책 문안 한 번에 |
| `invoice send --app (--to\|--email) (--product\|--amount) [--note]` · `list` · `get` | `POST/GET /invoices` | deliveryStatus `noop` = 발송 안 됨(미리보기) |
| `order list [--status]` · `order fulfill <id> [--event ship\|fulfill] [--tracking]` | `GET /orders`, `POST /orders/:id/fulfill` | ship 은 입금 확인 후 |
| `init [--framework] [--dir] [--dry-run]` | — | 튜토리얼 호환 파일 (Supabase+Stripe 패턴 치환), 시크릿은 서버 env 만 |
| `app add … --test` | `POST /apps {mode:'test'}` | `dce_pk_test_` 키, 가짜 결제창 |
| `policy fill --app` | `POST /apps/:id/policies/fill` | default 환불·약관·개인정보 texts |
| `slot add --app [--campaign]` | `POST /slots` | 409 NO_CAMPAIGN → exit 0 `waiting` |
| `readiness --app` | `GET /apps/:id/readiness` | score + `[ok]/[--]` checks with fixes |
| `snippet --app [--kind script\|pay-button\|tip-button\|slot\|policy\|file\|all] [--framework …] [--key]` | none | `--key` renders without config |
| `dashboard` / `open` | `GET /creators/me/dashboard-url` | session login in the browser |
| `whoami` | `GET /creators/me` | real check; exit 3 + fix when the key was rotated |

Flags: `--json`, `--api <url>`, env `DCT_PAY_API`, `DCT_EARN_CONFIG` (tests).
Exit: `0` ok · `1` usage · `2` network/API error (`CODE — message` + `→ fix`, 15 s timeout) · `3` not logged in / key revoked.

## Example transcript (pay, Vite + React)

```
User: 내 앱에 결제 붙여줘
Agent: Repo: Vite + React (index.html, src/App.tsx), Firebase auth (user.email = buyerRef), no pricing yet.
       한 가지만: 무엇을 얼마에 팔까요? (예: "Pro 9,900원 1회")
User: 워터마크 제거를 4,900원에
Agent: 1회 구매 · entitlement `nowatermark` · 4,900원으로 진행합니다. ~/.dct-pay/config.json 없음 → 등록부터.
       실행할 명령:  node scripts/dct-pay.mjs register --handle jiho --email jiho@x.io --name "Jiho"
       → registered @jiho. (secret saved to ~/.dct-pay/config.json, shown once above — not repeated)
       실행:  node scripts/dct-pay.mjs app add --name "PhotoClean" --url https://photoclean.app --category tools --contact jiho@x.io
       → app id app_01J…, publicKey dce_pk_…
       실행:  node scripts/dct-pay.mjs product add --app app_01J… --name "워터마크 제거" --kind one_time --price 4900 --entitlement nowatermark
       → product prod_01J…
       Edits (diff shown, then applied):
         index.html  <head>: <script src="https://pay.docenty.ai/sdk/earn.iife.js" data-app-key="dce_pk_…" data-app-id="app_01J…">
         src/App.tsx: DocentyEarn.init({ appKey, buyerRef: user.email }) after auth; "Pro 구매" button next to Export;
                      export gated by `await DocentyEarn.entitled('nowatermark')`
         src/Footer.tsx: 이용약관 · 환불정책 · 개인정보처리방침 → https://pay.docenty.ai/p/app_01J…/…
       readiness 71/100 — [--] SDK 설치 감지 (deploy 후 재확인), [--] PG 미연결(계좌이체만 가능).
       Dashboard: https://pay.docenty.ai/dashboard   결제는 Docenty가 판매주체인 /pay 페이지에서 처리됩니다.
       대금은 Docenty 입금 확인 후 수수료(판매 5%+300원, 후원 5%)를 뺀 빌드 크레딧(현금 아님)으로 적립되고, 월 1회 출금 또는 대납에 쓸 수 있습니다.
```

## 요약 (KO)

`/dct-pay pay`는 "무엇을 얼마에 팔지" 한 번만 묻고 등록 → 앱 → 상품 → SDK 스크립트와 "Pro 구매" 버튼 삽입
→ 정책 링크 → readiness → 대시보드 URL까지 처리합니다. `/dct-pay earn`은 스폰서 슬롯을 만들고(캠페인이
없으면 "대기" 상태) `DocentyEarn.slot()`과 동의 안내문을 알맞은 자리에 넣습니다. 웹 앱(Next.js/React/Vite/정적
HTML)만 지원하며, 키·코드는 CLI 출력만 사용하고, 보내는 내용은 항상 먼저 보여주며, 빌드 크레딧은 현금이 아닙니다.
