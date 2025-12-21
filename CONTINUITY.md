Goal (success criteria included):

- Address review feedback on config loader changes by resolving inline comments, keeping config loading robust and documented.

Constraints / Assumptions:

- Follow repository AGENTS.md guidelines (run npm test and npm run lint before commit/PR).
- Work in Japanese for communication per user request.
- Maintain ledger updates before/after significant steps.

Key decisions:

- Use existing ConfigLoader/schema structure; adjust behavior per review comments once identified.

State:
Done:

- Enforced object-only top-level parsing for config files and improved ConfigLoaderError options handling.
- Added tests for .yml support and non-object configuration rejection.
- Updated README to note object-only config requirement.
- Ran npm test and npm run lint successfully.
  Now:
- Prepare commit and PR message summarizing fixes.
  Next:
- Commit changes and generate PR message via make_pr.

Open questions:

- Specific inline comments are not visible in context; adjustments made to improve robustness and coverage accordingly.

Working set (files / ids / commands):

- CONTINUITY.md, src/config/loader.mjs, src/config/default.mjs, src/config/schema.mjs, tests/config-loader.test.mjs, README.md, package.json, package-lock.json
- Commands executed: npm test; npm run lint
