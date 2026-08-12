# Link Checking Guide

このガイドでは、River Reviewプロジェクトでのリンクチェックの使い方を説明します。

## 概要

3層のリンクチェック体制で、壊れたリンクを早期に発見・修正します。

### チェック体制

1. **ローカル開発時** - 開発者が手動で実行
2. **PR時** - GitHub ActionsでPRごとに自動チェック
3. **定期実行** - 毎週月曜日に自動チェック（外部リンクの変更検出）

## ローカルでのリンクチェック

### インストール

Lycheeをインストールしていない場合は、以下のいずれかの方法でインストールしてください。

**macOS (Homebrew):**

```bash
brew install lychee
```

**Linux (cargo):**

```bash
cargo install lychee
```

**その他の方法:**
[Lychee Installation Guide](https://github.com/lycheeverse/lychee#installation)を参照してください。

### 使い方

#### 標準チェック（推奨）

PR前に実行して、すべてのリンクをチェック:

```bash
npm run check:links
```

**特徴:**

- `.lychee.toml`の設定を使用
- すべての外部リンクをチェック
- キャッシュ有効（2回目以降は高速）

#### クイックチェック

開発中に素早くチェックしたい場合:

```bash
npm run check:links:quick
```

**特徴:**

- 並列実行数を増やして高速化
- 開発中の頻繁なチェックに最適

#### オフラインチェック

外部リンクをスキップして、内部リンクのみチェック:

```bash
npm run check:links:local
```

**特徴:**

- オフライン環境で使用可能
- 内部リンク（相対パス、アンカー）のみチェック
- 最速（ネットワーク不要）

### 出力例

#### 成功時

```text
✓ No broken links found!
```

#### 失敗時

```text
✗ 2 errors found

[404] https://example.com/broken-link
  ├─ docs/README.md:15
  └─ pages/guide.md:42

[404] https://old-domain.com/page
  └─ docs/tutorial.md:28
```

### エラー修正のワークフロー

1. **リンクチェック実行**

   ```bash
   npm run check:links
   ```

2. **エラー確認**
   - 404エラー → リンク先が存在しない
   - タイムアウト → リンク先が遅い、または到達不可
   - その他 → `.lychee.toml`で除外を検討

3. **修正**
   - リンクを修正
   - 不要なリンクは削除
   - 一時的に利用不可の場合は`.lychee.toml`に追加

4. **再チェック**

   ```bash
   npm run check:links
   ```

## CI/CDでのリンクチェック

### PR時の自動チェック

すべてのPRで自動的にリンクチェックが実行されます。

**動作:**

- PRがオープンされた時
- PRに新しいコミットがプッシュされた時
- `.lychee.toml`の設定を使用

**失敗した場合:**

1. GitHub Actionsのログでエラーを確認
2. Artifactから`lychee-report`をダウンロード
3. ローカルで修正
4. 再プッシュ

### 定期チェック（毎週月曜日）

外部リンクの変更を検出するため、毎週月曜日2:00 (UTC)に自動実行されます。

**動作:**

- リンクチェックが失敗すると自動的にIssueを作成
- `scheduled-check`ラベルが付与される
- 重複Issueは作成されない

**対応:**

1. 自動作成されたIssueを確認
2. 壊れたリンクを修正するPRを作成
3. マージ後、Issueをクローズ

## 設定ファイル

### .lychee.toml

プロジェクトルートの`.lychee.toml`でLycheeの動作を設定します。

**主な設定項目:**

```toml
# リダイレクト数の上限
max_redirects = 5

# 並列リクエスト数
max_concurrency = 8

# 除外パターン（正規表現）
exclude = [
  '^mailto:',
  '^https?://localhost',
  'example\.com',
]

# 許可するHTTPステータスコード
# リダイレクトは max_redirects で処理（ログで追跡可能にするため、ここには含めない）
accept = [200, 201, 202, 203, 204]

# タイムアウト（秒）
timeout = 30

# リトライ回数
max_retries = 3
```

**設定を変更した場合:**

```bash
# ローカルで確認
npm run check:links

# 問題なければコミット
git add .lychee.toml
git commit -m "chore: update lychee configuration"
```

## よくある問題と解決策

### 1. 一時的に利用不可のリンク

**問題:** 外部サイトがメンテナンス中などで一時的に到達できない。

**解決策:** `.lychee.toml`の`exclude`に一時的に追加する。

```toml
exclude = [
  # ... existing patterns ...
  'temporarily-unavailable-site\.com',
]
```

### 2. ボット検出でブロックされる

**問題:** 一部のサイトがLycheeをブロックしている。

**解決策:** `.lychee.toml`の`user_agent`を変更する、または`exclude`に追加する。

```toml
user_agent = "Mozilla/5.0 (compatible; River-Reviewer-LinkChecker/1.0)"
```

### 3. プライベートリンク

**問題:** 認証が必要なリンク（社内ドキュメントなど）

**解決策:** `.lychee.toml`の`exclude`に追加する。

```toml
exclude = [
  # ... existing patterns ...
  'internal-docs\.example\.com',
]
```

### 4. 開発中のPRリンク

**問題:** まだマージされていないPRへのリンクが404になる。

**解決策:**

- マージ後に解決されることをPRコメントで説明
- または、`.lychee.toml`で一時的に除外

```toml
exclude = [
  # ... existing patterns ...
  'github\.com/.*/tree/main/new-feature',  # Will be available after merge
]
```

## ベストプラクティス

### 開発フロー

1. **ドキュメント作成/更新時**

   ```bash
   # 内部リンクのみチェック（高速）
   npm run check:links:local
   ```

2. **PR作成前**

   ```bash
   # すべてのリンクをチェック
   npm run check:links
   ```

3. **定期的なメンテナンス**
   - 毎週のIssueを確認
   - 古いリンクを更新
   - 不要なリンクを削除

### リンク作成のヒント

1. **外部リンク**
   - 公式ドキュメントへのリンクは優先的に使用
   - ブログ記事などは避ける（リンク切れのリスク）
   - バージョン指定のURLを使用（例: `@v1.0.0`）

2. **内部リンク**
   - 相対パスを使用
   - ファイル名変更時は全文検索で更新
   - アンカーリンクは慎重に使用

3. **代替案の提供**
   - 重要な情報は直接記載
   - リンク先の内容を要約
   - 複数のソースを提供

## トラブルシューティング

### Lycheeが見つからない

```bash
# インストール確認
lychee --version

# インストールされていない場合
brew install lychee  # macOS
```

### キャッシュのクリア

```bash
# 1. 以下のコマンドでキャッシュディレクトリのパスを確認します
lychee --cache-path

# 2. 表示されたパスのディレクトリを削除します
# 例: rm -rf <表示されたパス>
```

### 設定ファイルが読み込まれない

```bash
# 設定ファイルのパスを明示的に指定
lychee --config .lychee.toml '**/*.md'
```

## 参考資料

- [Lychee Documentation](https://github.com/lycheeverse/lychee)
- [Lychee Action Documentation](https://github.com/lycheeverse/lychee-action)
- [Link Check Workflow](../../.github/workflows/link-check.yml)
- [Configuration File](../../.lychee.toml)

## 質問・問題報告

リンクチェックに関する質問や問題は、以下の方法で報告してください:

- [GitHub Issues](https://github.com/s977043/river-review/issues) - `question`ラベルを付けて投稿
