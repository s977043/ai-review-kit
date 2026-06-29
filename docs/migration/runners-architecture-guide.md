# Runners Architecture Guide

This guide provides a comprehensive overview of the new runners architecture introduced in River Review v0.2.0, explaining the architectural decisions, component relationships, and how to work with each runner.

## Overview

### What is the Runners Architecture?

The runners architecture is a modular system that separates **skill execution** from **execution environments**. This design follows the core principle: **"Skills are the main feature."** Runners are simply interfaces that execute these skills in different contexts.

```text
+-----------------+     +-----------------+     +-----------------+
|   GitHub Action |     |      CLI        |     |    Node API     |
|   Runner        |     |    Runner       |     |    Runner       |
+-----------------+     +-----------------+     +-----------------+
         |                      |                       |
         +----------------------+-----------------------+
                               |
                    +--------------------+
                    |    Core Runner     |
                    | (skill-loader.mjs) |
                    | (review-runner.mjs)|
                    +--------------------+
                               |
                    +--------------------+
                    |      Skills        |
                    |   Registry (/)     |
                    +--------------------+
```

### Why This Architecture?

**Before (v0.1.x):**

- Single monolithic CLI (`src/cli.mjs`) handling all execution contexts
- GitHub Action embedded in `.github/actions/river-review/`
- Core logic mixed with CLI argument parsing
- No programmatic API for Node.js applications

**After (v0.2.0+):**

- Clear separation between core logic and execution interfaces
- Each runner is a focused, maintainable module
- Skills remain portable across all execution contexts
- New capabilities: dedicated CLI commands, Node.js API

### Benefits

1. **Maintainability**: Each runner can evolve independently
2. **Testability**: Core logic is isolated and easily testable
3. **Extensibility**: New runners can be added without touching core code
4. **Portability**: Skills work identically across all runners
5. **Developer Experience**: Choose the right interface for your needs

## Architecture Comparison

### Directory Structure

**Old Structure (v0.1.x):**

```text
.
├── .github/
│   └── actions/
│       └── river-review/    # GitHub Action (tightly coupled)
│           ├── action.yml
│           └── post-comment.cjs
├── src/
│   ├── cli.mjs                # Monolithic CLI (all logic here)
│   ├── lib/
│   │   ├── skill-loader.mjs   # Skill loading (mixed with CLI concerns)
│   │   └── review-runner.mjs  # Review execution
│   └── core/
│       └── ...
└── skills/                    # Skill definitions
```

**New Structure (v0.2.0+):**

```text
.
├── runners/
│   ├── core/                  # Shared execution logic
│   │   ├── skill-loader.mjs   # Skill loading and validation
│   │   ├── review-runner.mjs  # Execution planning and skill selection
│   │   ├── package.json
│   │   └── README.md
│   ├── cli/                   # Command-line interface
│   │   ├── bin/river          # Executable entry point
│   │   ├── src/
│   │   │   ├── index.mjs      # CLI setup (Commander.js)
│   │   │   ├── commands/      # Command implementations
│   │   │   │   ├── review.mjs
│   │   │   │   ├── eval.mjs
│   │   │   │   └── create.mjs
│   │   │   └── utils/
│   │   ├── package.json
│   │   └── README.md
│   ├── github-action/         # GitHub Actions runner
│   │   ├── action.yml
│   │   ├── post-comment.cjs
│   │   └── README.md
│   └── node-api/              # Programmatic Node.js API
│       ├── src/
│       │   ├── index.ts
│       │   └── types.ts
│       ├── dist/              # Compiled output
│       ├── package.json
│       └── README.md
├── src/
│   ├── cli.mjs                # Legacy CLI (still functional)
│   ├── lib/                   # Supporting utilities
│   └── core/
└── skills/                    # Skill definitions (unchanged)
```

### Entry Point Mapping

| Use Case           | Old (v0.1.x)                   | New (v0.2.0+)                    | Notes                                    |
| ------------------ | ------------------------------ | -------------------------------- | ---------------------------------------- |
| CLI local review   | `src/cli.mjs run`              | `runners/cli/` (`river review`)  | New commands: `review`, `eval`, `create` |
| GitHub Action      | `.github/actions/river-review` | `runners/github-action/`         | Path changed in workflow files           |
| Skill loading      | `src/lib/skill-loader.mjs`     | `runners/core/skill-loader.mjs`  | Centralized in core                      |
| Execution planning | `src/lib/review-runner.mjs`    | `runners/core/review-runner.mjs` | Centralized in core                      |
| Programmatic API   | (none)                         | `runners/node-api/`              | New in v0.2.0                            |

## Core Runner

The core runner (`runners/core/`) provides the foundational skill loading and execution planning that all other runners depend on.

### skill-loader.mjs

Handles loading, parsing, and validating skill definitions.

**Key Exports:**

```javascript
import {
  loadSkills, // Load all skills from directory
  loadSkillFile, // Load a single skill file
  loadSchema, // Load JSON schema for validation
  createSkillValidator, // Create Ajv validator
  parseFrontMatter, // Parse YAML front matter from markdown
  SkillLoaderError, // Custom error class
  defaultPaths, // Default paths (repoRoot, skillsDir, schemaPath)
} from './runners/core/skill-loader.mjs';
```

**Example Usage:**

```javascript
import { loadSkills } from './runners/core/skill-loader.mjs';

// Load all skills with defaults
const skills = await loadSkills();

// Load from custom directory
const customSkills = await loadSkills({
  skillsDir: '/path/to/skills',
  schemaPath: '/path/to/schema.json',
});

console.log(`Loaded ${skills.length} skills`);
```

### review-runner.mjs

Handles skill selection, file routing, and execution plan building.

**Key Exports:**

```javascript
import {
  buildExecutionPlan, // Build optimized execution plan
  selectSkills, // Select skills matching criteria
  matchesPhase, // Check phase match
  rankByModelHint, // Rank by model preference
  summarizeSkill, // Create skill summary
} from './runners/core/review-runner.mjs';
```

**Example Usage:**

```javascript
import { buildExecutionPlan } from './runners/core/review-runner.mjs';

const plan = await buildExecutionPlan({
  phase: 'midstream',
  changedFiles: ['src/app.ts', 'src/utils.ts'],
  availableContexts: ['diff', 'fullFile'],
  preferredModelHint: 'balanced',
});

console.log(`Selected ${plan.selected.length} skills`);
console.log(`Skipped ${plan.skipped.length} skills`);
console.log(`Impact tags: ${plan.impactTags?.join(', ')}`);
```

### Skill Selection Logic

Skills are selected based on multiple criteria:

1. **Phase Match**: Skill's `phase` field must match the requested review phase
2. **File Pattern Match**: At least one changed file must match the skill's `applyTo` glob patterns
3. **Input Context**: Required `inputContext` values must be available
4. **Dependencies**: Required `dependencies` must be available

```javascript
// Example: How skill selection works internally
function evaluateSkill(skill, options) {
  const reasons = [];

  // Check phase match
  if (!matchesPhase(skill, options.phase)) {
    reasons.push(`phase mismatch: ${skill.phase} !== ${options.phase}`);
  }

  // Check file pattern match
  if (!matchesApplyTo(skill, options.changedFiles)) {
    reasons.push('applyTo did not match any changed file');
  }

  // Check input context availability
  const missingContexts = getMissingInputContexts(skill, options.availableContexts);
  if (missingContexts.length) {
    reasons.push(`missing inputContext: ${missingContexts.join(', ')}`);
  }

  return { ok: reasons.length === 0, reasons };
}
```

## CLI Runner

The CLI runner (`runners/cli/`) provides a modern command-line interface for River Review.

### Available Commands

#### `river review`

Review files in your current branch:

```bash
# Review all changed files
river review

# Review specific files
river review src/app.ts src/utils.ts

# Review with file patterns
river review "src/**/*.ts"

# Review specific phase
river review --phase midstream

# Show execution plan only (dry run)
river review --dry-run

# Verbose output
river review --verbose
```

**Options:**

| Option                 | Description                                            | Default     |
| ---------------------- | ------------------------------------------------------ | ----------- |
| `-p, --phase <phase>`  | Review phase: `upstream`, `midstream`, `downstream`    | `midstream` |
| `--model-hint <hint>`  | Model preference: `cheap`, `balanced`, `high-accuracy` | `balanced`  |
| `--context <contexts>` | Available contexts (comma-separated)                   | -           |
| `--dependency <deps>`  | Available dependencies (comma-separated)               | -           |
| `--dry-run`            | Show plan without executing                            | `false`     |
| `-v, --verbose`        | Show detailed output                                   | `false`     |
| `-q, --quiet`          | Suppress non-essential output                          | `false`     |
| `--debug`              | Show debug information                                 | `false`     |

#### `river eval`

Evaluate and validate skill definitions:

```bash
# Evaluate a specific skill
river eval skills/security-basic/skill.yaml

# Evaluate all skills
river eval --all

# Verbose output
river eval --all --verbose
```

#### `river create skill`

Create a new skill from template:

```bash
# Interactive mode (recommended)
river create skill --interactive

# Non-interactive
river create skill security \
  --phase midstream \
  --apply-to "src/**/*.ts" \
  --tags "security,authentication"
```

### Legacy CLI Compatibility

The existing `src/cli.mjs` continues to work with its original commands:

| Command               | Description                 |
| --------------------- | --------------------------- |
| `river run <path>`    | Run review against git repo |
| `river doctor <path>` | Check setup and print hints |
| `river skills <path>` | Run skill-based review      |
| `river eval`          | Run fixture evaluation      |

Both CLIs can coexist. The new CLI focuses on the core runner functionality, while the legacy CLI provides integration with the full review engine.

## GitHub Action Runner

The GitHub Action runner (`runners/github-action/`) provides CI/CD integration.

### Basic Usage

```yaml
name: River Review

on:
  pull_request:
    branches: [main]

jobs:
  review:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: write
    steps:
      - uses: actions/checkout@v6
        with:
          fetch-depth: 0
      - uses: s977043/river-review/runners/github-action@v0.2.0
        with:
          phase: midstream
          dry_run: false
        env:
          OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
```

### Inputs

| Input          | Description                                          | Default     |
| -------------- | ---------------------------------------------------- | ----------- |
| `phase`        | Review phase (`upstream`, `midstream`, `downstream`) | `midstream` |
| `planner`      | Planner mode (`off`, `order`, `prune`)               | `off`       |
| `target`       | Path to git repository                               | `.`         |
| `comment`      | Post PR comment with results                         | `true`      |
| `dry_run`      | Run without external API calls                       | `true`      |
| `debug`        | Print debug information                              | `false`     |
| `estimate`     | Estimate cost only                                   | `false`     |
| `max_cost`     | Abort if cost exceeds value (USD)                    | -           |
| `node_version` | Node.js version                                      | `22`        |

### Multi-Phase Review

```yaml
jobs:
  upstream:
    if: contains(github.event.pull_request.changed_files, 'docs/')
    steps:
      - uses: actions/checkout@v6
        with:
          fetch-depth: 0
      - uses: s977043/river-review/runners/github-action@v0.2.0
        with:
          phase: upstream
        env:
          OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}

  midstream:
    steps:
      - uses: actions/checkout@v6
        with:
          fetch-depth: 0
      - uses: s977043/river-review/runners/github-action@v0.2.0
        with:
          phase: midstream
        env:
          OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
```

## Node API Runner

The Node API runner (`runners/node-api/`) provides a programmatic TypeScript/JavaScript interface.

### Installation

```bash
npm install @river-review/node-api
```

### Quick Start

```typescript
import { review, loadSkills, buildExecutionPlan } from '@river-review/node-api';

// Build execution plan
const result = await review({
  phase: 'midstream',
  files: ['src/**/*.ts'],
  availableContexts: ['diff', 'fullFile'],
});

console.log(`Skills selected: ${result.summary.skillsExecuted}`);
```

### Key Functions

#### `loadSkills(options?)`

```typescript
// Load all skills
const allSkills = await loadSkills();

// Load for specific phase
const midstreamSkills = await loadSkills({ phase: 'midstream' });

// Load from custom directory
const customSkills = await loadSkills({
  skillsDir: '/path/to/skills',
});
```

#### `selectSkills(skills, options)`

```typescript
const skills = await loadSkills();
const selection = selectSkills(skills, {
  phase: 'midstream',
  changedFiles: ['src/app.ts'],
  availableContexts: ['diff', 'fullFile'],
});

console.log(`Selected: ${selection.selected.length}`);
console.log(`Skipped: ${selection.skipped.length}`);
```

#### `buildExecutionPlan(options)`

```typescript
const plan = await buildExecutionPlan({
  phase: 'midstream',
  changedFiles: ['src/security.ts'],
  availableContexts: ['diff', 'fullFile'],
  preferredModelHint: 'balanced',
  diffText: gitDiffOutput, // string containing the git diff output
});

// Execute in priority order
for (const skill of plan.selected) {
  console.log(`Execute: ${skill.metadata.id}`);
  // Custom AI provider integration here
}
```

### Type Definitions

```typescript
type Phase = 'upstream' | 'midstream' | 'downstream';
type Severity = 'info' | 'minor' | 'major' | 'critical';
type InputContext = 'diff' | 'fullFile' | 'tests' | 'adr' | 'commitMessage' | 'repoConfig';
type ModelHint = 'cheap' | 'balanced' | 'high-accuracy';
```

See `runners/node-api/src/types.ts` for complete type definitions.

## Breaking Changes

### GitHub Action Path

**Before (v0.1.x):**

```yaml
uses: s977043/river-review/.github/actions/river-review@v0.1.1
```

**After (v0.2.0+):**

```yaml
uses: s977043/river-review/runners/github-action@v0.2.0
```

### Core Module Imports

**Before:**

```javascript
import { loadSkills } from './src/lib/skill-loader.mjs';
import { buildExecutionPlan } from './src/lib/review-runner.mjs';
```

**After:**

```javascript
import { loadSkills } from './runners/core/skill-loader.mjs';
import { buildExecutionPlan } from './runners/core/review-runner.mjs';
```

### CLI Command Changes

The new CLI adds commands that complement the legacy CLI:

| Legacy CLI              | New CLI                | Notes                 |
| ----------------------- | ---------------------- | --------------------- |
| `river run <path>`      | `river review [files]` | Simplified interface  |
| `river doctor <path>`   | -                      | Still in legacy CLI   |
| `river eval` (fixtures) | `river eval [skill]`   | Skill evaluation      |
| -                       | `river create skill`   | New skill scaffolding |

## Upgrade Steps

### For GitHub Actions Users

1. **Update workflow files:**

   ```yaml
   # Find and replace in .github/workflows/*.yml
   # Old: s977043/river-review/.github/actions/river-review@v0.1.x
   # New: s977043/river-review/runners/github-action@v0.2.0
   ```

2. **Test the migration:**

   ```bash
   # Create a test PR and verify the action runs correctly
   ```

### For Local Development

1. **Update import paths:**

   ```javascript
   // Before
   import { loadSkills } from '../src/lib/skill-loader.mjs';

   // After
   import { loadSkills } from '../runners/core/skill-loader.mjs';
   ```

2. **Run tests:**

   ```bash
   npm test
   ```

### For Custom Integrations

1. **Install the Node API:**

   ```bash
   npm install @river-review/node-api
   ```

2. **Update imports:**

   ```typescript
   import { loadSkills, buildExecutionPlan } from '@river-review/node-api';
   ```

## Troubleshooting

### GitHub Action: "file not found" Error

Ensure `fetch-depth: 0` in checkout:

```yaml
- uses: actions/checkout@v6
  with:
    fetch-depth: 0
```

### Import Errors After Migration

Verify all import paths are updated:

```bash
# Find old import paths
grep -r "src/lib/skill-loader" .
grep -r "src/lib/review-runner" .
```

### CLI Command Not Found

Ensure the CLI is properly linked:

```bash
# From repository root
chmod +x runners/cli/bin/river
npm link runners/cli
```

### Skills Not Loading

Check the skills directory path:

```javascript
import { defaultPaths } from './runners/core/skill-loader.mjs';
console.log('Skills dir:', defaultPaths.skillsDir);
```

### Execution Plan Empty

Verify phase and file patterns match:

```javascript
const plan = await buildExecutionPlan({
  phase: 'midstream',
  changedFiles: ['src/app.ts'], // Must match skill's applyTo patterns
  availableContexts: ['diff'], // Must include skill's required contexts
});

// Check skipped reasons
plan.skipped.forEach(({ skill, reasons }) => {
  console.log(`Skipped ${skill.metadata.id}: ${reasons.join(', ')}`);
});
```

## Related Documentation

- [CHANGELOG](../../CHANGELOG.md) - Version history and breaking changes
- [Deprecated Paths](../deprecated.md) - Full deprecation notice
- [Architecture Overview](../architecture.md) - System architecture
- [Skills Concepts](../../pages/explanation/skills.en.md) - Understanding skills
- [Core Runner README](../../runners/core/README.md) - Core module details
- [CLI Runner README](../../runners/cli/README.md) - CLI documentation
- [GitHub Action README](../../runners/github-action/README.md) - Action documentation
- [Node API README](../../runners/node-api/README.md) - API documentation

## Getting Help

1. **Check existing issues:** [GitHub Issues](https://github.com/s977043/river-review/issues)
2. **Search with labels:** `migration-help`, `runners`
3. **Create new issue:** Include workflow file, error logs, and versions
4. **Reference Epic #242:** [Runners Architecture Refactoring](https://github.com/s977043/river-review/issues/242)
