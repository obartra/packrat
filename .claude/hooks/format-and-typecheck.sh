#!/usr/bin/env bash
# PostToolUse hook for Edit|Write|MultiEdit.
# 1. Formats the edited file with prettier (quietly) if it's a formatable type.
# 2. Runs `npm run typecheck` after TypeScript edits and surfaces errors.
# Only acts on files inside this project (/Users/os/repos/packrat).

set -e
PROJECT_ROOT="/Users/os/repos/packrat"

# Extract file_path from hook stdin JSON
f=$(jq -r '.tool_input.file_path // empty')
[[ -n "$f" ]] || exit 0

# Only act on files inside the project
case "$f" in
  "$PROJECT_ROOT"/*) ;;
  *) exit 0 ;;
esac

cd "$PROJECT_ROOT"

# Format with prettier (silent on success; non-fatal on error)
case "$f" in
  *.ts|*.tsx|*.css|*.json|*.js|*.mjs|*.cjs|*.yml|*.yaml|*.md)
    npx prettier --write --log-level=warn "$f" 2>/dev/null || true
    ;;
esac

# Typecheck after TypeScript edits — output goes to Claude if it fails
case "$f" in
  *.ts|*.tsx)
    if ! out=$(npm run typecheck 2>&1); then
      echo "$out" >&2
      exit 2
    fi
    ;;
esac

exit 0
