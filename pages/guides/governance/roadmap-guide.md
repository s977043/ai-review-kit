---
id: roadmap-guide
title: Roadmap & Project Board 運用ガイド
---

## 目的

- ロードマップのフェーズ進行と、GitHub Projects (Board) を使ったタスク管理を一貫させる。
- Issue/PR の粒度とステータスを揃え、進捗を見える化する。

## ボード初期設定

- ビュー: Board（Group by `Status`）。
- 推奨フィールド:
  - `Status`: Todo / Doing / Blocked / Done
  - `Phase`: 0 / 1 / 2 / 3 / 4（ROADMAP.md と対応）
  - `Component`: Schema / Loader / Runner / Skills / Evals / Memory
  - `Priority`: P0 / P1 / P2
  - `Owner`: 担当者（People フィールド）
- 自動化（任意）:
  - Issue 追加時に `Status=Todo` を自動設定。
  - PR クローズ時に関連 Issue を `Done` へ移動するワークフローを追加可能。

## タスクの切り出し方

- 1 Issue = 1 実行可能タスク。スコープは 1〜2 日で終わるサイズを目安にする。
- ロードマップのフェーズ項目を元に、粒度を落として Issue 化する。
- Phase の例:
  - Phase 1: スキル移行/ID 正規化、本番想定スキル追加
  - Phase 2: ローダー/Runner 実装、Actions ラッパー更新

## 登録フロー

1. Issue を作成し、`Phase`/`Priority`/`Status=Todo` を設定。
2. 必要ならマイルストン（`v0.2.0 – Developer Experience` など）に紐付ける（Milestone は SemVer 系に統一）。
3. プロジェクトボードに追加（Board でカードが自動生成される）。

## 運用フロー（カンバン）

- 毎週のスタンドアップまたは週次でボードを確認。
- ルール例:
  - 着手時に `Todo` → `Doing`。
  - ブロッカーがあれば `Blocked` に移動し、コメントで状況を残す。
  - PR マージ後、Issue をクローズし `Done` へ移動。
- フェーズ完了判定は ROADMAP.md の Exit Criteria に従う。

## 定義済みタスクの雛形例

具体的なタスク案は [ROADMAP.md](https://github.com/s977043/river-reviewer/blob/release/ROADMAP.md) の「次の具体タスク案」を参照してください（重複管理を避けるため本ドキュメントでは一覧を持たない）。

## 運用 Tips

- Issue テンプレを用意し、目的/完了条件/テスト観点を書く欄を設ける。
- 大きいタスクはチェックリストで分割し、サブタスクを Todo として管理。
- ラベルを少数に絞る（例: `type:task`, `P1`, `m2-dx`）。
- ロードマップ更新時は、対応する Issue にリンクを張り、重複や抜けを防ぐ。
