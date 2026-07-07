# Usage Prompts

Claude Code で RiverReview Discipline を使うための短い使用例。
いずれも「対象を分類し、根拠を示し、approved / needs_revision / blocked / rejected で判断し、
未検証事項と残リスクを隠さない」ことを前提にする。

## 1. 要件レビュー

```text
river-review-discipline で要件レビュー。対象は docs/spec/xxx.md。
requirements-review-template で、スコープ・受入条件・曖昧さ・未定義の前提を洗い、
実装前に確認すべき質問を挙げて、approved/needs_revision/blocked/rejected を根拠つきで。
```

## 2. 設計レビュー

```text
river-review-discipline で設計レビュー。対象は docs/design/xxx.md。
既存設計との整合を最優先に、責務分離・エラー処理・代替案・ロールバックを見て判断。
差分外の盲点は pre-mortem 観点も併用。
```

## 3. 実装計画レビュー

```text
river-review-discipline で implementation_plan をレビュー。
変更対象ファイル・影響範囲・検証手順・順序・ロールバックが妥当か、
計画外の広がり（スコープクリープ）がないかを見て判断。
```

## 4. 差分レビュー

```text
river-review-discipline で diff レビュー。対象は現在の作業差分（git diff）。
diff-review-template で、要件充足・計画外変更・既存挙動破壊・テストの失敗検知力・
セキュリティ/データ安全を見て、file:line つき findings と判断を出して。
差分に無いコードへの推測指摘はしない。
```

## 5. PR レビュー

```text
river-review-discipline で PR #<N> をレビュー。
diff-review-template を主に、必要なら design/verification も分けて。
破壊的変更・セキュリティ・データ影響は強制 high として扱い、判断を明示して。
```

## 6. テストレビュー

```text
river-review-discipline で test レビュー。対象は tests/xxx。
「テストがある」ではなく「適切な失敗を検知できるか」を中心に、
境界・回帰・偽陽性/偽陰性の観点で評価して判断。
```

## 7. 検証レポートレビュー

```text
river-review-discipline で verification_report をレビュー。
verification-review-template で、実行/未実行の検証を分け、証跡を実体（log/diff）で裏取りし、
complete/partial/not_complete を根拠つきで判定。「確認できたこと」と「推測」を分ける。
```

## 8. 最終報告レビュー

```text
river-review-discipline で完了報告をレビュー。
report-review-template で、「完了」の各主張に観測可能な証拠があるか裏取りし、
未検証事項・残リスクの隠蔽・誤解を招く表現を洗い出して判断。
```

## 9. セキュリティ影響レビュー

```text
river-review-discipline で security_sensitive_change として PR #<N> を見て。
認証認可・入力検証・信頼境界・秘密情報の扱いを強制 high 以上で評価。
攻撃者視点（PR 著者が制御できる範囲）で突破経路を探し、blocked 相当なら理由を明示。
```

## 10. データ影響レビュー

```text
river-review-discipline で data_sensitive_change として対象を見て。
データ削除・schema 変更・移行の不可逆性とロールバック可否を強制 high 以上で確認。
戻せないなら blocked にして人間承認へ。
```

## 11. /compact 前のレビュー記憶作成

```text
river-review-discipline の Remember を実行。review-memory.md に、
採用したレビュー判断・却下案と理由・既存制約・未解決リスク・次に見るファイル・次の一手を残して。
/compact 後に失われて困る判断を優先。
```

## 12. サブエージェント利用判断

```text
river-review-discipline の Subagent review rules で、この差分にサブエージェントを使うべきか判断して。
使う場合は Role / Review target / Context / Expected output / Decision criteria / What not to review を明示。
使わない方がよいなら理由（差分小・観点単一・証跡十分）を述べて単独でレビュー。
```
