---
id: rr-<phase>-<category>-<number>
name: <Skill Name>
description: <What this skill does>
version: '0.1.0'
category: midstream
phase: midstream
applyTo:
  - 'src/**/*.ts'
  - 'tests/**/*.test.ts'
tags:
  - example
  - category
severity: minor
inputContext:
  - diff
outputKind:
  - findings
  - summary
modelHint: balanced
# dependencies:
#   - code_search
---

## Goal / 目的

- このスキルで "何を減らす/防ぐ/促す" のかを 1〜2 行で書く。
- 1スキル=1テーマに絞り、目的が混ざらないようにする。

## Non-goals / 扱わないこと

- このスキルが扱わない領域を書く。

## False-positive guards / 抑制条件

- こういうケースでは言わない（誤検知ガード）を列挙する。

## Rule / ルール

- ルールを 1 観点に絞って箇条書きで書く。

## Evidence / 根拠の取り方

- 指摘は差分に紐づける（`<file>:<line>` で追える内容）。
- 推測を断定しない（不確実なら "可能性" として書く）。

## Output / 出力

`<file>:<line>: <message>` 形式。コメントは日本語で返す。

- Finding: 何が問題か（1文）
- Impact: 何が困るか（短く）
- Fix: 次の一手（最小の修正案）
