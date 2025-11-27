# Run Phase-Specific Review

Target a single phase when you only want Upstream, Midstream, or Downstream feedback.

## Steps

1. Tag each skill with the correct `phase` in its front matter.
2. Limit the review scope in CI when needed:

```yaml
on:
  pull_request:
    paths:
      - "docs/**"        # Upstream-focused example
      - "!src/**"        # skip Midstream code if desired
```

3. For local runs, execute only the relevant skills by filtering files or temporarily narrowing `applyTo` globs.
4. Share the chosen phase in your PR template so reviewers know which checks to expect.

## Verification

- Confirm the reviewer only loads skills whose `phase` matches the targeted segment.
- Add a small change in a different phase to verify it is ignored.
