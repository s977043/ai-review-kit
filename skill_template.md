---
# Required Metadata
id: <phase>.<short_name>
title: <Human readable title>
version: 0.1.0
severity: minor # critical | major | minor | notice
phase:
  - design # design | implementation | test | improve
category: architecture # e.g. architecture | security | performance | reliability
tags:
  - example
  - refactoring
applyTo:
  - '**/*'
exclude:
  - '**/test/**'
events:
  - pull_request
expected_output:
  format: review_v1
  fields:
    - issue
    - rationale
    - impact
    - suggestion
    - priority
---

## Rule

Describe the rule clearly. For example, "Ensure that each module has a single responsibility".

## Rationale

Explain why the rule is important. Include references to design principles or quality standards as needed.

## Heuristics

Provide heuristics that help identify violations of the rule. These can be pattern‑based, keyword‑based or structural hints.

## Good / Bad Examples

Show concise examples of compliant and non‑compliant code or design elements to illustrate the rule.
