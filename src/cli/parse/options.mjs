// `parseArgs` のオプション連鎖。src/cli.mjs から順序を保ったまま純粋に移設して
// いる（リファクタリング Step 4）。判定も副作用も変えていない。
//
// 連鎖は上から順に評価される。移設は必ず**残りの連鎖の先頭から**行うこと。
// 途中の分岐だけを持ち出すと評価順が変わる。
//
// `usageError` は移していない。usage hint を stdout へ出しつつ
// `parsed.usageError` を立てる副作用で、`parseArgs` の 70 箇所以上から呼ばれる。
// 引数で渡すと依存注入になるため、本関数は stderr への出力までを行い、
// ループを抜けるべきことを `'break'` で返す。呼び出し側が続けて `usageError` を
// 呼ぶので、出力の順序は移設前と同じである。

import { SEVERITY_RANK } from '../../lib/finding-factory.mjs';

const SEVERITY_VALUES = Object.keys(SEVERITY_RANK);

/**
 * 1 トークン分のオプションを読み取る。
 *
 * @param {object} parsed
 * @param {string} arg 読み取り済みのトークン
 * @param {string[]} args 残りの argv（破壊的に shift する）
 * @returns {'continue'|'break'|null}
 *   `'continue'` 呼び出し側はループを継続する。
 *   `'break'` 呼び出し側は `usageError(parsed)` を呼んでループを抜ける。
 *   `null` 本関数は扱わない。呼び出し側の連鎖へ落とす。
 */
export function consumeOption(parsed, arg, args) {
  if (arg === '--plan-only') {
    parsed.planOnly = true;
    return 'continue';
  }
  if (arg === '--fail-on' || arg === '--warn-on') {
    const value = args.shift();
    const sev = value ? value.toLowerCase() : '';
    if (!SEVERITY_VALUES.includes(sev)) {
      console.error(
        `Error: ${arg} must be one of: ${SEVERITY_VALUES.join(', ')} (got "${value ?? ''}").`
      );
      return 'break';
    }
    if (arg === '--fail-on') parsed.failOn = sev;
    else parsed.warnOn = sev;
    return 'continue';
  }
  if (arg === '--advisory-only') {
    parsed.advisoryOnly = true;
    return 'continue';
  }
  if (arg === '--gate') {
    parsed.gate = true;
    return 'continue';
  }
  if (arg === '--offline' || arg === '--rules-only') {
    parsed.offline = true;
    return 'continue';
  }
  if (arg === '--plan') {
    const value = args.shift();
    if (!value || value.startsWith('-')) {
      console.error('Error: --plan option requires a path.');
      return 'break';
    }
    parsed.planFile = value;
    return 'continue';
  }
  if (arg === '--output-file') {
    const value = args.shift();
    if (!value || value.startsWith('-')) {
      console.error('Error: --output-file option requires a path.');
      return 'break';
    }
    parsed.outputFile = value;
    return 'continue';
  }
  if (arg === '--summary-file') {
    const value = args.shift();
    if (!value || value.startsWith('-')) {
      console.error('Error: --summary-file option requires a path.');
      return 'break';
    }
    parsed.summaryFile = value;
    return 'continue';
  }
  if (arg === '--quiet') {
    parsed.quiet = true;
    return 'continue';
  }
  return null;
}
