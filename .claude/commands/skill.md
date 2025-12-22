---
description: Load the best-matching skill doc from skills/ and apply it to the current task
argument-hint: '[keyword]'
allowed-tools: Bash(rg:*)
---

Find the best matching skill under `skills/` for: $ARGUMENTS

Steps:

1. Search `skills/` for the keyword using ripgrep.
2. Identify the most relevant `skills/**/skill.md`.
3. Summarize the workflow rules from that skill.
4. Apply those rules to the current task and proceed.
