# Skill Pack template

このディレクトリは skill pack（オープンなレビューナレッジの配布単位）manifest の雛形です。
実装時は `pack.yaml` をコピーし、registry.yaml の `packs:` セクションにエントリとして追加してください。

- 設計方針・軸定義・tier 昇格条件: [docs/development/skill-pack-design.md](../../../docs/development/skill-pack-design.md)
- skill 本体の雛形: [specs/templates/skill/](../skill/)

official tier の昇格には、pack 内の **全 skill** が次の機械条件を満たし、かつ maintainer review を通過する必要があります。

- good / bad fixture と golden output がある
- false-positive canary がある
- `npm run eval:fixtures` が CI で green である
