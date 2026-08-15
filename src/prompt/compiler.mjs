// Prompt Compiler（ADR-006 / #1859）
//
// Review Request IR と Model Profile から、送信可能な 2 本の文字列
// （system message / user prompt）を作る。
//
// 責務の境界:
//   - compiler は profile が指す renderer を呼ぶだけである。分岐条件を
//     provider 名で持たない（それは profile-resolver.mjs の責務）。
//   - 判断側の値（ADR-006「不変条件」の節）を読み替えない。IR に入っている
//     値をそのまま renderer へ渡す。
//   - 決定論である。同じ IR と同じ profile なら常に同じ 2 本を返す。

import { renderGeneric } from './renderers/generic.mjs';
import { renderOpenAI } from './renderers/openai.mjs';

/** compiled prompt の来歴に載せる compiler 自体のバージョン。 */
export const PROMPT_COMPILER_VERSION = '1';

const RENDERERS = Object.freeze({
  generic: renderGeneric,
  openai: renderOpenAI,
});

/**
 * @param {object} ir buildReviewRequest の戻り値
 * @param {object} profile resolveProfile の戻り値
 * @returns {{systemMessage: string, prompt: string}}
 */
export function compileReviewPrompt(ir, profile) {
  if (!ir || typeof ir !== 'object') {
    throw new TypeError('compileReviewPrompt: ir is required');
  }
  const render = RENDERERS[profile?.rendererId];
  if (!render) {
    // profile-resolver は必ず既知の profile を返すため、ここへ来るのは
    // profile を手で組んだ呼び出し側の誤りである。黙って generic へ
    // 落とすと来歴が実際の描画と食い違うので、例外にする。
    throw new Error(`compileReviewPrompt: unknown rendererId ${String(profile?.rendererId)}`);
  }
  return render(ir);
}
