#!/usr/bin/env python3
import argparse
import json
import sys
from pathlib import Path

try:
  import yaml
except ImportError as exc:  # pragma: no cover - dependency hint
  print("PyYAML is required to parse skill frontmatter. Install via `pip install pyyaml`.", file=sys.stderr)
  sys.exit(1)

try:
  from jsonschema import Draft7Validator
except ImportError as exc:  # pragma: no cover - dependency hint
  print("jsonschema is required to validate skills. Install via `pip install jsonschema`.", file=sys.stderr)
  sys.exit(1)

ROOT = Path(__file__).resolve().parents[1]
SKILLS_DIR = ROOT / "skills"
SCHEMA_PATH = ROOT / "schemas" / "skill.schema.json"
VALID_PHASES = {"upstream", "midstream", "downstream"}


def extract_frontmatter(text: str) -> tuple[dict, str]:
  """Parse YAML frontmatter and return (metadata, body)."""
  lines = text.splitlines()
  if not lines or lines[0].strip() != "---":
    raise ValueError("missing frontmatter opener '---'")
  end_index = next((idx for idx, line in enumerate(lines[1:], start=1) if line.strip() == "---"), None)
  if end_index is None:
    raise ValueError("frontmatter not terminated with '---'")

  frontmatter = "\n".join(lines[1:end_index])
  body = "\n".join(lines[end_index + 1 :])
  meta = yaml.safe_load(frontmatter) or {}
  if not isinstance(meta, dict):
    raise ValueError("frontmatter must be a mapping")
  return meta, body


def load_schema(path: Path) -> Draft7Validator:
  schema = json.loads(path.read_text(encoding="utf-8"))
  return Draft7Validator(schema)


def build_memory_seed(skill_id: str, phase: str) -> dict:
  return {
    "skill_id": skill_id,
    "phase": phase,
    "last_run": None,
    "recent_findings": [],
  }


def derive_phase_from_path(path: Path) -> str:
  try:
    parts = path.relative_to(SKILLS_DIR).parts
  except ValueError:
    return ""
  return parts[0] if parts else ""


def main() -> int:
  parser = argparse.ArgumentParser(description="Refactor and validate River Reviewer skills.")
  parser.add_argument(
    "--phase",
    choices=["upstream", "midstream", "downstream", "all"],
    default="all",
    help="Filter skills by phase.",
  )
  args = parser.parse_args()

  if not SKILLS_DIR.exists():
    print(f"No skills directory found at {SKILLS_DIR}", file=sys.stderr)
    return 1

  if not SCHEMA_PATH.exists():
    print(f"Skill schema not found at {SCHEMA_PATH}", file=sys.stderr)
    return 1

  validator = load_schema(SCHEMA_PATH)
  skill_files = sorted(p for p in SKILLS_DIR.rglob("*.md") if p.is_file())
  loaded: list[dict] = []
  warnings: list[str] = []
  errors: list[str] = []
  id_index: dict[str, list[str]] = {}

  for path in skill_files:
    try:
      meta, body = extract_frontmatter(path.read_text(encoding="utf-8"))
    except Exception as exc:
      errors.append(f"{path.relative_to(ROOT)}: {exc}")
      continue

    meta["phase"] = str(meta.get("phase", "")).lower()
    skill_id = meta.get("id")

    validation_errors = [e.message for e in validator.iter_errors(meta)]
    if validation_errors:
      joined = "; ".join(validation_errors)
      errors.append(f"{path.relative_to(ROOT)}: {joined}")
      continue

    if args.phase != "all" and meta["phase"] != args.phase:
      continue

    path_phase = derive_phase_from_path(path)
    if path_phase and path_phase != meta["phase"]:
      warnings.append(
        f"{path.relative_to(ROOT)}: phase '{meta['phase']}' does not match directory '{path_phase}'"
      )

    memory_seed = build_memory_seed(skill_id, meta["phase"])
    loaded.append(
      {
        "path": str(path.relative_to(ROOT)),
        "frontmatter": meta,
        "body_preview": body.strip()[:140],
        "memory_seed": memory_seed,
      }
    )
    id_index.setdefault(skill_id, []).append(str(path.relative_to(ROOT)))

  duplicates = {k: v for k, v in id_index.items() if len(v) > 1}
  if duplicates:
    for dup_id, paths in duplicates.items():
      warnings.append(f"Duplicate skill id '{dup_id}' found at {', '.join(paths)}")

  output = {
    "phase": args.phase,
    "loaded": loaded,
    "warnings": warnings,
    "errors": errors,
  }
  print(json.dumps(output, indent=2))

  return 1 if errors else 0


if __name__ == "__main__":
  sys.exit(main())
