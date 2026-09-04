# Merge gate (RA-1 negative fixture: gate / completion / evidence)

Negative fixture for RA-1: this file defines gate verdict conditions, a
completion condition, and a finding evidence requirement — three of the four
forbidden classes in ADR-009 D3-2.

## 判定

### A. MERGE_OK

条件: すべての必須チェックが pass し、未処理のレビューコメントがない。

対応: マージへ進む。

### B. BLOCKED

条件: いずれかの必須チェックが fail、または未処理のレビューコメントが残る。

対応: 阻害要因を全件列挙する。

## 完了条件

条件: 上記の判定が MERGE_OK であり、フォローアップ Issue が起票済みである。

## 証跡

- finding には file:line の証跡を必ず添える。
