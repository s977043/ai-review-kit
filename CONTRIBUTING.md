# River Reviewer への貢献に感謝します

このプロジェクトをより良くするために時間を割いていただき、ありがとうございます。バグ報告、機能提案、ドキュメントの改善など、あらゆる形の貢献を歓迎します。

## ⚖️ 行動規範 (Code of Conduct)

私たちは、すべての人が参加しやすい、オープンで友好的なコミュニティを目指しています。貢献にあたっては、私たちの[行動規範](CODE_OF_CONDUCT.md)を遵守してください。

## 💡 貢献を始めるには

貢献にはいくつかの方法があります。

### 🐞 バグの報告

もしバグを発見した場合は、Issueを作成して報告してください。良いバグ報告には以下の情報が含まれます。

- **問題の概要**: 何が問題なのかを簡潔に説明してください。

- **再現手順**: 他の人が問題を再現できる具体的なステップを記述してください。

- **期待される動作**: 本来どうあるべきだったかを説明してください。

- **実際の動作**: 実際に何が起こったかを説明してください。

### ✨ 機能提案

新しいチェックリスト項目やエージェントのアイデアがある場合は、Issueを作成して提案してください。

- **明確なタイトル**: 提案内容がわかるようなタイトルを付けてください。

- **提案の背景**: なぜこの機能が必要なのか、どのような問題を解決するのかを説明してください。

### 📝 プルリクエストのプロセス

1. このリポジトリを**Fork**してください。
2. ローカルにクローンし、新しい変更のための**ブランチを作成**してください (`git checkout -b feature/your-feature-name`)。
3. 変更を行い、コミットしてください。コミットメッセージは分かりやすく記述してください。
4. 作成したブランチをGitHubに**Push**してください (`git push origin feature/your-feature-name`)。
5. プルリクエストを作成してください。プルリクエストのテンプレートに従い、変更内容を詳細に説明してください。

プルリクエストは、小さく、目的にフォーカスしたものであることが理想です。

## 📚 Documentation contributions

River Reviewer のドキュメントは [Diátaxis documentation framework](https://diataxis.fr/) に従っています。ドキュメントを追加・更新する際は、どのタイプに当てはまるかを決め、型に沿って書いてください。

- Tutorial（チュートリアル）  
  学習指向のステップバイステップで、新しいユーザーが River Reviewer で最初の成功体験を得られるようにするもの。  
  例: "First steps with River Reviewer on GitHub Actions"

- How-to guide（ガイド）  
  具体的なゴール達成のためのレシピ。読者は基本を理解済みです。  
  例: "Add a custom review skill", "Run River Reviewer locally"

- Reference（リファレンス）  
  API、設定、スキーマなどを正確かつ可能な限り網羅的に説明するもの。  
  例: "GitHub Action inputs", "skill YAML schema"

- Explanation（背景解説）  
  背景、設計判断、概念を説明するもの。  
  例: "Upstream/midstream/downstream model", "Design principles of River Reviewer"

レビューを円滑にするため、以下もお願いします。

- ファイルは該当するセクションに配置してください（例: `pages/tutorials/`, `pages/guides/`, `pages/reference/`, `pages/explanation/`）。
- 選んだタイプを PR のタイトルまたは説明に明記してください（例:
  - Docs: Tutorial – Getting started with River Reviewer
  - Docs: How-to – Add a custom skill
  - Docs: Reference – GitHub Action inputs
  - Docs: Explanation – River flow model）

## ✍️ ドキュメントスタイル（ダッシュ）

このリポジトリでは、ドキュメントのダッシュの扱いを次のように統一しています:

- 見出しや YAML front-matterの`title`など、文章の区切り用途のダッシュはem-dash（—）を用い、**前後のスペースは入れない**(例:`Part I—概要`)。
- 数値範囲（`0.0–1.0`のような場合）はen-dash（–）を利用し、そのままにする。
- コードブロックや YAMLの一部（値以外の要素）には自動変換を適用しない。

自動化:

- レポジトリには`scripts/fix-dashes.mjs`（node）という自動修正スクリプトを用意している。ローカルで実行する際は`npm run fix:dashes`を利用すること。
- CIとPRではVale（Prose Lint）を用い、Microsoft.Dashesルールに従わせている。PR作成前にローカルでlinterを実行することを推奨する。

## 📜 帰属

このガイドは、[contributing.md template](https://gist.github.com/PurpleBooth/b24679402957c63ec426) や [opensource.guide](https://opensource.guide/how-to-contribute/) などの優れた先行事例を参考に作成されました。
