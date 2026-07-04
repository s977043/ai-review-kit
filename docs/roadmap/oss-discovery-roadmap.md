# River Review OSS Discovery Roadmap

Parent epic: [#1276](https://github.com/s977043/river-review/issues/1276)

## Goal

River Review を「AI支援開発時代の Review Judgment as Code OSS」として認知させ、GitHub Star・試用・外部掲載・コミュニティ導線を増やす。

## North Star

```text
Review Judgment as Code for AI-assisted development.
```

## Positioning

River Review は、一般的な AI review bot ではなく、AI支援開発における team-owned audit layer として位置づける。

レビュー判断を `versioned / repo-owned` な skill として扱い、plan / diff / tests / JUnit / prior review artifacts をまたいでチーム基準を実行する。

## Out of Scope

- npm publish
- npm package distribution
- npm version / downloads badges
- `package.json` の `private` 設定変更
- paid ads
- unnatural growth tactics
- auto-approve / auto-merge positioning

## Workstreams

| Workstream              | Issue                                                        | Outcome                                                     |
| ----------------------- | ------------------------------------------------------------ | ----------------------------------------------------------- |
| Landing page            | [#1277](https://github.com/s977043/river-review/issues/1277) | README 冒頭で 5 秒以内に価値が伝わる                        |
| First-time demo         | [#1278](https://github.com/s977043/river-review/issues/1278) | plan conformance demo で 5 分以内に価値を理解できる         |
| Launch assets           | [#1279](https://github.com/s977043/river-review/issues/1279) | Social Preview / README diagram / 投稿用画像を用意する      |
| Community entry         | [#1280](https://github.com/s977043/river-review/issues/1280) | Discussions / good first issue / contributor path を整える  |
| Communication materials | [#1281](https://github.com/s977043/river-review/issues/1281) | Zenn / note / SNS / English post / awesome copy を用意する  |
| Metrics loop            | [#1282](https://github.com/s977043/river-review/issues/1282) | Star だけでなく traffic / clone / docs visit で効果測定する |
| External listings       | [#1283](https://github.com/s977043/river-review/issues/1283) | awesome 系掲載候補と紹介文を整理する                        |

## 30-day success metrics

| Metric                       |  Target |
| ---------------------------- | ------: |
| GitHub Stars                 |     +50 |
| GitHub unique visitors       |    500+ |
| GitHub clones                |     30+ |
| Docs visits                  |    300+ |
| SNS impressions              | 20,000+ |
| Zenn / note total PV         |  2,000+ |
| Issues / Discussions         |      3+ |
| External listing submissions |      2+ |

## Phase plan

### Phase 1: Repository landing page

- Improve README positioning around `Review Judgment as Code`
- Add first-time user path
- Keep npm-related paths out of scope
- Preserve Human-in-the-loop positioning

Tracking issue: [#1277](https://github.com/s977043/river-review/issues/1277)

### Phase 2: First-time demo

- Add minimal plan conformance demo
- Show how River Review detects implementation drift from the plan
- Use static artifacts where possible so the demo does not require npm publishing

Tracking issue: [#1278](https://github.com/s977043/river-review/issues/1278)

### Phase 3: Launch assets

- Prepare GitHub Social Preview
- Prepare README diagram
- Prepare article and SNS images
- Keep the visual message centered on `Review Judgment as Code`

Tracking issue: [#1279](https://github.com/s977043/river-review/issues/1279)

### Phase 4: Community entry points

- Define how to use Issues vs Discussions
- Prepare first Discussion topic
- Prepare three `good first issue` candidates

Tracking issue: [#1280](https://github.com/s977043/river-review/issues/1280)

### Phase 5: Communication materials

- Prepare Japanese long-form article structures
- Prepare short-form SNS drafts
- Prepare English launch copy
- Prepare awesome listing copy

Tracking issue: [#1281](https://github.com/s977043/river-review/issues/1281)

### Phase 6: Metrics and feedback loop

- Track GitHub traffic / clones / docs visits / posts / external links
- Review the metrics weekly
- Adjust README and communication copy based on evidence

Tracking issue: [#1282](https://github.com/s977043/river-review/issues/1282)

### Phase 7: External listings

- Evaluate listing candidates
- Confirm contribution rules for each list
- Submit only where River Review fits the audience

Tracking issue: [#1283](https://github.com/s977043/river-review/issues/1283)

### Phase 8: Coordinated launch execution

- Publish the technical article 1-2 days ahead so search indexing is ready
- Post to Hacker News / Reddit / X (and optionally Product Hunt) together on a Tue-Thu PT morning to build organic initial velocity
- Respond to all feedback within 24-48 hours, then move from broadcast to one-on-one user conversations
- Follow the day-of runbook and checklist in [launch-playbook](../growth/launch-playbook.md)

Runbook: [launch-playbook](../growth/launch-playbook.md)

## Weekly tracking template

```md
## Week of YYYY-MM-DD

- Stars:
- Unique visitors:
- Clones:
- Docs visits:
- Issues / Discussions:
- Published posts:
- External links:
- Observations:
- Next adjustment:
```

## Decision notes

- OpenSSF / Scorecard / trust signal work is completed in [#1269](https://github.com/s977043/river-review/issues/1269).
- npm support is intentionally excluded from this roadmap.
- River Review should not be positioned as replacing human review. It should be positioned as making team review judgment executable and repeatable.
