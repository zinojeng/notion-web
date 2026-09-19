#!/usr/bin/env bash
# Name-based access to this checkout's Claude Code background conversations.
# Uses the public CLI; never reads tokens, transcript files, or internal job state.
set -euo pipefail

project_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
cd -- "$project_dir"

usage() {
  cat <<'HELP'
Usage: ./scripts/claude-sessions.sh [view|list|json|attach NAME|resume NAME|logs NAME]

  view          Open this project's background session dashboard (default).
  list          Show names, kind, state and short IDs, including completed rows.
  json          Print the public Claude CLI session JSON for this project.
  attach NAME   Open an existing background row by its exact display name.
  resume NAME   Attach to a background row, or resume saved history by name.
  logs NAME     Show recent terminal output from a named background row.

Names such as notion-web-capture may also be entered as capture.
This helper does not create duplicate sessions or change global settings.
Use ASCII straight quotes in shell commands: claude agents --cwd "$PWD"
HELP
}

require_cli() {
  command -v claude >/dev/null 2>&1 || {
    printf '%s\n' 'Claude Code CLI was not found in PATH.' >&2
    exit 127
  }
}

session_json() {
  claude agents --json --all --cwd "$project_dir"
}

resolve_background_id() {
  local session_data
  session_data="$(session_json)" || return
  printf '%s\n' "$session_data" | python3 -c '
import json, sys
requested = sys.argv[1]
rows = json.load(sys.stdin)
matches = [row for row in rows if row.get("kind") == "background"
           and row.get("name") in (requested, "notion-web-" + requested)
           and row.get("id")]
live = [row for row in matches if row.get("pid") or row.get("state") in ("working", "blocked")]
if live:
    matches = live
else:
    completed = [row for row in matches if not row.get("pid")
                 and row.get("state") in ("done", "stopped", "failed")]
    if completed:
        def started_at(row):
            value = row.get("startedAt")
            return value if isinstance(value, (int, float)) else 0
        latest = max(started_at(row) for row in completed)
        matches = [row for row in completed if started_at(row) == latest]
if len(matches) > 1:
    print("More than one active or equally recent matching session; open the dashboard and rename duplicates.", file=sys.stderr)
    sys.exit(4)
if not matches:
    sys.exit(3)
print(matches[0]["id"])
' "$1"
}

action="${1:-view}"
case "$action" in
  help|-h|--help)
    usage
    exit 0
    ;;
esac
require_cli

case "$action" in
  view)
    exec claude agents --cwd "$project_dir"
    ;;
  json)
    session_json
    ;;
  list)
    session_data="$(session_json)"
    printf '%s\n' "$session_data" | python3 -c '
import json, sys
rows = json.load(sys.stdin)
if not rows:
    print("No active sessions or saved background rows for this project.")
    print("For older conversations, run: claude --resume")
    sys.exit(0)
print("NAME\tKIND\tSTATE\tID")
for row in rows:
    print("\t".join(str(row.get(key) or "-") for key in ("name", "kind")) + "\t"
          + str(row.get("state") or row.get("status") or "-") + "\t"
          + str(row.get("id") or "foreground"))
'
    ;;
  attach|resume|logs)
    if [[ $# -ne 2 || -z "$2" ]]; then
      usage >&2
      exit 2
    fi
    session_name="$2"
    if background_id="$(resolve_background_id "$session_name")"; then
      if [[ "$action" == logs ]]; then
        exec claude logs "$background_id"
      fi
      exec claude attach "$background_id"
    else
      resolve_status=$?
      if [[ "$resolve_status" -ne 3 ]]; then
        exit "$resolve_status"
      fi
      if [[ "$action" == resume ]]; then
        exec claude --resume "$session_name"
      fi
      printf 'No background row named %s in this project. Use resume NAME for saved history.\n' "$session_name" >&2
      exit 3
    fi
    ;;
  *)
    usage >&2
    exit 2
    ;;
esac
