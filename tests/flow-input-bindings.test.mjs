import assert from 'node:assert/strict';
import test, { describe } from 'node:test';

import {
  DEFAULT_FLOW_INPUT_BINDINGS,
  ENTRY_FLOW_INPUT_BINDING_OVERRIDES,
  resolveFlowInputBindings,
} from '../src/lib/flow-input-bindings.mjs';

const document = {
  inputs: [{ name: 'requirements' }, { name: 'tasks' }, { name: 'tests' }, { name: 'plan' }],
};

const resolution = (id, source = 'cwd') => ({
  id,
  path: `/repo/${id}`,
  source,
  exists: true,
});

describe('Flow input bindings', () => {
  // Three supply routes compete for one Flow input name. Only the CLI-vs-default
  // pair was pinned, so a mutation that ignored every non-CLI direct hit stayed
  // green. Pin the full order: explicit CLI > same-named resolution from any
  // other source > role-wide default binding.
  test('supply order: explicit CLI beats a same-named resolution, which beats the default', () => {
    const cliWins = resolveFlowInputBindings({
      document,
      resolved: {
        tasks: resolution('tasks', 'cli'),
        todo: resolution('todo'),
      },
    });
    assert.equal(cliWins.inputs.tasks, '/repo/tasks');
    assert.equal(cliWins.inputSources.tasks.kind, 'explicit');

    // The mutation this pins: dropping non-CLI direct hits would fall through to
    // `todo` here, silently changing which file the Flow reads.
    const directWins = resolveFlowInputBindings({
      document,
      resolved: {
        tasks: resolution('tasks', 'config'),
        todo: resolution('todo'),
      },
    });
    assert.equal(directWins.inputs.tasks, '/repo/tasks');
    assert.equal(directWins.inputSources.tasks.kind, 'direct');
    assert.equal(directWins.inputSources.tasks.source, 'config');

    const defaultWins = resolveFlowInputBindings({
      document,
      resolved: { todo: resolution('todo') },
    });
    assert.equal(defaultWins.inputs.tasks, '/repo/todo');
    assert.equal(defaultWins.inputSources.tasks.kind, 'default');
    assert.equal(defaultWins.inputSources.tasks.id, 'todo');
  });

  test('declares the role-wide defaults and no entry-specific exceptions yet', () => {
    assert.deepEqual(DEFAULT_FLOW_INPUT_BINDINGS, {
      requirements: ['pbi-input'],
      tasks: ['todo'],
      tests: ['junit', 'coverage', 'test-cases'],
    });
    assert.deepEqual(ENTRY_FLOW_INPUT_BINDING_OVERRIDES, {});
  });

  test('binds requirements and tasks to their Artifact Input Contract IDs', () => {
    const result = resolveFlowInputBindings({
      document,
      resolved: { 'pbi-input': resolution('pbi-input'), todo: resolution('todo') },
    });
    assert.deepEqual(result.inputs, { requirements: '/repo/pbi-input', tasks: '/repo/todo' });
    assert.deepEqual(result.inputSources, {
      requirements: { kind: 'default', id: 'pbi-input', source: 'cwd' },
      tasks: { kind: 'default', id: 'todo', source: 'cwd' },
    });
  });

  for (const id of ['junit', 'coverage', 'test-cases']) {
    test(`binds tests to ${id} when it is the only available test evidence`, () => {
      const result = resolveFlowInputBindings({ document, resolved: { [id]: resolution(id) } });
      assert.equal(result.inputs.tests, `/repo/${id}`);
      assert.deepEqual(result.inputSources.tests, { kind: 'default', id, source: 'cwd' });
    });
  }

  test('uses the first available tests candidate in declared order', () => {
    const result = resolveFlowInputBindings({
      document,
      resolved: {
        junit: resolution('junit'),
        coverage: resolution('coverage'),
        'test-cases': resolution('test-cases'),
      },
    });
    assert.equal(result.inputs.tests, '/repo/junit');
    assert.deepEqual(result.inputSources.tests, { kind: 'default', id: 'junit', source: 'cwd' });
  });

  test('an explicit same-named CLI artifact wins over the default binding', () => {
    const result = resolveFlowInputBindings({
      document,
      resolved: { tasks: resolution('tasks', 'cli'), todo: resolution('todo') },
    });
    assert.equal(result.inputs.tasks, '/repo/tasks');
    assert.deepEqual(result.inputSources.tasks, { kind: 'explicit', id: 'tasks', source: 'cli' });
  });

  test('does not bind undeclared roles or missing artifacts', () => {
    const result = resolveFlowInputBindings({
      document: { inputs: [{ name: 'design' }] },
      resolved: {
        todo: resolution('todo'),
        'pbi-input': { exists: false, path: '/repo/pbi-input' },
      },
    });
    assert.deepEqual(result, { inputs: {}, inputSources: {} });
  });
});
