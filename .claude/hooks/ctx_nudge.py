#!/usr/bin/env python3
"""UserPromptSubmit: контекст перевалил порог — подсказать агенту предложить /handoff (раз на каждые STEP токенов)."""

import json
import sys
import tempfile
from pathlib import Path

THRESHOLD = 150_000
STEP = 50_000
TAIL_BYTES = 512 * 1024
CONTEXT_KINDS = ("input_tokens", "cache_creation_input_tokens", "cache_read_input_tokens")


def last_context(transcript: Path) -> int:
    with transcript.open("rb") as f:
        f.seek(max(0, transcript.stat().st_size - TAIL_BYTES))
        lines = f.read().decode(errors="ignore").splitlines()
    for line in reversed(lines):
        try:
            entry = json.loads(line)
        except ValueError:
            continue
        usage = (entry.get("message") or {}).get("usage")
        if entry.get("type") == "assistant" and usage and not entry.get("isSidechain"):
            return sum(usage.get(k) or 0 for k in CONTEXT_KINDS)
    return 0


def main() -> None:
    data = json.load(sys.stdin)
    transcript = Path(data.get("transcript_path") or "")
    if not transcript.is_file():
        return
    context = last_context(transcript)
    if context < THRESHOLD:
        return
    level = (context - THRESHOLD) // STEP
    state = Path(tempfile.gettempdir()) / f"t2d-ctx-{data.get('session_id', 'x')}"
    if state.exists() and int(state.read_text() or -1) >= level:
        return
    state.write_text(str(level))
    note = (
        f"Контекст сессии ≈ {context // 1000}k токенов: каждый следующий шаг перечитывает его целиком. "
        "Закончи текущий шаг, затем одной строкой предложи автору /handoff и /clear перед следующей задачей. "
        "Если задача почти доделана — сначала доделай."
    )
    print(json.dumps({"hookSpecificOutput": {"hookEventName": "UserPromptSubmit", "additionalContext": note}}, ensure_ascii=False))


if __name__ == "__main__":
    main()
