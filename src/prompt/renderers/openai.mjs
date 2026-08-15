// OpenAI 互換 renderer（ADR-006 / #1859）
//
// generic との差は 1 点だけである。出力契約の節を system message 側へ寄せ、
// user prompt には対象・文脈・差分を残す。文面は generic と同一であり、
// 変わるのは置き場所だけである（tests/prompt-compiler.test.mjs が pin する）。

import {
  renderContextBlock,
  renderContractBlock,
  renderDiffBlock,
  renderRoleMessage,
  renderSubjectBlock,
} from './shared.mjs';

/**
 * @param {object} ir buildReviewRequest の戻り値
 * @returns {{systemMessage: string, prompt: string}}
 */
export function renderOpenAI(ir) {
  const systemMessage = `${renderRoleMessage(ir)}

${renderContractBlock(ir)}`;
  const prompt = `${renderSubjectBlock(ir)}
${renderContextBlock(ir)}
${renderDiffBlock(ir)}`;
  return { systemMessage, prompt };
}
