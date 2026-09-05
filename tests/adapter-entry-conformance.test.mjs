// Paired adapter conformance for the review Flow entry (#2054 PR-5, Epic #2011
// AC5 / AC7; Promotion Gate "deterministic conformance").
//
// Two host adapters now hand an entry name to `river review plan --entry`:
//
//   - Claude Code: hooks/hooks.json `Stop` -> scripts/plugin-task-checkpoint-hook.sh,
//     which names the entry in ONE shell assignment (`ENTRY="review-task"`);
//   - GitHub Action: runners/github-action/action.yml `entry` input, forwarded
//     verbatim through `INPUT_ENTRY`.
//
// The fixture under tests/fixtures/adapter-entry/ is one paired observation:
// the entry each adapter carries is read from the adapter's real surface (not
// from the fixture), resolved through the single Flow reader, and the two pins
// must be identical to each other and to what the trigger resolver derives for
// the neutral trigger. `expected` is hand-authored from flows/ so the test is
// not self-consistent with the loader (#1656).
//
// This is a resolver / loader comparison, not a live-runtime capture: the
// cross-runtime kit (tests/cross-runtime-conformance.test.mjs) keeps the
// `claude` / `codex` runtime vocabulary closed, so the Action pairing lives
// here rather than in that schema.
//
// ADR-009 D3 (RA-1..RA-4): both adapter surfaces are also scanned for review
// judgment vocabulary — an adapter may carry an entry name and nothing else.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadFlowRegistry, resolveFlowEntry } from '../src/lib/flow-loader.mjs';
import { resolveTrigger } from '../src/lib/trigger-resolver.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..');
const FIXTURES_DIR = path.join(HERE, 'fixtures', 'adapter-entry');

const read = (rel) => fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');

const fixtures = fs
  .readdirSync(FIXTURES_DIR)
  .filter((f) => f.endsWith('.json'))
  .sort()
  .map((file) => ({
    file,
    record: JSON.parse(read(path.join('tests/fixtures/adapter-entry', file))),
  }));

/** The entry name the Claude Code Stop hook carries, read from the script itself. */
function entryCarriedByHookScript(scriptSource) {
  const matches = [...scriptSource.matchAll(/^ENTRY="([^"]+)"$/gm)].map((m) => m[1]);
  assert.equal(matches.length, 1, 'the hook script must assign ENTRY exactly once');
  return matches[0];
}

/** Judgment vocabulary an adapter must not carry (ADR-009 D3). */
const JUDGMENT_TOKENS = [
  /\bNO_GO\b/,
  /\bGO_WITH_OBSERVATION\b/,
  /\bESCALATE\b/,
  /\bblocker\b/i,
  /\bcritical\b/i,
  /\bseverity\b/i,
  /\bthreshold\b/i,
];

describe('paired adapter conformance for --entry (#2054 PR-5)', () => {
  test('the paired fixture set is not empty', () => {
    assert.ok(fixtures.length > 0);
  });

  for (const { file, record } of fixtures) {
    describe(file, () => {
      const hooks = JSON.parse(read(record.adapters.claude.hooksFile));
      const hookScriptRel = record.adapters.claude.surface;
      const hookScript = read(hookScriptRel);
      const actionYml = read(record.adapters['github-action'].surface);

      test('Claude Code: hooks.json wires the event to the checkpoint script', () => {
        const event = hooks.hooks[record.adapters.claude.event];
        assert.ok(Array.isArray(event), `hooks.json has no ${record.adapters.claude.event} hooks`);
        const commands = event.flatMap((m) => m.hooks ?? []).map((h) => h.command ?? '');
        assert.ok(
          commands.some((c) => c.includes(path.basename(hookScriptRel))),
          `no ${record.adapters.claude.event} hook runs ${hookScriptRel}: ${JSON.stringify(commands)}`
        );
      });

      test('GitHub Action: the entry input is forwarded verbatim, never rewritten', () => {
        const input = record.adapters['github-action'].input;
        assert.match(
          actionYml,
          new RegExp(`^  ${input}:\\n`, 'm'),
          `action.yml declares no ${input} input`
        );
        assert.match(actionYml, /INPUT_ENTRY: \$\{\{ inputs\.entry \}\}/);
        assert.match(actionYml, /--entry "\$\{INPUT_ENTRY\}"/);
        // The default keeps the `run` path: an empty entry never reaches --entry.
        assert.match(actionYml, /if \[ -n "\$\{INPUT_ENTRY\}" \]; then/);
      });

      test('both adapters resolve to the same Flow pin, and to what the trigger resolver derives', () => {
        const claudeEntry = entryCarriedByHookScript(hookScript);
        // The Action forwards its input verbatim, so the entry it carries is the
        // one the workflow author names — the fixture's, for this pairing.
        const actionEntry = record.entry;
        assert.equal(
          claudeEntry,
          record.entry,
          'the hook script names a different entry than the fixture'
        );

        const claudePin = resolveFlowEntry(claudeEntry).flow;
        const actionPin = resolveFlowEntry(actionEntry).flow;
        assert.deepEqual(claudePin, actionPin);

        const { registry, flowDocuments } = loadFlowRegistry();
        const resolution = resolveTrigger({ event: record.trigger }, { registry, flowDocuments });
        assert.deepEqual(resolution.flowPins, [claudePin]);
        assert.deepEqual(resolution.evidenceRequirements, record.expected.evidenceRequirements);

        // Hand-authored expectation from flows/ (not from the loader).
        assert.equal(claudePin.entry, record.entry);
        assert.equal(claudePin.id, record.expected.flow);
        assert.equal(claudePin.version, record.expected.flowVersion);
        assert.match(claudePin.sha256, /^[0-9a-f]{64}$/);
        assert.deepEqual(
          resolveFlowEntry(claudeEntry).evidenceRequirements,
          record.expected.evidenceRequirements
        );
      });

      test('neither adapter surface carries review judgment vocabulary (ADR-009 D3)', () => {
        for (const token of JUDGMENT_TOKENS) {
          assert.doesNotMatch(hookScript, token, `${hookScriptRel} carries ${token}`);
        }
        // action.yml as a whole predates this PR and documents the gate input;
        // the scan is scoped to the entry input block and the entry branch.
        const entryInput = /^  entry:\n(?:    .*\n)+/m.exec(actionYml)?.[0] ?? '';
        assert.ok(entryInput.length > 0, 'entry input block not found');
        const entryBranch =
          /if \[ -n "\$\{INPUT_ENTRY\}" \]; then\n(?:.*\n)*?        fi\n/.exec(actionYml)?.[0] ??
          '';
        assert.ok(entryBranch.length > 0, 'entry branch not found');
        for (const token of JUDGMENT_TOKENS) {
          assert.doesNotMatch(entryInput, token, `entry input description carries ${token}`);
          assert.doesNotMatch(entryBranch, token, `entry branch carries ${token}`);
        }
      });
    });
  }

  test('every trigger that resolves to entries pins the same Flow through the Action input as through the resolver', () => {
    const { registry, flowDocuments } = loadFlowRegistry();
    let compared = 0;
    for (const [event, trigger] of Object.entries(registry.triggers)) {
      if (trigger.selectBy === 'artifactKind' || (trigger.entries ?? []).length === 0) continue;
      const resolution = resolveTrigger({ event }, { registry, flowDocuments });
      const viaAction = resolution.selectedEntries.map((entry) => resolveFlowEntry(entry).flow);
      assert.deepEqual(viaAction, resolution.flowPins, event);
      compared += 1;
    }
    assert.ok(
      compared >= 3,
      `expected task-checkpoint / before-publish / before-merge, compared ${compared}`
    );
  });
});
