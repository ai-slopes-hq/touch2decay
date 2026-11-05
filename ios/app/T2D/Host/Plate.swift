import CoreGraphics
import Foundation

// плашка с вкладками (transport · fx · scale · mix · sys): каркас, геометрия, попадания, рисование.
// Содержимое fx — Sheet (его геометрия и касания), scale — список ладов и тоники, mix — фейдеры, sys — настройки, transport — темп и действия.

enum SclPick: Equatable { case off, scale(Int), root(Int), outside }

enum PlateTab: CaseIterable {
  case transport, fx, scale, mix, sys
  var label: String {
    switch self { case .transport: return "transport"; case .fx: return "fx"; case .scale: return "scale"; case .mix: return "mix"; case .sys: return "sys" }
  }
}

struct TransportState {
  var playing = false
  var bpm: Double?                       // nil — у мира нет часов: play и темп погашены
  var range: ClosedRange<Double> = 40...200
  var canUndo = false, diceOn = true, recycleOn = true, diceSpin = false
}

enum PlateHit: Equatable { case tab(PlateTab), content(CGFloat, CGFloat), close, none }

struct Plate {
  var tab: PlateTab
  var scroll: CGFloat = 0

  // fx — только в мире, и только если у мира есть веер
  static func tabs(hasFx: Bool, onMap: Bool) -> [PlateTab] {
    PlateTab.allCases.filter { $0 != .fx || (hasFx && !onMap) }
  }

  // что под пальцем: выше полосы вкладок — закрыть, полоса — вкладка, ниже — содержимое
  static func hit(_ g: PlateGeo, x: CGFloat, y: CGFloat) -> PlateHit {
    if y < g.stripTop { return .close }
    if y < g.top { return g.tabs.first { x >= $0.rect.minX && x < $0.rect.maxX }.map { .tab($0.tab) } ?? .none }
    return .content(x, y)
  }

  // лад под пальцем в содержимом scale; .outside — не на строке и не на тонике
  // вкладка mix: окно из visibleRows строк; scroll сдвигает список вверх
  static func maxScroll(rows n: Int) -> CGFloat { CGFloat(max(0, n - Mixer.visibleRows)) * Mixer.rowH }
  // вкладка transport: старт/стоп часов, темп, бросок, отмена, очистка
  enum TransportRow: CaseIterable { case play, bpm, dice, undo, recycle
    var label: String {
      switch self { case .play: return "play"; case .bpm: return "tempo"; case .dice: return "dice"; case .undo: return "undo"; case .recycle: return "clear" }
    }
  }
  static func transportHit(_ g: PlateGeo, x: CGFloat, y: CGFloat) -> TransportRow? {
    let y0 = g.top + 8, i = Int(floor((y - y0) / itemH))
    guard y >= y0, TransportRow.allCases.indices.contains(i) else { return nil }
    return TransportRow.allCases[i]
  }
  static func transportRowY(_ g: PlateGeo, _ r: TransportRow) -> CGFloat {
    g.top + 8 + CGFloat(TransportRow.allCases.firstIndex(of: r) ?? 0) * itemH + itemH / 2
  }
  // вкладка sys: общий лад, буфер звука, перезапуск, MIDI-часы; общий темп всегда включён — строка неактивна
  enum SysRow: CaseIterable { case scale, stable, restart, midi, tempo
    var label: String {
      switch self { case .scale: return "shared scale"; case .stable: return "stable audio"; case .restart: return "restart audio"
                    case .midi: return "midi clock"; case .tempo: return "shared tempo" }
    }
  }
  static func sysHit(_ g: PlateGeo, x: CGFloat, y: CGFloat) -> SysRow? {
    let y0 = g.top + 8, i = Int(floor((y - y0) / itemH))
    guard y >= y0, SysRow.allCases.indices.contains(i) else { return nil }
    return SysRow.allCases[i]
  }
  static let itemH = PlateGeo.itemH

  enum MixHit: Equatable { case mute(Int), fader(Mixer.Key), none }
  static func mixHit(_ g: PlateGeo, scroll: CGFloat, keys: [Mixer.Key], x: CGFloat, y: CGFloat) -> MixHit {
    let y0 = g.top + 8
    guard y >= y0, y < y0 + CGFloat(Mixer.visibleRows) * Mixer.rowH else { return .none }
    let i = Int(floor((y - y0 + scroll) / Mixer.rowH))
    guard keys.indices.contains(i) else { return .none }
    if case .world(let s) = keys[i], x > g.mixTx1 + 40 { return .mute(s) }
    return x >= g.mixTx0 - 70 ? .fader(keys[i]) : .none
  }

  static func sclPick(_ g: PlateGeo, x: CGFloat, y: CGFloat) -> SclPick {
    let L = g.scl
    if x >= L.rx && x < L.rx + 2 * L.cw && y >= L.top && y < L.top + CGFloat(L.rows) * PlateGeo.itemH {
      let col = Int((x - L.rx) / L.cw), row = min(5, Int((y - L.top) / L.ch))
      return .root(col * 6 + row)
    }
    if x >= L.bx && x < L.bx + PlateGeo.listW && y >= L.top && y < L.top + CGFloat(L.rows) * PlateGeo.itemH {
      let i = Int((y - L.top) / PlateGeo.itemH)
      return i == 0 ? .off : .scale(i - 1)
    }
    return .outside
  }
}

struct PlateGeo {
  static let stripH: CGFloat = 40, itemH: CGFloat = 46, listW: CGFloat = 150, tonW: CGFloat = 56
  struct SclGeo { let rows: Int; let top, bx, rx, cw, ch: CGFloat }
  let x, w, bottom, stripTop, top: CGFloat       // полоса вкладок [stripTop, top), содержимое [top, bottom]
  let tabs: [(tab: PlateTab, rect: CGRect)]
  let scl: SclGeo
  let mixTx0, mixTx1, mixMx: CGFloat                // вкладка mix: дорожка фейдера и кружок mute

  // rows — строки содержимого (fx: строки веера, scale: игнорируется); extra — панель LFO под веером
  static func make(_ p: Plate, W: CGFloat, H: CGFloat, safeBot: CGFloat, rows: Int, extra: CGFloat = 0,
                   tabs ts: [PlateTab] = PlateTab.allCases) -> PlateGeo {
    let bottom = H - safeBot - 8, x: CGFloat = 16, w = W - 32
    let n = Scales.labels.count + 1
    let body: CGFloat
    switch p.tab {
    case .transport: body = 16 + CGFloat(Plate.TransportRow.allCases.count) * itemH
    case .fx: body = 52 + CGFloat(rows) * itemH + extra
    case .scale: body = CGFloat(n) * itemH + 16
    case .mix: body = 16 + CGFloat(Mixer.visibleRows) * Mixer.rowH
    case .sys: body = 16 + CGFloat(Plate.SysRow.allCases.count) * itemH
    }
    let top = bottom - body, stripTop = top - stripH
    let cw = tonW, rx = x + w - 2 * cw, ch = CGFloat(n) * itemH / 6
    let tw = W / CGFloat(max(1, ts.count))
    let rects = ts.enumerated().map { (tab: $1, rect: CGRect(x: CGFloat($0) * tw, y: stripTop, width: tw, height: stripH)) }
    return PlateGeo(x: x, w: w, bottom: bottom, stripTop: stripTop, top: top, tabs: rects,
                    scl: SclGeo(rows: n, top: top + 8, bx: x, rx: rx, cw: cw, ch: ch),
                    mixTx0: x + 118, mixTx1: x + w - 80, mixMx: x + w - 16)
  }
}

enum PlateDraw {
  // круговая стрелка «перезапуск» (k — 1 сразу после перезапуска, до 0): вкладка sys
  static func restartArrow(_ d: Draw, _ bx: CGFloat, _ y: CGFloat, _ k: CGFloat) {
    let g = d.g
    g.setStrokeColor(d.ink(0.5 + 0.5 * k)); g.setLineWidth(1.1); g.beginPath()
    g.addArc(center: CGPoint(x: bx, y: y), radius: 8, startAngle: -0.3, endAngle: .pi * 1.6, clockwise: false); g.strokePath()
    let tx = bx + 8 * cos(-0.3), ty = y + 8 * sin(-0.3)
    g.beginPath(); g.move(to: CGPoint(x: tx - 4, y: ty - 1)); g.addLine(to: CGPoint(x: tx, y: ty)); g.addLine(to: CGPoint(x: tx + 1, y: ty - 4.5)); g.strokePath()
  }

  // fx рисует SheetDraw (панель от g.top); здесь — полоса вкладок и содержимое scale
  static func draw(_ d: Draw, _ p: Plate, _ g: PlateGeo, scl: Scl, mix: Mix = .def, lv: [Float] = [], current: Int? = nil,
                   link: Link = Link(), audio: AudioPref = AudioPref(), restartK: CGFloat = 0, tr: TransportState = TransportState(), vol: Double = Vol.def) {
    d.reading {
      let c = d.g
      c.setFillColor(d.paper(0.97)); c.fill(CGRect(x: 0, y: g.stripTop, width: d.W, height: g.top - g.stripTop))
      for t in g.tabs {
        let on = t.tab == p.tab
        d.text(t.tab.label, t.rect.midX, t.rect.midY, 14, on ? 1 : 0.45, align: .center)
        if on {
          c.setStrokeColor(d.ink(0.8)); c.setLineWidth(1)
          c.beginPath(); c.move(to: CGPoint(x: t.rect.midX - 22, y: t.rect.maxY - 6.5)); c.addLine(to: CGPoint(x: t.rect.midX + 22, y: t.rect.maxY - 6.5)); c.strokePath()
        }
      }
      if p.tab == .fx { return }
      c.setFillColor(d.paper(0.97)); c.fill(CGRect(x: 0, y: g.top, width: d.W, height: g.bottom + 8 - g.top))   // ниже — нижний бар
      c.setStrokeColor(d.ink(0.35)); c.setLineWidth(1)
      c.beginPath(); c.move(to: CGPoint(x: 0, y: g.top + 0.5)); c.addLine(to: CGPoint(x: d.W, y: g.top + 0.5)); c.strokePath()
      if p.tab == .transport { drawTransport(d, g, tr) }
      if p.tab == .scale { drawScale(d, g, scl) }
      if p.tab == .mix { drawMix(d, p, g, mix, lv, current, vol) }
      if p.tab == .sys { drawSys(d, g, link, audio, restartK) }
    }
  }

  private static func drawTransport(_ d: Draw, _ g: PlateGeo, _ t: TransportState) {
    let c = d.g, bx = g.x + g.w - 20
    for (i, r) in Plate.TransportRow.allCases.enumerated() {
      let y = Plate.transportRowY(g, r)
      let on: Bool
      switch r {
      case .play: on = t.bpm != nil
      case .bpm: on = t.bpm != nil
      case .dice: on = t.diceOn
      case .undo: on = t.canUndo
      case .recycle: on = t.recycleOn
      }
      d.text(r.label, g.x, y, 15, on ? 0.95 : 0.35)
      c.setStrokeColor(d.ink(on ? 0.85 : 0.3)); c.setFillColor(d.ink(on ? 0.85 : 0.3)); c.setLineWidth(1.2); c.setLineCap(.round); c.setLineJoin(.round)
      switch r {
      case .play:
        d.ring(bx, y, 12, on ? 0.6 : 0.25, 1.1)
        if t.playing {
          c.fill(CGRect(x: bx - 5, y: y - 6, width: 3.5, height: 12)); c.fill(CGRect(x: bx + 1.5, y: y - 6, width: 3.5, height: 12))
        } else {
          c.beginPath(); c.move(to: CGPoint(x: bx - 4, y: y - 7)); c.addLine(to: CGPoint(x: bx + 6, y: y)); c.addLine(to: CGPoint(x: bx - 4, y: y + 7)); c.closePath(); c.fillPath()
        }
      case .bpm:
        let bpm = t.bpm ?? 120, k = (bpm - t.range.lowerBound) / (t.range.upperBound - t.range.lowerBound)
        Mixer.fader(d, g.mixTx0, g.mixTx1, y, min(max(k, 0), 1), 0, on)
        d.text("\(Int(bpm))", g.mixTx1 + 8, y, 12, on ? 0.7 : 0.3)
      case .dice:
        c.saveGState(); c.translateBy(x: bx, y: y); c.rotate(by: 0.18 + (t.diceSpin ? 0.9 : 0))
        c.addPath(CGPath(roundedRect: CGRect(x: -8, y: -8, width: 16, height: 16), cornerWidth: 3, cornerHeight: 3, transform: nil)); c.strokePath()
        for (px, py) in [(-3.5, -3.5), (3.5, -3.5), (0, 0), (-3.5, 3.5), (3.5, 3.5)] as [(CGFloat, CGFloat)] { d.dot(px, py, 1.2, on ? 0.85 : 0.3) }
        c.restoreGState()
      case .undo:
        c.beginPath(); c.addArc(center: CGPoint(x: bx + 1, y: y + 1), radius: 7, startAngle: .pi * 1.05, endAngle: .pi * 2.35, clockwise: false); c.strokePath()
        c.beginPath(); c.move(to: CGPoint(x: bx - 9.5, y: y - 4)); c.addLine(to: CGPoint(x: bx - 6, y: y + 2)); c.addLine(to: CGPoint(x: bx - 1.5, y: y - 2.5)); c.strokePath()
      case .recycle:
        c.beginPath()
        c.move(to: CGPoint(x: bx - 8, y: y - 5)); c.addLine(to: CGPoint(x: bx + 8, y: y - 5))
        c.move(to: CGPoint(x: bx - 3, y: y - 8)); c.addLine(to: CGPoint(x: bx + 3, y: y - 8))
        c.move(to: CGPoint(x: bx - 6.5, y: y - 5)); c.addLine(to: CGPoint(x: bx - 5, y: y + 8)); c.addLine(to: CGPoint(x: bx + 5, y: y + 8)); c.addLine(to: CGPoint(x: bx + 6.5, y: y - 5))
        c.strokePath()
      }
      c.setLineCap(.butt)
      if i > 0 {
        c.setStrokeColor(d.ink(0.1)); c.setLineWidth(1)
        c.beginPath(); c.move(to: CGPoint(x: g.x, y: y - Plate.itemH / 2 + 0.5)); c.addLine(to: CGPoint(x: g.x + g.w, y: y - Plate.itemH / 2 + 0.5)); c.strokePath()
      }
    }
  }

  private static func drawSys(_ d: Draw, _ g: PlateGeo, _ link: Link, _ audio: AudioPref, _ k: CGFloat) {
    let c = d.g, bx = g.x + g.w - 20
    for (i, r) in Plate.SysRow.allCases.enumerated() {
      let y = g.top + 8 + CGFloat(i) * Plate.itemH + Plate.itemH / 2
      switch r {
      case .restart:
        d.text(k > 0 ? "audio restarted" : r.label, g.x, y, 15, 0.6 + 0.35 * k)
        PlateDraw.restartArrow(d, bx, y, k)
      default:
        let on = r == .scale ? link.scale : r == .stable ? audio.stable : r == .midi ? audio.midi : true
        let a: CGFloat = r == .tempo ? 0.35 : on ? 0.95 : 0.6
        d.text(r.label, g.x, y, 15, a)
        d.ring(bx, y, 9, r == .tempo ? 0.25 : on ? 0.9 : 0.45, 1.1)
        if on { d.dot(bx, y, 4.5, r == .tempo ? 0.3 : 0.9) }
      }
      if i > 0 {
        c.setStrokeColor(d.ink(0.1)); c.setLineWidth(1)
        c.beginPath(); c.move(to: CGPoint(x: g.x, y: y - Plate.itemH / 2 + 0.5)); c.addLine(to: CGPoint(x: g.x + g.w, y: y - Plate.itemH / 2 + 0.5)); c.strokePath()
      }
    }
  }

  private static func drawMix(_ d: Draw, _ p: Plate, _ g: PlateGeo, _ mix: Mix, _ lv: [Float], _ current: Int?, _ vol: Double) {
    let c = d.g, keys = Mixer.rows(current: current), y0 = g.top + 8, h = CGFloat(Mixer.visibleRows) * Mixer.rowH
    c.saveGState()
    c.clip(to: CGRect(x: 0, y: y0, width: d.W, height: h))
    for (i, k) in keys.enumerated() {
      let y = y0 + CGFloat(i) * Mixer.rowH + Mixer.rowH / 2 - p.scroll
      if y < y0 - Mixer.rowH || y > y0 + h + Mixer.rowH { continue }
      switch k {
      case .world(let s):
        guard let wd = Worlds.info(s) else { continue }
        let m = mix.mute[s] == true, t = mix.fader(s), lvl = s < lv.count ? lv[s] : 0
        d.mapText(wd.roman, g.x, y, 12, 0.5); d.mapText(wd.title, g.x + 30, y, 13, m ? 0.35 : s == current ? 1 : 0.85)
        Mixer.fader(d, g.mixTx0, g.mixTx1, y, t, m ? 0 : lvl, !m)
        d.text(Mix.faderText(t), g.mixTx1 + 8, y, 11, 0.5)
        d.ring(g.mixMx, y, 8, m ? 0.9 : 0.4, 1)
        if m {
          c.setStrokeColor(d.ink(0.9)); c.beginPath()
          c.move(to: CGPoint(x: g.mixMx - 5.5, y: y + 5.5)); c.addLine(to: CGPoint(x: g.mixMx + 5.5, y: y - 5.5)); c.strokePath()
        } else if lvl > 0.003 { d.dot(g.mixMx, y, 2 + 2.5 * min(max(CGFloat(lvl) * 6, 0), 1), 0.7) }
      case .volume:
        d.mapText("volume", g.x, y, 13, 0.95)
        Mixer.fader(d, g.mixTx0, g.mixTx1, y, vol, 0, true)
        d.text(Vol.text(vol), g.mixTx1 + 8, y, 11, 0.55)
      case .master(let m):
        d.mapText(m.label, g.x, y, 13, 0.85)
        Mixer.fader(d, g.mixTx0, g.mixTx1, y, mix[m], 0, true)
        d.text(m.text(mix[m]), g.mixTx1 + 8, y, 11, 0.55)
        if m == .lpf {
          c.setStrokeColor(d.ink(0.3)); c.setLineWidth(1); c.beginPath()
          c.move(to: CGPoint(x: g.x, y: y - Mixer.rowH / 2 + 0.5)); c.addLine(to: CGPoint(x: g.x + g.w, y: y - Mixer.rowH / 2 + 0.5)); c.strokePath()
        }
      }
    }
    c.restoreGState()
    let mx = Plate.maxScroll(rows: keys.count)
    if mx > 0 {   // тонкая полоса прокрутки у правого края
      let th = h * h / (h + mx), ty = y0 + (h - th) * p.scroll / mx
      c.setFillColor(d.ink(0.3)); c.fill(CGRect(x: d.W - 5, y: ty, width: 1.5, height: th))
    }
  }

  private static func drawScale(_ d: Draw, _ g: PlateGeo, _ scl: Scl) {
    let c = d.g, L = g.scl, rows = ["off"] + Scales.labels
    for (i, label) in rows.enumerated() {
      let y = L.top + PlateGeo.itemH * (CGFloat(i) + 0.5), on = i == 0 ? !scl.on : scl.on && i - 1 == scl.idx
      d.text(label, L.bx + 22, y, 15, on ? 1 : 0.45)
      if on { d.dot(L.bx + 12, y, 3, 1) }
      if i > 0 {
        let ly = (y - PlateGeo.itemH / 2 + 0.5).rounded(.down) + 0.5
        c.setStrokeColor(d.ink(0.1)); c.setLineWidth(1)
        c.beginPath(); c.move(to: CGPoint(x: L.bx + 8, y: ly)); c.addLine(to: CGPoint(x: L.bx + PlateGeo.listW - 8, y: ly)); c.strokePath()
      }
    }
    for (i, nm) in Scales.notes.enumerated() {
      let col = CGFloat(i / 6), row = CGFloat(i % 6), on = i == scl.root
      if on { d.hairBox(L.rx + L.cw * col + 4, L.top + L.ch * row + 4, L.cw - 8, L.ch - 8, 0.9) }
      d.text(nm, L.rx + L.cw * (col + 0.5), L.top + L.ch * (row + 0.5), 13, on ? 1 : 0.5, align: .center)
    }
  }
}
