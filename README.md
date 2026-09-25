# dct-pay — attach payments and monetisation to your vibe-coded web app

**One session, two flows: `/dct-pay pay` (결제 받기) and `/dct-pay earn` (현금 아닌 수익화).**
An Agent Skill (Claude Code, Codex, Cursor, any Agent-Skills-compatible agent) for https://pay.docenty.ai

dct-pay gives a creator app a hosted checkout page (`/pay`), per-buyer entitlements and app-scoped
credits, sponsor slots that convert into Docenty build credits, and a creator dashboard — with Docenty as
the seller of record, so there is no PG contract, no business registration and no policy pages to write.
The skill analyses your repo, asks one question, registers you, creates the app/product/slot via a
zero-dependency CLI, inserts the SDK `<script>` and a "Pro 구매" button (or `DocentyEarn.slot()`) in the
right file, adds policy links, runs a readiness check and prints your dashboard URL.

## Install (3 ways)

```bash
# 1. skills CLI (Codex, Cursor, Claude Code, any Agent-Skills agent)
npx skills add ctb-rebooted/dct-pay-skill

# 2. Claude Code plugin marketplace
/plugin marketplace add ctb-rebooted/dct-pay-skill
/plugin install dct-pay@dct-pay-skill

# 3. Manual — copy the directory into your agent's skills folder
git clone https://github.com/ctb-rebooted/dct-pay-skill ~/.claude/skills/dct-pay      # Claude Code
#   Codex: ~/.codex/skills/dct-pay      Cursor: .cursor/skills/dct-pay
#   Monorepo dev: claude --skill-dir skills/dct-pay
```

Requirements: Node 18+ (global `fetch`). No npm install, no dependencies.

## Quick start

```
/dct-pay pay      # "내 앱에 결제 붙여줘"  → asks: 무엇을 얼마에 팔까요?
/dct-pay earn     # "수익화 붙여줘" / "돈 벌게 해줘"
```

Account: sign up at https://pay.docenty.ai (email magic link) or let the skill run `register` (202 → mail) and
`login` (device code — the key lands in the terminal, nothing to paste). Proceeds become build credits (BC, not
cash) after Docenty verifies the deposit; the fee is 5% + 300원 per sale (tips 5% only; `DOCENTY_SALE_FEE_RATE`, `DOCENTY_SALE_FEE_FIXED_KRW`), sealed per order at payment time. Credits can be withdrawn as cash monthly (individuals 3.3% withholding) or used to pay cloud/LLM/ads bills.

Or drive the CLI yourself (from `skills/dct-pay/`):

```bash
node scripts/dct-pay.mjs register --handle jiho --email jiho@x.io --name "Jiho"
#   202 verify_email — click the mail link, then:
node scripts/dct-pay.mjs login --email jiho@x.io
#   device-code login: the creator secret lands in ~/.dct-pay/config.json (mode 600), never printed
node scripts/dct-pay.mjs app add --name "PhotoClean" --url https://photoclean.app --category tools --contact jiho@x.io
#   app created · id app_01J… · publicKey dce_pk_…
node scripts/dct-pay.mjs product add --app app_01J… --name "Pro" --kind one_time --price 9900 --entitlement pro
node scripts/dct-pay.mjs slot add --app app_01J…          # or: "스폰서 캠페인 대기 중" (exit 0, status waiting)
node scripts/dct-pay.mjs snippet --app app_01J… --framework react
node scripts/dct-pay.mjs readiness --app app_01J…
node scripts/dct-pay.mjs dashboard
```

`DCT_PAY_API=http://localhost:3000` points the CLI at a local platform. `--json` on any command.
Exit codes: `0` ok · `1` usage · `2` network/API error (server message printed) · `3` not registered.

## What gets inserted

```html
<script src="https://pay.docenty.ai/sdk/earn.iife.js" data-app-key="dce_pk_…" data-app-id="app_…"></script>
<button type="button" onclick="DocentyEarn.checkout('prod_…', { buyerRef: 'user@example.com' })">Pro 구매</button>
<div id="dct-slot"></div>
<script>DocentyEarn.slot('#dct-slot', { slotCode: 'ab12cd34' })</script>   <!-- renders CTA + consent notice -->
```

Only the **public** key is placed in your code. The creator secret stays in `~/.dct-pay/config.json`.

## FAQ

**Do I need a business registration or a PG contract?** No. In v0 Docenty is the seller of record
(판매주체) on the hosted `/pay` page and the policy pages. Manual bank transfer works from day one; card
payments appear once Docenty connects the PG for your app (readiness says "PG 미연결" until then).

**What do sponsor slots pay?** Approved conversions become **build credits (BC)** on your creator ledger,
spendable on Docenty services. BC is not cash, is not refundable and cannot be withdrawn. Cash settlement is
an opt-in for a later stage.

**What data leaves my app?** The SDK sends batched events (`view`, `complete`, `slot_view`, `slot_click`…)
with a random per-page-load session hash — no cookies, no identifiers — and only while the consent notice
rendered by `DocentyEarn.slot()` is present in the page. Checkout sends the product id and your `buyerRef`.

**Which repos are supported?** Web apps: Next.js, React, Vite, static HTML. The skill refuses CLIs, bots,
mobile and backend-only repos and says why.

**Can the agent invent keys or prices?** No. Every id/key/URL comes from CLI output; the agent shows each
command before running it and never prints the secret after registration.

## Files

- `SKILL.md` — the agent instructions (two flows, repo detection, hard rules, when not to use, example)
- `scripts/dct-pay.mjs` — the CLI (`register | login | app | product | template | invoice | order | init | slot | readiness | policy | snippet | dashboard | whoami`)
- `scripts/smoke.test.mjs` — `node --test scripts/smoke.test.mjs` (help exits 0, snippet contains `data-app-key`, exit codes)
- `.claude-plugin/plugin.json` — Claude Code plugin manifest

Contract: `docs/ai-gen/gstack/specs/sp_001_dct-earn-v0-contract.md` (§3 HTTP API, §5 SDK, §6 Skill).
SDK source: `packages/sdk` (`@docenty/earn-sdk`).

## 요약 (KO)

dct-pay은 바이브코딩한 웹 앱에 한 세션 만에 결제(`/dct-pay pay`)와 스폰서 슬롯 수익화(`/dct-pay earn`)를
붙여주는 에이전트 스킬입니다. 사업자등록·PG 계약·정책 페이지 없이 Docenty가 판매주체인 `/pay` 페이지로 결제를
받고, 스폰서 전환은 빌드 크레딧(현금 아님)으로 쌓입니다. 설치: `npx skills add ctb-rebooted/dct-pay-skill`.

(c) Docenty, Seoul. Evaluation use. Build credits are not cash.
