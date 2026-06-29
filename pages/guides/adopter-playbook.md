# 導入プレイブック（Integration modes と段階導入）

River Review を新しいリポジトリやチームへ導入するとき、機能そのものより先に「どの経路で導入するか」「どこから gate 化するか」「観点をどう自前 skill に昇格するか」で迷いやすいです。このガイドは How-to として、その初期判断をまとめます。

このガイドは導入初期の運用判断にフォーカスします。各経路の具体的なセットアップ手順は、それぞれのガイド（[GitHub Actions](./github-actions.md) / [Skill Pack を使う](./use-skill-packs.md) / [2 段構えレビューゲート](./two-stage-review-gate.md)）を参照してください。

## 1. Integration modes（導入経路）を選ぶ

River Review は単一の導入経路ではなく、目的に応じて複数の経路があります。`.river-review.json` がどの経路で読まれるかは経路ごとに異なるため、注意が必要です。

| Mode                             | 意味                                                            |                       `.river-review.json` を読むか                       | 向いている用途                                |
| -------------------------------- | --------------------------------------------------------------- | :-----------------------------------------------------------------------: | --------------------------------------------- |
| GitHub Actions                   | CI 上で River Review runner を実行する                          |                    Yes（runner が repo root から読む）                    | PR 時点の自動レビュー                         |
| CLI / `river run`                | ローカルや任意の CI から CLI を直接実行する                     |                    Yes（runner が repo root から読む）                    | PR 前セルフレビュー、headless 実行            |
| Plugin（Claude Code / Codex 等） | エージェントのレビュー能力を skill で強化する                   | No（エージェントが skill を適用。repo ルールは `.river/rules.md` を参照） | 対話的なレビュー、エージェント駆動開発        |
| Skill adoption only              | 本体を導入せず、レビュー観点だけを自前の agent skill へ移植する |                         No（移植先の運用に従う）                          | 既存の社内 review workflow に観点だけ取り込む |

判断の目安:

- まず PR 自動レビューが欲しい → **GitHub Actions**
- 対話的にエージェントへレビューさせたい → **Plugin**
- 既存の社内 skill / workflow があり、観点だけ取り込みたい → **Skill adoption only**

> **`.river-review.json` の読まれ方**: 設定ファイルは `river run` / CLI / Action runner の経路で repo root から読まれます（`.river-review.json` / `.river-review.yaml` / `.river-review.yml` の順で探索）。Plugin 経路ではエージェントが skill を適用するため、設定ファイルではなく `.river/rules.md` / `.river/rules.d/*.md` のリポジトリ固有ルールが効きます（[リポジトリ全体レビュー](./repo-wide-review.md) 参照）。「設定ファイルを置いたが反映されない」を避けるため、自分の経路がどちらかを先に確認してください。

## 2. Rollout policy（段階導入）

最初から blocking gate にすると、false positive で開発速度が落ちやすいです。次の順で段階的に締めるのが安全です。

1. **comment-only**: レビュー結果を PR コメントとして出すだけで、CI は失敗させない。まずノイズ量と有用性を観察する。
2. **fail-if-required（warn）**: `critical` のみ失敗、`major` は警告に留める。重大な指摘だけを gate にする。
3. **blocking gate**: 必須チェックに昇格し、一定 severity 以上でマージをブロックする。

severity と失敗条件の対応（CLI / runner 既定）:

- `critical` = fail
- `major` = fail-if-required（既定は warn）
- `minor` = comment-only
- `info` = skipped

ノイズを抑える初期設定の例:

- 対象スキルを小さな公式 [Skill Pack](./use-skill-packs.md) から始める（`--skill-set` で限定）。
- 変更に関係するアーティファクト・ファイルにだけ当てる（[リポジトリ全体レビュー](./repo-wide-review.md) のチューニング）。
- ラベルによる実行制御（`prLabelsToIgnore`）で対象 PR を絞る。
- まず [2 段構えレビューゲート](./two-stage-review-gate.md) の「PR 前ローカル + PR 後ラベル付き自動実行」から始める。

## 3. 観点を skill / fixture / suppression へ昇格する

導入後の運用では、レビュー結果を次の単位で資産化すると陳腐化を防げます。

- **accepted（有用だった指摘）**: 繰り返し出したい観点なら skill として明文化する（[スキルを追加する](./add-new-skill.md)）。
- **false positive（誤検出）**: 決定論で判定できる誤検出は skill の fixture（false-positive guard ケース）として固定し、回帰を防ぐ。プロジェクト固有の抑制は [suppression memory](./repo-wide-review.md#false-positive-suppression-memory)（`suppression-feedback` の運用）で扱う。
- **missed issue（見逃し）**: 拾えなかった観点は新しい fixture（happy path）と skill 観点に落とす。

この昇格ループにより、AI レビューの判断を「再現可能な検査」へコード化していきます。判断単位の詳細は [スキルの選択と組み合わせ](./choose-skills.md) と [スキル作成ガイド](./write-a-skill.md) を参照してください。

## 4. Skill adoption only の drift 検知

観点を自前 skill へ移植する「Skill adoption only」では、上流（River Review）が skill を改善しても移植先が気づけず、時間とともに陳腐化します。これを機械的に検知する足場が2つあります。

- **skill manifest**: `docs/data/skill-manifest.json` に各 skill の `id` / `path` / `checksum`（内容ハッシュ）が記録される。移植元 skill の checksum を自分のコピーと突き合わせれば、上流が変わったかを CI で自動検知できる。
- **release notes の "Skills changed"**: 各リリースのノートに、前リリースから変わった skill（Changed / Added / Removed）が列挙される。どの観点を見直すべきかをリリース単位で追える。

ローカルでも `npm run skills:changelog -- --base <前タグ> --head <タグ>` で同じ差分を確認できます。

## よくある失敗と対処

| 失敗                               | 原因                                            | 対処                                                                         |
| ---------------------------------- | ----------------------------------------------- | ---------------------------------------------------------------------------- |
| 設定ファイルを置いたが反映されない | Plugin 経路では `.river-review.json` を読まない | 経路を確認し、Plugin 経路では `.river/rules.md` を使う（§1）                 |
| gate 化が早すぎて開発が止まる      | 最初から blocking                               | comment-only から段階導入する（§2）                                          |
| 社内 skill と観点が重複する        | 責務分界が未定義                                | Skill adoption only か Plugin かを決め、重複観点はどちらかに寄せる（§1, §3） |

## 関連

- [GitHub Actions で River Review をセットアップする](./github-actions.md)
- [Skill Pack を使う](./use-skill-packs.md)
- [2 段構えレビューゲート（PR 前 + PR 後）](./two-stage-review-gate.md)
- [リポジトリ全体を踏まえたレビューの導入とチューニング](./repo-wide-review.md)
- [スキルの選択と組み合わせ](./choose-skills.md)
