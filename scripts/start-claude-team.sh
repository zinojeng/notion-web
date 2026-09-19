#!/usr/bin/env bash
# Start independent Claude Code roles without duplicating saved conversations.
set -euo pipefail
repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
command -v python3 >/dev/null 2>&1 || {
  printf '%s\n' 'python3 is required to parse the public Claude CLI session JSON.' >&2
  exit 127
}

exec python3 - "$repo_root" "$@" <<'PY'
import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

repo = Path(sys.argv[1]).resolve()
parser = argparse.ArgumentParser(
    prog="./scripts/start-claude-team.sh",
    description="Start missing named Claude roles; preserve existing conversations and settings.",
)
parser.add_argument("--dry-run", action="store_true", help="show decisions without starting sessions")
parser.add_argument("roles", nargs="*", help="capture, notion, interface, coordinator (default: all)")
args = parser.parse_args(sys.argv[2:])
known_roles = ("capture", "notion", "interface", "coordinator")
roles = list(dict.fromkeys(args.roles or known_roles))
if any(role not in known_roles for role in roles):
    parser.error("roles must be capture, notion, interface, or coordinator")

claude = shutil.which("claude")
if not claude:
    parser.exit(127, "Claude Code CLI was not found in PATH.\n")


def run(command):
    # This launcher receives Python source on stdin; never forward it to Claude.
    return subprocess.run(command, cwd=repo, stdin=subprocess.DEVNULL,
                          text=True, capture_output=True, check=True)


def sessions():
    rows = json.loads(run([claude, "agents", "--json", "--all", "--cwd", str(repo)]).stdout)
    if not isinstance(rows, list) or any(not isinstance(row, dict) for row in rows):
        raise ValueError("Claude CLI returned an invalid session list; no new sessions started.")
    return rows


def report_existing(role, matches):
    name = "notion-web-" + role
    live = [row for row in matches if row.get("pid") or row.get("state") in ("working", "blocked")]
    completed = [row for row in matches if row.get("state") == "done"]
    if live:
        print(f"KEEP {name}: already active; no duplicate launched.")
    elif completed:
        print(f"KEEP {name}: completed conversation is still available.")
    else:
        states = ", ".join(sorted({str(row.get("state") or row.get("status") or "saved")
                                    for row in matches}))
        print(f"KEEP {name}: existing {states} conversation; resume it instead of restarting work.")
    print(f"  ./scripts/claude-sessions.sh resume {name}")
    if len(live) > 1:
        print("  Multiple matching rows: open the dashboard and rename duplicates before resuming.")
    elif not live and len(matches) > 1:
        print("  The helper selects the newest saved row by startedAt; older history stays available.")
    if any(row.get("state") in ("stopped", "failed") for row in matches):
        print("  Stopped/failed rows were preserved; inspect them in the dashboard if needed.")


try:
    top_level = Path(run(["git", "rev-parse", "--show-toplevel"]).stdout.strip()).resolve()
    if top_level != repo:
        raise ValueError("Run this launcher from its own Git repository checkout.")
    base_commit = run(["git", "rev-parse", "HEAD"]).stdout.strip()
    prompts = {}
    for role in roles:
        prompt_path = repo / "collaboration" / "prompts" / (role + ".txt")
        prompt = prompt_path.read_text(encoding="utf-8").strip()
        if not prompt:
            raise ValueError(f"Empty role prompt: collaboration/prompts/{role}.txt")
        prompts[role] = prompt.replace("{{REPO_ROOT}}", str(repo)).replace("{{BASE_COMMIT}}", base_commit)

    # Serialize launchers for this checkout so simultaneous invocations cannot duplicate roles.
    checkout_key = hashlib.sha256(str(repo).encode()).hexdigest()[:20]
    lock_path = Path(tempfile.gettempdir()) / f"notion-web-team-{os.getuid()}-{checkout_key}.lock"
    flags = os.O_CREAT | os.O_RDWR | getattr(os, "O_NOFOLLOW", 0)
    with os.fdopen(os.open(lock_path, flags, 0o600), "a+") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            parser.exit(1, "Another launcher is checking this checkout; try again after it finishes.\n")

        rows = sessions()
        settings = json.dumps({"crossSessionInbound": "accept", "worktree": {"bgIsolation": "none"}})
        allowed = ",".join([
            "Read", "Edit", "Write", "Glob", "Grep", "ListAgents", "SendMessage", "WebSearch", "WebFetch",
            "Bash(pwd)", "Bash(git status --short)", "Bash(git rev-parse HEAD)",
            "Bash(npm test)", "Bash(npm test *)", "Bash(node --test)", "Bash(node --test *)",
            "Bash(npm run build)",
        ])
        for role in roles:
            name = "notion-web-" + role
            matches = [row for row in rows if row.get("name") == name]
            if matches:
                report_existing(role, matches)
                continue
            if args.dry_run:
                print(f"WOULD START {name}: collaboration/prompts/{role}.txt (base {base_commit[:12]})")
                continue
            print(f"START {name}", flush=True)
            result = run([claude, "--bg", "--name", name, "--permission-mode", "acceptEdits",
                          "--settings", settings, "--allowedTools", allowed, "--", prompts[role]])
            if result.stdout.strip():
                print(result.stdout.strip())
            if result.stderr.strip():
                print(result.stderr.strip(), file=sys.stderr)
            rows = sessions()
            if not any(row.get("name") == name and row.get("kind") == "background" for row in rows):
                raise ValueError(f"Launch returned without a visible {name} row. Inspect the dashboard; do not retry blindly.")
        print("\nWatch: ./scripts/claude-sessions.sh")
        print("Inspect: ./scripts/claude-sessions.sh list")
        if args.dry_run:
            print("Dry run complete; no sessions were started or resumed.")
except subprocess.CalledProcessError as error:
    detail = (error.stderr or error.stdout or "CLI command failed").strip()
    print(detail, file=sys.stderr)
    sys.exit(error.returncode or 1)
except (OSError, ValueError) as error:
    print(str(error), file=sys.stderr)
    sys.exit(1)
PY
