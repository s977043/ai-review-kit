# examples/

River Review の利用イメージを掴むための最小構成サンプルです。各ディレクトリを自分のリポジトリにコピーして試してください。

- `examples/example-1-hello-skill/`: Hello Skill を含む最小構成（dry-run で PR コメントまで通す）
- `examples/example-2-upstream-only/`: upstream のみで動かす（設計/ドキュメント変更向け）
- `examples/example-3-planner/`: planner あり（`planner: off|order|prune` を切替）
- `examples/minimal-js/`: 最小の JavaScript プロジェクト + River Review の GitHub Actions ワークフロー例（互換維持のため残置）
- `examples/risk-map/`: `.river/risk-map.yaml` のサンプル（`require_human_review` / `escalate` / `comment_only` の 3 段階を網羅した実用テンプレ）
- `examples/plan-conformance-demo/`: Plan に反した実装を River Review が検出する様子を 5 分で読める最小デモ（plan / diff / tests をまたぐレビュー判断、API キー不要）
