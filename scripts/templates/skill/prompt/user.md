# User Prompt Template

## Input Context

You will receive the following context:

{{#if diff}}

### Code Changes (diff)

```diff
{{{diff}}}
```

{{/if}}

{{#if fullFile}}

### Full File Content

```text
{{{fullFile}}}
```

{{/if}}

{{#if tests}}

### Related Tests

```text
{{{tests}}}
```

{{/if}}

{{#if commitMessage}}

### Commit Message

```text
{{{commitMessage}}}
```

{{/if}}

## Task

Review the provided code changes according to the rules defined in the system prompt.

## Expected Output

Provide your review in the following format:

### Summary

[1-2 sentence overview of the review]

### Findings

- `<file>:<line>: <finding with impact and fix>`
- `<file>:<line>: <finding with impact and fix>`

### Questions (if any)

- `<file>:<line>: <question for human review>`

---

**Note**: Only report findings that are relevant to the changed code. Do not report issues in unchanged code unless they are directly related to the changes.
