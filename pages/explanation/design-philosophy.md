# 設計哲学

River Review は、チームの暗黙知を versioned / repo-owned な Skill（Skill Registry）へ落とし込み、共有資産として再利用することを基盤にしている。その基盤の上に、AI エージェントのレビュー能力を強化する capability pack、共有資産としてのレビュースキル、観点別レビュアーを並列実行する review team という 3 主軸が乗る。以下の原則は、この 3 主軸を支える設計判断をまとめている。

River Review は、チームの速度を落とすことなく、タイムリーでフェーズを意識したフィードバックを提供するために構築されている。

- **Flow-first**: すべてのチェックは、どのフェーズに属するか、そしてなぜそのフェーズなのかを明記すべきである。
- **Small, testable steps**: 明確な合格シグナルを持つ、狭くスコープされたスキルを好む。
- **Schema-driven**: `/schemas/skill.schema.json` はすべてのスキルの契約であり、単一の真実のソースであり続けるべきである。
- **Empathetic tone**: 発見事項はアクション可能で建設的であるべきであり、フレンドリーな River Review ブランドにマッチさせるべきである。
- **Evidence-based**: ガイダンスを、推奨事項を証明するコマンドやリンクに結びつける。
- **Context-aware**: LLM に渡すコンテキストを体系的に設計する。スキル・差分・メモリの選択と段階的開示により、限られた Context Budget の中でレビュー品質を最大化する。

## Non-Goals

River Review は以下を目指していない:

- **汎用 AI エージェントフレームワーク**: コードレビューに特化した context engineering framework であり、汎用タスク実行基盤ではない。review team も、1 つの orchestrator が観点別レビュアーロールを並列実行して結果を connected-components でマージする仕組みであり、完全に自律した独立エージェント群ではない。
- **人間のレビュー判断の代替**: AI はレビュー観点の提示と検証を支援する。findings と verdict はあくまで判定素材であり、GO / NO-GO・反復・停止の判断は caller や人間（HITL）の責務である。自動承認や自動マージは主張しない。
- **コード自動修正**: 問題の発見と指摘を行うが、コード変換や自動修正は行わない。
