#!/usr/bin/env python3
"""Сравнение трасс клея: python3 tools/trace-diff.py A B  (папки с <сценарий>.json от T2D_TRACE=... shot.py).

Трасса — список [кадр, kind, i, a] действий слота 1. Нормализация (чтобы сравнивать поведение, а не тайминг):
  - номер кадра не сравнивается (печатается только для диагностики);
  - подряд идущие kind 0 (VOICE) с одним i сворачиваются в последний (частые обновления голоса за жест);
  - числа округляются до 1e-3.
Печатает первое расхождение по каждому сценарию или `ok <сценарий>`; код выхода 1, если есть расхождение
или набор сценариев в папках разный.
"""
import json, os, sys


def norm(tr):
    out = []
    for fr, k, i, a in tr:
        if k == 0 and out and out[-1][1] == 0 and out[-1][2] == i: out.pop()
        out.append((fr, k, i, a))
    return [(fr, k, r(i), r(a)) for fr, k, i, a in out]


def r(x):
    if isinstance(x, float): return round(x, 3)
    if isinstance(x, list): return [r(v) for v in x]
    return x


def main(a, b):
    names = lambda d: {f[:-5] for f in os.listdir(d) if f.endswith('.json')}
    bad = False
    if names(a) != names(b): print('scenario sets differ:', sorted(names(a) ^ names(b))); bad = True
    for n in sorted(names(a) & names(b)):
        x, y = norm(json.load(open(f'{a}/{n}.json'))), norm(json.load(open(f'{b}/{n}.json')))
        d = next((k for k in range(min(len(x), len(y))) if x[k][1:] != y[k][1:]), None)
        if d is None and len(x) != len(y): d = min(len(x), len(y))
        if d is None: print('ok', n, f'({len(x)} actions)'); continue
        bad = True
        print(f'DIFF {n} at #{d}: A={x[d] if d < len(x) else None} B={y[d] if d < len(y) else None} (lens {len(x)}/{len(y)})')
    return 1 if bad else 0


if __name__ == '__main__':
    if len(sys.argv) != 3: sys.exit('usage: trace-diff.py A B')
    sys.exit(main(*sys.argv[1:]))
