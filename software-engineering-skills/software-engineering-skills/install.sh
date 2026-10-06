#!/usr/bin/env bash
set -e
PROJECT_PATH="${1:-.}"
TARGET="$PROJECT_PATH/.agents/skills"
mkdir -p "$TARGET"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
for d in "$SCRIPT_DIR"/[0-9][0-9]-*/; do
  [ -d "$d" ] || continue
  name="$(basename "$d")"
  rm -rf "$TARGET/$name"
  cp -R "$d" "$TARGET/$name"
  echo "Installed $name"
done

echo "Done. Skills installed to $TARGET"
