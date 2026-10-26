#!/usr/bin/env python3
"""Проверки выкладки на git commit / git push агента (PreToolUse и PostToolUse на Bash).

Блок — код выхода 2, причина в stderr уходит агенту. Предупреждение — additionalContext, команда идёт дальше.
"""

import json
import re
import shlex
import subprocess
import sys
from dataclasses import dataclass, field
from pathlib import Path

BLOCK = 2
SEGMENT_SPLIT = re.compile(r"&&|\|\||[;\n|]")
CACHE_RE = re.compile(r"const CACHE = 't2d-v(\d+)'")
QUERY_V_RE = re.compile(r"\?v=(\d+)")
NOT_SHIPPED_DIRS = ("tools/", "docs/", "core/", "ios/", "mockups/", "notebooks/", ".claude/")
CORE_SOURCE_RE = re.compile(r"^core/.*\.(cpp|hpp|h|c)$")
OFFLINE_EXT = (".js", ".wasm", ".woff2", ".png", ".webmanifest")
NO_WASM_MARK = "[no-wasm]"
COMMIT_ALL_RE = re.compile(r"^(--all|-[a-zA-Z]*a[a-zA-Z]*)$")


@dataclass
class GitCall:
    cwd: Path
    sub: str
    args: list[str]


@dataclass(frozen=True, slots=True)
class Version:
    cache: int | None
    queries: frozenset[int]


@dataclass(frozen=True, slots=True)
class CommitSet:
    files: frozenset[str]
    added: frozenset[str]


@dataclass(frozen=True, slots=True)
class PushTarget:
    local: str
    branch: str


@dataclass
class Verdict:
    errors: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)


def git(cwd: Path, *args: str) -> str:
    out = subprocess.run(["git", "-C", str(cwd), *args], capture_output=True, text=True)
    return out.stdout if out.returncode == 0 else ""


def tokens(segment: str) -> list[str]:
    try:
        return shlex.split(segment)
    except ValueError:
        return segment.split()


def git_calls(command: str, cwd: Path) -> list[GitCall]:
    calls = []
    for segment in SEGMENT_SPLIT.split(command):
        words = tokens(segment)
        if words[:1] == ["cd"] and len(words) > 1:
            cwd = (cwd / Path(words[1]).expanduser()).resolve()
            continue
        if "git" not in words:
            continue
        rest = words[words.index("git") + 1 :]
        call_cwd = cwd
        while rest and rest[0] in ("-C", "-c"):
            if rest[0] == "-C" and len(rest) > 1:
                call_cwd = (cwd / rest[1]).resolve()
            rest = rest[2:]
        if rest:
            calls.append(GitCall(cwd=call_cwd, sub=rest[0], args=rest[1:]))
    return calls


def is_shipped(path: str) -> bool:
    return not path.startswith(NOT_SHIPPED_DIRS) and not path.endswith((".md", ".test.mjs"))


def version_of(sw: str, html: str) -> Version:
    cache = CACHE_RE.search(sw)
    return Version(cache=int(cache.group(1)) if cache else None, queries=frozenset(int(v) for v in QUERY_V_RE.findall(html)))


def version_errors(version: Version, where: str) -> list[str]:
    if version.cache is None:
        return [f"{where}: в sw.js не найден `const CACHE = 't2d-vN'`"]
    if version.queries != {version.cache}:
        return [f"{where}: CACHE в sw.js = v{version.cache}, а ?v= в index.html = {sorted(version.queries)} — поднимай одним числом"]
    return []


def files_added_by(call: GitCall) -> set[str]:
    out = git(call.cwd, "add", "--dry-run", *call.args)
    return {m.group(1) for m in re.finditer(r"^add '(.+)'$", out, re.M)}


def commit_set(call: GitCall, pending_adds: set[str]) -> CommitSet:
    status = git(call.cwd, "diff", "--cached", "--name-status")
    if any(COMMIT_ALL_RE.match(a) for a in call.args):
        status += git(call.cwd, "diff", "--name-status")
    files, added = set(pending_adds), set()
    for line in status.splitlines():
        state, _, path = line.partition("\t")
        if state.startswith("D"):
            continue
        path = path.split("\t")[-1]
        files.add(path)
        if state.startswith("A"):
            added.add(path)
    untracked = set(git(call.cwd, "ls-files", "--others", "--exclude-standard").split("\n"))
    added |= pending_adds & untracked
    return CommitSet(files=frozenset(files), added=frozenset(added))


def check_commit(call: GitCall, command: str, pending_adds: set[str], verdict: Verdict) -> None:
    root = Path(git(call.cwd, "rev-parse", "--show-toplevel").strip() or call.cwd)
    commit = commit_set(call, pending_adds)
    files = commit.files
    if not files or not (root / "sw.js").is_file():
        return
    if {"sw.js", "index.html"} & files:
        verdict.errors += version_errors(version_of((root / "sw.js").read_text(), (root / "index.html").read_text()), "коммит")
    for path in sorted(f for f in files if f.endswith((".js", ".mjs")) and (root / f).is_file()):
        out = subprocess.run(["node", "--check", str(root / path)], capture_output=True, text=True)
        if out.returncode:
            verdict.errors.append(f"node --check {path}:\n{out.stderr.strip()[-600:]}")
    if any(CORE_SOURCE_RE.match(f) for f in files) and "t2d.wasm" not in files and NO_WASM_MARK not in command:
        verdict.errors.append(
            f"тронуто ядро core/, а t2d.wasm не в коммите: core/build.sh и закоммить wasm вместе с правкой "
            f"(правка только нативной стороны — {NO_WASM_MARK} в сообщении коммита)"
        )
    sw = (root / "sw.js").read_text()
    missing = sorted(f for f in commit.added if is_shipped(f) and f.endswith(OFFLINE_EXT) and f"'./{f}'" not in sw)
    if missing:
        verdict.warnings.append(f"новые файлы не в списках sw.js (офлайн не будет): {', '.join(missing)}")


def push_target(call: GitCall) -> PushTarget:
    positional = [a for a in call.args if not a.startswith("-")]
    if len(positional) < 2:
        return PushTarget(local="HEAD", branch=git(call.cwd, "branch", "--show-current").strip())
    local, _, remote = positional[1].partition(":")
    return PushTarget(local=local or "HEAD", branch=(remote or local).removeprefix("refs/heads/"))


def check_push(call: GitCall, verdict: Verdict) -> None:
    target = push_target(call)
    local, branch = target.local, target.branch
    remote_ref = f"origin/{branch}"
    if not branch or not git(call.cwd, "rev-parse", "--verify", "--quiet", remote_ref):
        return
    changed = git(call.cwd, "diff", "--name-only", f"{remote_ref}..{local}").split()
    shipped = [f for f in changed if is_shipped(f)]
    if not shipped:
        return
    version = version_of(git(call.cwd, "show", f"{local}:sw.js"), git(call.cwd, "show", f"{local}:index.html"))
    verdict.errors += version_errors(version, "пуш")
    new, old = version.cache, version_of(git(call.cwd, "show", f"{remote_ref}:sw.js"), "").cache
    if new is not None and old is not None and new <= old:
        verdict.errors.append(
            f"пуш в {branch}: меняются файлы сайта ({', '.join(shipped[:5])}{'…' if len(shipped) > 5 else ''}), "
            f"а версия v{new} не больше, чем в {remote_ref} (v{old}) — подними CACHE и ?v= на v{old + 1}"
        )


def pre_tool_use(command: str, cwd: Path) -> int:
    verdict = Verdict()
    pending_adds: set[str] = set()
    for call in git_calls(command, cwd):
        if call.sub == "add":
            pending_adds |= files_added_by(call)
        elif call.sub == "commit":
            check_commit(call, command, pending_adds, verdict)
        elif call.sub == "push":
            check_push(call, verdict)
    if verdict.errors:
        print("guard.py (.claude/hooks) остановил команду:\n- " + "\n- ".join(verdict.errors), file=sys.stderr)
        return BLOCK
    if verdict.warnings:
        note = "guard.py: " + "; ".join(verdict.warnings)
        print(json.dumps({"hookSpecificOutput": {"hookEventName": "PreToolUse", "additionalContext": note}}, ensure_ascii=False))
    return 0


def post_tool_use(command: str, cwd: Path) -> int:
    if any(call.sub == "push" for call in git_calls(command, cwd)):
        note = "Пуш прошёл. Дождись деплоя одной командой: `python3 tools/deploy-wait.py` (без своих циклов с curl)."
        print(json.dumps({"hookSpecificOutput": {"hookEventName": "PostToolUse", "additionalContext": note}}, ensure_ascii=False))
    return 0


def main() -> int:
    data = json.load(sys.stdin)
    command = (data.get("tool_input") or {}).get("command") or ""
    if "git" not in command:
        return 0
    cwd = Path(data.get("cwd") or ".")
    if data.get("hook_event_name") == "PostToolUse":
        return post_tool_use(command, cwd)
    return pre_tool_use(command, cwd)


if __name__ == "__main__":
    sys.exit(main())
