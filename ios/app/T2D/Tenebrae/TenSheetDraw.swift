import UIKit

// Плашка планеты и панель LFO модели Tenebrae (порт app.js: drawSheet0 :1982-2024, liveRange :212-228, drawLfoPanel0 :1429-1502).
// Текст — внутри d.reading (EB Garamond, прямой). Кадр состояние не меняет

private func clamp(_ x: Double, _ a: Double = 0, _ b: Double = 1) -> Double { x.isNaN ? a : min(b, max(a, x)) }
private func invLog(_ lo: Double, _ hi: Double, _ v: Double) -> Double { log(max(v, lo) / lo) / log(hi / lo) }

private let tenRowLabels = ["cutoff", "res", "detune", "fm", "shift", "amp"]
private let tenLfoLabels = ["pitch", "wave", "cutoff", "res", "detune", "shift", "amp", "fm"]   // LFO_TARGET_LABEL по LfoKey

// где параметр с учётом LFO, в долях луча (normAt :213); lfo — выход LFO (−depth…+depth)
private func tenShiftT(_ hz: Double) -> Double {
  let a = abs(hz)
  if a < 1e-3 { return 0.5 }
  return clamp(0.5 + (hz < 0 ? -1 : 1) * (0.04 + 0.96 * log2(a * 2047 / Ten.shiftMax + 1) / 11) / 2)
}
private func tenNormAt(_ v: TenVoiceM, _ r: Row, _ lfo: Double) -> Double {
  switch r {
  case .wave: return clamp(v.wave + lfo)
  case .cut: return clamp(v.cut + lfo * 4 / log2(Ten.cutHi / Ten.cutLo))
  case .res: return clamp(v.res + lfo * 20 / 24)
  case .beat: return invLog(Ten.beatMin, Ten.beatMax, clamp(v.beat + lfo * 16, Ten.beatMin, Ten.beatMax))
  case .shift: return tenShiftT(tenShiftHz(v.shift) + lfo * 300)
  default: return clamp(v.fm + lfo)
  }
}

extension TenebraeView {
  // для луча с LFO: где значение сейчас и в каких пределах гуляет; LFO нет — nil
  func liveRange(_ i: Int, _ r: Row) -> (lo: Double, hi: Double, now: Double)? {
    guard let k = tenSheetRows.first(where: { $0.row == r })?.lfo, let l = voice(i).lfo[k.rawValue] else { return nil }
    let cur = Waves.morph(clamp(l.morph), vw[i].ph[k.rawValue]) * l.depth
    let a = tenNormAt(voice(i), r, -l.depth), b = tenNormAt(voice(i), r, l.depth)
    return (min(a, b), max(a, b), tenNormAt(voice(i), r, cur))
  }

  // ---------- плашка (:1982) ----------
  func drawSheet(_ p: NatPen, _ d: Draw, nowMs: Double) {
    guard let i = sheetVoice, voice(i).active else { return }
    d.reading { sheet(p, d, i, nowMs: nowMs) }
  }

  private func sheet(_ p: NatPen, _ d: Draw, _ i: Int, nowMs: Double) {
    let v = voice(i), s = sheetGeo, g = d.g
    let pos = screenPos(i)
    d.ring(pos.x, pos.y, tenPlanetR(v.amp) + 9, 0.85, 1.4)               // на поле — кто сейчас в плашке
    g.setFillColor(d.paper(0.97)); g.fill(CGRect(x: 0, y: s.top, width: d.W, height: d.H - s.top))
    g.setStrokeColor(d.ink(0.35)); g.setLineWidth(1)
    g.beginPath(); g.move(to: CGPoint(x: 0, y: s.top + 0.5)); g.addLine(to: CGPoint(x: d.W, y: s.top + 0.5)); g.strokePath()
    g.setFillColor(d.ink(0.3)); g.fill(CGRect(x: d.W / 2 - 18, y: s.top + 5, width: 36, height: 2))
    let hz = tenFreq(soundX(v))
    contour(p, i, x: s.x + 16, y: s.top + 27, R: 13, a: 1, lw: 1.2, glow: false)
    d.mapText("\(tenNoteName(tenInt(Horo.jsRound(tenSemiOf(hz))))) · \(tenInt(Horo.jsRound(hz))) Hz", s.x + 40, s.top + 27, 16, 0.95)
    let pc = s.pitch, pOn = v.lfo[LfoKey.pitch.rawValue] != nil, pSel = sheetLfo == LfoKey.pitch
    d.hairBox(pc.minX, pc.minY, pc.width, pc.height, pSel ? 0.9 : 0.4)
    d.text("~ pitch", pc.midX, pc.midY, 12, pOn ? 1 : 0.6, align: .center)
    d.hairBox(s.close.minX, s.close.minY, s.close.width, s.close.height, 0.5)
    d.text("close", s.close.midX, s.close.midY, 12, 0.85, align: .center)
    // полоса волн: таблицы по местам, рамка — где сейчас морфинг
    d.hairBox(s.x, s.waveY, s.w, 40, 0.3)
    for j in 0..<Waves.count {
      d.drawCurve({ Waves.morph(Double(j) / 8, $0) }, s.x + 18 + Double(j) / 8 * (s.w - 36), s.waveY + 20, 22, 14, 0.4, cycles: 1, lw: 1)
    }
    let wp = clamp(v.wave + vw[i].wv), wx = s.x + 18 + wp * (s.w - 36)
    d.hairBox(wx - 15, s.waveY + 3, 30, 34, 0.95)
    d.drawCurve({ Waves.morph(wp, $0) }, wx, s.waveY + 20, 22, 14, 1, cycles: 1, lw: 1.4)
    for (n, r) in tenSheetRows.enumerated() {                             // строка: имя, нить с бегунком, полоса размаха LFO, значение, «~»
      let cy = s.rowY(n) + TenSheetGeo.rowH / 2, sel = sheetLfo == r.lfo
      let rf = sheetFingers.values.contains { if case .row(let q, _, _) = $0.kind { return q == r.row } else { return false } }
      d.text(tenRowLabels[n], s.x, cy, 14, rf || sel ? 1 : 0.75)
      g.setStrokeColor(d.ink(0.45)); g.setLineWidth(1)
      g.beginPath(); g.move(to: CGPoint(x: s.tx0, y: cy + 0.5)); g.addLine(to: CGPoint(x: s.tx1, y: cy + 0.5)); g.strokePath()
      func T(_ t: Double) -> Double { s.tx0 + clamp(t) * (s.tx1 - s.tx0) }
      if r.row == .shift {
        g.beginPath(); g.move(to: CGPoint(x: T(0.5) + 0.5, y: cy - 5)); g.addLine(to: CGPoint(x: T(0.5) + 0.5, y: cy + 5)); g.strokePath()
      }
      let lr = r.row == .amp ? nil : liveRange(i, r.row)
      if let lr { g.setFillColor(d.ink(0.16)); g.fill(CGRect(x: T(lr.lo), y: cy - 3, width: T(lr.hi) - T(lr.lo), height: 6)) }
      let rowV: Double
      switch r.row { case .cut: rowV = v.cut; case .res: rowV = v.res; case .beat: rowV = v.beat; case .fm: rowV = v.fm
                     case .shift: rowV = v.shift; default: rowV = v.amp }
      d.dot(T(tenNorm(r.row, rowV)), cy, rf ? 8 : 6.5, 1)
      if let lr { d.dot(T(lr.now), cy, 2.2, 0.7) }
      d.text(tenValueText(r.row, rowV), s.tx1 + 12, cy, 13, 0.9)
      if r.row != .amp {                                                   // «~» — кнопка в рамке: есть LFO — залита, открыта панель — двойная рамка
        let on = v.lfo[r.lfo.rawValue] != nil, lx = s.lfoX
        if on { g.setFillColor(d.ink(0.14)); g.fill(CGRect(x: lx - 15, y: cy - 12, width: 30, height: 24)) }
        d.hairBox(lx - 15, cy - 12, 30, 24, sel ? 0.95 : on ? 0.7 : 0.45)
        if sel { d.hairBox(lx - 18, cy - 15, 36, 30, 0.4) }
        g.setStrokeColor(d.ink(on ? 1 : 0.7)); g.setLineWidth(on ? 1.4 : 1.1)
        g.beginPath()
        for q in 0...12 {
          let pt = CGPoint(x: lx - 9 + Double(q) / 12 * 18, y: cy + sin(Double(q) / 12 * 2 * .pi) * 4)
          if q > 0 { g.addLine(to: pt) } else { g.move(to: pt) }
        }
        g.strokePath()
      }
    }
    if let k = sheetLfo { drawLfoPanel(p, d, i, k, nowMs: nowMs) }
  }

  // ---------- панель LFO (:1429) ----------
  func drawLfoPanel(_ p: NatPen, _ d: Draw, _ i: Int, _ k: LfoKey, nowMs: Double) {
    guard let pn = sheetGeo.panel else { return }
    let g = d.g, pd = pn.pad, sh = pn.shape, spec = voice(i).lfo[k.rawValue]
    var strip: Int? = nil                                                  // какой полосой занят палец: 0 — формы, 1 — пад
    for f in sheetFingers.values {
      if case .shape(let q) = f.kind, q == k { strip = 0 }
      if case .pad(let q) = f.kind, q == k { strip = 1 }
    }
    g.setFillColor(d.paper(0.9)); g.fill(CGRect(x: 0, y: pn.top - 10, width: d.W, height: pn.bottom - pn.top + 18))
    g.setStrokeColor(d.ink(0.2)); g.setLineWidth(1)
    g.beginPath(); g.move(to: CGPoint(x: 0, y: pn.top - 9.5)); g.addLine(to: CGPoint(x: d.W, y: pn.top - 9.5)); g.strokePath()
    d.text("LFO → \(tenLfoLabels[k.rawValue])", pn.x, pn.top + 6, 13, 1)
    if let spec {
      let hz = String(format: spec.rate < 10 ? "%.2f" : "%.1f", spec.rate)
      d.text("\(hz) Hz · \(tenInt(Horo.jsRound(spec.depth * 100)))%", pn.x + pn.w - 58, pn.top + 6, 15, 1, align: .right)
      if let o = sheetGeo.offChip {
        d.hairBox(o.minX, o.minY, o.width, o.height, 0.45)
        d.text("off", o.midX, o.midY, 12, 0.75, align: .center)
      }
    } else { d.text("drag the pad", pn.x + pn.w, pn.top + 6, 12, 0.5, align: .right) }

    // форма: таблицы по местам, рамка — текущая
    d.hairBox(pn.x, sh.y, pn.w, sh.h, strip == 0 ? 0.8 : 0.3)
    for j in 0..<Waves.count {
      d.drawCurve({ Waves.morph(Double(j) / 8, $0) }, pn.x + 22 + CGFloat(j) / 8 * (pn.w - 44), sh.y + sh.h / 2, 24, 16, 0.3, cycles: 1, lw: 1.1)
    }
    if let spec {
      let m = clamp(spec.morph), mx = pn.x + 22 + CGFloat(m) * (pn.w - 44)
      d.hairBox(mx - 24, sh.y + 4, 48, sh.h - 8, 0.9)
      d.drawCurve({ Waves.morph(m, $0) }, mx, sh.y + sh.h / 2, 38, 22, 1, cycles: 1.5, lw: 1.6)
    }

    // пад: шкала скорости по низу (0.1 / 1 / 10 Hz), глубины по левому краю
    let on = strip == 1, by = pd.y + pd.h - 0.5
    d.hairBox(pn.x, pd.y, pn.w, pd.h, on ? 0.8 : 0.3)
    g.setStrokeColor(d.ink(0.1)); g.setLineWidth(1)
    g.beginPath()
    for hz in [0.1, 1, 10] {
      let x = Pad.rateX(pn, hz).rounded() + 0.5
      g.move(to: CGPoint(x: x, y: pd.y + 1)); g.addLine(to: CGPoint(x: x, y: by))
    }
    for q in [0.25, 0.5, 0.75] {
      let y = Pad.depthY(pn, q).rounded() + 0.5
      g.move(to: CGPoint(x: pn.x + 1, y: y)); g.addLine(to: CGPoint(x: pn.x + 7, y: y))
      g.move(to: CGPoint(x: pn.x + pn.w - 7, y: y)); g.addLine(to: CGPoint(x: pn.x + pn.w - 1, y: y))
    }
    g.strokePath()
    g.setStrokeColor(d.ink(0.3)); g.beginPath()
    for e in -1...1 { for j in 1...9 {                                     // логарифмические риски
      let hz = Double(j) * pow(10, Double(e))
      if hz < LFO_RATE_MIN || hz > LFO_RATE_MAX { continue }
      let x = Pad.rateX(pn, hz).rounded() + 0.5
      g.move(to: CGPoint(x: x, y: by)); g.addLine(to: CGPoint(x: x, y: by - (j == 1 ? 7 : 3)))
    } }
    g.strokePath()
    for (hz, s) in [(0.1, "0.1"), (1.0, "1"), (10.0, "10 Hz")] { d.text(s, Pad.rateX(pn, hz) + 4, by - 12, 10, 0.45) }
    d.text("depth", pn.x + 10, pd.y + 12, 10, 0.45)
    guard let spec else { return }

    // сама LFO-волна: окно в 2 с, правый край — «сейчас»; размах — глубина
    let cx = Pad.rateX(pn, spec.rate), cy = Pad.depthY(pn, spec.depth), mid = pd.y + pd.h / 2
    let amp = CGFloat(spec.depth) * (pd.h / 2 - PAD_IN), span = 2 * spec.rate, m = clamp(spec.morph)
    let ph0 = vw[i].ph[k.rawValue]
    g.saveGState()
    g.clip(to: CGRect(x: pn.x + 1, y: pd.y + 1, width: pn.w - 2, height: pd.h - 2))
    g.setStrokeColor(d.ink(on ? 0.5 : 0.32)); g.setLineWidth(1.2); g.setLineJoin(.round)
    g.beginPath()
    let N = min(600, max(120, tenInt(Horo.jsRound(span * 24))))
    for q in 0...N {
      let t = Double(q) / Double(N)
      let ph = ((ph0 - (1 - t) * span).truncatingRemainder(dividingBy: 1) + 1).truncatingRemainder(dividingBy: 1)
      let pt = CGPoint(x: pn.x + PAD_IN + CGFloat(t) * (pn.w - 2 * PAD_IN), y: mid - CGFloat(Waves.morph(m, ph)) * amp)
      if q > 0 { g.addLine(to: pt) } else { g.move(to: pt) }
    }
    g.strokePath()
    g.setLineDash(phase: 0, lengths: [2, 4]); g.setStrokeColor(d.ink(0.35)); g.setLineWidth(1)   // перекрестье на значении
    g.beginPath()
    g.move(to: CGPoint(x: cx.rounded() + 0.5, y: pd.y + 1)); g.addLine(to: CGPoint(x: cx.rounded() + 0.5, y: by))
    g.move(to: CGPoint(x: pn.x + 1, y: cy.rounded() + 0.5)); g.addLine(to: CGPoint(x: pn.x + pn.w - 1, y: cy.rounded() + 0.5))
    g.strokePath()
    g.restoreGState()
    d.dot(pn.x + pn.w - PAD_IN, mid - CGFloat(Waves.morph(m, ph0)) * amp, 2.5, 0.9)
    d.ring(cx, cy, on ? 11 : 8, 1, on ? 2 : 1.4)
    d.dot(cx, cy, 2.5, 1)
  }
}
