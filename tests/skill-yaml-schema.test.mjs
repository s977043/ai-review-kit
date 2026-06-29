import { test } from 'node:test';
import assert from 'node:assert';
import { SkillYamlSchema } from '../src/lib/skillYamlSchema.mjs';

test('validates a minimal valid skill.yaml', () => {
  const validSkill = {
    id: 'test',
    version: '0.1.0',
    name: 'Test Skill',
    description: 'A test skill for validation',
    category: 'midstream',
    phase: 'midstream',
    applyTo: ['src/**/*.ts'],
  };

  const result = SkillYamlSchema.safeParse(validSkill);
  assert.ok(result.success, 'Should validate minimal valid skill');
  // Only outputKind has default value per spec
  assert.deepStrictEqual(result.data.outputKind, ['findings'], 'Should apply default outputKind');
});

test('validates a full-featured skill.yaml', () => {
  const fullSkill = {
    id: 'adr-quality',
    version: '1.2.3',
    name: 'ADR Decision Quality',
    description: 'Ensure ADRs capture context, decision, alternatives, and tradeoffs',
    category: 'upstream',
    phase: 'upstream',
    applyTo: ['docs/adr/**/*', 'adr/**/*'],
    tags: ['architecture', 'adr', 'decision'],
    severity: 'major',
    inputContext: ['diff', 'adr'],
    outputKind: ['summary', 'findings', 'actions', 'questions'],
    modelHint: 'balanced',
    dependencies: ['adr_lookup', 'repo_metadata'],
    prompt: {
      system: 'prompt/system.md',
      user: 'prompt/user.md',
    },
    eval: {
      promptfoo: 'eval/promptfoo.yaml',
    },
    fixturesDir: 'fixtures',
    goldenDir: 'golden',
  };

  const result = SkillYamlSchema.safeParse(fullSkill);
  assert.ok(result.success, 'Should validate full-featured skill');
});

test('validates skill with phase array', () => {
  const skillWithPhaseArray = {
    id: 'phase',
    version: '0.1.0',
    name: 'Multi-Phase Skill',
    description: 'A skill that applies to multiple phases',
    category: 'core',
    phase: ['midstream', 'downstream'],
    applyTo: ['src/**/*.ts'],
  };

  const result = SkillYamlSchema.safeParse(skillWithPhaseArray);
  assert.ok(result.success, 'Should validate skill with phase array');
});

test('validates skill with trigger object', () => {
  const skillWithTrigger = {
    id: 'test',
    version: '0.1.0',
    name: 'Trigger Test Skill',
    description: 'A skill using trigger object',
    category: 'core',
    trigger: {
      phase: ['upstream', 'midstream'],
      files: ['docs/adr/**/*'],
    },
  };

  const result = SkillYamlSchema.safeParse(skillWithTrigger);
  assert.ok(result.success, 'Should validate skill with trigger object');
});

test('validates skill with custom dependency', () => {
  const skillWithCustomDep = {
    id: 'dep',
    version: '0.1.0',
    name: 'Custom Dependency Skill',
    description: 'A skill with custom dependency',
    category: 'midstream',
    phase: 'midstream',
    applyTo: ['src/**/*.ts'],
    dependencies: ['adr_lookup', 'custom:my_tool'],
  };

  const result = SkillYamlSchema.safeParse(skillWithCustomDep);
  assert.ok(result.success, 'Should validate skill with custom dependency');
});

test('rejects skill without required fields', () => {
  const invalidSkill = {
    name: 'Invalid Skill',
    // missing id, version, description, trigger conditions
  };

  const result = SkillYamlSchema.safeParse(invalidSkill);
  assert.ok(!result.success, 'Should reject skill without required fields');
});

test('rejects skill with invalid version format', () => {
  const invalidSkill = {
    id: 'version',
    version: '1.0', // missing patch version
    name: 'Invalid Version Skill',
    description: 'A skill with invalid version',
    category: 'midstream',
    phase: 'midstream',
    applyTo: ['src/**/*.ts'],
  };

  const result = SkillYamlSchema.safeParse(invalidSkill);
  assert.ok(!result.success, 'Should reject skill with invalid version format');
});

test('rejects skill with neither top-level nor trigger conditions', () => {
  const invalidSkill = {
    id: 'trigger',
    version: '0.1.0',
    name: 'No Trigger Skill',
    description: 'A skill without trigger conditions',
    // missing phase/applyTo or trigger
  };

  const result = SkillYamlSchema.safeParse(invalidSkill);
  assert.ok(!result.success, 'Should reject skill without trigger conditions');
});

test('rejects skill with invalid phase value', () => {
  const invalidSkill = {
    id: 'phase',
    version: '0.1.0',
    name: 'Invalid Phase Skill',
    description: 'A skill with invalid phase',
    category: 'midstream',
    phase: 'invalid-phase',
    applyTo: ['src/**/*.ts'],
  };

  const result = SkillYamlSchema.safeParse(invalidSkill);
  assert.ok(!result.success, 'Should reject skill with invalid phase value');
});

test('rejects skill with invalid severity value', () => {
  const invalidSkill = {
    id: 'severity',
    version: '0.1.0',
    name: 'Invalid Severity Skill',
    description: 'A skill with invalid severity',
    category: 'midstream',
    phase: 'midstream',
    applyTo: ['src/**/*.ts'],
    severity: 'high', // should be info/minor/major/critical
  };

  const result = SkillYamlSchema.safeParse(invalidSkill);
  assert.ok(!result.success, 'Should reject skill with invalid severity value');
});

test('rejects skill with invalid modelHint value', () => {
  const invalidSkill = {
    id: 'model',
    version: '0.1.0',
    name: 'Invalid Model Skill',
    description: 'A skill with invalid modelHint',
    category: 'midstream',
    phase: 'midstream',
    applyTo: ['src/**/*.ts'],
    modelHint: 'fast', // should be cheap/balanced/high-accuracy
  };

  const result = SkillYamlSchema.safeParse(invalidSkill);
  assert.ok(!result.success, 'Should reject skill with invalid modelHint value');
});

test('rejects skill with invalid dependency', () => {
  const invalidSkill = {
    id: 'dep',
    version: '0.1.0',
    name: 'Invalid Dependency Skill',
    description: 'A skill with invalid dependency',
    category: 'midstream',
    phase: 'midstream',
    applyTo: ['src/**/*.ts'],
    dependencies: ['invalid_dep'], // not in allowed list and doesn't start with "custom:"
  };

  const result = SkillYamlSchema.safeParse(invalidSkill);
  assert.ok(!result.success, 'Should reject skill with invalid dependency');
});

test('rejects skill with empty custom dependency', () => {
  const invalidSkill = {
    id: 'custom-dep',
    version: '0.1.0',
    name: 'Empty Custom Dependency Skill',
    description: 'A skill with empty custom dependency',
    category: 'midstream',
    phase: 'midstream',
    applyTo: ['src/**/*.ts'],
    dependencies: ['custom:'], // empty custom dependency name
  };

  const result = SkillYamlSchema.safeParse(invalidSkill);
  assert.ok(!result.success, 'Should reject skill with empty custom dependency name');
});
