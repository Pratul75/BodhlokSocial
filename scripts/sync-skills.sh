#!/usr/bin/env bash
# Builds .skills/ (git-ignored) from scripts/skills.txt: markdown only, one folder per skill.
# deploy-vm.sh uploads it to the server's SKILLS_DIR. Review what changed before deploying:
# these files become part of the agents' instructions.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/.skills"
CACHE="${SKILLS_CACHE:-$ROOT/.skills-src}"
rm -rf "$OUT" && mkdir -p "$OUT" "$CACHE"
grep -vE '^\s*(#|$)' "$ROOT/scripts/skills.txt" | while read -r src path; do
  if [ "$src" = local ]; then
    dir="$HOME/.claude/skills/$path"
  else
    repo="$CACHE/${src//\//_}"
    [ -d "$repo" ] || git clone -q --depth 1 "https://github.com/$src" "$repo"
    dir="$repo/$path"
  fi
  [ -f "$dir/SKILL.md" ] || { echo "missing: $src $path" >&2; continue; }
  name="$(basename "$path")"
  dest="$OUT/$name"
  mkdir -p "$dest"
  (cd "$dir" && find . -name '*.md' -not -path '*/.*' -not -iname 'readme.md' -not -iname 'changelog.md' -not -iname 'agents.md' -print0 | while IFS= read -r -d '' f; do mkdir -p "$dest/$(dirname "$f")"; cp "$f" "$dest/$f"; done)
  case "$src" in local) ;; *) for l in LICENSE LICENSE.md LICENSE.txt; do [ -f "$repo/$l" ] && cp "$repo/$l" "$dest/LICENSE.txt" && break; done ;; esac
done
echo "$(ls "$OUT" | wc -l | tr -d ' ') skills in $OUT ($(du -sh "$OUT" | cut -f1))"
