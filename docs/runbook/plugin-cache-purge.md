# Plugin Cache Purge Runbook

プラグインキャッシュに旧バージョンが残存すると、古い skill 定義が解決されて意図しない挙動になります。ここでは river-review プラグインを例に、診断と purge の手順、再発防止チェックリストをまとめます。

## いつ使うか

- `review-team` など河川レビューの skill が、最新版と異なる古い挙動をする。
- 同名 skill が複数解決され、どの版が呼ばれたか判然としない。
- プラグイン更新後も旧版の description や本文が参照される。

## 背景

Claude Code はインストール済みプラグインをバージョンごとの cache ディレクトリに展開します。river-review の場合、次のパスにバージョン別のディレクトリが並びます。

```text
~/.claude/plugins/cache/river-review-marketplace/river-review/<version>/
```

同一プラグインの複数バージョンが cache に共存すると、skill 解決が古い版へ引き寄せられることがあります。素の（prefix なしの）`review-team` 呼び出しは、同名 skill と衝突して誤解決した実績があります。ここでの同名 skill とは growth-core 版や旧バージョン cache を指します。呼び出し側の一次対策は namespace prefix の徹底です。詳細は CLAUDE.md の AI Misoperation Guards「Prefix skill invocations」を参照してください。cache 起因が疑われる場合は、本 runbook の purge 手順で二次対策を行います。

## 診断: cache 内バージョンの確認

まず cache に何バージョン残っているかを確認します。

```bash
ls -1 ~/.claude/plugins/cache/river-review-marketplace/river-review/
```

複数のバージョンディレクトリが並ぶ場合は、古い版が解決対象に混ざる余地があります。実例として `1.34.0` と `1.43.0` の併存が観測されました。

該当 skill が各版に存在するかは、次のコマンドで確認できます。

```bash
ls -d ~/.claude/plugins/cache/river-review-marketplace/river-review/*/skills/agent-skills/review-team
```

最新版が何かは marketplace 側のインストール情報で確認します。

```bash
cat ~/.claude/plugins/installed_plugins.json
```

## Purge: 古いバージョンの安全な削除

最新版のみ残し、古いバージョンディレクトリを削除します。次の手順は破壊的操作を含むため、削除対象を目視で確認してから実行してください。

1. 残すべき最新バージョンを確定する（`installed_plugins.json` の値と `ls` の結果を照合する）。
2. 削除候補を dry-run で列挙する。

   ```bash
   ls -1d ~/.claude/plugins/cache/river-review-marketplace/river-review/*/ \
     | grep -v '/1.43.0/'
   ```

3. 列挙結果が古いバージョンのみと確認できたら、対象ディレクトリを削除する。

   ```bash
   rm -rf ~/.claude/plugins/cache/river-review-marketplace/river-review/1.34.0
   ```

4. Claude Code を再起動し、cache が最新版のみになったことを確認する。

marketplace クローン（`~/.claude/plugins/marketplaces/river-review-marketplace/`）は git リポジトリの実体で、cache とは別物です。purge の対象にはしません。更新が必要なときは削除せず、marketplace 側の更新フローで最新化します。

## 再発時のチェックリスト

- [ ] cache に旧バージョンディレクトリが残っていないか（`ls -1 .../river-review/`）。
- [ ] 呼び出しは namespace prefix 付きか（`river-review:review-team` の形式）。
- [ ] growth-core など他プラグインに同名 skill がないか（同名なら prefix 必須）。
- [ ] purge 後に Claude Code を再起動したか。
- [ ] marketplace クローンを誤って削除していないか。

## 関連

- CLAUDE.md AI Misoperation Guards「Prefix skill invocations」（呼び出し側の一次対策）
- 計画書 [#1463](https://github.com/s977043/river-review/issues/1463)（review-team 改名保留と消極的対策）
