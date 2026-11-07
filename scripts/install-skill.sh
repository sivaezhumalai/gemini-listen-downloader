#!/usr/bin/env bash
# Installs the "gemini-tamil-brief" skill for Claude Code (macOS, Linux, Git Bash on Windows).
#
#   bash scripts/install-skill.sh          # copy the skill (default)
#   bash scripts/install-skill.sh --link   # symlink instead, so `git pull` updates it
#   bash scripts/install-skill.sh --project /path/to/project   # install for one project only
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="$REPO_DIR/skills/gemini-tamil-brief"
MODE="copy"
DEST_ROOT="$HOME/.claude/skills"

while [ $# -gt 0 ]; do
  case "$1" in
    --link) MODE="link" ;;
    --project) shift; DEST_ROOT="${1:?--project needs a folder}/.claude/skills" ;;
    -h|--help) sed -n '2,7p' "$0"; exit 0 ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
  shift
done

[ -f "$SRC/SKILL.md" ] || { echo "Cannot find $SRC/SKILL.md" >&2; exit 1; }
DEST="$DEST_ROOT/gemini-tamil-brief"
mkdir -p "$DEST_ROOT"

if [ -e "$DEST" ] || [ -L "$DEST" ]; then
  # Backups go OUTSIDE the skills folder, or Claude Code would load two skills with the same name.
  BACKUP_DIR="$(dirname "$DEST_ROOT")/skill-backups"
  mkdir -p "$BACKUP_DIR"
  BACKUP="$BACKUP_DIR/gemini-tamil-brief-$(date +%Y%m%d-%H%M%S)"
  mv "$DEST" "$BACKUP"
  echo "Existing skill moved to: $BACKUP"
fi

if [ "$MODE" = "link" ]; then
  ln -s "$SRC" "$DEST"
  echo "Linked: $DEST -> $SRC"
else
  cp -R "$SRC" "$DEST"
  echo "Copied to: $DEST"
fi

echo
echo "Done. Start a NEW Claude Code session, then type:  /gemini-tamil-brief"
