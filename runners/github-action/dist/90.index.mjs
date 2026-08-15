export const id = 90;
export const ids = [90];
export const modules = {

/***/ 6709:
/***/ ((__unused_webpack___webpack_module__, __webpack_exports__, __webpack_require__) => {

/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   PromptComparisonError: () => (/* binding */ PromptComparisonError),
/* harmony export */   buildPromptComparison: () => (/* binding */ buildPromptComparison),
/* harmony export */   formatPromptComparisonMarkdown: () => (/* binding */ formatPromptComparisonMarkdown)
/* harmony export */ });
/* unused harmony exports PROMPT_COMPARISON_SCHEMA_VERSION, LEGACY_CONFIG_ID, compiledConfigId, ACCEPTANCE_COVERAGE, extractPromptCompilerObservation, buildPromptComparisonSpec */
/* harmony import */ var _promotion_candidates_mjs__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(3077);
/* harmony import */ var _paired_replay_mjs__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(3080);
/* harmony import */ var _shadow_aggregate_mjs__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(4029);
// legacy と compiled の paired 比較導線（ADR-006 / #1860、#1858 の子タスク 3）
//
// `review.promptCompiler.mode = 'observe'` で走った run が
// `debug.execution.promptCompiler` に残した観測を、legacy 側 / compiled 側の
// 2 系統として取り出し、既存の Experiment Manifest（`./paired-replay.mjs`、
// #1574 P2）へ流す。
//
// ── 比較機構は作らない ───────────────────────────────────────────────
// Experiment Manifest の生成と検証（契約3）、case ごとの findings 突合、
// profile 別受入基準の評価（契約6）は `./paired-replay.mjs` が実装済みである。
// ここはその executor 側であり、突合そのものは buildPairedReplay に委譲する。
// case key / run id / 正規化も同モジュールと SSoT から import する。
//
// ── 何を 2 系統として取り出すか（実測に基づく設計判断）────────────────
// observe は 1 回の run で legacy と compiled の **両方の指紋**
// （legacyPromptHash / compiledPromptHash と両者の推定長）を同時に記録する。
// したがってプロンプト水準の比較に 2 回の run は要らない。実測（node で
// generateReview → buildRunRecord を通した結果）でも、保存済み run レコード
// 1 件が両側の hash と推定長を持つことを確認している。
//
// 一方で compiled 側の **findings は存在しない**。observe は compiled prompt を
// provider へ送らないためである（ADR-006 の observe 不変条件、および
// `src/lib/review-engine.mjs` が observe で記録する `sentPrompt: 'legacy'`）。
// よって recall / precision / parse 成功率 / Evidence 充足のような
// 「LLM の応答」を要する受入基準は、この導線では観測できない。#1861 で配線した
// `active` の run は sentPrompt が `compiled` になり、下の受け入れ条件が弾く。
//
// この非対称を、測れたことにせず構造として表に出す:
//   - プロンプト水準（指紋・推定長・profile 来歴）は `promptMetrics` に出す
//   - findings 水準は `findingComparison.observable = false` と理由で出す
//   - ADR-006 の受入基準表は `acceptanceCoverage` に 1 行ずつ観測可否で出す
//   - spec は acceptance profile を宣言しない。宣言すると空集合に対する
//     vacuous pass を「基準を満たした」と読ませる余地が生まれる
//
// ── 非ゴール ─────────────────────────────────────────────────────────
// automatic canary / 自動 Keep-Rollback / 自動昇格。`./paired-replay.mjs`
// 冒頭が #1574 の採否コメントで確定した非ゴールとして記録しており、ADR-006 も
// これを踏襲する。`decision` は常に null、`applied` は常に false である。
// この導線は LLM も provider も呼ばない。副作用は戻り値だけである。




const PROMPT_COMPARISON_SCHEMA_VERSION = 1;

/** baseline 側（既存プロンプト）の構成識別子。 */
const LEGACY_CONFIG_ID = 'prompt:legacy';

/** candidate 側の構成識別子を profile 来歴から組む。 */
function compiledConfigId({ profileId, profileVersion }) {
  return `prompt:compiled/${profileId}@${profileVersion}`;
}

class PromptComparisonError extends Error {
  constructor(message) {
    super(message);
    this.name = 'PromptComparisonError';
  }
}

/**
 * ADR-006 の受入基準表を、この導線で観測できるか / できないかで 1 行ずつ持つ。
 *
 * 「埋められない項目を落とす」のではなく「なぜ今は測れないか」を残す。
 * 落とすと、測っていない基準が満たされたものとして読まれる。
 */
const ACCEPTANCE_COVERAGE = Object.freeze(
  [
    {
      metric: 'should-detect recall',
      observable: false,
      reason:
        'compiled prompt を送った run が存在しないため candidate 側の findings が無い（observe は compiled を provider へ送らない）',
      unblockedBy: '#1861 active 配線',
    },
    {
      metric: 'should-not-detect precision',
      observable: false,
      reason: 'recall と同じ理由で candidate 側の findings が無い',
      unblockedBy: '#1861 active 配線',
    },
    {
      metric: 'parse 成功率',
      observable: false,
      reason: 'compiled prompt に対する LLM 応答が無く、parse の対象が存在しない',
      unblockedBy: '#1861 active 配線',
    },
    {
      metric: 'Evidence / Fix の充足',
      observable: false,
      reason: 'candidate 側の findings が無いため充足度を数える対象が存在しない',
      unblockedBy: '#1861 active 配線',
    },
    {
      metric: 'invalid ArtifactRefs',
      observable: false,
      reason: 'candidate 側の findings が無いため ArtifactRef の検査対象が存在しない',
      unblockedBy: '#1861 active 配線',
    },
    {
      metric: 'duplicate findings',
      observable: false,
      reason: 'candidate 側の findings が無いため重複を数える対象が存在しない',
      unblockedBy: '#1861 active 配線',
    },
    {
      metric: 'critical 回帰',
      observable: false,
      reason:
        '両側の run が同一のため paired diff は構造上つねに差分 0 になる。この 0 は「回帰が無い」ではなく「観測していない」である',
      unblockedBy: '#1861 active 配線',
    },
    {
      metric: 'token（送信前のプロンプト推定長）',
      observable: true,
      reason: 'observe が legacy / compiled 双方の推定長を 1 run で記録するため観測できる',
      unblockedBy: null,
    },
    {
      metric: 'latency / cost',
      observable: false,
      reason: 'compiled prompt を送っていないため所要時間も課金も発生しておらず、計測対象が無い',
      unblockedBy: '#1861 active 配線',
    },
  ].map((row) => Object.freeze(row))
);

/** observe の観測が必ず持つフィールド（src/lib/review-engine.mjs の記録）。 */
const REQUIRED_OBSERVATION_FIELDS = Object.freeze([
  'mode',
  'sentPrompt',
  'compilerVersion',
  'profileId',
  'profileVersion',
  'legacyPromptEstimate',
  'compiledPromptEstimate',
  'legacyPromptHash',
  'compiledPromptHash',
]);

function compareStrings(a, b) {
  const left = a ?? '';
  const right = b ?? '';
  return left < right ? -1 : left > right ? 1 : 0;
}

function runLabel(record) {
  return (0,_shadow_aggregate_mjs__WEBPACK_IMPORTED_MODULE_2__/* .deriveReviewRunId */ .Kh)(record) ?? '(run id 未取得)';
}

/**
 * 保存済み run レコードから Prompt Compiler の観測を取り出す。
 *
 * 観測が無い run（mode=off で走った run、Prompt Compiler 導入前の run）は
 * `null` を返す。観測はあるが欠けたフィールドがある run は投げる — 黙って
 * 落とすと、比較対象から外れたことが誰にも見えないまま集計が縮む。
 *
 * @param {object|null|undefined} record 保存済み run レコード
 * @returns {object|null}
 */
function extractPromptCompilerObservation(record) {
  const observation = record?.debug?.execution?.promptCompiler;
  if (observation == null) return null;
  if (typeof observation !== 'object' || Array.isArray(observation)) {
    throw new PromptComparisonError(
      `run ${runLabel(record)} の debug.execution.promptCompiler がオブジェクトではない。`
    );
  }
  const missing = REQUIRED_OBSERVATION_FIELDS.filter((field) => observation[field] == null);
  if (missing.length) {
    throw new PromptComparisonError(
      `run ${runLabel(record)} の Prompt Compiler 観測に必須フィールドが無い: ${missing.join(', ')}。`
    );
  }
  return observation;
}

function requireSingleValue(values, label, hint) {
  const distinct = [...new Set(values.filter((value) => value != null))].sort(compareStrings);
  if (distinct.length > 1) {
    throw new PromptComparisonError(
      `${label} が run ごとに異なる（${distinct.join(' / ')}）。${hint}`
    );
  }
  return distinct[0] ?? null;
}

/**
 * 観測付きの run を集め、構成が単一であることを確かめる。
 *
 * 同一 fixture・同一モデル・同一 context・同一 skills が本タスクの前提である。
 * provider / model / profile が混ざった集合をそのまま 1 実験として畳むと、
 * manifest が pin する構成と実際の run が食い違う。
 */
function collectObservedRuns(runRecords) {
  const records = Array.isArray(runRecords) ? runRecords : [];
  const observed = [];
  const withoutObservation = [];
  for (const record of records) {
    const observation = extractPromptCompilerObservation(record);
    if (!observation) {
      withoutObservation.push(runLabel(record));
      continue;
    }
    observed.push({
      record,
      observation,
      runId: (0,_shadow_aggregate_mjs__WEBPACK_IMPORTED_MODULE_2__/* .deriveReviewRunId */ .Kh)(record),
      caseKey: (0,_paired_replay_mjs__WEBPACK_IMPORTED_MODULE_1__/* .deriveCaseKey */ .XZ)(record),
    });
  }
  // 入力順に依存しない。spec（両側の runs / declaredEvidence）まで含めて
  // 同じ入力集合なら常に同じ成果物になる。
  observed.sort((a, b) => compareStrings(a.runId, b.runId) || compareStrings(a.caseKey, b.caseKey));
  if (observed.length === 0) {
    throw new PromptComparisonError(
      'Prompt Compiler の観測を持つ run が 1 件も無い。`review.promptCompiler.mode` を `observe` にしてレビューを実行し、run を保存してから再実行すること（既定は off）。'
    );
  }

  // 送信物が legacy でない run は、この導線の前提（両側の findings が legacy 由来）を
  // 壊す。#1861 で active が配線された時点で静かに誤った比較を出すより、ここで
  // 止めて導線を見直させる。
  const nonLegacy = observed.filter((entry) => entry.observation.sentPrompt !== 'legacy');
  if (nonLegacy.length) {
    throw new PromptComparisonError(
      `sentPrompt が legacy でない run が ${nonLegacy.length} 件ある（${[
        ...new Set(nonLegacy.map((entry) => entry.observation.sentPrompt)),
      ]
        .sort(compareStrings)
        .join(
          ' / '
        )}）。compiled を実際に送った run は findings 水準で比較できるため、この導線ではなく #1861 の経路で扱うこと。`
    );
  }

  const profileId = requireSingleValue(
    observed.map((entry) => (0,_promotion_candidates_mjs__WEBPACK_IMPORTED_MODULE_0__/* .nonEmptyNfcString */ .bS)(entry.observation.profileId)),
    'profileId',
    '同一 profile の run だけを渡すこと。'
  );
  const profileVersion = requireSingleValue(
    observed.map((entry) => (0,_promotion_candidates_mjs__WEBPACK_IMPORTED_MODULE_0__/* .nonEmptyNfcString */ .bS)(String(entry.observation.profileVersion))),
    'profileVersion',
    '同一 profile version の run だけを渡すこと。'
  );
  const compilerVersion = requireSingleValue(
    observed.map((entry) => (0,_promotion_candidates_mjs__WEBPACK_IMPORTED_MODULE_0__/* .nonEmptyNfcString */ .bS)(String(entry.observation.compilerVersion))),
    'compilerVersion',
    '同一 compiler version の run だけを渡すこと。'
  );
  const provider = requireSingleValue(
    observed.map((entry) => (0,_promotion_candidates_mjs__WEBPACK_IMPORTED_MODULE_0__/* .nonEmptyNfcString */ .bS)(entry.record?.debug?.llmProvider)),
    'provider',
    '同一 provider の run だけを渡すこと。'
  );
  const model = requireSingleValue(
    observed.map((entry) => (0,_promotion_candidates_mjs__WEBPACK_IMPORTED_MODULE_0__/* .nonEmptyNfcString */ .bS)(entry.record?.debug?.llmModel)),
    'model',
    '同一モデルの run だけを渡すこと。'
  );

  return {
    observed,
    withoutObservation: withoutObservation.sort(compareStrings),
    configuration: { profileId, profileVersion, compilerVersion, provider, model },
  };
}

/**
 * 既存の Experiment Manifest（契約3）へ渡す experiment spec を組む。
 *
 * 両側の `runs` は **同じ run レコード**である。observe では compiled prompt を
 * 送っていないため、compiled 側に固有の run は存在しない。findings が空の
 * ダミー run を candidate 側に置くと「compiled は何も検出しなかった」という
 * 観測していない主張になるので、それはしない。
 *
 * 構成の差は `configId` が担う。これにより `buildPairedReplay` の
 * activation check は `configurationDiffers = true` かつ
 * `observedDifference = false` となり、`verified = false` を理由付きで返す。
 * 「変更経路が発火した証跡を観測できない」という既存の判定が、この導線の
 * 状態そのものである。
 *
 * @param {{ runRecords: object[], hypothesis?: string|null }} input
 * @returns {object} buildPairedReplay に渡せる spec
 */
function buildPromptComparisonSpec({ runRecords, hypothesis = null } = {}) {
  const { observed, withoutObservation, configuration } = collectObservedRuns(runRecords);
  const records = observed.map((entry) => entry.record);
  const { profileId, profileVersion, compilerVersion, provider, model } = configuration;
  // 両側でレビュー実行コードは同一である（1 プロセスが両方のプロンプトを組む）。
  // 構成差は configId だけが持つ、というのがこの実験の実際の形である。
  const commitSha = `river-prompt-compiler@${compilerVersion}`;
  const side = (configId) => ({
    commitSha,
    configId,
    provider,
    model,
    temperature: null,
    runs: records,
  });
  return {
    hypothesis:
      hypothesis ??
      'compiled prompt は legacy prompt と同じ判断入力から生成される（ADR-006 の不変条件）。品質水準の比較は #1861 まで観測できない。',
    baseline: side(LEGACY_CONFIG_ID),
    candidate: side(compiledConfigId({ profileId, profileVersion })),
    metrics: { denominator: 'paired-case' },
    activation: {
      expectedSignal:
        'compiled prompt を送信した run の findings。observe では取得できないため、activation は verified にならない',
      declaredEvidence: observed.map((entry) => entry.runId).filter(Boolean),
    },
    environment: {
      promptCompilerModes: [...new Set(observed.map((entry) => entry.observation.mode))].sort(
        compareStrings
      ),
      compilerVersion,
      profileId,
      profileVersion,
      runsWithoutObservation: withoutObservation.length,
    },
    // profile を宣言しない。findings 水準を観測できない状態で基準を宣言すると、
    // 差分 0 の paired diff が「基準を満たした」と読まれる（vacuous pass）。
    acceptance: { profiles: [] },
    trials: { trialCount: 1 },
  };
}

/** run ごとのプロンプト水準の比較値。observe が記録した値をそのまま使う。 */
function promptRowOf(entry) {
  const o = entry.observation;
  return {
    runId: entry.runId,
    caseKey: entry.caseKey,
    profileId: o.profileId,
    profileVersion: o.profileVersion,
    mode: o.mode,
    legacyPromptHash: o.legacyPromptHash,
    compiledPromptHash: o.compiledPromptHash,
    // 指紋が一致する = その profile の描画が legacy とバイト単位で同じである。
    // generic profile は legacy と同一描画になるため、一致自体は異常ではない。
    promptsIdentical: o.legacyPromptHash === o.compiledPromptHash,
    legacyPromptEstimate: o.legacyPromptEstimate,
    compiledPromptEstimate: o.compiledPromptEstimate,
    // 推定長は src/lib/token-estimator.mjs の estimateTokens が run 時に出した
    // 値である。ここで数え直さない（単位が食い違う）。
    estimateDelta: o.compiledPromptEstimate - o.legacyPromptEstimate,
  };
}

function summarizePromptMetrics(observed, withoutObservation, configuration) {
  const rows = observed.map(promptRowOf).sort((a, b) => compareStrings(a.runId, b.runId));
  const legacyTotal = rows.reduce((acc, row) => acc + row.legacyPromptEstimate, 0);
  const compiledTotal = rows.reduce((acc, row) => acc + row.compiledPromptEstimate, 0);
  return {
    ...configuration,
    observedRunCount: rows.length,
    runsWithoutObservation: withoutObservation,
    identicalPromptRunCount: rows.filter((row) => row.promptsIdentical).length,
    divergentPromptRunCount: rows.filter((row) => !row.promptsIdentical).length,
    legacyPromptEstimateTotal: legacyTotal,
    compiledPromptEstimateTotal: compiledTotal,
    estimateDeltaTotal: compiledTotal - legacyTotal,
    runs: rows,
    note: 'プロンプト推定長は送信前の推定であり、品質の代理指標ではない。「prompt token が減ったから採用」という判定は ADR-006 が禁じている。',
  };
}

/**
 * legacy と compiled の paired 比較を組む。
 *
 * 純関数である。I/O を持たず、時計は注入する。LLM も provider も呼ばない。
 *
 * @param {{ runRecords: object[], now?: Date, hypothesis?: string|null }} input
 * @returns {object}
 */
function buildPromptComparison({ runRecords, now = new Date(), hypothesis = null } = {}) {
  const { observed, withoutObservation, configuration } = collectObservedRuns(runRecords);
  const spec = buildPromptComparisonSpec({ runRecords, hypothesis });
  // 突合・manifest・受入評価はすべて #1574 P2 の実装に委譲する。
  const replay = (0,_paired_replay_mjs__WEBPACK_IMPORTED_MODULE_1__.buildPairedReplay)(spec, { now });
  return {
    schemaVersion: PROMPT_COMPARISON_SCHEMA_VERSION,
    generatedAt: now.toISOString(),
    mode: 'prompt-compiler-paired',
    readOnly: true,
    sides: {
      baseline: { configId: spec.baseline.configId, label: 'legacy prompt（buildPrompt）' },
      candidate: {
        configId: spec.candidate.configId,
        label: `compiled prompt（profile ${configuration.profileId}@${configuration.profileVersion}）`,
      },
    },
    promptMetrics: summarizePromptMetrics(observed, withoutObservation, configuration),
    findingComparison: {
      observable: false,
      reason:
        'observe は compiled prompt を provider へ送らないため、compiled 側の findings が存在しない。両側の run は同一であり、paired diff の差分 0 は「回帰が無い」ではなく「観測していない」である。',
      unblockedBy: '#1861（active の配線）',
      // 既存モジュール側の判定を再実装せず、その結論を指し示す。
      activationVerified: replay.activationCheck.verified,
      activationReasons: replay.activationCheck.reasons,
    },
    acceptanceCoverage: [...ACCEPTANCE_COVERAGE],
    spec,
    replay,
    // 非ゴールを成果物側でも明示する。
    decision: null,
    applied: false,
    autoPromotion: false,
    requiresHumanJudgment: true,
    writeEffects: [],
  };
}

/**
 * 人が読む Markdown。観測できない基準を先に出す。
 *
 * 順序に意味がある。paired replay の表を先に出すと、差分 0 の行が「回帰なし」と
 * 読まれる。
 */
function formatPromptComparisonMarkdown(result) {
  const p = result.promptMetrics;
  const lines = ['## Prompt Compiler paired comparison (read-only)', ''];
  lines.push('| Item | Value |');
  lines.push('|---|---|');
  lines.push(`| Baseline | \`${result.sides.baseline.configId}\` |`);
  lines.push(`| Candidate | \`${result.sides.candidate.configId}\` |`);
  lines.push(`| Provider / Model | ${p.provider ?? '(未取得)'} / ${p.model ?? '(未取得)'} |`);
  lines.push(`| Observed runs | ${p.observedRunCount} |`);
  lines.push(`| Runs without observation | ${p.runsWithoutObservation.length} |`);
  lines.push(`| Manifest | \`${result.replay.manifest.manifestId}\` |`);
  lines.push('');

  lines.push('### 観測できない受入基準（ADR-006）');
  lines.push('');
  lines.push('| Metric | 観測 | 理由 |');
  lines.push('|---|---|---|');
  for (const row of result.acceptanceCoverage) {
    lines.push(`| ${row.metric} | ${row.observable ? '可' : '不可'} | ${row.reason} |`);
  }
  lines.push('');
  lines.push(`- findings 水準の比較: 不可。${result.findingComparison.reason}`);
  lines.push(`- 解消条件: ${result.findingComparison.unblockedBy}`);
  lines.push('');

  lines.push('### プロンプト水準（観測できる範囲）');
  lines.push(
    `- profile: \`${p.profileId}@${p.profileVersion}\` / compiler \`${p.compilerVersion}\``
  );
  lines.push(
    `- 推定長合計: legacy ${p.legacyPromptEstimateTotal} → compiled ${p.compiledPromptEstimateTotal}（差 ${p.estimateDeltaTotal}）`
  );
  lines.push(
    `- 指紋一致 ${p.identicalPromptRunCount} 件 / 相違 ${p.divergentPromptRunCount} 件（${p.observedRunCount} 件中）`
  );
  lines.push(`- ${p.note}`);
  lines.push('');

  lines.push((0,_paired_replay_mjs__WEBPACK_IMPORTED_MODULE_1__.formatPairedReplayMarkdown)(result.replay));
  return lines.join('\n');
}


/***/ })

};

//# sourceMappingURL=90.index.mjs.map