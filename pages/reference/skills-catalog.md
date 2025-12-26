# Skills Catalog

River Reviewer に同梱されているスキル一覧です。フェーズ別に分類しています。

## upstream

### `rr-upstream-adr-decision-quality-001`

- 名前: `ADR Decision Quality`
- 概要: `Ensure ADRs capture context; decision; alternatives; tradeoffs; and follow-ups in a way that prevents future
drift.`
- 対象:
  - `docs/adr/**/*`
  - `adr/**/*`
  - `**/*.adr`
  - `**/*adr*.md`
- 重要度: major
- タグ: architecture / adr / decision / upstream
- 依存関係: adr_lookup / repo_metadata
- 適用条件: phase=upstream, inputContext=diff / adr

チェック項目の例:

- summary / findings / actions / questions

### `rr-upstream-api-design-001`

- 名前: `API Design Consistency`
- 概要: `Ensure API design follows RESTful naming and consistent conventions.`
- 対象:
  - `**/api/**`
  - `**/routes/**`
- 重要度: major
- タグ: api / design / upstream
- 依存関係: repo_metadata
- 適用条件: phase=upstream, inputContext=diff / adr

チェック項目の例:

- findings / summary / actions

### `rr-upstream-api-versioning-compat-001`

- 名前: `API Versioning & Backward Compatibility`
- 概要: `Ensure API/contract changes specify versioning strategy; backward compatibility; deprecation plan; and
migration guidance.`
- 対象:
  - `docs/**/*api*.md`
  - `docs/**/*openapi*.{yml,yaml,json}`
  - `docs/**/*contract*.md`
  - `docs/**/*interface*.md`
  - `docs/adr/**/*`
  - `pages/**/*api*.md`
  - `pages/**/*contract*.md`
  - `pages/**/*interface*.md`
  - `**/*openapi*.{yml,yaml,json}`
  - `**/*api*.{yml,yaml,json}`
  - `**/*.adr`
- 重要度: major
- タグ: api / compatibility / versioning / upstream
- 依存関係: repo_metadata
- 適用条件: phase=upstream, inputContext=diff / fullFile / adr

チェック項目の例:

- summary / findings / actions / questions

### `rr-upstream-architecture-boundaries-001`

- 名前: `Architecture Boundaries & Dependencies`
- 概要: `Ensure architecture/design docs define clear boundaries; ownership; dependency direction; and change impact to
avoid tight coupling.`
- 対象:
  - `docs/architecture/**/*`
  - `docs/adr/**/*`
  - `docs/**/*architecture*.md`
  - `docs/**/*design*.md`
  - `pages/**/*architecture*.md`
  - `**/*.adr`
  - `**/*c4*.{md,png,svg}`
  - `**/*diagram*.{md,png,svg}`
- 重要度: major
- タグ: architecture / boundaries / dependencies / upstream
- 依存関係: repo_metadata
- 適用条件: phase=upstream, inputContext=diff / adr

チェック項目の例:

- summary / findings / actions / questions

### `rr-upstream-architecture-diagrams-001`

- 名前: `Architecture Diagrams Readiness`
- 概要: `Ensure architecture diagrams are readable; consistent with text; and clear on scope; boundaries; and data
flow.`
- 対象:
  - `docs/architecture/**/*`
  - `docs/adr/**/*`
  - `docs/**/*diagram*.md`
  - `docs/**/*c4*.md`
  - `docs/**/*sequence*.md`
  - `docs/**/*flow*.md`
  - `pages/**/*diagram*.md`
  - `pages/**/*c4*.md`
  - `pages/**/*sequence*.md`
  - `pages/**/*flow*.md`
  - `**/*diagram*.{md,png,svg}`
  - `**/*c4*.{md,png,svg}`
  - `**/*sequence*.{md,png,svg}`
  - `**/*flow*.{md,png,svg}`
- 重要度: major
- タグ: architecture / diagrams / c4 / sequence / upstream
- 依存関係: repo_metadata
- 適用条件: phase=upstream, inputContext=diff / adr

チェック項目の例:

- summary / findings / actions / questions

### `rr-upstream-architecture-risk-register-001`

- 名前: `Architecture Risks, Assumptions & Open Questions`
- 概要: `Ensure design docs explicitly capture risks; assumptions; and open questions with owners; deadlines; and
mitigation plans.`
- 対象:
  - `docs/**/*design*.md`
  - `docs/**/*architecture*.md`
  - `docs/adr/**/*`
  - `docs/architecture/**/*`
  - `pages/**/*design*.md`
  - `pages/**/*architecture*.md`
  - `**/*.adr`
- 重要度: major
- タグ: architecture / risk / assumptions / upstream
- 依存関係: repo_metadata
- 適用条件: phase=upstream, inputContext=diff / adr

チェック項目の例:

- summary / findings / actions / questions

### `rr-upstream-architecture-sample-001`

- 名前: `Sample Architecture Consistency Review`
- 概要: `Checks design/ADR docs for consistency and missing decisions.`
- 対象:
  - `docs/architecture/**/*.md`
  - `docs/adr/**/*.md`
- 重要度: minor
- タグ: sample / design / architecture / upstream
- 依存関係: adr_lookup
- 適用条件: phase=upstream, inputContext=diff

チェック項目の例:

- findings / summary / questions / actions

### `rr-upstream-architecture-traceability-001`

- 名前: `Architecture Traceability & Consistency`
- 概要: `Ensure design changes stay consistent across ADRs; diagrams; and specs; decisions are traceable; and drift is
explicitly managed.`
- 対象:
  - `docs/architecture/**/*`
  - `docs/adr/**/*`
  - `docs/**/*design*.md`
  - `docs/**/*architecture*.md`
  - `pages/**/*design*.md`
  - `pages/**/*architecture*.md`
  - `**/*.adr`
  - `**/*c4*.{md,png,svg}`
  - `**/*diagram*.{md,png,svg}`
- 重要度: major
- タグ: architecture / adr / traceability / upstream
- 依存関係: adr_lookup / repo_metadata
- 適用条件: phase=upstream, inputContext=diff / adr

チェック項目の例:

- summary / findings / actions / questions

### `rr-upstream-availability-architecture-001`

- 名前: `Availability & Resilience Architecture`
- 概要: `Ensure architecture docs capture availability targets; failover strategy; capacity headroom; and resilience
trade-offs for critical services.`
- 対象:
  - `docs/architecture/**/*`
  - `docs/adr/**/*`
  - `docs/**/*design*.md`
  - `docs/**/*availability*.md`
  - `pages/**/*design*.md`
  - `pages/**/*architecture*.md`
  - `**/*.adr`
- 重要度: major
- タグ: availability / resilience / sre / upstream
- 依存関係: repo_metadata
- 適用条件: phase=upstream, inputContext=diff / adr

チェック項目の例:

- summary / findings / actions / questions

### `rr-upstream-bounded-context-language-001`

- 名前: `Bounded Context & Ubiquitous Language`
- 概要: `Ensure architecture docs define bounded contexts; ownership; and a consistent ubiquitous language to prevent
domain drift and coupling.`
- 対象:
  - `docs/**/*design*.md`
  - `docs/**/*architecture*.md`
  - `docs/adr/**/*`
  - `docs/architecture/**/*`
  - `pages/**/*design*.md`
  - `pages/**/*architecture*.md`
  - `**/*.adr`
- 重要度: major
- タグ: architecture / domain / boundaries / language / upstream
- 依存関係: repo_metadata
- 適用条件: phase=upstream, inputContext=diff / adr

チェック項目の例:

- summary / findings / actions / questions

### `rr-upstream-capacity-cost-design-001`

- 名前: `Capacity, Performance & Cost Assumptions`
- 概要: `Ensure architecture/design docs state traffic assumptions; performance budgets; resource limits; and cost
risks for critical paths.`
- 対象:
  - `docs/**/*performance*.md`
  - `docs/**/*capacity*.md`
  - `docs/**/*scal*.md`
  - `docs/**/*cost*.md`
  - `docs/**/*design*.md`
  - `pages/**/*performance*.md`
  - `pages/**/*capacity*.md`
  - `pages/**/*scal*.md`
  - `pages/**/*cost*.md`
- 重要度: major
- タグ: architecture / performance / capacity / cost / upstream
- 依存関係: repo_metadata
- 適用条件: phase=upstream, inputContext=diff / adr

チェック項目の例:

- summary / findings / actions / questions

### `rr-upstream-change-communication-001`

- 名前: `Architecture Change Communication`
- 概要: `Ensure architecture updates document affected stakeholders; notification plan; and deprecation/retirement
signals to keep knowledge aligned.`
- 対象:
  - `docs/architecture/**/*`
  - `docs/adr/**/*`
  - `docs/**/*design*.md`
  - `docs/**/*architecture*.md`
  - `pages/**/*design*.md`
  - `pages/**/*architecture*.md`
  - `**/*.adr`
- 重要度: major
- タグ: architecture / communication / governance / upstream
- 依存関係: repo_metadata
- 適用条件: phase=upstream, inputContext=diff / adr

チェック項目の例:

- summary / findings / questions

### `rr-upstream-data-flow-state-ownership-001`

- 名前: `Data Flow & State Ownership`
- 概要: `Ensure designs define data flow; state ownership; consistency boundaries; and cross-boundary writes to prevent
drift and incidents.`
- 対象:
  - `docs/**/*flow*.md`
  - `docs/**/*sequence*.md`
  - `docs/**/*data-flow*.md`
  - `docs/**/*state*.md`
  - `docs/**/*design*.md`
  - `pages/**/*flow*.md`
  - `pages/**/*sequence*.md`
  - `**/*sequence*.{md,png,svg}`
  - `**/*flow*.{md,png,svg}`
  - `**/*dfd*.{md,png,svg}`
  - `**/*diagram*.{md,png,svg}`
- 重要度: major
- タグ: architecture / dataflow / state / ownership / upstream
- 依存関係: repo_metadata
- 適用条件: phase=upstream, inputContext=diff / adr

チェック項目の例:

- summary / findings / actions / questions

### `rr-upstream-data-model-db-design-001`

- 名前: `Data Model & DB Design Review`
- 概要: `Ensure data model/DB designs cover constraints; integrity; indexes; migrations; rollback; and operational
impacts.`
- 対象:
  - `**/*schema*.{sql,prisma}`
  - `**/*migrate*/**/*.{sql}`
  - `**/*migration*/**/*.{sql}`
  - `**/*ddl*.sql`
  - `**/*erd*.{md,png,svg}`
  - `docs/**/*db*.md`
  - `docs/**/*schema*.md`
- 重要度: major
- タグ: database / schema / migration / upstream
- 依存関係: repo_metadata
- 適用条件: phase=upstream, inputContext=diff / fullFile / adr

チェック項目の例:

- summary / findings / actions / questions

### `rr-upstream-dr-multiregion-001`

- 名前: `Disaster Recovery & Multi-Region Readiness`
- 概要: `Ensure architecture docs define RPO/RTO; failover paths; data consistency; and DR drillability.`
- 対象:
  - `docs/**/*dr*.md`
  - `docs/**/*disaster*.md`
  - `docs/**/*business-continuity*.md`
  - `docs/**/*multi-region*.md`
  - `docs/**/*resilien*.md`
  - `pages/**/*dr*.md`
  - `pages/**/*disaster*.md`
  - `pages/**/*business-continuity*.md`
  - `pages/**/*multi-region*.md`
  - `pages/**/*resilien*.md`
  - `**/*.adr`
- 重要度: major
- タグ: reliability / dr / resiliency / multiregion / upstream
- 依存関係: repo_metadata
- 適用条件: phase=upstream, inputContext=diff / adr

チェック項目の例:

- summary / findings / actions / questions

### `rr-upstream-event-driven-semantics-001`

- 名前: `Event-Driven Semantics & Delivery Guarantees`
- 概要: `Ensure event-driven designs specify delivery guarantees; ordering; idempotency; schema evolution; and
replay/backfill strategy.`
- 対象:
  - `docs/**/*event*.md`
  - `docs/**/*message*.md`
  - `docs/**/*queue*.md`
  - `docs/**/*stream*.md`
  - `docs/**/*kafka*.md`
  - `docs/**/*pubsub*.md`
  - `pages/**/*event*.md`
  - `pages/**/*message*.md`
  - `**/*asyncapi*.{yml,yaml,json}`
  - `**/*schema*.{avsc,json}`
  - `**/*proto*.proto`
- 重要度: major
- タグ: architecture / events / messaging / reliability / upstream
- 依存関係: repo_metadata
- 適用条件: phase=upstream, inputContext=diff / adr

チェック項目の例:

- summary / findings / actions / questions

### `rr-upstream-external-dependencies-001`

- 名前: `External Dependencies & Vendor Risks`
- 概要: `Ensure designs document third-party dependencies; SLAs; quotas; failure modes; and vendor lock-in mitigation.`
- 対象:
  - `docs/**/*design*.md`
  - `docs/**/*architecture*.md`
  - `docs/**/*dependency*.md`
  - `docs/**/*integration*.md`
  - `pages/**/*design*.md`
  - `pages/**/*architecture*.md`
- 重要度: major
- タグ: architecture / dependencies / vendor / risk / upstream
- 依存関係: repo_metadata
- 適用条件: phase=upstream, inputContext=diff / adr

チェック項目の例:

- summary / findings / actions / questions

### `rr-upstream-failure-modes-observability-001`

- 名前: `Failure Modes & Observability in Design`
- 概要: `Ensure designs specify failure modes; timeouts; error contracts; and observability for critical flows.`
- 対象:
  - `**/api/**`
  - `**/routes/**`
  - `docs/**/*`
  - `pages/**/*`
- 重要度: major
- タグ: reliability / observability / api / design / upstream
- 依存関係: repo_metadata / tracing
- 適用条件: phase=upstream, inputContext=diff / adr

チェック項目の例:

- findings / actions / questions / summary

### `rr-upstream-integration-contracts-001`

- 名前: `Service Integration & Contracts`
- 概要: `Ensure cross-service integration defines contracts; ownership; failure handling; versioning; and
rollout/rollback expectations.`
- 対象:
  - `docs/**/*integration*.md`
  - `docs/**/*interface*.md`
  - `docs/**/*contract*.md`
  - `docs/**/*event*.md`
  - `docs/**/*message*.md`
  - `pages/**/*integration*.md`
  - `**/*openapi*.{yml,yaml,json}`
  - `**/*asyncapi*.{yml,yaml,json}`
  - `**/*schema*.{avsc,json}`
  - `**/*proto*.proto`
- 重要度: major
- タグ: integration / contract / api / events / upstream
- 依存関係: repo_metadata
- 適用条件: phase=upstream, inputContext=diff / fullFile / adr

チェック項目の例:

- summary / findings / actions / questions

### `rr-upstream-migration-rollout-rollback-001`

- 名前: `Migration, Rollout & Rollback Plan`
- 概要: `Ensure design/ADR changes include a concrete migration plan; rollout strategy; rollback conditions; and
compatibility considerations.`
- 対象:
  - `docs/**/*`
  - `pages/**/*`
  - `**/*migration*.md`
  - `**/*rollout*.md`
  - `**/*rollback*.md`
  - `**/*release*.md`
  - `**/*deploy*.md`
- 重要度: major
- タグ: migration / rollout / rollback / release / upstream
- 依存関係: repo_metadata
- 適用条件: phase=upstream, inputContext=diff / adr

チェック項目の例:

- summary / findings / actions / questions

### `rr-upstream-openapi-contract-001`

- 名前: `OpenAPI Contract Completeness`
- 概要: `Ensure OpenAPI specs define consistent request/response schemas; error model; auth; pagination; and backward
compatibility.`
- 対象:
  - `**/openapi/**/*.{yml,yaml,json}`
  - `**/*openapi*.{yml,yaml,json}`
  - `**/*swagger*.{yml,yaml,json}`
  - `**/*api*.{yml,yaml,json}`
  - `docs/**/*api*.md`
- 重要度: major
- タグ: api / openapi / contract / upstream
- 依存関係: repo_metadata
- 適用条件: phase=upstream, inputContext=diff / fullFile / adr

チェック項目の例:

- summary / findings / actions / questions

### `rr-upstream-operability-slo-001`

- 名前: `Operability, SLO & Runbook Readiness`
- 概要: `Ensure designs define operability basics: SLO/SLI; monitoring; alerting; on-call actions; and incident
handling expectations.`
- 対象:
  - `docs/**/*`
  - `pages/**/*`
  - `**/*slo*.md`
  - `**/*sli*.md`
  - `**/*runbook*.md`
  - `**/*operat*.md`
  - `**/*monitor*.md`
  - `**/*alert*.md`
- 重要度: major
- タグ: reliability / sre / operability / upstream
- 依存関係: repo_metadata
- 適用条件: phase=upstream, inputContext=diff / adr

チェック項目の例:

- summary / findings / actions / questions

### `rr-upstream-requirements-acceptance-001`

- 名前: `Requirements Clarity & Acceptance Criteria`
- 概要: `Ensure requirement docs define scope; terminology; acceptance criteria; edge cases; and non-functional
requirements.`
- 対象:
  - `docs/**/*`
  - `pages/**/*`
  - `**/*prd*.md`
  - `**/*requirements*.md`
  - `**/*user-story*.md`
  - `**/*spec*.md`
- 重要度: major
- タグ: requirements / product / specification / upstream
- 依存関係: repo_metadata
- 適用条件: phase=upstream, inputContext=diff

チェック項目の例:

- summary / findings / actions / questions

### `rr-upstream-review-policy-standard-001`

- 名前: `Standard Review Policy for Upstream`
- 概要: `Applies standard AI review policy guidelines for upstream (design) phase reviews.`
- 対象:
  - `**/*.md`
  - `**/*.adr`
  - `**/docs/**/*`
  - `**/design/**/*`
- 重要度: info
- タグ: policy / upstream / design / architecture
- 依存関係: none
- 適用条件: phase=upstream, inputContext=diff

チェック項目の例:

- findings / summary

### `rr-upstream-security-privacy-design-001`

- 名前: `Security & Privacy Design Review`
- 概要: `Ensure designs clarify data sensitivity; threat model assumptions; access control; and privacy/compliance
requirements.`
- 対象:
  - `docs/**/*`
  - `pages/**/*`
  - `**/*security*.md`
  - `**/*privacy*.md`
  - `**/*threat*.md`
  - `**/*pii*.md`
  - `**/*gdpr*.md`
  - `**/*compliance*.md`
- 重要度: critical
- タグ: security / privacy / design / upstream
- 依存関係: repo_metadata
- 適用条件: phase=upstream, inputContext=diff / adr

チェック項目の例:

- summary / findings / actions / questions

### `rr-upstream-test-code-nextjs-001`

- 名前: `Component Test Scaffold (Next.js)`
- 概要: `Generate React/Next.js component test skeletons (RTL) from specifications.`
- 対象:
  - `docs/**/*.md`
  - `specs/**/*.md`
- 重要度: major
- タグ: unit-test / tdd / nextjs / react / testing-library
- 依存関係: none
- 適用条件: phase=upstream, inputContext=fullFile

チェック項目の例:

- tests

### `rr-upstream-test-code-php-laravel-001`

- 名前: `Test Scaffold (Laravel/PHPUnit)`
- 概要: `Generate PHP/Laravel (PHPUnit) test skeletons from specifications.`
- 対象:
  - `docs/**/*.md`
  - `specs/**/*.md`
- 重要度: major
- タグ: unit-test / tdd / php / laravel / phpunit
- 依存関係: none
- 適用条件: phase=upstream, inputContext=fullFile

チェック項目の例:

- tests

### `rr-upstream-test-code-react-001`

- 名前: `Component Test Scaffold (React)`
- 概要: `Generate generic React component test skeletons (RTL) from specifications.`
- 対象:
  - `docs/**/*.md`
  - `specs/**/*.md`
- 重要度: major
- タグ: unit-test / tdd / react / testing-library / vite
- 依存関係: none
- 適用条件: phase=upstream, inputContext=fullFile

チェック項目の例:

- tests

### `rr-upstream-test-code-remix-001`

- 名前: `Route/Function Test Scaffold (Remix)`
- 概要: `Generate Remix loader/action and route component test skeletons.`
- 対象:
  - `docs/**/*.md`
  - `specs/**/*.md`
- 重要度: major
- タグ: unit-test / tdd / remix / react / vitest
- 依存関係: none
- 適用条件: phase=upstream, inputContext=fullFile

チェック項目の例:

- tests

### `rr-upstream-test-code-unit-python-pytest-001`

- 名前: `Unit Test Scaffold (Python/pytest)`
- 概要: `Generate Python/pytest unit test skeletons from specifications.`
- 対象:
  - `docs/**/*.md`
  - `specs/**/*.md`
- 重要度: major
- タグ: unit-test / tdd / python
- 依存関係: none
- 適用条件: phase=upstream, inputContext=fullFile

チェック項目の例:

- tests

### `rr-upstream-test-code-unit-ts-jest-001`

- 名前: `Unit Test Scaffold (TypeScript)`
- 概要: `Generate TypeScript unit test skeletons (Jest/Vitest) from specifications.`
- 対象:
  - `docs/**/*.md`
  - `specs/**/*.md`
- 重要度: major
- タグ: unit-test / tdd / typescript / jest / vitest
- 依存関係: none
- 適用条件: phase=upstream, inputContext=fullFile

チェック項目の例:

- tests

### `rr-upstream-test-code-vue-001`

- 名前: `Component Test Scaffold (Vue.js)`
- 概要: `Generate Vue.js component test skeletons (Vue Test Utils) from specifications.`
- 対象:
  - `docs/**/*.md`
  - `specs/**/*.md`
- 重要度: major
- タグ: unit-test / tdd / vue / vitest / vue-test-utils
- 依存関係: none
- 適用条件: phase=upstream, inputContext=fullFile

チェック項目の例:

- tests

### `rr-upstream-trust-boundaries-authz-001`

- 名前: `Trust Boundaries & Authorization Architecture`
- 概要: `Ensure designs define trust boundaries; authn/authz responsibilities; and propagation of identity/claims
across services.`
- 対象:
  - `docs/**/*security*.md`
  - `docs/**/*auth*.md`
  - `docs/**/*design*.md`
  - `docs/**/*architecture*.md`
  - `docs/adr/**/*`
  - `pages/**/*security*.md`
  - `pages/**/*auth*.md`
  - `pages/**/*design*.md`
  - `pages/**/*architecture*.md`
- 重要度: critical
- タグ: architecture / security / authz / trust-boundary / upstream
- 依存関係: repo_metadata
- 適用条件: phase=upstream, inputContext=diff / adr

チェック項目の例:

- summary / findings / actions / questions

## midstream

### `rr-<phase>-<category>-<number>`

- 名前: `<Human readable title>`
- 概要: `<What this skill checks>`
- 対象:
  - `src/**/*.ts`
- 重要度: minor
- タグ: example
- 依存関係: none
- 適用条件: phase=midstream, inputContext=diff

チェック項目の例:

- findings

### `rr-midstream-a11y-accessible-name-001`

- 名前: `a11y Accessible Name Basics`
- 概要: `画像・ボタン・フォーム要素に適切なアクセシブルネームがあるか確認する。`
- 対象:
  - `src/**/*.{ts,tsx,js,jsx,html}`
  - `app/**/*.{ts,tsx,js,jsx,html}`
  - `components/**/*.{ts,tsx,js,jsx,html}`
- 重要度: minor
- タグ: community / accessibility / ui / midstream
- 依存関係: none
- 適用条件: phase=midstream, inputContext=diff

チェック項目の例:

- findings / actions

### `rr-midstream-code-quality-sample-001`

- 名前: `Sample Code Quality Pass`
- 概要: `Checks common code quality and maintainability risks.`
- 対象:
  - `src/**/*.ts`
  - `src/**/*.js`
  - `src/**/*.py`
- 重要度: minor
- タグ: sample / style / maintainability / midstream
- 依存関係: code_search
- 適用条件: phase=midstream, inputContext=diff

チェック項目の例:

- findings / actions

### `rr-midstream-hello-skill-001`

- 名前: `Hello Skill (Always-On Sample)`
- 概要: `Minimal always-on sample skill to guarantee an end-to-end review experience.`
- 対象:
  - `**/*`
- 重要度: info
- タグ: sample / hello / midstream
- 依存関係: none
- 適用条件: phase=midstream, inputContext=diff

チェック項目の例:

- findings / summary

### `rr-midstream-logging-observability-001`

- 名前: `Logging and Observability Guard`
- 概要: `Ensure code changes keep logs/metrics/traces useful for debugging failures and regressions.`
- 対象:
  - `src/**/*`
  - `lib/**/*`
  - `**/*.js`
  - `**/*.mjs`
  - `**/*.ts`
  - `**/*.tsx`
- 重要度: minor
- タグ: observability / logging / reliability / midstream
- 依存関係: tracing / code_search
- 適用条件: phase=midstream, inputContext=diff

チェック項目の例:

- findings / actions

### `rr-midstream-nextjs-app-router-boundary-001`

- 名前: `Next.js App Router Client/Server Boundary`
- 概要: `App Router の Server Component でクライアント専用APIを使っていないか確認する。`
- 対象:
  - `app/**/*.{ts,tsx,js,jsx}`
  - `components/**/*.{ts,tsx,js,jsx}`
- 重要度: major
- タグ: community / nextjs / midstream / react
- 依存関係: none
- 適用条件: phase=midstream, inputContext=diff

チェック項目の例:

- findings / actions

### `rr-midstream-review-comment-triage-001`

- 名前: `Review Comment Triage (No-Code-Fix Mode)`
- 概要: `レビューコメントの重要度ラベリングと対応方針・返信案を整理する。AI はコード修正やパッチ提案を行わない。`
- 対象:
  - `**/*`
- 重要度: minor
- タグ: review / process / midstream
- 依存関係: none
- 適用条件: phase=midstream, inputContext=diff

チェック項目の例:

- findings / summary / questions

### `rr-midstream-review-policy-standard-001`

- 名前: `Standard Review Policy for Midstream`
- 概要: `Applies standard AI review policy guidelines for midstream (implementation) phase reviews.`
- 対象:
  - `src/**/*.ts`
  - `src/**/*.js`
  - `src/**/*.py`
  - `src/**/*.go`
  - `src/**/*.java`
  - `src/**/*.rb`
  - `lib/**/*`
  - `app/**/*`
- 重要度: info
- タグ: policy / midstream / implementation / code-quality
- 依存関係: code_search
- 適用条件: phase=midstream, inputContext=diff / fullFile

チェック項目の例:

- findings / summary / actions

### `rr-midstream-security-basic-001`

- 名前: `Baseline Security Checks`
- 概要: `Check common security risks in application code (SQLi; XSS; secrets).`
- 対象:
  - `**/{api,routes,db,ui,components,auth,security,config}/**/*.{ts,tsx,js,jsx}`
- 重要度: major
- タグ: security / midstream / web
- 依存関係: code_search
- 適用条件: phase=midstream, inputContext=diff

チェック項目の例:

- findings / actions

### `rr-midstream-typescript-nullcheck-001`

- 名前: `TypeScript Null Safety Guardrails`
- 概要: `Enforce null/undefined safety for changed TypeScript code and suggest safer patterns.`
- 対象:
  - `**/*.ts`
  - `**/*.tsx`
- 重要度: major
- タグ: typescript / type-safety / midstream
- 依存関係: code_search
- 適用条件: phase=midstream, inputContext=diff / fullFile

チェック項目の例:

- findings / actions

### `rr-midstream-typescript-strict-001`

- 名前: `TypeScript Strictness Guard`
- 概要: `Enforce TypeScript strictness by reducing any/unsafe assertions and ensuring null handling.`
- 対象:
  - `**/*.ts`
  - `**/*.tsx`
- 重要度: major
- タグ: typescript / type-safety / midstream
- 依存関係: code_search
- 適用条件: phase=midstream, inputContext=diff / fullFile

チェック項目の例:

- findings / actions

## downstream

### `rr-downstream-coverage-gap-001`

- 名前: `Coverage and Failure Path Gaps`
- 概要: `Find missing tests for critical paths; edge cases; and failure handling in changed code.`
- 対象:
  - `src/**/*`
  - `lib/**/*`
  - `**/*.test.*`
  - `**/*.spec.*`
- 重要度: major
- タグ: tests / coverage / reliability / downstream
- 依存関係: test_runner / coverage_report
- 適用条件: phase=downstream, inputContext=diff

チェック項目の例:

- tests / findings / actions / summary

### `rr-downstream-flaky-test-001`

- 名前: `Flaky Test Risk Check`
- 概要: `Detects patterns that make tests flaky and proposes stabilization steps.`
- 対象:
  - `**/*.test.ts`
  - `**/*.test.js`
  - `**/*.spec.ts`
  - `**/*.spec.js`
  - `tests/**/*.ts`
  - `tests/**/*.js`
- 重要度: major
- タグ: tests / reliability / flakiness / downstream
- 依存関係: test_runner
- 適用条件: phase=downstream, inputContext=diff

チェック項目の例:

- findings / actions / summary

### `rr-downstream-review-policy-standard-001`

- 名前: `Standard Review Policy for Downstream`
- 概要: `Applies standard AI review policy guidelines for downstream (test/QA) phase reviews.`
- 対象:
  - `test/**/*`
  - `tests/**/*`
  - `**/*.test.ts`
  - `**/*.test.js`
  - `**/*.test.py`
  - `**/*.spec.ts`
  - `**/*.spec.js`
  - `**/__tests__/**/*`
- 重要度: info
- タグ: policy / downstream / testing / qa
- 依存関係: test_runner / coverage_report
- 適用条件: phase=downstream, inputContext=diff / tests

チェック項目の例:

- findings / summary / tests

### `rr-downstream-test-existence-001`

- 名前: `Test Presence for Changed Code`
- 概要: `Check whether changed code paths have corresponding tests and suggest minimal coverage.`
- 対象:
  - `src/**/*`
  - `lib/**/*`
  - `**/*.test.*`
  - `**/*.spec.*`
- 重要度: major
- タグ: tests / coverage / downstream
- 依存関係: test_runner / coverage_report
- 適用条件: phase=downstream, inputContext=diff

チェック項目の例:

- tests / findings / actions

### `rr-downstream-test-naming-001`

- 名前: `Test Naming and Structure`
- 概要: `Ensure tests use clear naming and cover edge cases with proper describe/it structure.`
- 対象:
  - `**/*.test.ts`
  - `**/*.spec.ts`
- 重要度: minor
- タグ: tests / naming / downstream
- 依存関係: none
- 適用条件: phase=downstream, inputContext=tests / diff

チェック項目の例:

- tests / findings / summary

### `rr-downstream-test-review-sample-001`

- 名前: `Sample Test Coverage Review`
- 概要: `Evaluates downstream tests for coverage and edge cases.`
- 対象:
  - `tests/**/*.ts`
  - `tests/**/*.js`
  - `tests/**/*.py`
- 重要度: major
- タグ: sample / tests / coverage / downstream
- 依存関係: test_runner / coverage_report
- 適用条件: phase=downstream, inputContext=diff / tests

チェック項目の例:

- tests / findings / summary / actions
