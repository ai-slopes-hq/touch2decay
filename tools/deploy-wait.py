#!/usr/bin/env python3
"""Ждёт статус деплоя Vercel для коммита (GitHub commit status) и печатает одну строку: success / failure / timeout."""

import argparse
import json
import re
import subprocess
import sys
import time

REPO = "ai-slopes-hq/touch2decay"
POLL_S = 15
TIMEOUT_S = 600
HTTP_TIMEOUT_S = 10
DONE = ("success", "failure", "error")


def git(*args: str) -> str:
    return subprocess.run(["git", *args], capture_output=True, text=True, check=True).stdout.strip()


def combined_status(sha: str) -> dict:
    url = f"https://api.github.com/repos/{REPO}/commits/{sha}/status"
    out = subprocess.run(["curl", "-sf", "-m", str(HTTP_TIMEOUT_S), url], capture_output=True, text=True, check=True)
    return json.loads(out.stdout)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("ref", nargs="?", default="HEAD")
    parser.add_argument("--timeout", type=int, default=TIMEOUT_S)
    args = parser.parse_args()

    sha = git("rev-parse", args.ref)
    version = re.search(r"t2d-v(\d+)", git("show", f"{sha}:sw.js"))
    label = f"v{version.group(1) if version else '?'} {sha[:7]}"
    deadline = time.monotonic() + args.timeout
    state, url = "pending", ""
    while time.monotonic() < deadline:
        try:
            status = combined_status(sha)
        except (subprocess.CalledProcessError, ValueError) as exc:
            print(f"github: {exc}", file=sys.stderr)
        else:
            state = status.get("state", "pending")
            url = next((s.get("target_url") or "" for s in status.get("statuses") or []), "")
            if status.get("statuses") and state in DONE:
                print(f"{state} {label} {url}")
                return 0 if state == "success" else 1
        time.sleep(POLL_S)
    print(f"timeout ({state}) {label} {url}")
    return 1


if __name__ == "__main__":
    sys.exit(main())
