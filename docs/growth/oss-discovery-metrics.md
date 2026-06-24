# OSS discovery metrics

River Review の OSS 普及施策（[oss-discovery-roadmap](../roadmap/oss-discovery-roadmap.md)）の効果を 30 日間記録し、README / docs / communication materials の改善判断に使うためのテンプレートです。

> 親エピック: [#1276](https://github.com/s977043/river-review/issues/1276) / 追跡 Issue: [#1282](https://github.com/s977043/river-review/issues/1282)

## 方針

- GitHub Star 数だけで成功を判断しない。README 改善・デモ追加・外部発信・掲載申請が、実際に**流入・試用・相談**につながったかを見る。
- 個人を特定する分析・有料広告の効果測定・npm downloads は対象外とする。
- 週次で記録し、各施策の流入元をメモして次の改善 Issue に接続する。

## 追跡する指標

| 指標                    | 取得元                               | 目的        |
| ----------------------- | ------------------------------------ | ----------- |
| GitHub Stars            | リポジトリトップ                     | 認知        |
| GitHub unique visitors  | Insights → Traffic                   | README 流入 |
| GitHub clones           | Insights → Traffic                   | 試用意欲    |
| Docs visits             | docs ホスティングの解析              | 導入検討    |
| Issues / Discussions 数 | Issues / Discussions                 | 関心の深さ  |
| SNS impressions         | X / 各 SNS の解析                    | 発信効果    |
| Zenn / note PV          | 各記事の解析                         | 記事効果    |
| External links          | Insights → Traffic → Referring sites | 外部流入    |

> GitHub の Traffic 指標（visitors / clones / referrers）は**過去 14 日分のみ**保持されるため、週次記録を欠かさないこと。

## 30 日ターゲット

[oss-discovery-roadmap](../roadmap/oss-discovery-roadmap.md#30-day-success-metrics) の success metrics を基準とする（Stars +50 / unique visitors 500+ / clones 30+ ほか）。本ファイルはその達成度を週次で追う記録簿として使う。

## 週次記録テンプレート

新しい週はこのブロックをコピーして追記する。

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

## 記録ログ

<!-- 新しい週を上に追記する -->

## 改善ループへの接続

- `Observations` で見えた弱点（例: visitors は多いのに clone は少ない＝導入導線が弱い）を、具体的な改善 Issue に落とす。
- README コピーの A/B 的な変更は、変更日と指標の変化をこのログに併記して判断材料にする。
- 施策ごとの流入は `External links` と各記事の `Published posts` 行で突き合わせる。
