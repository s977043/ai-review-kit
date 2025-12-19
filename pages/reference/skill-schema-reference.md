# Skill Schema Reference

All skills in River Reviewer must conform to JSON schema located at:

```text
/schemas/skill.schema.json
```

## Required fields

| Field       | Description                                          |
| ----------- | ---------------------------------------------------- |
| id          | Unique skill identifier (rr-xxxx format recommended) |
| name        | Human-readable skill name                            |
| description | What the skill checks                                |
| phase       | upstream / midstream / downstream                    |
| applyTo     | File glob patterns                                   |

`phase` と `applyTo` はトップレベルまたは `trigger` 内に書けます（`trigger.phase`, `trigger.applyTo` / `trigger.files`）。両方指定した場合はトップレベルが優先されます。

## Example

```yaml
---
id: rr-python-sqlinj-v1
name: Python SQL Injection Check
description: Detects SQL injection patterns in Python code
phase: midstream
applyTo:
  - '**/*.py'
tags: ['security', 'owasp']
---
# instructions...
```

### Example with trigger wrapper

```yaml
---
id: rr-python-sqlinj-v1
name: Python SQL Injection Check
description: Detects SQL injection patterns in Python code
trigger:
  phase: midstream
  files:
    - '**/*.py'
tags: ['security', 'owasp']
---
# instructions...
```
