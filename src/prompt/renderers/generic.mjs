// generic renderer（ADR-006 / #1859）
//
// 配置は legacy な組み立てと同じである。すべての節を user prompt に置き、
// system message には役割宣言だけを置く。provider 固有の前提を持たない
// モデルに対する既定の描画として使う。

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
export function renderGeneric(ir) {
  const prompt = `${renderSubjectBlock(ir)}
${renderContextBlock(ir)}${renderContractBlock(ir)}
${renderDiffBlock(ir)}`;
  return { systemMessage: renderRoleMessage(ir), prompt };
}
