// Model Profile の解決（ADR-006 / #1859）
//
// provider / model から profile を決める純関数。決定論であり、I/O も
// プロセス状態の参照もしない。未知の入力は generic へ落とす（例外にしない）。
//
// profile を 2 本に限る理由は ADR-006「初回導入範囲」にある。レビュー実行経路
// （src/lib/review-engine.mjs の skipReason 判定）が openai 以外を退避するため、
// 他 provider の profile を今置いても到達不能なコードになる。
// Anthropic / Google の追加は ADR-006「再参入条件」が成立してからとする。

import { genericProfile } from './profiles/generic.mjs';
import { openaiProfile } from './profiles/openai.mjs';

/** 解決可能な profile の一覧。id から引けるようにしておく。 */
export const PROFILES = Object.freeze({
  [genericProfile.id]: genericProfile,
  [openaiProfile.id]: openaiProfile,
});

/** 解決先が決まらないときの落とし先。 */
export const DEFAULT_PROFILE = genericProfile;

function normalize(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : null;
}

/**
 * provider / model から profile を決める。
 *
 * `model` は現時点で選択に影響しない。同一 provider 内でモデル別の描画を
 * 分ける必要が出た時点でここが分岐点になるため、引数としては受け取る。
 *
 * @param {{provider?: string|null, model?: string|null}} [params]
 * @returns {object} 凍結済みの profile
 */
export function resolveProfile(params) {
  const provider = normalize(params?.provider);
  if (provider === 'openai') return openaiProfile;
  return DEFAULT_PROFILE;
}
