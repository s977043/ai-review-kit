# Using Skill Packs

A Skill Pack is the distribution unit for bundled open review knowledge (TypeScript review, DDD review, and so on).
Pick a pack and reviews work out of the box — no custom skills required.

## Installing a pack

Pass the pack id to `--skill-set`:

```bash
# Review with the TypeScript pack (type safety, null safety, type-driven design)
river run . --skill-set typescript

# Multiple packs are comma separated (each skill runs at most once)
river run . --skill-set typescript,basic
```

See the top of the [Skills Catalog](../reference/skills-catalog.md) for the list of available packs.

## Pack maturity (tier)

| tier           | Meaning                                                                        |
| -------------- | ------------------------------------------------------------------------------ |
| `official`     | Every skill carries fixtures / canary / eval and passed maintainer review      |
| `community`    | Fixtures exist but canary / eval coverage is incomplete; recommended as opt-in |
| `experimental` | Idea stage. Works, but the quality gate is not in place yet                    |

Run `npm run packs:tier` to see the mechanical tier assessment.

## Relationship with recommendations

Packs supersede the legacy `recommendations:` skill sets in the registry.

- `--skill-set <name>` checks packs first and falls back to recommendations
- When a name exists in both, the pack wins and a warning is printed
- The legacy `typescript` recommendation is reproducible with `--skill-set typescript,basic`

## Authoring your own pack

The manifest template lives at [specs/templates/pack/pack.yaml](https://github.com/s977043/river-review/blob/main/scripts/templates/pack/pack.yaml); the design policy, axes, and tier promotion rules are in [skill-pack-design.md](https://github.com/s977043/river-review/blob/main/docs/development/skill-pack-design.md). A pack references skills by id —
no skill files need to move.
