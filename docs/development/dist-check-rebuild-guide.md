# Dist Check Rebuild Guide

`runners/github-action/dist/` は `npm run build:action` により ncc で事前 bundle される。`test.yml` の `Action dist freshness` ジョブはこの dist が最新の src と一致することを検証する。

## 問題

このリポジトリでは、ncc bundle 出力が Node major version によって異なることが経験的に観測されている。ローカルと CI で Node major が異なると、同一 src からでも異なる bundle が生成され、`Action dist freshness` の false positive fail を引き起こす。

過去の rebuild コミット:

- `fc1c019 chore(action): rebuild dist after main updates`
- `#491 chore(action): rebuild github-action dist`

契機となった最近のセッション:

- `#528` 準備中にローカル Node 25 で rebuild したところ CI Node 22 と出力が食い違い、Node 22 で再度 rebuild し直した

## Node version の SSoT

リポジトリルートの `.nvmrc` が唯一の真実。現時点では `22.22.2` が pin されている。workflow 側の `node-version: 22.x` はこれを緩く参照しているだけ。

```bash
cat .nvmrc
# → 22.22.2
```

## 自動再ビルド（Auto Rebuild Action Dist）

`.github/workflows/auto-rebuild-action-dist.yml` が PR 上で dist の再ビルドを自動化します。bundled sources（`runners/github-action/src/**`、`src/**`、`package-lock.json`）が変更された PR において、workflow は `.nvmrc` の Node により `npm run build:action` を実行します。byte 差分が出た場合のみ `chore(action): rebuild github-action dist` コミットを PR branch に push します。差分が出なければ何も push しません。

対象となる条件は以下のとおりです。

- 同一リポジトリ内ブランチからの PR（fork PR は push 不可のため対象外。従来どおり `Action dist freshness` job が staleness を検出する）
- `release-please--` で始まる branch は対象外（自動コミットが release PR を汚染しないようにするため）

トークンおよび no-recursion 制約の扱いは、`release-please-kick.yml` と同様です。`GITHUB_TOKEN` による push は GitHub の no-recursion 制約により `pull_request` workflow を再発火させません。そのため `RELEASE_KICK_PAT`（contents:write）があればそれを優先し、新しい head SHA で CI が再実行されます。`RELEASE_KICK_PAT` が未設定の場合、fallback push は warning を表示します。その際は empty commit などにより手動で CI を発火させてください。

以下の場合は次節の手動手順を fallback として使います。

- fork からの PR
- release-please branch 上での staleness
- workflow 自体が失敗した場合

## ローカル rebuild 手順（手動 fallback）

### 1. Node を `.nvmrc` に合わせる

```bash
# nvm
nvm use              # .nvmrc を自動参照

# volta (.nvmrc を読む場合は自動、そうでなければ明示)
volta pin node@"$(cat .nvmrc)"

# asdf
asdf install nodejs "$(cat .nvmrc)"
asdf local nodejs "$(cat .nvmrc)"
```

nvm/volta/asdf いずれも使っていない場合、`node -v` で version を確認し、homebrew / fnm / 手動インストールで `.nvmrc` のバージョンに合わせる。

### 2. 依存を解決して rebuild

```bash
npm ci
npm run build:action
```

### 3. 差分を確認して commit

```bash
git diff --stat runners/github-action/dist/
git add runners/github-action/dist/
git commit -m "chore(action): rebuild github-action dist"
```

## いつ rebuild が必要か

以下のいずれかを触った場合:

- `runners/github-action/src/**`
- `runners/github-action/src/index.mjs` から import される `src/**` のモジュール
- `package.json` / `package-lock.json` の ncc 依存 (`@vercel/ncc` 自体の bump、または bundle 対象に入る dependency の bump)

> CI の `Action dist freshness` job は src commit timestamp が dist より新しい場合に **追加で `npm run build:action` を実行して byte 差分を確認**する。再 build しても dist に diff が出ないなら、その src 変更は bundle に含まれていない sibling と判断され、ローカル commit なしでも pass する（false positive 回避）。逆に diff が出た場合は依然として rebuild commit が必要。

## トラブルシューティング

| 症状                                                                            | 原因                             | 対応                                             |
| ------------------------------------------------------------------------------- | -------------------------------- | ------------------------------------------------ |
| ローカルで `git diff --quiet runners/github-action/dist/` は通るのに CI で fail | ローカル Node が `.nvmrc` と違う | `nvm use` で揃えて再 build                       |
| rebuild しても差分が残り続ける                                                  | `node_modules` が stale          | `npm ci` で依存再解決後に `npm run build:action` |
| `index.mjs.map` のみの大量差分                                                  | sourcemap の決定論性問題         | Node を `.nvmrc` に揃えれば通常解消              |

## 関連

- CLAUDE.md § AI Misoperation Guards—"Match CI Node version for dist rebuilds"
- `.nvmrc`—リポジトリ Node version の SSoT
- `.github/workflows/test.yml`—`dist-check` ジョブ定義
- `runners/github-action/package.json`—`build:action` スクリプト
