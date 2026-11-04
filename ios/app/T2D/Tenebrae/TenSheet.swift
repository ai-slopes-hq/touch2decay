import UIKit

// Плашка планеты Tenebrae и панель LFO модели (порт app.js: sheetGeo :545, uiHit :600-613, uiDown :681-727, uiMove :762-772,
// uiUp :797, :807-819, lfoStrip :740-749). Формулы пада и полосы форм — Pad из Host/Sheet.swift. Нативные состояния — в TenebraeView

// порядок строк (SHEET_ROWS :543): строка плашки и ключ её LFO
let tenSheetRows: [(row: Row, lfo: LfoKey)] = [(.cut, .cut), (.res, .res), (.beat, .beat), (.fm, .fm), (.shift, .shift), (.amp, .amp)]

// палец на плашке: что он тянет. row — бегунок (v0 — значение в долях на касании, done — двойной тап уже сработал)
struct TenSheetFinger {
  enum Kind { case row(Row, v0: Double, done: Bool), wave, shape(LfoKey), pad(LfoKey) }
  var kind: Kind
  var x0: Double, y0: Double, t0: Double
}

// геометрия плашки (sheetGeo): lfo — открыта ли панель LFO (плашка тогда на 196 выше)
struct TenSheetGeo {
  static let rowH = 40.0
  let x, w, top, bottom, waveY, tx0, tx1, lfoX, lfoTop: Double
  let close, pitch: CGRect
  let panel: SheetGeo.Panel?

  init(W: Double, H: Double, safeBot: Double, lfo: Bool) {
    let bot = H - safeBot - 8, lfoH = lfo ? 196.0 : 0
    x = 16; w = W - 32; bottom = bot
    top = bot - lfoH - Double(tenSheetRows.count) * TenSheetGeo.rowH - 52 - 50
    lfoTop = bot - lfoH
    waveY = top + 52
    tx0 = x + 70; tx1 = x + w - 112; lfoX = x + w - 18
    close = CGRect(x: x + w - 64, y: top + 12, width: 64, height: 30)
    pitch = CGRect(x: x + w - 140, y: top + 12, width: 66, height: 30)
    panel = lfo ? SheetGeo.Panel(x: CGFloat(x), w: CGFloat(w), top: CGFloat(lfoTop + 8), bottom: CGFloat(bot),
                                 shape: (CGFloat(lfoTop + 30), 40), pad: (CGFloat(lfoTop + 78), CGFloat(bot - lfoTop - 78))) : nil
  }
  func rowY(_ i: Int) -> Double { top + 100 + Double(i) * TenSheetGeo.rowH }
  var offChip: CGRect? { panel.map { CGRect(x: $0.x + $0.w - 46, y: $0.top - 6, width: 46, height: 24) } }
}

private func clamp01(_ x: Double) -> Double { x.isNaN ? 0 : min(1, max(0, x)) }
private func inBox(_ x: Double, _ y: Double, _ b: CGRect, pad: Double = 6) -> Bool {   // util.js inBox
  x > Double(b.minX) - pad && x < Double(b.maxX) + pad && y > Double(b.minY) - pad && y < Double(b.maxY) + pad
}

extension TenebraeView {
  var sheetGeo: TenSheetGeo { TenSheetGeo(W: area.W, H: area.H, safeBot: area.safeBot, lfo: sheetLfo != nil) }

  private func rowValue(_ v: TenVoiceM, _ r: Row) -> Double {
    switch r {
    case .wave: return v.wave
    case .cut: return v.cut
    case .res: return v.res
    case .beat: return v.beat
    case .fm: return v.fm
    case .shift: return v.shift
    case .amp: return v.amp
    }
  }

  // ---------- открыть / закрыть ----------
  func openPlanetSheet(_ i: Int) {                           // удержание: плашка планеты i; планета удерживается (KEEP)
    sheetVoice = i
    sheetLfo = nil
    send(Act.keep, 0, [Double(i)])
  }

  // закрыть: UNKEEP (как closeEditor :369); LFO с глубиной, ушедшей в ноль, снимаем
  func closePlanetSheet() {
    guard let i = sheetVoice else { return }
    if voice(i).active { for k in 0..<8 where (voice(i).lfo[k]?.depth ?? 1) < Ten.lfoOff { removeLfo(i, k) } }
    sheetVoice = nil; sheetLfo = nil; sheetFingers = [:]; lastRowTap = nil
    send(Act.unkeep)
  }

  func sheetReset() { sheetVoice = nil; sheetLfo = nil; sheetFingers = [:]; lastRowTap = nil }   // restored: ничего не шлём

  private func removeLfo(_ i: Int, _ k: Int) {
    guard voice(i).lfo[k] != nil else { return }
    vw[i].ph[k] = 0; vw[i].vph[k] = 0
    send(Act.setLfo, i, [Double(k), 0, 0, -1])
  }
  private func sendLfo(_ i: Int, _ k: LfoKey, _ l: TenLfo) {
    if voice(i).lfo[k.rawValue] == nil { vw[i].ph[k.rawValue] = 0; vw[i].vph[k.rawValue] = 0 }
    send(Act.setLfo, i, [Double(k.rawValue), l.morph, l.rate, l.depth])
  }

  // ---------- касание ----------
  func sheetDown(_ f: Finger) -> Bool {
    guard let i = sheetVoice, voice(i).active, let p = pt(f) else { return false }
    let s = sheetGeo, id = f.id
    func start(_ k: TenSheetFinger.Kind) { sheetFingers[id] = TenSheetFinger(kind: k, x0: p.x, y0: p.y, t0: f.t0) }
    if p.y < s.top || inBox(p.x, p.y, s.close, pad: 4) { closePlanetSheet(); return true }
    if inBox(p.x, p.y, s.pitch, pad: 4) { openLfoPanel(i, .pitch); return true }
    if p.y >= s.waveY - 4 && p.y < s.waveY + 40 + 4 { start(.wave); setWave(i, p.x); return true }
    for (n, r) in tenSheetRows.enumerated() where p.y >= s.rowY(n) && p.y < s.rowY(n) + TenSheetGeo.rowH {
      if p.x > s.tx1 + 4 && r.row != .amp { openLfoPanel(i, r.lfo); return true }    // «~» справа — LFO; слева — тянуть
      var done = false
      if let lt = lastRowTap, lt.row == r.row, now - lt.t < Ten.dtap {
        if let d = Ten.rowDef[r.row] { send(Act.set, i, [Double(r.row.rawValue), d]) }
        lastRowTap = nil; done = true
      }
      start(.row(r.row, v0: tenNorm(r.row, rowValue(voice(i), r.row)), done: done))
      return true
    }
    if let k = sheetLfo, let panel = s.panel {
      if voice(i).lfo[k.rawValue] != nil, let o = s.offChip, inBox(p.x, p.y, o) { removeLfo(i, k.rawValue); return true }
      let px = Double(panel.x)
      if p.x >= px - 8 && p.x <= px + Double(panel.w) + 8 {
        if p.y > Double(panel.shape.y) - 6 && p.y < Double(panel.shape.y + panel.shape.h) + 4 { start(.shape(k)); setLfoStrip(i, k, pad: false, p.x, p.y); return true }
        if p.y > Double(panel.pad.y) - 4 && p.y < Double(panel.pad.y + panel.pad.h) + 8 { start(.pad(k)); setLfoStrip(i, k, pad: true, p.x, p.y); return true }
      }
    }
    return true                                              // 'none': съедено
  }

  // «~» строки: LFO на этот параметр и его панель; ещё раз по той же строке — свернуть (LFO остаётся)
  private func openLfoPanel(_ i: Int, _ k: LfoKey) {
    if sheetLfo == k { sheetLfo = nil; return }
    sheetLfo = k
    if voice(i).lfo[k.rawValue] == nil { sendLfo(i, k, Ten.lfoDef) }
  }

  private func setWave(_ i: Int, _ x: Double) {
    let s = sheetGeo
    send(Act.set, i, [Double(Row.wave.rawValue), clamp01((x - s.x - 18) / max(1, s.w - 36))])
  }

  // полоса форм — morph; пад — rate и depth (lfoStrip :740); нет LFO — берём умолчания
  private func setLfoStrip(_ i: Int, _ k: LfoKey, pad: Bool, _ x: Double, _ y: Double) {
    guard let p = sheetGeo.panel else { return }
    var l = voice(i).lfo[k.rawValue] ?? Ten.lfoDef
    if pad { l.rate = Pad.rate(p, CGFloat(x)); l.depth = Pad.depth(p, CGFloat(y)) }
    else { l.morph = Pad.shapeT(p, CGFloat(x)) }
    sendLfo(i, k, l)
  }

  func sheetMove(_ f: Finger) {
    guard let i = sheetVoice, voice(i).active, let sf = sheetFingers[f.id], let p = pt(f) else { return }
    switch sf.kind {
    case .wave: setWave(i, p.x)
    case .row(let r, let v0, let done):
      guard !done else { return }
      let s = sheetGeo, t = clamp01(v0 + (p.x - sf.x0) / max(1, s.tx1 - s.tx0))
      send(Act.set, i, [Double(r.rawValue), tenSetNorm(r, t)])
    case .shape(let k): setLfoStrip(i, k, pad: false, p.x, p.y)
    case .pad(let k): setLfoStrip(i, k, pad: true, p.x, p.y)
    }
  }

  func sheetUp(_ f: Finger) {
    guard let sf = sheetFingers.removeValue(forKey: f.id) else { return }
    guard let i = sheetVoice, voice(i).active else { return }
    switch sf.kind {
    case .row(let r, _, let done):
      let p = pt(f) ?? (sf.x0, sf.y0)
      let quick = now - sf.t0 < Ten.tap && hypot(p.x - sf.x0, p.y - sf.y0) < Ten.tapMove
      lastRowTap = quick && !done ? (r, now) : nil
    case .pad(let k), .shape(let k):                          // глубину увёл в ноль — LFO снят
      if let l = voice(i).lfo[k.rawValue], l.depth < Ten.lfoOff { removeLfo(i, k.rawValue) }
    case .wave: break
    }
  }
}
