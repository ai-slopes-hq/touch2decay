#!/usr/bin/env python3
# Сверка sdk::Param (core/sdk/param.hpp) с AudioParam Chromium: одни и те же события в OfflineAudioContext (ConstantSourceNode.offset,
# события кванта B ставятся в suspend(B·128/sr)) и в core/build/param-cli. Огибающие Tria, Natura (set → lin → target), Portus (cancel),
# target раз в квант (дрон), рампа после идущего target, замена в то же время. Мерило — max |Δ| / max(1, |v|) ≤ 1e-6 (Chromium считает во float: у 931 Гц ulp — 6e-5).
#   python3 tools/param-check.py   (собирает param-cli сам; сервер не нужен)
import asyncio, math, os, struct, subprocess, sys
from playwright.async_api import async_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CLI = os.path.join(ROOT, 'core/build/param-cli')
SR, LEN = 32768, 32768                                  # кванты — точные доли секунды (b·128/sr без округления, как кадры в ядре)

def drone():                                            # target раз в квант к пляшущей цели, τ 12 мс и 50 мс
    ops = []
    for b in range(0, 300):
        ops.append(('target', b, 0.3 + 0.25 * math.sin(b * 0.37) + 0.1 * math.sin(b * 1.9), b * 128 / SR, 0.012))
    return ops

CASES = {
    'bell': [('set', 0, 0, 0.005), ('lin', 0, 0.42, 0.008), ('exp', 0, 0.0004, 0.005 + 0.83), ('lin', 0, 0, 0.005 + 0.84)],
    'index': [('set', 0, 931.7, 0.005), ('exp', 0, max(1, 931.7 * 0.04), 0.005 + 0.498)],
    'thud': [('set', 0, 440, 0.005), ('exp', 0, 220, 0.065)],
    'burst': [('set', 0, 0, 0), ('lin', 0, 0.27, 0.004), ('exp', 0, 0.0005, 0.3), ('lin', 0, 0, 0.31)],
    'late': [('set', 10, 0, 10 * 128 / SR), ('lin', 10, 0.5, 10 * 128 / SR + 0.003), ('exp', 10, 0.0004, 10 * 128 / SR + 0.4), ('lin', 10, 0, 10 * 128 / SR + 0.41)],
    'drone': drone(),
    'natura': [('set', 0, 0, 0.01), ('lin', 0, 1, 0.02), ('target', 0, 0.2, 0.02, 0.1), ('lin', 200, 0, 0.6)],
    'cancel': [('set', 0, 0.1, 0), ('lin', 0, 1, 0.5), ('cancel', 50, 50 * 128 / SR), ('set', 80, 0.3, 80 * 128 / SR), ('target', 90, 0.9, 90 * 128 / SR, 0.05), ('cancel', 120, 0.2)],
    'rampAfterTarget': [('set', 0, 1, 0), ('target', 0, 0, 0.01, 0.05), ('lin', 40, 0.5, 0.2), ('exp', 100, 0.01, 0.6)],
    'replace': [('set', 0, 0.2, 0.1), ('set', 0, 0.7, 0.1), ('lin', 0, 1, 0.3), ('lin', 0, 0.4, 0.3), ('target', 0, 0, 0.5, 0.02)],
    'frac': [('set', 0, 0.3, 0.012345), ('exp', 0, 2.5, 0.0712345), ('exp', 0, 0.01, 0.2), ('lin', 0, -0.5, 0.25), ('target', 0, 0.3, 0.250001, 0)],
}


def build():
    subprocess.run(['clang++', '-std=c++17', '-O2', '-ffp-contract=off', '-Wall', '-Wextra', '-o', CLI, os.path.join(ROOT, 'core/tests/param_cli.cpp')], check=True)


def native(ops):
    lines = [f'sr {SR}', f'len {LEN}', 'def 0'] + [' '.join(str(x) for x in (o[0], *o[1:])) for o in ops]
    r = subprocess.run([CLI], input='\n'.join(lines).encode(), stdout=subprocess.PIPE, check=True)
    return struct.unpack(f'{LEN}f', r.stdout)


JS = '''async ([ops, SR, LEN]) => {
  const ctx = new OfflineAudioContext(1, LEN, SR), src = new ConstantSourceNode(ctx, { offset: 0 }), p = src.offset;
  src.connect(ctx.destination); src.start(0);
  const run = (o) => { const [k, b, v, t, tau] = o; if (k === 'set') p.setValueAtTime(v, t); else if (k === 'lin') p.linearRampToValueAtTime(v, t);
    else if (k === 'exp') p.exponentialRampToValueAtTime(v, t); else if (k === 'target') p.setTargetAtTime(v, t, tau); else if (k === 'cancel') p.cancelScheduledValues(b === undefined ? 0 : v); };
  const byB = new Map();
  for (const o of ops) { const b = o[1]; if (!byB.has(b)) byB.set(b, []); byB.get(b).push(o); }
  for (const [b, list] of byB) {
    const go = () => { for (const o of list) { if (o[0] === 'cancel') p.cancelScheduledValues(o[2]); else run(o); } };
    if (b === 0) go(); else ctx.suspend((b * 128) / SR).then(() => { go(); ctx.resume(); });
  }
  const buf = await ctx.startRendering();
  return Array.from(buf.getChannelData(0));
}'''


async def main():
    build()
    bad = 0
    async with async_playwright() as pw:
        br = await pw.chromium.launch()
        pg = await br.new_page()
        for name, ops in CASES.items():
            web = await pg.evaluate(JS, [[list(o) for o in ops], SR, LEN])
            nat = native(ops)
            d, at = 0, 0
            for i, (a, b) in enumerate(zip(web, nat)):
                e = abs(a - b) / max(1, abs(a))
                if e > d: d, at = e, i
            ok = d <= 1e-6
            bad += not ok
            print(f'{name:16s} max |core − chromium| (rel) {d:.2e} at frame {at} (chromium {web[at]:.7f}, core {nat[at]:.7f}) {"ok" if ok else "FAIL"}')
        await br.close()
    sys.exit(1 if bad else 0)


asyncio.run(main())
