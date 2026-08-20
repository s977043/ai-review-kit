#!/usr/bin/env bash
# 作業ツリーの汚染を排除して件数を測る（refs #1827）。
#
# `git archive <ref>` を一時ファイルへ書き出し `tar -x -f` で一時ディレクトリへ clean tree を展開し、そこで
# 任意のコマンドを実行して結果を返す。展開されるのは <ref> が追跡しているファイル
# だけなので、次の 2 つの汚染源が構造的に消える:
#
#   1. worktree の重複計上（`.claude/worktrees/` 配下の作業コピー）
#   2. 作業ツリーの追跡外ファイル（`.gitignore` 対象・未 commit の新規ファイル）
#
# 2 は `git grep` 規律では防げない。textlint のようにディレクトリを自分で走査する
# ツールは `.gitignore` 対象まで数えるため、#1786 では 347 件と公開した実測値の
# 真値が 317 件だった（`docs/Working/` の 14 ファイルが混入）。
#
# 構造化データ（YAML の引用符付きスカラー等）の集計ミスは本 script の対象外で、
# パーサを使う（`node -e` / `yq`）ことで別途防ぐ。
#
# 使い方:
#   scripts/count-in-clean-tree.sh [--ref <ref>] [--raw] [--] <command> [args...]
#
# 例:
#   scripts/count-in-clean-tree.sh -- git grep -c TODO
#   scripts/count-in-clean-tree.sh --ref HEAD -- npx textlint --no-cache 'docs/**/*.md'
#   scripts/count-in-clean-tree.sh -- bash -c 'git ls-files "*.md" | wc -l'
#
# <command> は exec される（シェル経由ではない）ため、パイプ・リダイレクト・変数展開を
# 使う場合は上の例のように `bash -c '...'` へ包むこと。
# 展開先は .git を持たない素のディレクトリなので、`git grep` は `--no-index` を付ける
# （付けないと `fatal: not a git repository` で終わる）。
# 既定の ref は origin/main。終了コードは実行したコマンドのものをそのまま返す。
#
# ただしパイプの終端が `wc` の場合、上流が失敗しても `wc` は成功するため、全体は
# exit 0 で「0 件」を返す。誤った件数を防ぐために本 script を通しても、この形では
# 失敗が 0 件として通過する。件数を数えるパイプには `set -o pipefail` を付けること:
#
#   scripts/count-in-clean-tree.sh -- bash -c 'set -o pipefail; git ls-files "*.md" | wc -l'

set -euo pipefail

REF="origin/main"
RAW=0

usage() {
  # 以下は #1950 まで `cat <<'EOF'` の heredoc だった。bash 5.3.15（homebrew）は
  # 本体が 512 バイトを超える heredoc で決定論的に deadlock し、この本体は 518
  # バイトなので `--help` と usage エラーがそのまま固まっていた。単一引用符の
  # 複数行文字列を `printf` へ渡すと quoted heredoc と同じ「一切展開しない」
  # 意味論のままバイト単位で同一の出力になり、しかもサイズ上限が無い。
  # heredoc へ戻さないこと（#1950）。
  printf '%s\n' 'Usage: scripts/count-in-clean-tree.sh [--ref <ref>] [--raw] [--] <command> [args...]

Options:
  --ref <ref>   展開する git ref（既定: origin/main）
  --raw         再現用ヘッダを付けず、コマンドの出力だけを stdout へ流す
  -h, --help    このヘルプを表示する

出力は既定で「そのまま doc へ貼れる」fenced block になる。ref・解決した SHA・
実行コマンド・出力が 1 ブロックに収まるため、公開した数値の再現手段が残る。'
}

while [ $# -gt 0 ]; do
  case "$1" in
    --ref)
      [ $# -ge 2 ] || {
        echo "error: --ref requires a value" >&2
        exit 2
      }
      REF="$2"
      shift 2
      ;;
    --ref=*)
      REF="${1#--ref=}"
      shift
      ;;
    --raw)
      RAW=1
      shift
      ;;
    -h | --help)
      usage
      exit 0
      ;;
    --)
      shift
      break
      ;;
    -*)
      echo "error: unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
    *) break ;;
  esac
done

if [ $# -eq 0 ]; then
  echo "error: no command given" >&2
  usage >&2
  exit 2
fi

if ! SHA=$(git rev-parse --verify "${REF}^{commit}" 2>/dev/null); then
  echo "error: cannot resolve ref: ${REF}" >&2
  echo "hint: origin/main を使う前に git fetch origin を実行してください" >&2
  exit 2
fi

TMPBASE="${TMPDIR:-/tmp}"
TMPROOT=$(mktemp -d "${TMPBASE%/}/rr-clean-tree.XXXXXX")
WORKDIR="${TMPROOT}/tree"
ARCHIVE="${TMPROOT}/archive.tar"
mkdir "${WORKDIR}"
cleanup() {
  rm -rf "${TMPROOT}"
}
trap cleanup EXIT INT TERM

echo "clean tree: ${WORKDIR} (removed on exit)" >&2
# パイプ（`git archive | tar -x`）は使わない。git archive は tar の出力を blocking
# factor 20（10240 バイト）へパディングするが、bsdtar は EOF マーカー（512 バイトの
# ゼロブロック 2 つ）を読んだ時点で終了でき、残りのパディングを読み捨てない。つまり
# 読み手が先に消えうる構造があり、書き手が残りを書き終える前に読み手が抜けると
# git archive が SIGPIPE を受け、`set -o pipefail` と `set -e` の下ではスクリプト
# 全体が exit 141 で落ちる（#1838）。どちらが先かはスケジューリング次第で、負荷や
# repo の構成によって顕在化する（本 repo では並列作業中に、テストが作る小さな repo
# では毎回）。中間ファイルを挟めばパイプが無くなり、この競合自体が消える。
git archive --format=tar -o "${ARCHIVE}" "${SHA}"
tar -x -f "${ARCHIVE}" -C "${WORKDIR}"
rm -f "${ARCHIVE}"

# 表示用にコマンドを再クォートする（コピペしてそのまま再実行できる形にする）。
# 安全な文字だけの引数は素のまま、それ以外は単一引用符で包む（%q の
# バックスラッシュ羅列より読める形にするため）。
SHOWN_CMD=""
for arg in "$@"; do
  if [ -n "${arg}" ] && [ -z "${arg//[A-Za-z0-9._\/:=-]/}" ]; then
    SHOWN_CMD="${SHOWN_CMD}${arg} "
  else
    SHOWN_CMD="${SHOWN_CMD}'${arg//\'/\'\\\'\'}' "
  fi
done
SHOWN_CMD="${SHOWN_CMD% }"

set +e
if [ "${RAW}" -eq 1 ]; then
  (cd "${WORKDIR}" && "$@")
  code=$?
else
  OUTPUT=$( (cd "${WORKDIR}" && "$@") 2>&1 )
  code=$?
  printf '```console\n'
  printf '# clean tree of %s @ %s (git archive; untracked/ignored files absent)\n' "${REF}" "${SHA}"
  printf '$ scripts/count-in-clean-tree.sh --ref %s -- %s\n' "${REF}" "${SHOWN_CMD}"
  printf '%s\n' "${OUTPUT}"
  printf '# exit code: %s\n' "${code}"
  printf '```\n'
fi
set -e

exit "${code}"
