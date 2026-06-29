# 2 段構えレビューゲート（PR 前 + PR 後）

River Review は「PR 前のローカルセルフレビュー」と「PR 後の自動レビュー」を組み合わせると効果的です。PR 前でノイズを落としてから人間レビューに渡し、PR 後で CI として再確認する 2 段構えの導線です。

## 全体像

```text
実装
  ↓  PR 前（ローカル・ノイズ除去）
river run .            ← 差分の品質・リスクをセルフレビュー
  ↓  PR 作成
GitHub Actions         ← PR 後の自動レビュー（コメント投稿）
  ↓  仕様整合
river review plan / exec ← plan・要件と diff の整合を確認
  ↓
人間レビュー
```

## PR 前: ローカルセルフレビュー

実装者が PR を作る前に、ローカルで差分をレビューしてノイズを減らします。

```bash
river run . --base main          # 比較先ブランチを明示（既定は自動検出）
river run . --depth thorough     # レビュー深度を明示（quick|standard|thorough）
river run . --skill-set typescript  # 観点セットを限定（registry の recommendations）
```

- `.river/rules.md` と `.river/rules.d/*.md` のプロジェクト固有ルールが自動注入される（[リポジトリ全体レビュー](./repo-wide-review.md) 参照）。
- `--dry-run` で API を呼ばずに計画と対象スキルだけを確認できる。

## PR 後: GitHub Actions 自動レビュー

PR の作成・更新時に自動でレビューし、結果を PR コメントへ投稿します。セットアップは [GitHub Actions で River Review をセットアップする](./github-actions.md) を参照してください。

- フェーズ（`upstream` / `midstream` / `downstream`）を指定して実行できる。
- ラベルによる実行制御（`prLabelsToIgnore`）でノイズや無駄なコストを抑えられる。

## 仕様整合: plan / exec ゲート

差分が要件・計画と整合しているかは SDLC ゲートで確認します。

```bash
river review plan   # 上流アーティファクト（plan / pbi-input 等）からレビュー計画を生成
river review exec   # 計画に沿ってレビューを実行
```

`plangate-exec-conformance` などの skill が plan と diff の整合をチェックします。

## ポイント

- **AI レビューは判断材料**であり、採用判断は人間が行う。指摘は重要度（critical / major / minor / info）付きで出力される。
- まずは「PR 前ローカル + PR 後ラベル付き自動実行」から始め、慣れてきたら対象を広げるのが安全。

## 関連

- [リポジトリ全体を踏まえたレビューの導入とチューニング](./repo-wide-review.md)
- [GitHub Actions で River Review をセットアップする](./github-actions.md)
- [フェーズ固有のレビューを実行する](./run-phase-specific-review.md)
