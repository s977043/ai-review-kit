# Riverbed Memory Storage Design

Riverbed Memory is a lightweight storage system for leveraging past decisions and patterns in LLM reviews. It saves data as JSON files under `.river/memory/` in the repository and regenerates indexes as needed.

## Directory Structure

```text
.river/memory/
  entries/
    adr-example.json
    review-2024-11-01.json
    pattern-react-query.json
  index.json
```

- `entries/*.json`: Individual entries. See `schemas/riverbed-entry.schema.json`.
- `index.json`: List of entries and metadata. See `schemas/riverbed-index.schema.json`.

## Entry Specification (Excerpt)

- `id`: Unique string (e.g., `adr-001`, `pattern-react-query`)
- `type`: `adr | review | wontfix | pattern | decision`
- `content`: Body text. Markdown/Text assumed.
- `metadata`:
  - `createdAt` (ISO8601), `updatedAt` (Optional)
  - `author`
  - `phase` (`upstream | midstream | downstream`, Optional)
  - `tags`, `relatedFiles`, `links`, `summary`
- `context`: Arbitrary additional info (PR number, related ADR ID, etc.)

See `schemas/riverbed-entry.schema.json` for details.

## Index Specification (Excerpt)

- `generatedAt`: Index generation time
- `entries[]`:
  - `id`, `type`, `path`
  - `title`, `tags`, `phase`, `createdAt`, `summary`

## Generation and Usage Flow

1. Add change history or ADRs in JSON format to `.river/memory/entries/`.
2. Update `index.json` with index generation script (future `npm run riverbed:index`).
3. Search for nearby entries during review and inject them into the prompt.

### Storage Policy

- Assumes Git management. Do not include sensitive information.
- UTF-8 encoding.
- Corrupted files are skipped, logged, and review continues.

## Sample Data

Examples of ADR, wontfix, and pattern are placed in `tests/fixtures/riverbed/`. Use them as minimal references satisfying the schema.
