---
description: Review current working tree changes (diff) and suggest fixes
allowed-tools: Bash(git status:*), Bash(git diff:*), Bash(git log:*)
---

## Context

- Status: `git status`
- Diff: `git diff`
- Recent commits: `git log --oneline -10`

## Task

Review the diff for:

- correctness and edge cases
- security issues
- performance
- style consistency

Provide actionable comments and propose minimal patches.
