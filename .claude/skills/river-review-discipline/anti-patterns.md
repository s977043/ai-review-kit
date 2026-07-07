# RiverReview Anti-patterns

避けるべきレビューの型。各項目は Problem / Why it happens / Risk / Countermeasure。

## 1. レビュー対象を分類せずに見る

- **Problem**: 要件なのか差分なのか検証なのか決めずにレビューを始める。
- **Why**: 早く結論を出したい。対象が混在した依頼が来る。
- **Risk**: 観点が漏れ、分類ごとの必須チェックを飛ばす。
- **Countermeasure**: Loop の `1. Classify` を必須化。`unknown` のまま Review に進まない。

## 2. 要件レビューと差分レビューを混同する

- **Problem**: 差分の良し悪しと要件充足を同じ観点で判断する。
- **Why**: どちらも「レビュー」に見える。
- **Risk**: 「コードは綺麗だが要件を満たさない」を見逃す。
- **Countermeasure**: 分類ごとに別テンプレを使い、`Requirement Fit` を diff テンプレに独立させる。

## 3. 差分だけ見て仕様を見ない

- **Problem**: diff の行だけ見て、そもそも何を実現すべきかを見ない。
- **Why**: 差分は目の前にあり、仕様は探す必要がある。
- **Risk**: 正しく実装された「間違った物」を approve する。
- **Countermeasure**: diff レビューで必ず要件・計画を並べて `Planned vs Actual` を見る。

## 4. 仕様だけ見て実装差分を見ない

- **Problem**: 設計・仕様が良ければ実装も良いと仮定する。
- **Why**: 設計レビューで満足する。
- **Risk**: 設計と実装の乖離（design-deviation）を見逃す。
- **Countermeasure**: 実装差分が要件を満たすかを別途検証する（原則 6）。

## 5. テストが存在するだけで安心する

- **Problem**: 「テストが追加された」で品質を担保したつもりになる。
- **Why**: テストの有無は数えやすいが、失敗検知力は評価が要る。
- **Risk**: 常に通るテスト・偽陽性/偽陰性を見逃す。
- **Countermeasure**: 「適切な失敗を検知できるか」を Test Review の必須項目にする（原則 7）。

## 6. 検証結果を見ずに approve する

- **Problem**: 実行結果・証跡を確認せず「動くはず」で通す。
- **Why**: 検証は手間。報告文がもっともらしい。
- **Risk**: 未検証・失敗を承認する。捏造報告を通す。
- **Countermeasure**: Verify フェーズで実体（diff/log/ファイル）を裏取り。approve は根拠必須。

## 7. 「問題なさそう」で通す

- **Problem**: 根拠のない直感で approved にする。
- **Why**: 明確な問題が目に付かない。
- **Risk**: 見ていない観点の問題を通す。
- **Countermeasure**: approved には「確認した根拠」を添える（Final report rules）。

## 8. 既存設計を確認せずに新設計を肯定する

- **Problem**: 新しい設計単体の良し悪しだけで判断する。
- **Why**: 既存設計を読むのに時間がかかる。
- **Risk**: 既存契約・不変条件・パターンとの矛盾を導入する。
- **Countermeasure**: `Existing Design Fit` を設計レビューの最優先項目にする（原則 5）。

## 9. 小さな修正を大規模リファクタに広げる

- **Problem**: ついでに周辺を書き換える。
- **Why**: 「今なら直せる」誘惑。
- **Risk**: スコープ拡大・レビュー困難・回帰。high リスク化。
- **Countermeasure**: `Unintended Changes` を diff レビューで検査。大規模リファクタは強制 high。

## 10. セキュリティ影響を軽視する

- **Problem**: 認証認可・秘密情報・信頼境界の変更を通常変更として扱う。
- **Why**: 機能的には動く。攻撃面は見えにくい。
- **Risk**: RCE・secret 窃取・認可バイパス。
- **Countermeasure**: `security_sensitive_change` は強制 high 以上。信頼境界を明示的に問う。

## 11. データ破壊リスクを見逃す

- **Problem**: 削除・schema 変更・移行を可逆と仮定する。
- **Why**: 開発環境では戻せる。
- **Risk**: 不可逆なデータ損失。
- **Countermeasure**: `data_sensitive_change` は強制 high 以上。ロールバック可否を必須確認。

## 12. 未検証事項を報告しない

- **Problem**: 確認できていないことを報告から省く。
- **Why**: 「完了」を綺麗に見せたい。
- **Risk**: 未検証部分の障害が後で顕在化。判断者が誤る。
- **Countermeasure**: 「確認できていないこと / 推測 / 人間確認要」を分けて必ず書く（原則 8）。

## 13. 却下した案と理由を memory に残さない

- **Problem**: 採用案だけ記録し、却下案を捨てる。
- **Why**: 却下案は「終わったこと」に見える。
- **Risk**: 同じ案を再検討して時間を浪費。判断の追跡不能。
- **Countermeasure**: `review-memory.md` の Rejected Options / Rejection Reasons を必須化。

## 14. /compact 後に同じレビュー漏れを繰り返す

- **Problem**: 要約でレビュー判断・制約が失われ、再び同じ穴に落ちる。
- **Why**: 会話が長くなり文脈が圧縮される。
- **Risk**: 既存制約違反・二重作業・退行。
- **Countermeasure**: `/compact` 前に Remember フェーズで memory を更新（原則 11・Memory rules）。

## 15. サブエージェントを使うこと自体を目的化する

- **Problem**: 小さな変更にまでサブエージェントを起動する。
- **Why**: 「多エージェント＝丁寧」という思い込み。
- **Risk**: 起動コスト・遅延・結果統合の負荷が価値を上回る。
- **Countermeasure**: Subagent review rules の「使わない条件」を先に判定する。

## 16. 長すぎるレビュー指示で重要観点を埋もれさせる

- **Problem**: 網羅的すぎる指示で、致命的観点が他に紛れる。
- **Why**: 抜け漏れを恐れて全部盛りにする。
- **Risk**: 最重要リスク（security/data/破壊的変更）の優先度が下がる。
- **Countermeasure**: 高リスク観点を先頭に置く。Next Action は最もリスクが高い未確認から。
