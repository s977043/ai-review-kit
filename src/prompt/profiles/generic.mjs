// Model Profile: generic（ADR-006 / #1859）
//
// profile が宣言してよいのは「そのモデルがどう受け取るか」だけである。
// ADR-006「不変条件」の節が列挙する判断側の 4 種は、この階層に置かない。
// tests/prompt-compiler-invariants.test.mjs が本ディレクトリのソースを
// 走査して、判断側の語が現れないことを機械保証する。
//
// generic は既定の描画である。legacy な組み立てと同じ配置を採り、
// system message には役割宣言だけを置く。

export const genericProfile = Object.freeze({
  id: 'generic-review-v1',
  version: '1',
  // renderers/ のどの実装を使うか。文面ではなく配置だけを決める。
  rendererId: 'generic',
  capabilities: Object.freeze({
    supportsSystemMessage: true,
    // 出力契約を system 側へ寄せるか。generic は user 側へ残す。
    outputContractInSystemMessage: false,
  }),
});
