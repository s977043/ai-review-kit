# Launch assets

X / Zenn / note / awesome 系で River Review が共有されたとき、画像で一瞬に価値が伝わるようにするためのローンチアセットと、その仕様をまとめます。River Review は概念価値が強い OSS なので、`Review Judgment as Code` を視覚的に伝えます。

> 親エピック: [#1276](https://github.com/s977043/river-review/issues/1276) / 追跡 Issue: [#1279](https://github.com/s977043/river-review/issues/1279)

## ソースアセット（このリポジトリ）

| アセット           | ファイル                                                                       | 用途                              |
| ------------------ | ------------------------------------------------------------------------------ | --------------------------------- |
| Social Preview     | [`assets/social/social-preview.svg`](../../assets/social/social-preview.svg)   | GitHub リンク共有 / X 投稿の基図  |
| 図解（コアモデル） | [`assets/social/diagram.svg`](../../assets/social/diagram.svg)                 | README 理解補助 / Zenn・note hero |
| ロゴ               | [`assets/logo/river-review-logo.svg`](../../assets/logo/river-review-logo.svg) | 既存ワードマーク                  |

SVG をソースとして保持し、各配信先が要求するラスタ形式（PNG）へ書き出して使います。書き出し済みの PNG はアップロード元を一元管理するためリポジトリにもコミットしています。

| 書き出し済み PNG | ファイル                                                                     | サイズ   | 用途                                 |
| ---------------- | ---------------------------------------------------------------------------- | -------- | ------------------------------------ |
| Social Preview   | [`assets/social/social-preview.png`](../../assets/social/social-preview.png) | 1280×640 | GitHub Social preview にアップロード |
| X 投稿用         | [`assets/social/x-post.png`](../../assets/social/x-post.png)                 | 1200×675 | X 投稿                               |

## コピー

```text
River Review
Review Judgment as Code
for AI-assisted development
```

補足ライン:

```text
repo-owned skills · PR gates · plan-diff-test review
```

配色はロゴ準拠（背景 `#0b1f33`、river グラデーション `#1a75ff`→`#1fd1a1`、本文 `#f3f7fb`、補助 `#a9bed2`）。

## 各アセットの仕様

| アセット              | 推奨サイズ           | 元                 | 備考                                                                                              |
| --------------------- | -------------------- | ------------------ | ------------------------------------------------------------------------------------------------- |
| GitHub Social Preview | 1280×640 PNG         | social-preview.svg | GitHub は 640×320 以上を要求。Settings → Social preview にアップロード（リポジトリ管理者操作）    |
| README diagram        | 1280×520（横幅可変） | diagram.svg        | README へ図解として埋め込み                                                                       |
| X 投稿用画像          | 1200×675 PNG         | social-preview.svg | 16:9 にトリミング                                                                                 |
| Zenn / note hero      | 1200×630 PNG         | diagram.svg        | 記事 OGP / 先頭画像                                                                               |
| Demo screenshot       | 実画面に依存         | —                  | [plan-conformance デモ](../../examples/plan-conformance-demo/README.md)の実行結果を後日キャプチャ |

## PNG 書き出し手順

PNG は [`scripts/build-social-assets.mjs`](../../scripts/build-social-assets.mjs) で生成します。

このスクリプトは `@resvg/resvg-js` で SVG をレンダリングします。フォントは SVG 側の指定を維持します。`loadSystemFonts=true` と `defaultFontFamily=Inter` も指定します。Inter が環境に無い場合は、SVG の `font-family` にある `Segoe UI` / `sans-serif` へフォールバックします。

```bash
# 依存をローカル作業用に取得する。package-lock.json は更新しない。
npm install --no-save --package-lock=false @resvg/resvg-js@2.6.2

# 3種類の PNG を dist/social/ に生成する。
npm run assets:social

# 出力先を変えたい場合。
npm run assets:social -- --out /tmp/river-review-social
```

既定では `dist/social/`（git 管理外）にプレビュー用として生成されます:

| ファイル                         | サイズ   | 元 SVG             | 処理                         |
| -------------------------------- | -------- | ------------------ | ---------------------------- |
| `dist/social/social-preview.png` | 1280×640 | social-preview.svg | SVG と同サイズでレンダリング |
| `dist/social/x-post.png`         | 1200×675 | social-preview.svg | 16:9 cover で中央トリミング  |
| `dist/social/zenn-note-hero.png` | 1200×630 | diagram.svg        | contain で中央配置           |

生成ログには、使ったレンダラのバージョンが表示されます。記録例:

```text
Renderer: @resvg/resvg-js 2.6.2
Font handling: loadSystemFonts=true; SVG font-family keeps Inter, Segoe UI, sans-serif fallback.
```

配信に使う**公式 PNG は `assets/social/` にコミット**して管理し、配信先（GitHub Settings / 記事 / SNS）へはそこからアップロードします。SVG を更新したら PNG を再生成して差し替えてください。

```bash
# 公式 PNG（assets/social/）を再生成して差し替える。
npm run assets:social -- --out assets/social
```

> 字形の忠実性は実行環境の Inter フォント有無に依存します。Inter が無い環境では `Segoe UI` / `sans-serif` にフォールバックするため、公式 PNG の差し替え時は Inter が使えること（または字形が崩れないこと）を確認してください。

## 制約（#1279）

- 画像内で npm 前提の表現をしない。
- 有料広告用クリエイティブ・過剰な自律エージェント化・自動承認/自動マージを想起させる表現は避ける。
- `Review Judgment as Code` と、`team-owned` / `repo-owned` / `audit layer` のいずれかが必ず伝わるようにする。

## 残作業（リポジトリ管理者 / デザイン）

- `assets/social/social-preview.png` を GitHub Settings → Social preview へアップロード（管理者の手動操作）。
- Zenn / note hero（1200×630、diagram.svg ベース）の書き出し。
- デモ実行結果のスクリーンショット取得。
