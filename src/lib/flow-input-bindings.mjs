// Flow input bindings (Epic #2011 AC7 P3-2).
//
// Flow inputs describe review roles while Artifact Input Contract IDs describe
// concrete files. This module is the CLI-side SSoT that connects the two;
// Flow documents intentionally carry no host vocabulary.

/**
 * Role-wide default artifact IDs, in selection order.
 *
 * `tests` has several valid forms of test evidence, so the first resolved
 * artifact wins. Keep this table small: a role without a stable Artifact
 * Input Contract counterpart must not receive a speculative default.
 */
export const DEFAULT_FLOW_INPUT_BINDINGS = Object.freeze({
  requirements: Object.freeze(['pbi-input']),
  tasks: Object.freeze(['todo']),
  tests: Object.freeze(['junit', 'coverage', 'test-cases']),
});

/**
 * Entry-specific candidates, checked before role-wide defaults.
 *
 * Empty today by design. The separate table prevents a future exceptional
 * Flow from duplicating the defaults for every entry.
 */
export const ENTRY_FLOW_INPUT_BINDING_OVERRIDES = Object.freeze({});

function declaredInputNames(document) {
  return new Set(
    (Array.isArray(document?.inputs) ? document.inputs : [])
      .map((input) => input?.name)
      .filter((name) => typeof name === 'string')
  );
}

function resolvedArtifact(resolved, id) {
  const value = resolved?.[id];
  return value?.exists === true && typeof value.path === 'string' && value.path ? value : null;
}

/**
 * Bind resolved Artifact Input Contract IDs to a Flow's declared input names.
 *
 * A directly named artifact (for example `--artifact tasks=other.md`) always
 * wins over a role default (`todo`). `inputSources` preserves whether each
 * value came from an explicit CLI argument, another direct resolver source,
 * or a default binding so later phases can make source-aware stop decisions.
 *
 * @param {object} options
 * @param {string|null} [options.entry] Flow entry name, for exceptional bindings
 * @param {object} options.document resolved Flow document
 * @param {Record<string, {exists?: boolean, path?: string, source?: string}>} [options.resolved]
 * @returns {{inputs: Record<string, string>, inputSources: Record<string, {kind: 'explicit'|'direct'|'default', id: string, source: string|null}>}}
 */
export function resolveFlowInputBindings({ entry = null, document, resolved = {} }) {
  const names = declaredInputNames(document);
  const inputs = {};
  const inputSources = {};

  // Preserve P3-1's same-named resolution and make it take precedence over
  // role defaults. A CLI-sourced direct ID is the explicit supply contract.
  for (const name of [...names].sort()) {
    const artifact = resolvedArtifact(resolved, name);
    if (!artifact) continue;
    inputs[name] = artifact.path;
    inputSources[name] = {
      kind: artifact.source === 'cli' ? 'explicit' : 'direct',
      id: name,
      source: artifact.source ?? null,
    };
  }

  const entryOverrides =
    entry && ENTRY_FLOW_INPUT_BINDING_OVERRIDES[entry]
      ? ENTRY_FLOW_INPUT_BINDING_OVERRIDES[entry]
      : {};
  for (const name of [...names].sort()) {
    if (name in inputs) continue;
    const candidates = entryOverrides[name] ?? DEFAULT_FLOW_INPUT_BINDINGS[name] ?? [];
    for (const id of candidates) {
      const artifact = resolvedArtifact(resolved, id);
      if (!artifact) continue;
      inputs[name] = artifact.path;
      inputSources[name] = { kind: 'default', id, source: artifact.source ?? null };
      break;
    }
  }

  return { inputs, inputSources };
}
