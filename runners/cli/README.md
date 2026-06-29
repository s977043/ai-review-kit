# River Review CLI

Command-line interface for River Review, providing direct access to code review functionality from the terminal.

## Installation

The CLI is part of the River Review monorepo. To use it:

```bash
# From the repository root
npm install

# Make the CLI executable
chmod +x runners/cli/bin/river

# Link it globally (optional)
npm link runners/cli
```

## Usage

### Review Command

Review files in your current branch against the default branch.

```bash
# Review all changed files
river review

# Review specific files
river review src/app.ts src/utils.ts

# Review with file patterns
river review "src/**/*.ts"

# Review specific phase
river review --phase midstream

# Show execution plan without running
river review --dry-run

# Verbose output (show skipped skills)
river review --verbose
```

#### Review Options

- `-p, --phase <phase>` - Review phase: `upstream`, `midstream`, or `downstream` (default: `midstream`)
- `--model-hint <hint>` - Model preference: `cheap`, `balanced`, or `high-accuracy` (default: `balanced`)
- `--context <contexts>` - Available contexts (comma-separated): `diff`, `fullFile`, `tests`, `adr`, etc.
- `--dependency <dependencies>` - Available dependencies (comma-separated)
- `--dry-run` - Show execution plan without running review
- `-v, --verbose` - Show detailed output including skipped skills
- `-q, --quiet` - Suppress non-essential output
- `--debug` - Show debug information

### Eval Command

Evaluate and validate skill definitions.

```bash
# Evaluate a specific skill
river eval skills/midstream/security-basic/SKILL.md

# Evaluate all skills
river eval --all

# Verbose output with full details
river eval --all --verbose
```

#### Eval Options

- `-a, --all` - Evaluate all skills in the skills directory
- `-v, --verbose` - Show detailed skill information including body preview
- `-q, --quiet` - Suppress non-essential output
- `--debug` - Show debug information

### Create Skill Command

Create a new skill from the template.

```bash
# Interactive mode (recommended)
river create skill --interactive

# Non-interactive with skill name
river create skill security-review

# With additional options
river create skill security-review \
  --phase midstream \
  --apply-to "src/**/*.ts,tests/**/*.test.ts" \
  --tags "security,authentication" \
  --severity major
```

#### Create Skill Options

- `-i, --interactive` - Interactive mode with prompts
- `--version <version>` - Skill version in semver format (default: `0.1.0`)
- `--phase <phase>` - Review phase (default: `midstream`)
- `--apply-to <patterns>` - File patterns as glob (default: `src/**/*.ts`)
- `--tags <tags>` - Tags, comma-separated
- `--severity <severity>` - Severity level: `info`, `minor`, `major`, or `critical` (default: `minor`)
- `-q, --quiet` - Suppress non-essential output
- `--debug` - Show debug information

## Examples

### Example 1: Review TypeScript files in midstream phase

```bash
river review "src/**/*.ts" --phase midstream --verbose
```

Output:

```text
✓ Loaded 45 skills

Reviewing 12 file(s) in midstream phase

✓ Execution plan ready

Selected skills (5):
  security-basic, code-quality, ...

Impact tags: security, api

✓ Review plan ready. Use --dry-run to see the plan without executing.
```

### Example 2: Evaluate all skills

```bash
river eval --all
```

Output:

```text
✓ Loaded 45 skills

Skill Evaluation Summary:

✓ security-basic
  Name: Basic Security Review
  Phase: midstream
  Apply to: src/**/*.ts, tests/**/*.test.ts

✓ code-quality
  Name: Code Quality Review
  Phase: midstream
  Apply to: src/**/*.{ts,js}

...

✓ Successfully evaluated 45 skills
```

### Example 3: Create a new skill interactively

```bash
river create skill --interactive
```

Output:

```text
Creating new skill

? Skill ID (e.g., code-quality): auth-review
? Version: 0.1.0
? Skill name: Authentication Review
? Description: Review authentication and authorization patterns
? Phase: midstream
? File patterns (comma-separated globs): src/auth/**/*.ts,src/middleware/auth.ts
? Tags (comma-separated): security,authentication
? Severity: major
? Create skill at /path/to/skills/auth-review? Yes

✓ Skill created successfully

✓ Skill created at: /path/to/skills/auth-review

Next steps:
  1. cd /path/to/skills/auth-review
  2. Edit prompt/system.md and prompt/user.md
  3. Add test fixtures to fixtures/
  4. Add expected output to golden/
  5. Validate: npm run validate:skill-yaml
  6. Test: npx promptfoo eval (if configured)
```

## Exit Codes

すべてのコマンド（`review`・`eval`・`create skill`）は以下の終了コードを返す。

| コード | 意味                           |
| ------ | ------------------------------ |
| `0`    | 正常終了                       |
| `1`    | エラーまたはバリデーション失敗 |

シェルスクリプトや CI ジョブでの利用例:

```bash
river eval --all || echo "Skill validation failed"
```

## 構造化出力（スクリプト連携）

`--output` フラグは現時点では実装されていません。
JSON などの構造化出力をプログラムから取得する場合は、CLI ではなく Node API（`runners/core/`）を直接使用してください。

## Architecture

The CLI is built on top of the core runner components:

- `runners/core/skill-loader.mjs` - Skill loading and validation
- `runners/core/review-runner.mjs` - Execution planning and skill selection

### Directory Structure

```text
runners/cli/
├── bin/
│   └── river              # Executable entry point
├── src/
│   ├── index.mjs          # CLI setup with Commander.js
│   ├── commands/          # Command implementations
│   │   ├── review.mjs     # Review command
│   │   ├── eval.mjs       # Eval command
│   │   └── create.mjs     # Create skill command
│   └── utils/             # Shared utilities
│       ├── logger.mjs     # Logging with ora spinners
│       └── format.mjs     # Output formatting
├── package.json
└── README.md              # This file
```

## Dependencies

- `commander` - CLI framework for command parsing and help
- `ora` - Elegant terminal spinners
- `@inquirer/prompts` - Interactive prompts for create command

## Related Documentation

- [Core Runner](../core/README.md) - Skill loading and execution planning
- [Skills Directory](../../skills/) - Skill definitions
- [Skill Schema](../../schemas/skill.schema.json) - Skill metadata schema
- [Project README](../../README.md) - Main documentation
- [Runner CLI Reference](../../pages/reference/runner-cli-reference.md) - Exit codes and `--reviewers` flag reference

## Integration with Existing CLI

The existing `src/cli.mjs` provides the `river run` and `river doctor` commands. This new CLI runner provides:

- `river review` - Simplified review interface using core runner
- `river eval` - Skill validation and inspection
- `river create skill` - Skill scaffolding

Both CLIs can coexist, with the new CLI focusing on core runner functionality and the existing CLI providing integration with the full review engine and GitHub Actions features.
