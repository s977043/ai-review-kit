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

`phase` and `applyTo` can be specified at the top level or within a `trigger` object (`trigger.phase`, `trigger.applyTo` / `trigger.files`). If both are specified, the top-level properties take precedence.

## Example

```yaml
---
id: rr-python-sqlinj-v1-en
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
id: rr-python-sqlinj-v2-en
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
