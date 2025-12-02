# Riverbed Memory (Draft)

## Overview

Riverbed Memory is the place where context settles—like how a riverbed holds the traces of past flows. It remembers architectural decisions, WontFix items, and prior review outcomes so River Reviewer can stay consistent across PRs and releases. Think of it as a lightweight, auditable memory layer that keeps the stream grounded. （流れの底に記憶を残すイメージ）

## Scope (v0 → v1 → v2)

- **v0: Stateless (current)**—no persisted context; each review is independent.
- **v1: Minimal memory**—embed structured metadata in PR comments or store a per-run JSON artifact that captures decisions/links for the next run.
- **v2: Externalized memory (sketch)**—optional Postgres/Redis/vector store backing for teams that need cross-repo recall or long-lived history.

## Storage options

- **GitHub PR comments with hidden markers**: Easy to inspect; survives reruns; limited size; must avoid noisy notifications.
- **GitHub Artifacts (.json per PR)**: Cheap and auditable; good for snapshots; expires on retention policy.
- **Repository files under `.river/`**: Co-located with code; versioned; can create churn and merge conflicts if written often.
- **External datastore (Postgres/Redis/vector DB)**: Scales and can power semantic recall; adds ops overhead and secret management.

## Design trade-offs

- **Cost**: Comments are free; artifacts inexpensive; external stores incur infra costs.
- **Complexity**: Comments/artifacts are simple; repo files need write paths and merge strategy; external DBs require services and rotation.
- **Security**: Comments/artifacts live in GitHub scopes; repo files inherit repo ACLs; external stores need secret handling and network policies.
- **Auditability**: Comments and repo files are human-readable; artifacts are retrievable; external stores need explicit retention/backups.

## Next actions (toward v1)

1. Define a minimal memory record schema (for example, issue IDs, ADR links, or WontFix rationale) that can be serialized to JSON.
2. Add an optional GitHub Action step to emit the record as an artifact and, when permitted, a compact PR comment with hidden markers.
3. Teach the agent to ingest the last avAIlable artifact/comment on each run and merge it into the prompt context without blocking the review.
