---
title: Roadmap & Project Board Guide
---

## Purpose

- Align roadmap phase progression with task management using GitHub Projects (Board).
- Align granularity and status of Issues/PRs to visualize progress.

## Board Initial Setup

- View: Board (Group by `Status`).
- Recommended Fields:
  - `Status`: Todo / Doing / Blocked / Done
  - `Phase`: 0 / 1 / 2 / 3 / 4 (Corresponds to ROADMAP.md)
  - `Component`: Schema / Loader / Runner / Skills / Evals / Memory
  - `Priority`: P0 / P1 / P2
  - `Owner`: Assignee (People field)
- Automation (Optional):
  - Auto-set `Status=Todo` when Issue added.
  - Workflow to move related Issue to `Done` when PR closed.

## Task Breakdown

- 1 Issue = 1 Executable Task. Scope aiming for 1-2 days size.
- Break down granularity based on Roadmap phase items into Issues.
- Phase Examples:
  - Phase 1: Skill migration/ID normalization, add production-ready skills
  - Phase 2: Loader/Runner implementation, update Actions wrapper

## Registration Flow

1. Create Issue and set `Phase`/`Priority`/`Status=Todo`.
2. Link to Milestone (e.g., `v0.2.0 – Developer Experience`) if needed (Unify Milestone to SemVer).
3. Add to Project Board (Card auto-generated in Board).

## Operation Flow (Kanban)

- Check board at weekly standup or weekly.
- Rule Examples:
  - `Todo` -> `Doing` when starting.
  - Move to `Blocked` if blocked, leave status in comment.
  - Close Issue and move to `Done` after PR merge.
- Follow Exit Criteria in ROADMAP.md for phase completion judgment.

## Defined Task Template

Refer to "Next Concrete Tasks" in [ROADMAP.md](https://github.com/s977043/river-reviewer/blob/main/ROADMAP.md) for concrete task ideas (List not maintained here to avoid duplication).

## Operation Tips

- Prepare Issue template with fields for purpose/completion conditions/test perspectives.
- Split large tasks with checklists and manage subtasks as Todo.
- Limit labels (e.g., `type:task`, `P1`, `m2-dx`).
- Link to corresponding Issue when updating Roadmap to prevent duplication or omission.
