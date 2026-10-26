#!/usr/bin/env python3
# Эталон oversample 4× для sdk::Shaper (core/sdk/shaper.hpp): WaveShaperNode с oversample = '4x' в OfflineAudioContext Chromium,
# кривая asym(2.4, 0.35) — как drive Tenebrae (host/audio.js, 4096 точек), вход — синус 1 кГц амплитуды 0.8 при 48 кГц, 4800 сэмплов.
# Печатает C++-массив kShaperOs4Ref — его вставляют в core/tests/sdk_test.cpp (тест shaperOs4).
#   python3 tools/shaper-os4-ref.py   (нужен playwright; сервер не нужен)
import asyncio, sys
from playwright.async_api import async_playwright

SR, LEN = 48000, 4800

JS = '''async ([SR, LEN]) => {
  const n = 4096, c = new Float32Array(n), o = Math.tanh(0.35); let peak = 0;
  for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; c[i] = Math.tanh(2.4 * x + 0.35) - o; peak = Math.max(peak, Math.abs(c[i])); }
  for (let i = 0; i < n; i++) c[i] /= peak;
  const ctx = new OfflineAudioContext(1, LEN, SR), buf = ctx.createBuffer(1, LEN, SR), d = buf.getChannelData(0);
  for (let i = 0; i < LEN; i++) d[i] = 0.8 * Math.sin(2 * Math.PI * 1000 * i / SR);
  const src = new AudioBufferSourceNode(ctx, { buffer: buf }), ws = new WaveShaperNode(ctx, { curve: c, oversample: '4x' });
  src.connect(ws).connect(ctx.destination); src.start(0);
  const out = await ctx.startRendering();
  return Array.from(out.getChannelData(0));
}'''


def lit(v):                                             # float-литерал C++: 0 → 0.0f
    t = f'{v:.9g}'
    return t + ('' if any(c in t for c in '.en') else '.0') + 'f'


async def main():
    async with async_playwright() as pw:
        br = await pw.chromium.launch()
        pg = await br.new_page()
        y = await pg.evaluate(JS, [SR, LEN])
        await br.close()
    print('// asym(2.4, 0.35) 4×, синус 1 кГц · 0.8 при 48 кГц — Chromium (tools/shaper-os4-ref.py)')
    print('static const float kShaperOs4Ref[4800] = {')
    for i in range(0, LEN, 8):
        print('  ' + ', '.join(lit(v) for v in y[i:i + 8]) + ',')
    print('};')


asyncio.run(main())
