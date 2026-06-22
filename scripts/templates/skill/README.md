# Skill Template

This directory contains the template structure for creating new skills in the Skill Registry format.

## Structure

```text
<skill-name>/
├── skill.yaml              # Skill metadata and configuration
├── prompt/                 # Prompt files (optional)
│   ├── system.md          # System prompt
│   └── user.md            # User prompt
├── fixtures/              # Test input data (optional)
├── golden/                # Expected outputs (optional)
├── eval/                  # Evaluation configuration (optional)
│   └── promptfoo.yaml    # promptfoo config
└── README.md              # Usage documentation
```

## Usage

1. **Copy this template** to create a new skill:

   ```bash
   cp -r specs/templates/skill skills/<phase>/<skill-name>
   ```

2. **Edit `skill.yaml`**:
   - Update required fields: `id`, `version`, `name`, `description`
   - Set trigger conditions: `phase`, `applyTo`
   - Configure optional fields as needed

3. **Create prompt files** (if using separate files):
   - `prompt/system.md`: Define the reviewer role and rules
   - `prompt/user.md`: Define the input format and expected output

4. **Add test fixtures** (optional but recommended):
   - Create sample inputs in `fixtures/`
   - Create expected outputs in `golden/`
   - Configure evaluation in `eval/promptfoo.yaml`

5. **Validate** the skill:

   ```bash
   npm run skills:validate
   ```

6. **Test** with promptfoo (if configured):

   ```bash
   cd skills/<phase>/<skill-name>
   npx promptfoo eval
   ```

## Migration from YAML Frontmatter Format

If you have an existing skill in YAML frontmatter format (`.md` file):

1. Extract the YAML frontmatter to `skill.yaml`
2. Add `version: "0.1.0"` field
3. Move the Markdown content to the `prompt/` directory (e.g., `prompt/system.md`), splitting it if necessary
4. Update file references in the skill registry

See [specs/skill-yaml-spec.md](../../skill-yaml-spec.md) for the full specification.

## References

- [Skill YAML Specification](../../skill-yaml-spec.md)
- [promptfoo Documentation](https://www.promptfoo.dev/)
