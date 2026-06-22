# River Review Architecture

> **Note:** 公開版のアーキテクチャ解説は [`pages/explanation/river-architecture.md`](../pages/explanation/river-architecture.md) を参照してください。本ファイルは実装詳細の内部補足資料です。

## Overview

River Review is a **context engineering framework for AI code review**, built around a Skill Registry that transforms implicit team knowledge into reproducible, version-controlled agent skills.

The core philosophy: **"Skills are the main feature."** Everything else—GitHub Actions, CLI, Node API—are just interfaces to execute these skills.

## Architecture Principles

1. **Skills as First-Class Assets**
   - Each skill is a versioned, testable, documented artifact
   - Skills live in a registry with metadata, prompts, fixtures, and evaluations
   - Skills can be shared, improved, and composed

2. **Separation of Concerns**
   - **Skill Definition** (what to check) is separate from **Execution Environment** (how to run)
   - Skills are portable across different execution contexts (Actions, CLI, API)

3. **Data-Driven Routing**
   - Skills declare their requirements (phase, file patterns, input context)
   - The framework automatically routes files to appropriate skills

4. **Evaluation-Driven Development**
   - Every skill includes test fixtures and golden outputs
   - promptfoo integration enables regression testing and quality measurement

5. **Context Engineering**
   - Manage what enters the LLM prompt, when, and at what fidelity
   - Progressive disclosure: load metadata first, full instructions only for selected skills
   - Context budget awareness: select the smallest high-signal context that produces quality review output

## Core Components

```mermaid
flowchart TB
    subgraph Registry["Skill Registry (skills/)"]
        direction TB
        S1[skill.yaml<br/>Metadata]
        S2[prompt/<br/>System & User Prompts]
        S3[fixtures/<br/>Test Inputs]
        S4[golden/<br/>Expected Outputs]
        S5[eval/<br/>promptfoo Config]
    end

    subgraph Loader["Skill Loader"]
        L1[Schema Validation<br/>Zod]
        L2[Frontmatter Parser<br/>Legacy Skills]
        L3[SkillDefinition<br/>Unified Model]
    end

    subgraph Router["Skill Router"]
        R1[Phase Filter<br/>upstream/midstream/downstream]
        R2[File Pattern Match<br/>applyTo globs]
        R3[Context Filter<br/>diff/fullFile/tests]
        R4[Ranking<br/>modelHint/priority]
    end

    subgraph Runner["Review Runner"]
        RN1[Context Builder<br/>diff/files/PR]
        RN2[LLM Client<br/>OpenAI]
        RN3[Formatter<br/>Markdown/JSON]
    end

    Registry --> Loader
    Loader --> Router
    Router --> Runner
    Runner -->|Results| OUT[Output<br/>PR Comments/JSON]
```

## References

- [Skill YAML Specification](specs/skill-yaml-spec.md)
- [Skill Registry README](../skills/README.md)
- [Migration Guide](./migration/skill-migration-guide.md)
- [promptfoo Documentation](https://www.promptfoo.dev/)
