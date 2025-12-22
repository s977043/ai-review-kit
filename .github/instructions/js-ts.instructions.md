---
applyTo: '**/*.{js,jsx,ts,tsx}'
---

# JavaScript / TypeScript instructions

- Follow the existing style and patterns in this repository (imports, folder layout, naming).
- Prefer TypeScript types over implicit `any`. If you must use `any`, justify it in a comment.
- Keep functions small and testable; avoid hidden side effects.
- When changing behavior:
  - update/extend tests
  - update docs if user-facing behavior changes
  - keep backward compatibility unless explicitly requested
- Avoid introducing new dependencies unless necessary. If you add one, explain why and note the tradeoffs.
