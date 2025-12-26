# Skill Authoring Guide / How-to

This guide summarizes "how to write" River Reviewer skills (`skills/**/*.md`) to reduce hesitation and maintain consistent quality when adding or updating them.

## Goals

- 1 Skill = 1 Perspective: Align granularity and intent of findings.
- Reduce false positives (noisy comments) and make reviews readable.
- Write robust skills (maintainable even with extensions).
- Automate "what is always said" in human reviews.

## Non-goals

- Do not debate preferences/religion (indentation, naming styles).
- Do not assert "implementation methods" or "project-specific circumstances" in skill body.
- Do not create skills to increase "nits" (Avoid spamming low-impact findings).
- Do not make comprehensive findings on unchanged code.

## Skill Structure

A skill consists of YAML frontmatter (metadata) and Markdown body (instruction).

- Metadata: Info for routing, validation, priority.
- Body: Checkpoints and style guide for the reviewer (LLM/Heuristic).

See `schemas/skill.schema.json` for definitions and `pages/reference/metadata-fields.en.md` for the list.

Minimum frontmatter (Required):

- `id`: Stable identifier (Invariant across move/rename)
- `name`: Short human-readable name
- `description`: What to check (1 sentence)
- `phase`: `upstream` / `midstream` / `downstream`
- `applyTo`: Target file glob

## Recommended Template (Minimal)

Base on `skills/_template.md` and align the following:

- Narrow `applyTo` (Don't start with `**/*`)
- Write "Suppression Conditions" (False positive guards)
- Write "Out of Scope" (Non-goals)
- Keep findings short and actionable

## Granularity (1 Theme / 1 Perspective)

Basically split skills by "1 Theme / 1 Perspective". Not packing different purposes into one skill reduces false positives and stabilizes operations.

- 1 Skill = 1 Type of Risk (e.g., Missing input validation, Missing Accessible Name)
- Keep framework-specific knowledge within one skill (Don't mix with general rules)
- Split into separate skills if there are many exceptions or derived conditions

## Diff-first

Skills are review units that take diff as primary input to produce reproducible findings.

- Prioritize evaluating "changed lines" as much as possible.
- When mentioning outside changes, lower Confidence and avoid assertion.
- Avoid "design criticism that cannot be judged without project context".

## Recommended: Signals (Application Criteria)

`signals` is not a frontmatter field, but writing "criteria for applying this skill" in the body reduces inconsistency.

- Ex: "Apply if `catch` swallowing exception (no log, no re-throw) is in diff."
- Ex: "Apply if string looking like credential (AKIA/ghp\_/sk- etc.) is in diff."

## Severity Criteria (Guideline)

`severity` is a guideline on "how the recipient should treat it".

- `critical`: Leads to security incident or data loss; requires immediate action.
- `major`: High risk of bug/outage; want to address in principle.
- `minor`: Good for future maintainability/readability; fix if bandwidth allows.
- `info`: Presentation of judgment material ("Consideration point").

Note:

- Often discussed as `blocker` / `warning` / `nit`, but the enum in this repo is `info` / `minor` / `major` / `critical`.

## Expression of Confidence (Especially Low)

If Confidence is low (mixed with speculation), write so the reader understands it's "not an assertion".

- Avoid assertions like `must` / `should` / `definitely`.
- Use expressions showing "possibility/suggestion" like `may` / `might` / `consider`.
- Separate Fact (Evidence) and Suggestion (Speculation) (e.g., "X is visible in diff. Consider checking Y as it might be ...").

## Evidence Requirements (Mandatory)

River Reviewer comments are posted in `<file>:<line>: <message>` format. Minimally satisfy:

- **Where is it based on?** (Linked to file and line)
- **Do not assert speculation** (Write as "possibility" if uncertain)
- **Clue for reproduction/verification** (What to check)
- **Comment in Japanese** (Review comments should be in Japanese - _Note: This applies to Japanese config/context, English if config is English_)

## Output Format (Required)

Skill return `message` cannot be long. Ensure the following elements are readable:

- Finding: What is the problem (Short, avoid over-assertion)
- Evidence: Basis (Which file/line, what fact in diff)
- Impact: Impact if ignored (Short)
- Fix: Minimal fix plan (Next step)

Note:

- Do not write findings if Evidence cannot be written.
- Confidence is not a schema field, so express it in wording.

## Recommended: Finding Pattern (Short)

Align "patterns" that are readable even if short.

- Finding: What is the problem (1 sentence)
- Evidence: Basis (File/Line, Fact in diff)
- Impact: What is the trouble (Short)
- Fix: Minimal fix plan (Next step)

Example:

- `src/foo.ts:42: Potential swallowed exception. Debugging difficult. Fix: Log+rethrow in catch (or return to caller)`

## Prohibitions (Anti-patterns)

- Assertive tone assumptions ("Must be ~", "Definitely ~")
- Forcing context-dependent things ("Should do this" without knowing project premise)
- Spamming "nits" (Massive output of low-value findings)
- Repetitive generalities unrelated to diff
- Implementation overlapping with other skills (Increases redundancy/noise)

## Rules to Reduce False Positives (Guards)

Skills must have "Suppression Conditions". False positives are treated as "Bugs worth fixing".

Example:

- Do not point out if input validation already exists.
- Do not propose log improvement if context-aware log exists.

## Minimum Check for PR

When adding/updating skills, leave the following in PR body:

- `npm run skills:validate`
- `npm test`
- Verification perspective for "False positive guards/Non-goals" (What not to say) if possible

## Checklist for Adding/Changing Skills

- [ ] Finding focused on 1 perspective
- [ ] Evidence (File/Line, Diff fact) is clear
- [ ] False positive guard (Suppression condition) exists
- [ ] Non-goals (What not to handle) are written
- [ ] Fixtures or minimal reproduction steps exist if possible

## Minimum Acceptance Bar

A skill is considered "acceptable" when it meets the following minimum bar:

- It produces at least one actionable finding when applicable (a concrete next step, not just a vague note).
- It includes clear evidence that can be traced to the diff (file and line).
- It avoids noise (no "nit" spam) and stays focused on meaningful risks.

## Guidelines for Good Skills

- High probability of "hitting" (Low false positives)
- Concrete fix plan, clear next step
- Low noise, focused on 1 perspective

See `pages/guides/governance/skill-policy.en.md` (if exists, or Japanese version) for stricter adoption criteria.
