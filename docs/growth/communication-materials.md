# Communication materials

River Review の価値を外部の開発者に一貫して伝えるための発信素材（記事構成・SNS 投稿案・英語 launch post）をまとめます。README とデモを補完し、記事・投稿・掲載申請で同じ説明を使えるようにします。

> 親エピック: [#1276](https://github.com/s977043/river-review/issues/1276) / 追跡 Issue: [#1281](https://github.com/s977043/river-review/issues/1281)

River Review は一般的な AI レビュー bot ではなく、`Review Judgment as Code` として説明します。「AI がレビューを完全自動化する」といった誤認表現や、自動承認/自動マージの訴求は避けます。

## Message pillars

すべての発信で次の柱を一貫して使います。

- Review Judgment as Code
- team-owned audit layer
- repo-owned skills
- plan / diff / tests / JUnit / prior review artifacts をまたぐレビュー
- Human-in-the-loop（自動マージではない）

## Zenn 記事構成（技術者向け）

タイトル案: `AIレビューを「プロンプト」ではなく「チーム資産」にするOSSを作った`

1. **課題**: AI 支援開発でコードは速く書けるが、レビュー判断は暗黙知のまま属人化している。
2. **既存 AI レビュー bot の限界**: diff だけを見る・判断はベンダー black box・知識が provider-owned。
3. **River Review のアプローチ**: レビュー判断を repo-owned skill としてコード化し、plan / diff / tests / JUnit / 過去レビューをまたいで実行する。
4. **動作イメージ**: [plan-conformance デモ](../../examples/plan-conformance-demo/README.md)で、plan に反した実装を検出する例を示す。
5. **導入**: プラグイン / GitHub Actions の 2 チャネル（npm 非依存）。
6. **思想**: Human Judgment Focus—人間は高リスクな判断に集中する。
7. **まとめ + CTA**: リポジトリへの導線・Star・Discussions。

## note 記事構成（背景・思想向け）

タイトル案: `レビューは誰のものか—AI時代の「判断の所有」について`

1. レビュー判断がチームの責任であり続ける理由。
2. 速度が上がるほど、判断の再現性・監査性・継続改善が重要になる。
3. `Review Judgment as Code` という考え方（team-owned audit layer）。
4. River Review がそれをどう実行可能にするか（概念中心、コードは最小限）。
5. 立ち位置: 人間の判断を置き換えるのではなく支える。
6. CTA: リポジトリ・記事（Zenn）への導線。

## SNS 投稿案（3 本）

各投稿はリポジトリへの自然な導線を含めます。

1. 価値訴求:

   ```text
   AIがコードを書く時代でも、レビュー判断はチームのもの。
   River Review はレビュー基準を repo-owned な skill としてコード化し、
   plan / diff / tests をまたいでチーム基準で検査する OSS である。
   Review Judgment as Code → <repo URL>
   ```

2. 差別化:

   ```text
   一般的な AI レビュー bot は diff を見るだけ。
   River Review は plan / diff / tests / JUnit / 過去レビューをまたいで、
   チーム所有の監査レイヤーとして動く。判断は repo の中に、versioned で。
   <repo URL>
   ```

3. デモ誘導:

   ```text
   「plan に反した実装」を River Review がどう検出するか、
   5分で読める最小デモを用意しました（API キー不要）。
   <デモ URL>
   ```

## 英語 launch post 案

タイトル案: `I built River Review: Review Judgment as Code for AI-assisted development`

```text
AI writes code fast, but review judgment still belongs to your team.

River Review lets teams codify review standards as repo-owned skills and run
them across plans, diffs, tests, JUnit, and prior review artifacts — a
team-owned audit layer, not another black-box bot. Human-in-the-loop, not
auto-merge.

5-minute, no-API-key demo and repo: <repo URL>
```

## 関連素材

- 外部掲載候補と紹介文: [external-listings](./external-listings.md)（#1283）
- 投稿後の効果測定（KPI メモ）: [oss-discovery-metrics](./oss-discovery-metrics.md)（#1282）
- ローンチ用ビジュアル: Social Preview / hero image（#1279）

## 注意点

- npm 公開告知・npm install 前提の説明はしない。
- OpenSSF / CI / CodeQL などの trust signal は事実ベースで触れ、誇張しない。
- 有料プロモーション・不自然な成長施策は扱わない。
