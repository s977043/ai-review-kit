# Skills Catalog

List of skills bundled with River Reviewer, categorized by phase.

## upstream

### `rr-upstream-adr-decision-quality-001`

- Name: `ADR Decision Quality`
- Summary: `Ensure ADRs capture context; decision; alternatives; tradeoffs; and follow-ups in a way that prevents future
drift.`
- Target:
  - `docs/adr/**/*`
  - `adr/**/*`
  - `**/*.adr`
  - `**/*adr*.md`
- Severity: major
- Tags: architecture / adr / decision / upstream
- Dependencies: adr_lookup / repo_metadata
- Conditions: phase=upstream, inputContext=diff / adr

Example Outputs:

- summary / findings / actions / questions

### `rr-upstream-api-design-001`

- Name: `API Design Consistency`
- Summary: `Ensure API design follows RESTful naming and consistent conventions.`
- Target:
  - `**/api/**`
  - `**/routes/**`
- Severity: major
- Tags: api / design / upstream
- Dependencies: repo_metadata
- Conditions: phase=upstream, inputContext=diff / adr

Example Outputs:

- findings / summary / actions

### `rr-upstream-api-versioning-compat-001`

- Name: `API Versioning & Backward Compatibility`
- Summary: `Ensure API/contract changes specify versioning strategy; backward compatibility; deprecation plan; and
migration guidance.`
- Target:
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
- Severity: major
- Tags: api / compatibility / versioning / upstream
- Dependencies: repo_metadata
- Conditions: phase=upstream, inputContext=diff / fullFile / adr

Example Outputs:

- summary / findings / actions / questions

### `rr-upstream-architecture-boundaries-001`

- Name: `Architecture Boundaries & Dependencies`
- Summary: `Ensure architecture/design docs define clear boundaries; ownership; dependency direction; and change impact to
avoid tight coupling.`
- Target:
  - `docs/architecture/**/*`
  - `docs/adr/**/*`
  - `docs/**/*architecture*.md`
  - `docs/**/*design*.md`
  - `pages/**/*architecture*.md`
  - `**/*.adr`
  - `**/*c4*.{md,png,svg}`
  - `**/*diagram*.{md,png,svg}`
- Severity: major
- Tags: architecture / boundaries / dependencies / upstream
- Dependencies: repo_metadata
- Conditions: phase=upstream, inputContext=diff / adr

Example Outputs:

- summary / findings / actions / questions

### `rr-upstream-architecture-diagrams-001`

- Name: `Architecture Diagrams Readiness`
- Summary: `Ensure architecture diagrams are readable; consistent with text; and clear on scope; boundaries; and data
flow.`
- Target:
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
- Severity: major
- Tags: architecture / diagrams / c4 / sequence / upstream
- Dependencies: repo_metadata
- Conditions: phase=upstream, inputContext=diff / adr

Example Outputs:

- summary / findings / actions / questions

### `rr-upstream-architecture-risk-register-001`

- Name: `Architecture Risks, Assumptions & Open Questions`
- Summary: `Ensure design docs explicitly capture risks; assumptions; and open questions with owners; deadlines; and
mitigation plans.`
- Target:
  - `docs/**/*design*.md`
  - `docs/**/*architecture*.md`
  - `docs/adr/**/*`
  - `docs/architecture/**/*`
  - `pages/**/*design*.md`
  - `pages/**/*architecture*.md`
  - `**/*.adr`
- Severity: major
- Tags: architecture / risk / assumptions / upstream
- Dependencies: repo_metadata
- Conditions: phase=upstream, inputContext=diff / adr

Example Outputs:

- summary / findings / actions / questions

### `rr-upstream-architecture-sample-001`

- Name: `Sample Architecture Consistency Review`
- Summary: `Checks design/ADR docs for consistency and missing decisions.`
- Target:
  - `docs/architecture/**/*.md`
  - `docs/adr/**/*.md`
- Severity: minor
- Tags: sample / design / architecture / upstream
- Dependencies: adr_lookup
- Conditions: phase=upstream, inputContext=diff

Example Outputs:

- findings / summary / questions / actions

### `rr-upstream-architecture-traceability-001`

- Name: `Architecture Traceability & Consistency`
- Summary: `Ensure design changes stay consistent across ADRs; diagrams; and specs; decisions are traceable; and drift is
explicitly managed.`
- Target:
  - `docs/architecture/**/*`
  - `docs/adr/**/*`
  - `docs/**/*design*.md`
  - `docs/**/*architecture*.md`
  - `pages/**/*design*.md`
  - `pages/**/*architecture*.md`
  - `**/*.adr`
  - `**/*c4*.{md,png,svg}`
  - `**/*diagram*.{md,png,svg}`
- Severity: major
- Tags: architecture / adr / traceability / upstream
- Dependencies: adr_lookup / repo_metadata
- Conditions: phase=upstream, inputContext=diff / adr

Example Outputs:

- summary / findings / actions / questions

### `rr-upstream-availability-architecture-001`

- Name: `Availability & Resilience Architecture`
- Summary: `Ensure architecture docs capture availability targets; failover strategy; capacity headroom; and resilience
trade-offs for critical services.`
- Target:
  - `docs/architecture/**/*`
  - `docs/adr/**/*`
  - `docs/**/*design*.md`
  - `docs/**/*availability*.md`
  - `pages/**/*design*.md`
  - `pages/**/*architecture*.md`
  - `**/*.adr`
- Severity: major
- Tags: availability / resilience / sre / upstream
- Dependencies: repo_metadata
- Conditions: phase=upstream, inputContext=diff / adr

Example Outputs:

- summary / findings / actions / questions

### `rr-upstream-bounded-context-language-001`

- Name: `Bounded Context & Ubiquitous Language`
- Summary: `Ensure architecture docs define bounded contexts; ownership; and a consistent ubiquitous language to prevent
domain drift and coupling.`
- Target:
  - `docs/**/*design*.md`
  - `docs/**/*architecture*.md`
  - `docs/adr/**/*`
  - `docs/architecture/**/*`
  - `pages/**/*design*.md`
  - `pages/**/*architecture*.md`
  - `**/*.adr`
- Severity: major
- Tags: architecture / domain / boundaries / language / upstream
- Dependencies: repo_metadata
- Conditions: phase=upstream, inputContext=diff / adr

Example Outputs:

- summary / findings / actions / questions

### `rr-upstream-capacity-cost-design-001`

- Name: `Capacity, Performance & Cost Assumptions`
- Summary: `Ensure architecture/design docs state traffic assumptions; performance budgets; resource limits; and cost
risks for critical paths.`
- Target:
  - `docs/**/*performance*.md`
  - `docs/**/*capacity*.md`
  - `docs/**/*scal*.md`
  - `docs/**/*cost*.md`
  - `docs/**/*design*.md`
  - `pages/**/*performance*.md`
  - `pages/**/*capacity*.md`
  - `pages/**/*scal*.md`
  - `pages/**/*cost*.md`
- Severity: major
- Tags: architecture / performance / capacity / cost / upstream
- Dependencies: repo_metadata
- Conditions: phase=upstream, inputContext=diff / adr

Example Outputs:

- summary / findings / actions / questions

### `rr-upstream-change-communication-001`

- Name: `Architecture Change Communication`
- Summary: `Ensure architecture updates document affected stakeholders; notification plan; and deprecation/retirement
signals to keep knowledge aligned.`
- Target:
  - `docs/architecture/**/*`
  - `docs/adr/**/*`
  - `docs/**/*design*.md`
  - `docs/**/*architecture*.md`
  - `pages/**/*design*.md`
  - `pages/**/*architecture*.md`
  - `**/*.adr`
- Severity: major
- Tags: architecture / communication / governance / upstream
- Dependencies: repo_metadata
- Conditions: phase=upstream, inputContext=diff / adr

Example Outputs:

- summary / findings / questions

### `rr-upstream-data-flow-state-ownership-001`

- Name: `Data Flow & State Ownership`
- Summary: `Ensure designs define data flow; state ownership; consistency boundaries; and cross-boundary writes to prevent
drift and incidents.`
- Target:
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
- Severity: major
- Tags: architecture / dataflow / state / ownership / upstream
- Dependencies: repo_metadata
- Conditions: phase=upstream, inputContext=diff / adr

Example Outputs:

- summary / findings / actions / questions

### `rr-upstream-data-model-db-design-001`

- Name: `Data Model & DB Design Review`
- Summary: `Ensure data model/DB designs cover constraints; integrity; indexes; migrations; rollback; and operational
impacts.`
- Target:
  - `**/*schema*.{sql,prisma}`
  - `**/*migrate*/**/*.{sql}`
  - `**/*migration*/**/*.{sql}`
  - `**/*ddl*.sql`
  - `**/*erd*.{md,png,svg}`
  - `docs/**/*db*.md`
  - `docs/**/*schema*.md`
- Severity: major
- Tags: database / schema / migration / upstream
- Dependencies: repo_metadata
- Conditions: phase=upstream, inputContext=diff / fullFile / adr

Example Outputs:

- summary / findings / actions / questions

### `rr-upstream-dr-multiregion-001`

- Name: `Disaster Recovery & Multi-Region Readiness`
- Summary: `Ensure architecture docs define RPO/RTO; failover paths; data consistency; and DR drillability.`
- Target:
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
- Severity: major
- Tags: reliability / dr / resiliency / multiregion / upstream
- Dependencies: repo_metadata
- Conditions: phase=upstream, inputContext=diff / adr

Example Outputs:

- summary / findings / actions / questions

### `rr-upstream-event-driven-semantics-001`

- Name: `Event-Driven Semantics & Delivery Guarantees`
- Summary: `Ensure event-driven designs specify delivery guarantees; ordering; idempotency; schema evolution; and
replay/backfill strategy.`
- Target:
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
- Severity: major
- Tags: architecture / events / messaging / reliability / upstream
- Dependencies: repo_metadata
- Conditions: phase=upstream, inputContext=diff / adr

Example Outputs:

- summary / findings / actions / questions

### `rr-upstream-external-dependencies-001`

- Name: `External Dependencies & Vendor Risks`
- Summary: `Ensure designs document third-party dependencies; SLAs; quotas; failure modes; and vendor lock-in mitigation.`
- Target:
  - `docs/**/*design*.md`
  - `docs/**/*architecture*.md`
  - `docs/**/*dependency*.md`
  - `docs/**/*integration*.md`
  - `pages/**/*design*.md`
  - `pages/**/*architecture*.md`
- Severity: major
- Tags: architecture / dependencies / vendor / risk / upstream
- Dependencies: repo_metadata
- Conditions: phase=upstream, inputContext=diff / adr

Example Outputs:

- summary / findings / actions / questions

### `rr-upstream-failure-modes-observability-001`

- Name: `Failure Modes & Observability in Design`
- Summary: `Ensure designs specify failure modes; timeouts; error contracts; and observability for critical flows.`
- Target:
  - `**/api/**`
  - `**/routes/**`
  - `docs/**/*`
  - `pages/**/*`
- Severity: major
- Tags: reliability / observability / api / design / upstream
- Dependencies: repo_metadata / tracing
- Conditions: phase=upstream, inputContext=diff / adr

Example Outputs:

- findings / actions / questions / summary

### `rr-upstream-integration-contracts-001`

- Name: `Service Integration & Contracts`
- Summary: `Ensure cross-service integration defines contracts; ownership; failure handling; versioning; and
rollout/rollback expectations.`
- Target:
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
- Severity: major
- Tags: integration / contract / api / events / upstream
- Dependencies: repo_metadata
- Conditions: phase=upstream, inputContext=diff / fullFile / adr

Example Outputs:

- summary / findings / actions / questions

### `rr-upstream-migration-rollout-rollback-001`

- Name: `Migration, Rollout & Rollback Plan`
- Summary: `Ensure design/ADR changes include a concrete migration plan; rollout strategy; rollback conditions; and
compatibility considerations.`
- Target:
  - `docs/**/*`
  - `pages/**/*`
  - `**/*migration*.md`
  - `**/*rollout*.md`
  - `**/*rollback*.md`
  - `**/*release*.md`
  - `**/*deploy*.md`
- Severity: major
- Tags: migration / rollout / rollback / release / upstream
- Dependencies: repo_metadata
- Conditions: phase=upstream, inputContext=diff / adr

Example Outputs:

- summary / findings / actions / questions

### `rr-upstream-openapi-contract-001`

- Name: `OpenAPI Contract Completeness`
- Summary: `Ensure OpenAPI specs define consistent request/response schemas; error model; auth; pagination; and backward
compatibility.`
- Target:
  - `**/openapi/**/*.{yml,yaml,json}`
  - `**/*openapi*.{yml,yaml,json}`
  - `**/*swagger*.{yml,yaml,json}`
  - `**/*api*.{yml,yaml,json}`
  - `docs/**/*api*.md`
- Severity: major
- Tags: api / openapi / contract / upstream
- Dependencies: repo_metadata
- Conditions: phase=upstream, inputContext=diff / fullFile / adr

Example Outputs:

- summary / findings / actions / questions

### `rr-upstream-operability-slo-001`

- Name: `Operability, SLO & Runbook Readiness`
- Summary: `Ensure designs define operability basics: SLO/SLI; monitoring; alerting; on-call actions; and incident
handling expectations.`
- Target:
  - `docs/**/*`
  - `pages/**/*`
  - `**/*slo*.md`
  - `**/*sli*.md`
  - `**/*runbook*.md`
  - `**/*operat*.md`
  - `**/*monitor*.md`
  - `**/*alert*.md`
- Severity: major
- Tags: reliability / sre / operability / upstream
- Dependencies: repo_metadata
- Conditions: phase=upstream, inputContext=diff / adr

Example Outputs:

- summary / findings / actions / questions

### `rr-upstream-requirements-acceptance-001`

- Name: `Requirements Clarity & Acceptance Criteria`
- Summary: `Ensure requirement docs define scope; terminology; acceptance criteria; edge cases; and non-functional
requirements.`
- Target:
  - `docs/**/*`
  - `pages/**/*`
  - `**/*prd*.md`
  - `**/*requirements*.md`
  - `**/*user-story*.md`
  - `**/*spec*.md`
- Severity: major
- Tags: requirements / product / specification / upstream
- Dependencies: repo_metadata
- Conditions: phase=upstream, inputContext=diff

Example Outputs:

- summary / findings / actions / questions

### `rr-upstream-review-policy-standard-001`

- Name: `Standard Review Policy for Upstream`
- Summary: `Applies standard AI review policy guidelines for upstream (design) phase reviews.`
- Target:
  - `**/*.md`
  - `**/*.adr`
  - `**/docs/**/*`
  - `**/design/**/*`
- Severity: info
- Tags: policy / upstream / design / architecture
- Dependencies: none
- Conditions: phase=upstream, inputContext=diff

Example Outputs:

- findings / summary

### `rr-upstream-security-privacy-design-001`

- Name: `Security & Privacy Design Review`
- Summary: `Ensure designs clarify data sensitivity; threat model assumptions; access control; and privacy/compliance
requirements.`
- Target:
  - `docs/**/*`
  - `pages/**/*`
  - `**/*security*.md`
  - `**/*privacy*.md`
  - `**/*threat*.md`
  - `**/*pii*.md`
  - `**/*gdpr*.md`
  - `**/*compliance*.md`
- Severity: critical
- Tags: security / privacy / design / upstream
- Dependencies: repo_metadata
- Conditions: phase=upstream, inputContext=diff / adr

Example Outputs:

- summary / findings / actions / questions

### `rr-upstream-test-code-nextjs-001`

- Name: `Component Test Scaffold (Next.js)`
- Summary: `Generate React/Next.js component test skeletons (RTL) from specifications.`
- Target:
  - `docs/**/*.md`
  - `specs/**/*.md`
- Severity: major
- Tags: unit-test / tdd / nextjs / react / testing-library
- Dependencies: none
- Conditions: phase=upstream, inputContext=fullFile

Example Outputs:

- tests

### `rr-upstream-test-code-php-laravel-001`

- Name: `Test Scaffold (Laravel/PHPUnit)`
- Summary: `Generate PHP/Laravel (PHPUnit) test skeletons from specifications.`
- Target:
  - `docs/**/*.md`
  - `specs/**/*.md`
- Severity: major
- Tags: unit-test / tdd / php / laravel / phpunit
- Dependencies: none
- Conditions: phase=upstream, inputContext=fullFile

Example Outputs:

- tests

### `rr-upstream-test-code-react-001`

- Name: `Component Test Scaffold (React)`
- Summary: `Generate generic React component test skeletons (RTL) from specifications.`
- Target:
  - `docs/**/*.md`
  - `specs/**/*.md`
- Severity: major
- Tags: unit-test / tdd / react / testing-library / vite
- Dependencies: none
- Conditions: phase=upstream, inputContext=fullFile

Example Outputs:

- tests

### `rr-upstream-test-code-remix-001`

- Name: `Route/Function Test Scaffold (Remix)`
- Summary: `Generate Remix loader/action and route component test skeletons.`
- Target:
  - `docs/**/*.md`
  - `specs/**/*.md`
- Severity: major
- Tags: unit-test / tdd / remix / react / vitest
- Dependencies: none
- Conditions: phase=upstream, inputContext=fullFile

Example Outputs:

- tests

### `rr-upstream-test-code-unit-python-pytest-001`

- Name: `Unit Test Scaffold (Python/pytest)`
- Summary: `Generate Python/pytest unit test skeletons from specifications.`
- Target:
  - `docs/**/*.md`
  - `specs/**/*.md`
- Severity: major
- Tags: unit-test / tdd / python
- Dependencies: none
- Conditions: phase=upstream, inputContext=fullFile

Example Outputs:

- tests

### `rr-upstream-test-code-unit-ts-jest-001`

- Name: `Unit Test Scaffold (TypeScript)`
- Summary: `Generate TypeScript unit test skeletons (Jest/Vitest) from specifications.`
- Target:
  - `docs/**/*.md`
  - `specs/**/*.md`
- Severity: major
- Tags: unit-test / tdd / typescript / jest / vitest
- Dependencies: none
- Conditions: phase=upstream, inputContext=fullFile

Example Outputs:

- tests

### `rr-upstream-test-code-vue-001`

- Name: `Component Test Scaffold (Vue.js)`
- Summary: `Generate Vue.js component test skeletons (Vue Test Utils) from specifications.`
- Target:
  - `docs/**/*.md`
  - `specs/**/*.md`
- Severity: major
- Tags: unit-test / tdd / vue / vitest / vue-test-utils
- Dependencies: none
- Conditions: phase=upstream, inputContext=fullFile

Example Outputs:

- tests

### `rr-upstream-trust-boundaries-authz-001`

- Name: `Trust Boundaries & Authorization Architecture`
- Summary: `Ensure designs define trust boundaries; authn/authz responsibilities; and propagation of identity/claims
across services.`
- Target:
  - `docs/**/*security*.md`
  - `docs/**/*auth*.md`
  - `docs/**/*design*.md`
  - `docs/**/*architecture*.md`
  - `docs/adr/**/*`
  - `pages/**/*security*.md`
  - `pages/**/*auth*.md`
  - `pages/**/*design*.md`
  - `pages/**/*architecture*.md`
- Severity: critical
- Tags: architecture / security / authz / trust-boundary / upstream
- Dependencies: repo_metadata
- Conditions: phase=upstream, inputContext=diff / adr

Example Outputs:

- summary / findings / actions / questions

## midstream

### `rr-<phase>-<category>-<number>`

- Name: `<Human readable title>`
- Summary: `<What this skill checks>`
- Target:
  - `src/**/*.ts`
- Severity: minor
- Tags: example
- Dependencies: none
- Conditions: phase=midstream, inputContext=diff

Example Outputs:

- findings

### `rr-midstream-a11y-accessible-name-001`

- Name: `a11y Accessible Name Basics`
- Summary: `画像・ボタン・フォーム要素に適切なアクセシブルネームがあるか確認する。`
- Target:
  - `src/**/*.{ts,tsx,js,jsx,html}`
  - `app/**/*.{ts,tsx,js,jsx,html}`
  - `components/**/*.{ts,tsx,js,jsx,html}`
- Severity: minor
- Tags: community / accessibility / ui / midstream
- Dependencies: none
- Conditions: phase=midstream, inputContext=diff

Example Outputs:

- findings / actions

### `rr-midstream-code-quality-sample-001`

- Name: `Sample Code Quality Pass`
- Summary: `Checks common code quality and maintainability risks.`
- Target:
  - `src/**/*.ts`
  - `src/**/*.js`
  - `src/**/*.py`
- Severity: minor
- Tags: sample / style / maintainability / midstream
- Dependencies: code_search
- Conditions: phase=midstream, inputContext=diff

Example Outputs:

- findings / actions

### `rr-midstream-hello-skill-001`

- Name: `Hello Skill (Always-On Sample)`
- Summary: `Minimal always-on sample skill to guarantee an end-to-end review experience.`
- Target:
  - `**/*`
- Severity: info
- Tags: sample / hello / midstream
- Dependencies: none
- Conditions: phase=midstream, inputContext=diff

Example Outputs:

- findings / summary

### `rr-midstream-logging-observability-001`

- Name: `Logging and Observability Guard`
- Summary: `Ensure code changes keep logs/metrics/traces useful for debugging failures and regressions.`
- Target:
  - `src/**/*`
  - `lib/**/*`
  - `**/*.js`
  - `**/*.mjs`
  - `**/*.ts`
  - `**/*.tsx`
- Severity: minor
- Tags: observability / logging / reliability / midstream
- Dependencies: tracing / code_search
- Conditions: phase=midstream, inputContext=diff

Example Outputs:

- findings / actions

### `rr-midstream-nextjs-app-router-boundary-001`

- Name: `Next.js App Router Client/Server Boundary`
- Summary: `App Router の Server Component でクライアント専用APIを使っていないか確認する。`
- Target:
  - `app/**/*.{ts,tsx,js,jsx}`
  - `components/**/*.{ts,tsx,js,jsx}`
- Severity: major
- Tags: community / nextjs / midstream / react
- Dependencies: none
- Conditions: phase=midstream, inputContext=diff

Example Outputs:

- findings / actions

### `rr-midstream-review-comment-triage-001`

- Name: `Review Comment Triage (No-Code-Fix Mode)`
- Summary: `レビューコメントの重要度ラベリングと対応方針・返信案を整理する。AI はコード修正やパッチ提案を行わない。`
- Target:
  - `**/*`
- Severity: minor
- Tags: review / process / midstream
- Dependencies: none
- Conditions: phase=midstream, inputContext=diff

Example Outputs:

- findings / summary / questions

### `rr-midstream-review-policy-standard-001`

- Name: `Standard Review Policy for Midstream`
- Summary: `Applies standard AI review policy guidelines for midstream (implementation) phase reviews.`
- Target:
  - `src/**/*.ts`
  - `src/**/*.js`
  - `src/**/*.py`
  - `src/**/*.go`
  - `src/**/*.java`
  - `src/**/*.rb`
  - `lib/**/*`
  - `app/**/*`
- Severity: info
- Tags: policy / midstream / implementation / code-quality
- Dependencies: code_search
- Conditions: phase=midstream, inputContext=diff / fullFile

Example Outputs:

- findings / summary / actions

### `rr-midstream-security-basic-001`

- Name: `Baseline Security Checks`
- Summary: `Check common security risks in application code (SQLi; XSS; secrets).`
- Target:
  - `**/{api,routes,db,ui,components,auth,security,config}/**/*.{ts,tsx,js,jsx}`
- Severity: major
- Tags: security / midstream / web
- Dependencies: code_search
- Conditions: phase=midstream, inputContext=diff

Example Outputs:

- findings / actions

### `rr-midstream-typescript-nullcheck-001`

- Name: `TypeScript Null Safety Guardrails`
- Summary: `Enforce null/undefined safety for changed TypeScript code and suggest safer patterns.`
- Target:
  - `**/*.ts`
  - `**/*.tsx`
- Severity: major
- Tags: typescript / type-safety / midstream
- Dependencies: code_search
- Conditions: phase=midstream, inputContext=diff / fullFile

Example Outputs:

- findings / actions

### `rr-midstream-typescript-strict-001`

- Name: `TypeScript Strictness Guard`
- Summary: `Enforce TypeScript strictness by reducing any/unsafe assertions and ensuring null handling.`
- Target:
  - `**/*.ts`
  - `**/*.tsx`
- Severity: major
- Tags: typescript / type-safety / midstream
- Dependencies: code_search
- Conditions: phase=midstream, inputContext=diff / fullFile

Example Outputs:

- findings / actions

## downstream

### `rr-downstream-coverage-gap-001`

- Name: `Coverage and Failure Path Gaps`
- Summary: `Find missing tests for critical paths; edge cases; and failure handling in changed code.`
- Target:
  - `src/**/*`
  - `lib/**/*`
  - `**/*.test.*`
  - `**/*.spec.*`
- Severity: major
- Tags: tests / coverage / reliability / downstream
- Dependencies: test_runner / coverage_report
- Conditions: phase=downstream, inputContext=diff

Example Outputs:

- tests / findings / actions / summary

### `rr-downstream-flaky-test-001`

- Name: `Flaky Test Risk Check`
- Summary: `Detects patterns that make tests flaky and proposes stabilization steps.`
- Target:
  - `**/*.test.ts`
  - `**/*.test.js`
  - `**/*.spec.ts`
  - `**/*.spec.js`
  - `tests/**/*.ts`
  - `tests/**/*.js`
- Severity: major
- Tags: tests / reliability / flakiness / downstream
- Dependencies: test_runner
- Conditions: phase=downstream, inputContext=diff

Example Outputs:

- findings / actions / summary

### `rr-downstream-review-policy-standard-001`

- Name: `Standard Review Policy for Downstream`
- Summary: `Applies standard AI review policy guidelines for downstream (test/QA) phase reviews.`
- Target:
  - `test/**/*`
  - `tests/**/*`
  - `**/*.test.ts`
  - `**/*.test.js`
  - `**/*.test.py`
  - `**/*.spec.ts`
  - `**/*.spec.js`
  - `**/__tests__/**/*`
- Severity: info
- Tags: policy / downstream / testing / qa
- Dependencies: test_runner / coverage_report
- Conditions: phase=downstream, inputContext=diff / tests

Example Outputs:

- findings / summary / tests

### `rr-downstream-test-existence-001`

- Name: `Test Presence for Changed Code`
- Summary: `Check whether changed code paths have corresponding tests and suggest minimal coverage.`
- Target:
  - `src/**/*`
  - `lib/**/*`
  - `**/*.test.*`
  - `**/*.spec.*`
- Severity: major
- Tags: tests / coverage / downstream
- Dependencies: test_runner / coverage_report
- Conditions: phase=downstream, inputContext=diff

Example Outputs:

- tests / findings / actions

### `rr-downstream-test-naming-001`

- Name: `Test Naming and Structure`
- Summary: `Ensure tests use clear naming and cover edge cases with proper describe/it structure.`
- Target:
  - `**/*.test.ts`
  - `**/*.spec.ts`
- Severity: minor
- Tags: tests / naming / downstream
- Dependencies: none
- Conditions: phase=downstream, inputContext=tests / diff

Example Outputs:

- tests / findings / summary

### `rr-downstream-test-review-sample-001`

- Name: `Sample Test Coverage Review`
- Summary: `Evaluates downstream tests for coverage and edge cases.`
- Target:
  - `tests/**/*.ts`
  - `tests/**/*.js`
  - `tests/**/*.py`
- Severity: major
- Tags: sample / tests / coverage / downstream
- Dependencies: test_runner / coverage_report
- Conditions: phase=downstream, inputContext=diff / tests

Example Outputs:

- tests / findings / summary / actions
