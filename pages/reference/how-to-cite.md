---
id: how-to-cite
title: River Review の引用方法
sidebar_label: 引用方法
description: 研究や記事で River Review を参照するための引用情報をまとめます。メタデータの単一の情報源はリポジトリの CITATION.cff です。
keywords:
  - citation
  - CITATION.cff
  - River Review 引用
  - how to cite
---

研究や記事で River Review を引用する方法は次のとおりです。引用メタデータの単一の情報源は、リポジトリ直下の [`CITATION.cff`](https://github.com/s977043/river-review/blob/main/CITATION.cff) です。

## GitHub の「Cite this repository」

GitHub のリポジトリページ右サイドバーにある「Cite this repository」から、`CITATION.cff` を基にした APA / BibTeX 形式の引用を生成できます。手入力せずに済むため、最も手軽な方法です。

## BibTeX

`version` と `date` には、引用時点の [`CITATION.cff`](https://github.com/s977043/river-review/blob/main/CITATION.cff) の `version` と、利用したリリースの日付を入れてください。

```bibtex
@software{river_review,
  title   = {River Review},
  author  = {{River Review maintainers}},
  url     = {https://github.com/s977043/river-review},
  version = {X.Y.Z},
  date    = {YYYY-MM-DD},
  license = {MIT}
}
```

## プレーンテキスト

```text
River Review maintainers (YYYY). River Review (Version X.Y.Z) [Software]. https://github.com/s977043/river-review
```

## DOI について

- 現時点で DOI は未発行である。
- Zenodo と GitHub を連携してリリースへ DOI を付与したのち、`CITATION.cff` の `doi` フィールドと本ページを更新する。
- バージョンや日付は最新リリースで変わるため、引用時は `CITATION.cff` の値を正とする。

## 関連ドキュメント

- [`CITATION.cff`（メタデータの正）](https://github.com/s977043/river-review/blob/main/CITATION.cff)
- [River Review とは](../explanation/what-is-river-review.md)
