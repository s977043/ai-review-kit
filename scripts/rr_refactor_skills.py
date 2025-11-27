#!/usr/bin/env python3
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SKILLS = ROOT / "skills"
VALID_PHASES = {"upstream", "midstream", "downstream"}

FRONTMATTER_RE = re.compile(r"^---\s*\n(.*?)\n---", re.DOTALL)
PHASE_RE = re.compile(r"^phase:\s*[\"']?(?P<phase>[A-Za-z0-9_-]+)[\"']?\s*$", re.MULTILINE)
ID_RE = re.compile(r"^id:\s*[\"']?(?P<id>[A-Za-z0-9_.-]+)[\"']?\s*$", re.MULTILINE)
ID_LINE_RE = re.compile(r"^(id:\s*)([\"']?)(?P<id>[A-Za-z0-9_.-]+)([\"']?)\s*$", re.MULTILINE)


def parse_frontmatter(text: str) -> dict:
  match = FRONTMATTER_RE.search(text)
  if not match:
    return {}
  block = match.group(1)
  phase_match = PHASE_RE.search(block)
  id_match = ID_RE.search(block)
  result = {}
  if phase_match:
    result["phase"] = phase_match.group("phase").strip()
  if id_match:
    result["id"] = id_match.group("id").strip()
  return result


def rewrite_id(text: str, skill_id: str | None) -> tuple[str | None, str, bool]:
  if not skill_id:
    return skill_id, text, False
  new_id = re.sub(r"^(rra|kra)-", "rr-", skill_id, flags=re.IGNORECASE)
  if new_id == skill_id:
    return skill_id, text, False

  def replacer(match: re.Match) -> str:
    prefix = match.group(1)
    opener = match.group(2)
    closer = match.group(4)
    return f"{prefix}{opener}{new_id}{closer}"

  updated_text, replaced = ID_LINE_RE.subn(replacer, text, count=1)
  return new_id, updated_text if replaced else text, replaced > 0


def ensure_dirs() -> None:
  for phase in VALID_PHASES:
    (SKILLS / phase).mkdir(parents=True, exist_ok=True)


def unique_target(path: Path) -> Path:
  if not path.exists():
    return path
  counter = 1
  while True:
    candidate = path.with_name(f"{path.stem}_{counter}{path.suffix}")
    if not candidate.exists():
      return candidate
    counter += 1


def move_skill(path: Path, dest_dir: Path, content: str) -> tuple[Path, bool]:
  dest_dir.mkdir(parents=True, exist_ok=True)
  target = dest_dir / path.name
  if target.resolve() == path.resolve():
    path.write_text(content, encoding="utf-8")
    return target, False

  target = unique_target(target)
  target.write_text(content, encoding="utf-8")
  path.unlink()
  return target, True


def process_skill(path: Path) -> tuple[bool, bool, str | None, str, Path]:
  text = path.read_text(encoding="utf-8")
  meta = parse_frontmatter(text)
  phase = (meta.get("phase") or "").lower()
  skill_id = meta.get("id")
  if phase not in VALID_PHASES:
    phase = "midstream"
    warning = "phase missing/invalid"
  else:
    warning = ""

  new_id, updated_text, id_changed = rewrite_id(text, skill_id)
  dest_dir = SKILLS / phase
  target_path, moved = move_skill(path, dest_dir, updated_text)
  return moved, id_changed, new_id or skill_id, warning, target_path


def main() -> int:
  if not SKILLS.exists():
    print(f"No skills directory found at {SKILLS}", file=sys.stderr)
    return 1

  ensure_dirs()
  skill_files = [p for p in SKILLS.rglob("*.md") if p.is_file()]
  moved_count = 0
  id_updates = 0
  warnings: list[str] = []
  id_index: dict[str, list[Path]] = {}

  for path in skill_files:
    moved, id_changed, skill_id, warning, target_path = process_skill(path)
    if moved:
      moved_count += 1
    if id_changed:
      id_updates += 1
    if warning:
      rel = path.relative_to(ROOT)
      warnings.append(f"{rel}: {warning}; defaulted to midstream")
    if skill_id:
      id_index.setdefault(skill_id, []).append(target_path.relative_to(ROOT))

  print(f"Moved {moved_count} skill file(s).")
  print(f"Rewrote {id_updates} skill id(s) to rr- prefix." )
  if warnings:
    print("Warnings:")
    for w in warnings:
      print(f"  - {w}")
  duplicates = {k: v for k, v in id_index.items() if len(v) > 1}
  if duplicates:
    print("Duplicate skill id(s) detected:")
    for dup_id, paths in duplicates.items():
      joined = ", ".join(str(p) for p in paths)
      print(f"  - {dup_id}: {joined}")
  return 0


if __name__ == "__main__":
  sys.exit(main())
