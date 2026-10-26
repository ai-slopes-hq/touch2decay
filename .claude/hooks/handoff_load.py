#!/usr/bin/env python3
"""SessionStart (startup, clear): подложить .claude/handoff.md в новую сессию один раз и убрать в handoff.prev.md."""

import json
import os
import sys
from pathlib import Path


def main() -> None:
    data = json.load(sys.stdin)
    root = Path(os.environ.get("CLAUDE_PROJECT_DIR") or data.get("cwd") or ".")
    handoff = root / ".claude" / "handoff.md"
    if not handoff.is_file():
        return
    text = handoff.read_text()
    handoff.replace(handoff.with_name("handoff.prev.md"))
    note = f"Передача дел из прошлой сессии (.claude/handoff.md, теперь handoff.prev.md):\n\n{text}"
    print(json.dumps({"hookSpecificOutput": {"hookEventName": "SessionStart", "additionalContext": note}}, ensure_ascii=False))


if __name__ == "__main__":
    main()
