---
# Required metadata (validate with schemas/skill.schema.json)
id: rr-<phase>-<category>-<number> # 例: rr-midstream-code-quality-001（フェーズ-カテゴリ-連番）
name: <Human readable title> # 50文字以内で簡潔に
description: <What this skill checks> # 具体的なチェック目的
phase: midstream # upstream | midstream | downstream
applyTo:
  - 'src/**/*.ts' # glob パターンを列挙。できるだけ絞り込む
tags:
  - example # カテゴリやドメインタグ（security, testing, api 等）
severity: minor # info | minor | major | critical
inputContext:
  - diff # diff / fullFile / tests / adr / commitMessage / repoConfig など
outputKind:
  - findings # findings / summary / actions / tests / metrics / questions
modelHint: balanced # cheap / balanced / high-accuracy
# dependencies:
#   - code_search # 必要なリソースがあれば指定。不要なら省略
---

## Goal / 目的

- このスキルで “何を減らす/防ぐ/促す” のかを 1〜2 行で書く。

## Non-goals / 扱わないこと

- このスキルが扱わない領域（例: リファクタ方針の一般論、プロジェクト固有の制約の断定）を書く。

## False-positive guards / 黙る条件

- こういうケースでは言わない（誤検知ガード）を列挙する。

## Rule / ルール

- ルールを 1 観点に絞って箇条書きで書く。
- “nit” を濫発しない（重要度が低いものは控える）。

## Evidence / 根拠の取り方

- 指摘は差分に紐づける（`<file>:<line>` で追える内容）。
- 推測を断定しない（不確実なら “可能性” として書く）。

## Output / 出力（短文版の推奨）

River Reviewer のコメントは `<file>:<line>: <message>` 形式です。`<message>` は短くても、次が伝わる形にします。

- Finding: 何が問題か（1文）
- Impact: 何が困るか（短く）
- Fix: 次の一手（最小の修正案）

例:

- `src/foo.ts:42: 例外が握りつぶされる可能性。障害調査が困難。Fix: catch でログ+再throw`

## Heuristics / 判定の手がかり（任意）

- 具体的な検出の手がかり（キーワード、構造、パターン）を列挙する。

## Good / Bad Examples（任意）

- 短い例で、何が良い/悪いかを示す。
