---
# Required metadata (validate with schemas/skill.schema.json)
id: rr-<phase>-<short-name>
name: <Human readable title>
description: <What this skill checks>
phase: upstream # upstream | midstream | downstream
applyTo:
  - '**/*'
tags:
  - example
severity: minor # info | minor | major | critical
---

## Rule

Describe the rule clearly. For example, "Ensure that each module has a single responsibility".

## Rationale

Explain why the rule is important. Include references to design principles or quality standards as needed.

## Heuristics

Provide heuristics that help identify violations of the rule. These can be pattern‑based, keyword‑based or structural hints.

## Good / Bad Examples

Show concise examples of compliant and non‑compliant code or design elements to illustrate the rule.
