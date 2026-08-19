# River Review のビジョン

> **内部資料:** 設計思想の SSoT です。公開向けの導入は [`pages/explanation/intro.md`](../pages/explanation/intro.md)、公開向けのコンセプト解説は [`pages/explanation/concept.md`](../pages/explanation/concept.md)、運用ガイドは [`pages/guides/`](../pages/guides/) を参照してください。

River Review は、**チームのレビュー判断を skill として明示化・バージョン管理し、SDLC の各ゲートで実行する基盤** です。

「AI に PR を読ませる SaaS」ではなく、「**レビュー職務を skill として定義・評価・運用するための基盤**」と位置付ける。AI 支援開発（Claude Code / Codex / Cursor 等）の普及により、コードは速く書けるようになった一方、判断基準は依然としてチームが所有しなければならない。River Review はその所有を実行可能にする。

## Problem（なぜ、いまレビューなのか）

AI によって「作る速度」は上がった。一方で「何を信頼してよいか」を判断する負荷は増えている。River Review は次の 4 つの課題を出発点とする。

1. **実装速度と判断速度の非対称**—AI は大量のコードや artifact を生成できるが、意思決定の品質は自動では高まらない。
2. **レビュー知識の散逸**—判断基準が PR コメント・個人の経験・会話に埋もれ、次の開発で再利用されにくい。
3. **同じレビューの繰り返し**—チームは同じ観点を毎回ゼロから説明するため、レビュアーの認知負荷と待ち時間が増える。
4. **判断基準の所有権**—モデルやレビュー SaaS を乗り換えても、チーム固有の判断基準はチーム自身の資産として残す必要がある。

## 中核となる洞察

> レビューの価値は、バグを見つけることだけではない。意思決定の品質を高めることにある。

レビューとは、成果物に対して異なる視点・根拠・リスク・代替案を提示し、より信頼できる意思決定を可能にする活動を指す。バグ発見はその重要な一部だが、価値はそこだけに閉じない。River Review は、この活動を再利用・評価・改善できる形へ変える。

## 語彙階層

コンセプトの語彙は 4 層に分ける。層ごとに役割が違うため、混ぜて使わない。

| 層                  | 表現                                              | 役割                                     |
| ------------------- | ------------------------------------------------- | ---------------------------------------- |
| Tagline             | レビューを、組織の判断資産へ                      | 価値を一言で伝える                       |
| Core Mechanism      | Review Judgment as Code                           | 中核思想。仕組みの説明はここに集約する   |
| Current Product     | Review Judgment Platform / Team-owned Audit Layer | いま提供しているものの呼び方             |
| Long-term Direction | Engineering Judgment Infrastructure               | 長期の拡張方向であり、現在の看板ではない |

**Review Judgment as Code** は、レビュー観点・判断基準・責任範囲・Evidence・エスカレーション条件・品質評価方法を、再利用と評価と改善が可能な形で管理する考え方を指す。Engineering Judgment Infrastructure は長期の到達点を示す語であり、現在の提供機能の説明には使わない。

## 現在の提供価値（Review Judgment Platform）

現在の River Review は Review Judgment Platform であり、次を提供する。

- **Skill Registry**: レビュー観点・判断基準が、コードと同じくリポジトリ内で versioned / testable / portable な資産として存在する。
- **SDLC ゲート**: 設計（plan）／実装（exec）／QA（verify）の 3 ゲートで、skill が一貫した契約（artifact 入力 → findings 出力）で実行される。
- **リスク階層型の人間監督**: skill は責任境界を持ち、リスク階層に応じて人間監督を配分する。崖（cliff）は人間承認を必須とし、丘（hill）は期限付き観測を課し、原っぱ（field）は自律収束を許して事後監査する（[ADR-003](adr/003-risk-tiered-human-supervision.md)）。崖の最終判断は人間が行う。
- **評価駆動**: skill ごとに golden fixture と promptfoo eval を持ち、品質が回帰できる。
- **AI 監査レイヤー**: 実装エージェントが書いたコードを、チーム所有のルールで検査する運用モードを提供する。

## コアモデル

```text
Skills define judgment.       skill = レビュー判断の単位
Gates execute judgment.       plan / exec / verify CLI = 実行ゲート
Riverbed remembers judgment.  suppression / WontFix / 過去判断 = operating memory
```

これらの 3 層が、AI 支援実装の時代における **チーム所有の監査レイヤー** を構成する。

## skill の再定義（職務単位）

- skill は「レビュー工程」ではなく「レビュー職務」を代替・補完する役割として設計する。
- 何を責任として引き受け、どの判断を自動で行い、どこから人間へ返すかを明確にする。
- 成果が「良いレビューだった」と判断できる条件（golden + eval）を持つ。

## 既存ツールとの差分

- **CodeRabbit / Copilot Review / Gemini Code Assist**: diff を入力に PR コメントを返す SaaS。判断ロジックはプロバイダ側に閉じる。
- **Claude Code / Codex / Cursor**: 実装を行うエージェント IDE/CLI。レビューは付帯機能。River Review はこれらの**横で動く検査ゲート**として設計されている。
- **Anthropic Agent Skills**: 業務マニュアル付きの道具箱（能力単位）。River Review の skill は「**レビュー職務単位**」で、アーティファクト契約と評価可能性をもつ。
- **ESLint / SonarQube などの静的解析**: 1 ファイル内で完結する決定論的チェック。River Review は **アーティファクトを跨ぐ判断**（plan と diff の乖離、テストと境界条件の整合、過去レビューとの一貫性）を扱う。

## 持続的な差別化軸

River Review の持続的な差別化は "AI" ではなく **判断基準の所有権**にある。Claude Code / Cursor / Codex といった実装エージェントが変わっても、repo-owned skills と gates は残る。したがって主張順は次の通り構成する。

1. チームの判断基準をコード化する（持続的差別化）
2. plan / diff / tests をまたいで gate する（持続的差別化）
3. その結果、AI 実装時代の監査レイヤーとして機能する（時代適合）

## 責任境界と人間中心の原則

- skill は自律的に暴れる存在ではなく、責任境界が明確な労働者として扱う。
- 崖（リスクの高い変更）は人間承認を必須とし、HITL を温存する。
- 丘は期限付き観測、原っぱは自律収束 + 事後監査とし、希少な人間の注意を崖へ配分する。
- 迷い・不明・未決は常に安全側（ESCALATE / NO_GO）へ倒す fail-safe を持たせる。

## 非ゴール

本節を River Review の Non-Goals の SSoT とする。公開ページの [`pages/explanation/concept.md`](../pages/explanation/concept.md) は、この一覧と同じ項目を掲載する。

- **汎用 AI コードレビュー SaaS にはしない**: チーム文脈を持ち込めないため。
- **実装エージェントを置き換えない**: 並列して検査ゲートとして動く。
- **静的解析の置き換えにはしない**: アーティファクト跨ぎの判断に集中する。
- **人間レビュアーを完全代替しない**: 崖の人間承認を契約に組み込み、監督をリスク階層で配分する。
- **コード自動修正は行わない**: 問題の発見と指摘までを担い、コード変換や自動修正は行わない（[security-model](../pages/explanation/security-model.md) の「レビューは読み取り専用」に対応する）。
- **自動承認・自動マージを主張しない**: verdict は判断材料であり、承認そのものではない。
- **Evidence 不足のままの自律判断は行わない**: 自動化範囲の拡大は、検証とフィードバック反映の裏付けがある観点に限る。

## 長期的な方向性（Engineering Judgment Infrastructure）

長期の拡張方向は Engineering Judgment Infrastructure とする。これは現在の看板ではなく、上記「現在の提供価値」と混同しないよう分けて扱う。

- レビューに留まらず、ADR / 設計 / 運用 / SRE などの判断職務にも横展開できるアーティファクト契約と skill スキーマを目指す。
- 「良いツール」ではなく「良い仕事の作り方」を実装する方向へ進む。

## ロードマップとの対応

ビジョンを実体化する 7 Epic は [`README.md`](../README.md) の「Roadmap」セクションを参照する。実装現況の SSoT は GitHub の Milestones / Projects とする。
