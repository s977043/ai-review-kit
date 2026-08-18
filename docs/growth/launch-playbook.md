# Launch execution playbook

準備した素材（README・デモ・[launch assets](./launch-assets.md)・[communication materials](./communication-materials.md)・[community](./community.md)・[external listings](./external-listings.md)）を、実際に「認知が立ち上がる 1 日」へ束ねるための実行手順をまとめます。[oss-discovery-roadmap](../roadmap/oss-discovery-roadmap.md) の Phase 1〜7 が素材準備、本ファイルはその素材を投下するローンチ当日の runbook です。

> 親エピック: [#1276](https://github.com/s977043/river-review/issues/1276)

## 前提と原則

- **不自然な成長施策は使わない**。[roadmap の Out of Scope](../roadmap/oss-discovery-roadmap.md#out-of-scope) に従い、star の購入・相互 star・bot 誘導は行わない。本ファイルの「velocity」は、正当な同時告知で自然な初速を作ることを指す。
- **Human-in-the-loop を崩さない**。「AI が完全自動でレビューする」等の誤認表現は使わず、`Review Judgment as Code` / team-owned audit layer で一貫させる（[message pillars](./communication-materials.md#message-pillars) 参照）。
- **外部リポジトリ・SNS への実際の投稿はリポジトリ管理者が行う**。本ファイルは手順とテンプレートを提供する。

## なぜ「同時投下」なのか

GitHub の発見経路のうち **Trending は star velocity（単位時間あたりの star）** を重視する。複数チャネル（記事 / Hacker News / Reddit / X）が同時に流入を作ると初速が立ち、Trending に載れば以降はアルゴリズムが露出を広げる。逆に 1 チャネルずつ小出しにすると初速が分散し、velocity が立たない。準備済みの素材を「同じ日にまとめて出す」ことが要点である。

## タイムライン

### T-7〜T-3 日: 直前準備

- [communication materials](./communication-materials.md) の Zenn / note 記事を清書し、下書き保存まで進める。
- [launch assets](./launch-assets.md) の PNG（Social Preview / X 投稿用）を書き出し、GitHub Settings の Social Preview に設定する。
- README 冒頭で 5 秒以内に価値が伝わるか、[plan-conformance デモ](../../examples/plan-conformance-demo/README.md)が 5 分で動くかを最終確認する。
- Discussions のカテゴリと[最初の Discussion 案](./community.md#最初の-discussion-案)を用意する。
- [external listings](./external-listings.md#提出状況トラッキング) の掲載状況を確認し、被リンク元を把握する。

### T-2〜T-1 日: 記事を先に出す

- **技術記事（Zenn / Dev.to）を先行公開**する。検索インデックスに載せ、ローンチ当日にトラフィックが跳ねたとき検索・SNS 経由で回遊できる状態を作るため。
- 記事末尾の CTA はリポジトリ Star と Discussions に向ける。

### T-0 当日: 同時投下

- **曜日と時刻**: 火・水・木のいずれか、**米国の太平洋時間（PT）午前 8〜10 時**を狙う（開発者の閲覧が最も多い帯）。月曜・金曜は避ける。日本時間では同日深夜〜翌日未明に相当するため、投稿予約を活用する。
- **投下順序（できるだけ同時刻に）**:
  1. Hacker News に `Show HN:` で投稿する。タイトルは誇張せず、何ができるかを一文で。
  2. 関連 subreddit（例: r/programming, r/devops, r/opensource）へ、各コミュニティの文体に合わせて投稿する。同一文面のコピペは避ける。
  3. X で図解（[diagram](./launch-assets.md)）付きで投稿する。
  4. Product Hunt に登録する（任意）。
- **最初の 100 star は人脈から**。チーム/知人へ個別に告知し、初速の起点を作る。
- **最初の 2 時間が最重要**。この間の反応が Trending の可否を左右するため、コメント・質問へ即応できるよう時間を確保しておく。

### T+1〜T+2 日: 初期対応

- Hacker News / Reddit / Discussions / Issues のすべての反応へ **24〜48 時間以内**に返信する。「生きているプロジェクト」のシグナルは評価者の第一チェック項目である。
- 指摘された不足（ドキュメント・デモの穴）は `good first issue` 化し、貢献導線に変える。

### T+3 日以降: 放送から対話へ

- 一斉告知を止め、実際に試したユーザーと 1on1 で使い方を聞く。
- [oss-discovery-metrics](./oss-discovery-metrics.md) の週次テンプレートで、star だけでなく traffic / clone / docs visit / referrer を記録し、次の改善 Issue に接続する。GitHub の Traffic 指標は過去 14 日分しか保持されないため、記録を欠かさない。

## 当日チェックリスト

```md
## Launch day: YYYY-MM-DD（火〜木 / PT 8-10am 目安）

- [ ] 先行記事（Zenn / Dev.to）公開済み・CTA 導線確認
- [ ] Social Preview 設定済み
- [ ] README 冒頭の価値提案・Quick Start 最終確認
- [ ] Discussions 有効・最初の投稿用意
- [ ] Show HN 投稿
- [ ] Reddit 投稿（各サブレディット文体調整）
- [ ] X 投稿（図解添付）
- [ ] Product Hunt 登録（任意）
- [ ] 人脈への個別告知
- [ ] 最初の 2 時間、コメント即応の時間を確保
- [ ] 反応を metrics テンプレートに記録開始
```

## 関連ドキュメント

- ポジショニングと全体計画: [oss-discovery-roadmap](../roadmap/oss-discovery-roadmap.md)
- 記事・SNS・英語 launch copy: [communication-materials](./communication-materials.md)
- 投稿用画像とコピー: [launch-assets](./launch-assets.md)
- Star のあとの導線: [community](./community.md)
- 効果測定: [oss-discovery-metrics](./oss-discovery-metrics.md)
- 外部掲載（被リンク）: [external-listings](./external-listings.md)
