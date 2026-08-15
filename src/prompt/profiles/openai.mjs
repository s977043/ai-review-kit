// Model Profile: OpenAI 互換（ADR-006 / #1859）
//
// profile が宣言してよいのは「そのモデルがどう受け取るか」だけである。
// ADR-006「不変条件」の節が列挙する判断側の 4 種は、この階層に置かない。
// tests/prompt-compiler-invariants.test.mjs が本ディレクトリのソースを
// 走査して、判断側の語が現れないことを機械保証する。
//
// generic との差は 1 点だけである。出力契約の節を system message 側へ寄せ、
// user message には対象・文脈・差分を置く。文面そのものは共通で、
// src/prompt/sections.mjs が唯一の出典である。

export const openaiProfile = Object.freeze({
  id: 'openai-review-v1',
  version: '1',
  rendererId: 'openai',
  capabilities: Object.freeze({
    supportsSystemMessage: true,
    outputContractInSystemMessage: true,
  }),
});
