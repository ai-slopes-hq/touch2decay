#!/usr/bin/env python3
"""Токены сессий Claude Code по транскриптам: текущая сессия, строка для docs/tokens.md, история."""

import argparse
import json
import os
import statistics
import subprocess
import sys
from collections import Counter
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path

PROJECTS = Path.home() / ".claude" / "projects"
KINDS = ("input_tokens", "cache_creation_input_tokens", "cache_read_input_tokens", "output_tokens")
# Вес относительно цены input у моделей Anthropic: чтение кеша 0.1, запись (TTL 1 ч) 2, выход 5.
WEIGHTS = {"input_tokens": 1, "cache_creation_input_tokens": 2, "cache_read_input_tokens": 0.1, "output_tokens": 5}
MILLION = 1e6
THOUSAND = 1e3


@dataclass
class Usage:
    by_model: dict[str, Counter] = field(default_factory=dict)
    contexts: list[int] = field(default_factory=list)
    started: str = ""

    def add(self, model: str, usage: dict) -> None:
        counter = self.by_model.setdefault(model, Counter())
        for kind in KINDS:
            counter[kind] += usage.get(kind) or 0
        counter["calls"] += 1

    def total(self) -> Counter:
        return sum(self.by_model.values(), Counter())


@dataclass(frozen=True)
class Session:
    id: str
    main: Usage
    subagents: Usage


def project_dirs(root: Path) -> list[Path]:
    slug = str(root).replace("/", "-").replace(".", "-")
    return sorted(p for p in PROJECTS.glob(slug + "*") if p.is_dir())


def git_root() -> Path:
    out = subprocess.run(["git", "rev-parse", "--path-format=absolute", "--git-common-dir"], capture_output=True, text=True)
    if out.returncode:
        return Path.cwd()
    return Path(out.stdout.strip()).parent


def read_usage(path: Path, *, track_context: bool) -> Usage:
    usage = Usage()
    seen: set[str] = set()
    for line in path.open(errors="ignore"):
        try:
            entry = json.loads(line)
        except ValueError:
            continue
        if not usage.started and entry.get("timestamp"):
            usage.started = entry["timestamp"]
        message = entry.get("message") or {}
        if entry.get("type") != "assistant" or not message.get("usage") or message.get("id") in seen:
            continue
        seen.add(message.get("id"))
        usage.add(message.get("model", "?"), message["usage"])
        if track_context:
            u = message["usage"]
            usage.contexts.append(sum(u.get(k) or 0 for k in KINDS[:3]))
    return usage


def load_session(path: Path) -> Session:
    subagents = Usage()
    for sub in sorted((path.parent / path.stem / "subagents").glob("*.jsonl")):
        for model, counter in read_usage(sub, track_context=False).by_model.items():
            subagents.by_model.setdefault(model, Counter()).update(counter)
    return Session(id=path.stem, main=read_usage(path, track_context=True), subagents=subagents)


def transcripts(root: Path) -> list[Path]:
    return sorted((p for d in project_dirs(root) for p in d.glob("*.jsonl")), key=lambda p: p.stat().st_mtime)


def weighted(counter: Counter) -> float:
    return sum(counter[k] * w for k, w in WEIGHTS.items())


def millions(value: float) -> str:
    return f"{value / MILLION:.1f}M" if value >= MILLION else f"{value / THOUSAND:.0f}k"


def cell(session: Session) -> str:
    total = session.main.total() + session.subagents.total()
    return (
        f"{millions(weighted(total))} экв. input (кеш {millions(total['cache_read_input_tokens'])}, "
        f"запись {millions(total['cache_creation_input_tokens'])}, вход {millions(total['input_tokens'])}, "
        f"выход {millions(total['output_tokens'])}; субагенты {millions(weighted(session.subagents.total()))})"
    )


def print_session(session: Session) -> None:
    print(f"сессия {session.id}")
    for label, usage in (("главный", session.main), ("субагенты", session.subagents)):
        for model, c in sorted(usage.by_model.items()):
            print(
                f"  {label:9} {model:22} вызовов {c['calls']:4}  кеш {millions(c['cache_read_input_tokens']):>6}"
                f"  запись {millions(c['cache_creation_input_tokens']):>6}  вход {millions(c['input_tokens']):>6}"
                f"  выход {millions(c['output_tokens']):>6}  экв. {millions(weighted(c)):>6}"
            )
    if session.main.contexts:
        print(f"  контекст: сейчас {millions(session.main.contexts[-1])}, медиана {millions(statistics.median(session.main.contexts))}")
    print(f"  итого: {cell(session)}")


def print_history(paths: list[Path]) -> None:
    print("дата              сессия    вызовов  контекст медиана / p90 / max   кеш     экв.")
    for session in sorted(map(load_session, paths), key=lambda s: s.main.started):
        ctx = sorted(session.main.contexts)
        if not ctx:
            continue
        total = session.main.total() + session.subagents.total()
        started = datetime.fromisoformat(session.main.started.replace("Z", "+00:00")).astimezone().strftime("%Y-%m-%d %H:%M")
        p90 = ctx[int(len(ctx) * 0.9)]
        print(
            f"{started}  {session.id[:8]}  {len(ctx):6}  {millions(statistics.median(ctx)):>8} / {millions(p90):>6} / {millions(ctx[-1]):>6}"
            f"  {millions(total['cache_read_input_tokens']):>6}  {millions(weighted(total)):>6}"
        )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--session", help="id сессии (по умолчанию — последняя изменённая, то есть текущая)")
    parser.add_argument("--line", action="store_true", help="только ячейка «Токены» для docs/tokens.md")
    parser.add_argument("--history", action="store_true", help="все сессии проекта: размер контекста и расход")
    args = parser.parse_args()

    paths = transcripts(Path(os.environ.get("CLAUDE_PROJECT_DIR") or git_root()))
    if not paths:
        print("транскриптов проекта не найдено", file=sys.stderr)
        return 1
    if args.history:
        print_history(paths)
        return 0
    path = next((p for p in paths if p.stem.startswith(args.session)), None) if args.session else paths[-1]
    if path is None:
        print(f"сессия {args.session} не найдена", file=sys.stderr)
        return 1
    session = load_session(path)
    if args.line:
        print(cell(session))
    else:
        print_session(session)
    return 0


if __name__ == "__main__":
    sys.exit(main())
