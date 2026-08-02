# ドキュメント列挙の機械検証

`scripts/check-doc-enumerations.mjs` は、ドキュメントが書いている「列挙・件数・構成」の主張を実体と突き合わせます。単体実行は `npm run check:doc-enum` です。`npm run meta:validate` からも呼ばれるため、CI の必須チェック `Meta consistency` が落ちれば PR はブロックされます。

## なぜ script なのか

2026-08-02 のドキュメント監査で、次の非対称が観測されました。

- 機械が検証している参照（相対リンク 1123 件・npm script 340 件）の乖離率は 0.18% である
- CI 非対象の「列挙・件数・構成」主張は、20 件サンプルのうち 18 件（90%）が陳腐化していた

実例として `docs/skills-structure.md` は upstream 46 / midstream 26 / downstream 9 と書いていましたが、実測は 49 / 60 / 8 でした（midstream は 2.3 倍の乖離）。

チェックリストでは止まらないことも実証済みです。`plugin-asset-registration-checklist.md` には「`commands/README.md` も更新する」という項目が以前からありましたが、`commands/README.md` の表は 37〜41 日ものあいだ更新されませんでした。そこで [improvement-flow.md](./improvement-flow.md) の「mechanical に実行できるか」という基準に従い、script と CI に倒しています。

## 何を検証しているか

登録内容は `scripts/check-doc-enumerations.mjs` の `DOC_ENUMERATION_SPECS` が SSoT です。初期スコープは、誤検出でメイン開発を止めないことを優先し、決定論で判定できる 4 件に絞ってあります。

| spec id                      | 対象ドキュメント             | 宣言側                              | 実体                                    |
| ---------------------------- | ---------------------------- | ----------------------------------- | --------------------------------------- |
| `skills-stream-counts`       | `docs/skills-structure.md`   | ツリー図の `# <n> スキル` コメント  | `skills/<stream>/` の実ディレクトリ数   |
| `distributed-commands-table` | `commands/README.md`         | コマンド表の `File` 列              | `commands/*.md`（`README.md` を除く）   |
| `repo-dev-commands-table`    | `.claude/commands/README.md` | コマンド表の `File` 列              | `.claude/commands/*.md`（同上）         |
| `claude-md-command-table`    | `CLAUDE.md`                  | `Custom Commands` 表の `Command` 列 | 上記 2 ディレクトリのコマンド名の和集合 |

既存チェックとの重複は避けています。`CLAUDE.md` の「Details: distributed commands (...)」という散文は、すでに機械検証の対象です。担当は `scripts/validate-plugin-manifest.mjs` の `checkClaudeMdCommandParity` であり、`.claude-plugin/plugin.json` の `commands[]` と突き合わせます。本 script が受け持つのは `Custom Commands` の**表**であって、散文ではありません。

## 列挙を書いたときの手順

1. その列挙が機械で数えられるか確かめる。数えられないなら、そもそも件数を書かない選択も検討する
2. `DOC_ENUMERATION_SPECS` に spec を 1 件追加する。`declare`（doc から宣言値を取り出す純関数）と `measure`（実体を数える関数）の組で表現する
3. 上の「何を検証しているか」の表にも同じ spec の行を足す。この表は自己検証の対象外なので、手で揃える必要がある
4. `npm run check:doc-enum` を実行し、追加した spec が現状で green になることを確認する
5. `tests/check-doc-enumerations.test.mjs` に「実 doc を 1 箇所だけ壊すと落ちる」テストを足す。偽 spec だけで固めると、`declare` が別の表を掴んでいても集合が一致すれば通ってしまう
6. 同ファイルの「passes on the current repo state」が通ることを `node --test` で確認する

spec の型は次の 2 種類です。

- `kind: 'counts'`—キーと数値の `Map` を突き合わせる。件数の主張に使う
- `kind: 'names'`—名前の `Set` を突き合わせる。一覧表の主張に使う。過不足の両方向を報告する

宣言側のマーカー（表や行）が見つからない場合は、一致ではなく**エラー**として扱います。regex がすり抜けて検証が空振りする状態は、落ちるよりも危険だからです。これは `validate-meta-consistency.mjs` が `extractLatestRelease` の `null` をエラー化しているのと同じ設計です。

同じ理由で、次の状態もエラーになります。

- **1 件も検証していない**（全 spec が ignore またはスキップされた）。「落ちないが何も守っていない」状態を OK にはしない
- **同一キーの宣言が重複している**。`docs/skills-structure.md` のようにツリーが複数ある doc では、後勝ちにすると読者が最初に見るツリーが陳腐化しても通ってしまう
- **`kind` が `'counts'` / `'names'` 以外**。typo が黙って別の比較経路に落ちるのを防ぐ
- **`declare` が throw した**。1 つの spec の失敗で全 spec が巻き添えにならないよう、spec 単位で捕捉して報告する

## 除外の使い方

意図的に概数で書きたい箇所や、まだ実体が揃っていない項目は除外できます。除外は 2 通りあり、いずれも理由の記述が必須です。

### 1. doc 側のインラインコメント（spec 全体を除外）

対象ドキュメントの本文に次のコメントを置くと、その spec の検証をスキップします。

```html
<!-- doc-enum:ignore <specId> -- 理由をここに書く -->
```

理由を省いた `<!-- doc-enum:ignore <specId> -->` はエラーになります。理由なしの黙殺を作らないための仕様です。

### 2. spec テーブル側の allowlist（キー単位で除外）

一覧のうち特定の項目だけを対象外にしたい場合は、spec に `ignoreKeys` を書きます。キーが項目名、値が理由です。

```js
{
  id: 'distributed-commands-table',
  // ...
  ignoreKeys: { 'experimental.md': '実験中のため意図的に未掲載' },
}
```

値が空文字や文字列以外の場合はエラーになり、その除外は採用されません。該当キーは通常どおり比較されるため、理由なしの除外で検証が空振りすることはありません。

宣言側と実体側のどちらにも現れないキーの除外は、期限切れとみなしてエラーになります。除外キーは両側をマスクするため、そのまま残すと、対象ファイルが将来復活しても永久に検査されないからです。

## 誤検出が出たとき

false positive でメイン開発を止めないことを最優先とします。対処の優先順は次のとおりです。

1. spec の `declare` / `measure` を直して、正しく判定できるようにする
2. すぐ直せないなら `doc-enum:ignore` か `ignoreKeys` で理由付きの除外を入れ、issue を立てる
3. 対象そのものが機械検証に向いていないと判明したら、spec を削除する

## 関連

- `scripts/check-doc-enumerations.mjs`—spec テーブル本体と検証エンジン
- `tests/check-doc-enumerations.test.mjs`—パーサーと除外機構の回帰テスト
- `scripts/validate-plugin-manifest.mjs`—plugin manifest 側の列挙検証（`Meta consistency` で併走）
- [`improvement-flow.md`](./improvement-flow.md)—再発防止策を script と CI に倒す判断基準
- [`plugin-asset-registration-checklist.md`](./plugin-asset-registration-checklist.md)—コマンド追加時の登録手順
