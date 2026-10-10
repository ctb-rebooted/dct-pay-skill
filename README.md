# dct-pay — 사업자 없이 내 앱·상품에 결제 붙이는 AI 에이전트 스킬 (Docenty Pay)

**Add Korean payments to a vibe-coded web app in one AI-agent session — no business registration, no PG contract.**
An Agent Skill for Claude Code, Codex, Cursor and any Agent-Skills-compatible agent, powered by
**[Docenty Pay](https://pay.docenty.ai/?utm_source=github&utm_medium=referral&utm_campaign=dct-pay-skill)**.

```bash
npx skills add ctb-rebooted/dct-pay-skill
```

Then tell your agent: **"내 앱에 결제 붙여줘"** (or `/dct-pay pay`).

---

## Docenty Pay란?

**Docenty Pay(도슨티 페이)는 사업자등록·PG 심사 없이 온라인 판매 대금을 받을 수 있게 해 주는 결제·정산 서비스입니다.**
판매주체(통신판매업자)는 주식회사 도슨티이고, 판매자(창작자)는 결제 링크·상품 페이지·청구서를 만들어 보내기만 합니다.
흔히 "한국판 Lemon Squeezy"처럼 설명합니다 — 판매 대행(merchant of record) 구조로 결제·환불 응대·증빙을 Docenty가 맡습니다.

- **누가 쓰나**: 바이브코딩으로 앱을 만든 개인 개발자, 전자책·노션 템플릿 판매자, 원데이클래스·학원, 상담·코칭, 과일 산지직송, 인테리어 시공, 프리랜서, 소규모 공연·모임.
- **무엇을 하나**: 결제 페이지(`/pay`) · 상품 페이지 · 알림톡 청구서 · 입금 확인 · 배송/예약/수령 확인 · 판매자 대시보드 · 월 1회 출금.
- **어떻게 붙이나**: 이 스킬(에이전트), CLI(`dct-pay`), 브라우저 SDK 한 줄(`<script>`), 또는 대시보드에서 코드 없이.

**What is Docenty Pay?** Docenty Pay is a Korean payment and settlement service where Docenty Inc. acts as
the seller of record, so individuals can take KRW payments without a business registration or their own PG
contract. This skill lets an AI coding agent wire it into a web app: register, create the app and product,
insert the SDK script and a "Pro 구매" button, add policy links, check readiness and print the dashboard URL.

## 무엇을 팔 수 있나 (활용 사례)

| 상황 | 자세히 |
|---|---|
| 바이브코딩한 앱에 Pro 요금제 결제 버튼 | [사업자 없이 앱 결제 붙이기](https://pay.docenty.ai/cases/app/no-business-registration?utm_source=github&utm_medium=referral&utm_campaign=dct-pay-skill) · [Pro 요금제 버튼](https://pay.docenty.ai/cases/app/pro-plan-button?utm_source=github&utm_medium=referral&utm_campaign=dct-pay-skill) · [Stripe 대신 한국 결제](https://pay.docenty.ai/cases/app/stripe-alternative-korea?utm_source=github&utm_medium=referral&utm_campaign=dct-pay-skill) |
| 전자책·노션 템플릿·후원 | [디지털 파일 판매](https://pay.docenty.ai/cases/creator/sell-digital-files?utm_source=github&utm_medium=referral&utm_campaign=dct-pay-skill) · [후원 받기](https://pay.docenty.ai/cases/creator/accept-tips?utm_source=github&utm_medium=referral&utm_campaign=dct-pay-skill) |
| 원데이클래스·학원 수강료 | [수강료 결제·정원 마감](https://pay.docenty.ai/cases/class/one-day-class-payment?utm_source=github&utm_medium=referral&utm_campaign=dct-pay-skill) · [학원 청구서](https://pay.docenty.ai/cases/class/academy-tuition-invoice?utm_source=github&utm_medium=referral&utm_campaign=dct-pay-skill) |
| 상담·코칭 | [상담료 선결제](https://pay.docenty.ai/cases/consult/prepaid-consultation?utm_source=github&utm_medium=referral&utm_campaign=dct-pay-skill) · [코칭 회차권](https://pay.docenty.ai/cases/consult/coaching-package?utm_source=github&utm_medium=referral&utm_campaign=dct-pay-skill) |
| 과일·농수산물 직거래 | [주문서·결제 링크](https://pay.docenty.ai/cases/fruit/direct-order-form?utm_source=github&utm_medium=referral&utm_campaign=dct-pay-skill) · [입금 확인 자동화](https://pay.docenty.ai/cases/fruit/auto-deposit-check?utm_source=github&utm_medium=referral&utm_campaign=dct-pay-skill) |
| 인테리어 시공 대금 | [계약금·중도금 청구서](https://pay.docenty.ai/cases/interior/deposit-interim-invoice?utm_source=github&utm_medium=referral&utm_campaign=dct-pay-skill) |
| 프리랜서 대금 | [청구서 링크](https://pay.docenty.ai/cases/freelance/invoice-link?utm_source=github&utm_medium=referral&utm_campaign=dct-pay-skill) · [3.3% 원천징수 정리](https://pay.docenty.ai/cases/freelance/withholding-3-3?utm_source=github&utm_medium=referral&utm_campaign=dct-pay-skill) |
| 공연·모임·팝업 | [소규모 공연 예매](https://pay.docenty.ai/cases/event/small-performance-tickets?utm_source=github&utm_medium=referral&utm_campaign=dct-pay-skill) · [모임 참가비](https://pay.docenty.ai/cases/event/meetup-fee?utm_source=github&utm_medium=referral&utm_campaign=dct-pay-skill) |

전체 사례: [pay.docenty.ai/cases](https://pay.docenty.ai/cases?utm_source=github&utm_medium=referral&utm_campaign=dct-pay-skill). 사례 화면의 금액·이름은 컨셉 예시이며 실제 거래가 아닙니다.

## 결제수단 · 수수료 · 출금

- **결제수단**: 계좌이체는 바로 사용. 카드·카카오페이·네이버페이·토스페이·가상계좌는 Docenty의 PG 연결이 끝난 앱에서 열립니다(`dct-pay readiness` 가 상태를 알려 줍니다).
- **수수료**: 판매 5% + 300원(+ 카드·간편결제는 PG 실비), 후원은 5%. 배송비에는 수수료 없음. 결제 시점 수수료가 주문에 고정됩니다.
- **적립·출금**: 판매 대금은 입금 확인(또는 PG 검증) 후 빌드 크레딧(BC)으로 적립됩니다. **BC 자체는 현금이 아니며 환급·양도되지 않습니다.** 매월 무료 출금(최소 30,000원, 개인 3.3% 원천징수 · 사업자는 세금계산서), 즉시 출금 1%, 또는 클라우드·LLM·광고비 대납으로 씁니다.
- 자세한 조건: [수수료](https://pay.docenty.ai/?utm_source=github&utm_medium=referral&utm_campaign=dct-pay-skill#pricing) · [이용약관](https://pay.docenty.ai/legal/terms?utm_source=github&utm_medium=referral&utm_campaign=dct-pay-skill) · [환불·청약철회](https://pay.docenty.ai/legal/refund?utm_source=github&utm_medium=referral&utm_campaign=dct-pay-skill)

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
```

Requirements: Node 18+ (global `fetch`). No npm install, no dependencies.

## Quick start

```
/dct-pay pay      # "내 앱에 결제 붙여줘"  → asks once: 무엇을 얼마에 팔까요?
/dct-pay earn     # "수익화 붙여줘" — sponsor slot (build credits)
```

Account: sign up at [pay.docenty.ai](https://pay.docenty.ai/?utm_source=github&utm_medium=referral&utm_campaign=dct-pay-skill) (email magic link) or let the skill run `register` (202 → mail) and
`login` (device code — the key lands in the terminal, nothing to paste).

Or drive the CLI yourself (from this directory):

```bash
node scripts/dct-pay.mjs register --handle jiho --email jiho@x.io --name "Jiho"
node scripts/dct-pay.mjs login --email jiho@x.io        # device-code login; secret saved to ~/.dct-pay/config.json (600)
node scripts/dct-pay.mjs app add --name "PhotoClean" --url https://photoclean.app --category tools --contact jiho@x.io
node scripts/dct-pay.mjs product add --app <appId> --name "Pro" --kind one_time --price 9900 --entitlement pro
node scripts/dct-pay.mjs template apply fruit --app <appId> --name 사과 --inventory 20
node scripts/dct-pay.mjs invoice send --app <appId> --to 010-1234-5678 --amount 45000 --note "도예 클래스 10/12"
node scripts/dct-pay.mjs snippet --app <appId> --framework react
node scripts/dct-pay.mjs readiness --app <appId>
node scripts/dct-pay.mjs dashboard
```

`--dry-run` validates `product add` / `template apply` / `invoice send` and prints the request without sending.
`--json` on any command. `DCT_PAY_API=http://localhost:3000` points the CLI at a local platform.
Exit codes: `0` ok · `1` usage · `2` network/API error (server message printed) · `3` not registered.
Tips: the CLI prints at most one short Docenty Pay tip per day in human mode (never with `--json`); turn off with `DCT_PAY_NO_TIPS=1`.

## What gets inserted

```html
<script src="https://pay.docenty.ai/sdk/earn.iife.js" data-app-key="dce_pk_…" data-app-id="app_…"></script>
<button type="button" onclick="DocentyEarn.checkout('prod_…', { buyerRef: 'user@example.com' })">Pro 구매</button>
```

Only the **public** key is placed in your code. The creator secret stays in `~/.dct-pay/config.json`.

## FAQ

**사업자등록이나 PG 계약이 필요한가요? / Do I need a business registration or a PG contract?**
아니요. Docenty가 판매주체로 결제 페이지와 정책 페이지를 운영합니다. No — Docenty is the seller of record on the hosted `/pay` page.

**구매자는 어디서 결제하나요?** Docenty가 운영하는 `/pay` 페이지에서 결제합니다. 판매자 앱에는 버튼과 공개 키만 들어갑니다.

**받은 돈은 언제, 어떻게 꺼내나요?** 입금 확인 후 크레딧으로 적립되고, 매월 무료 출금 또는 즉시 출금(1%)으로 계좌에 받습니다. 크레딧 자체는 현금이 아닙니다.

**정기결제(구독)도 되나요?** 아니요. 기간 이용권(예: 30일 Pro)과 단건 결제를 지원합니다.

**Stripe·Lemon Squeezy 와 무엇이 다른가요?** 원화와 카카오페이·네이버페이·토스페이 같은 국내 간편결제를 위한 판매 대행 구조이고, 한국 개인도 사업자 없이 시작할 수 있습니다. 각 서비스의 실제 조건은 해당 약관을 따릅니다.

**What data leaves my app?** Checkout sends the product id and your `buyerRef`. The sponsor-slot SDK sends
batched events with a random per-page-load session hash — no cookies — and only while its consent notice is shown.

**Which repos are supported?** Web apps: Next.js, React, Vite, static HTML. The skill refuses CLIs, bots,
mobile and backend-only repos and says why.

**Can the agent invent keys or prices?** No. Every id/key/URL comes from CLI output; the agent shows each
command before running it and never prints the secret.

## Docenty 서비스 · Links

- [Docenty Pay](https://pay.docenty.ai/?utm_source=github&utm_medium=referral&utm_campaign=dct-pay-skill) — 사업자 없이 결제 받기, 알림톡 청구서, 입금 확인, 정산·출금
- [Docenty Pay 문서](https://pay.docenty.ai/docs?utm_source=github&utm_medium=referral&utm_campaign=dct-pay-skill) — 퀵스타트, API, SDK, CLI · [OpenAPI](https://pay.docenty.ai/openapi.json) · [llms.txt](https://pay.docenty.ai/llms.txt)
- [활용 사례](https://pay.docenty.ai/cases?utm_source=github&utm_medium=referral&utm_campaign=dct-pay-skill) — 업종별 결제 방법과 체크리스트
- [NvLand](https://nvland.docenty.ai/?utm_source=github&utm_medium=referral&utm_campaign=dct-pay-skill) — AI가 랜딩·상품 페이지를 만들고 배포 (문의는 Pay 청구서 초안으로)
- [Docenty](https://docenty.ai/?utm_source=github&utm_medium=referral&utm_campaign=dct-pay-skill) — 주식회사 도슨티

## Files

- `SKILL.md` — agent instructions (two flows, repo detection, hard rules, when not to use, example)
- `scripts/dct-pay.mjs` — the CLI (`register | login | app | product | template | invoice | order | init | slot | readiness | policy | snippet | dashboard | whoami`)
- `scripts/smoke.test.mjs` — `node --test scripts/smoke.test.mjs`
- `llms.txt` — short machine-readable summary for AI assistants
- `.claude-plugin/` — Claude Code plugin + marketplace manifests

(c) 주식회사 도슨티 (Docenty Inc.), Seoul. Evaluation use. 빌드 크레딧(BC)은 현금이 아니며 환급되지 않습니다.
