# 🌊 River Reviewer Pull Request

Flow your changes from Upstream to Midstream to Downstream with clear validation.

## Overview

- What is changing and why? (1-2 lines)
- Primary phase focus: Upstream / Midstream / Downstream

## Flow Consistency

- [ ] Upstream: design/requirements updated and linked
- [ ] Midstream: implementation matches the intended flow
- [ ] Downstream: tests/QA steps cover the change
- [ ] Schema Validation passed? (`schemas/skill.schema.json`)
- [ ] Skill file structure validated? (`skills/*` follows schema and naming)

## Validation & Evidence

List commands and logs that prove the change is river-safe.

```bash
# e.g.
npm run agents:validate
npm test
```

## Related Issues

- Closes #
- Related #

## Reviewer Notes

Context, roll-out risks, or follow-up tasks for reviewers.
