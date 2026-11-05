import CoreGraphics
import Foundation

// плашка с вкладками (fx · scale · mix · sys): каркас, геометрия, попадания, рисование.
// Содержимое fx — Sheet (его геометрия и касания), scale — список ладов и тоники; mix и sys приходят позже.

enum PlateTab: CaseIterable {
  case fx, scale, mix, sys
  var label: String {
    switch self { case .fx: return "fx"; case .scale: return "scale"; case .mix: return "mix"; case .sys: return "sys" }
  }
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

  // rows — строки содержимого (fx: строки веера, scale: игнорируется); extra — панель LFO под веером
  static func make(_ p: Plate, W: CGFloat, H: CGFloat, safeBot: CGFloat, rows: Int, extra: CGFloat = 0,
                   tabs ts: [PlateTab] = PlateTab.allCases) -> PlateGeo {
    let bottom = H - safeBot - 8, x: CGFloat = 16, w = W - 32
    let n = Scales.labels.count + 1
    let body: CGFloat
    switch p.tab {
    case .fx: body = 52 + CGFloat(rows) * itemH + extra
    case .scale: body = CGFloat(n) * itemH + 16
    case .mix, .sys: body = 16 + CGFloat(rows) * itemH
    }
    let top = bottom - body, stripTop = top - stripH
    let cw = tonW, rx = x + w - 2 * cw, ch = CGFloat(n) * itemH / 6
    let tw = W / CGFloat(max(1, ts.count))
    let rects = ts.enumerated().map { (tab: $1, rect: CGRect(x: CGFloat($0) * tw, y: stripTop, width: tw, height: stripH)) }
    return PlateGeo(x: x, w: w, bottom: bottom, stripTop: stripTop, top: top, tabs: rects,
                    scl: SclGeo(rows: n, top: top + 8, bx: x, rx: rx, cw: cw, ch: ch))
  }
}

enum PlateDraw {
  // fx рисует SheetDraw (панель от g.top); здесь — полоса вкладок и содержимое scale
  static func draw(_ d: Draw, _ p: Plate, _ g: PlateGeo, scl: Scl) {
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
      c.setFillColor(d.paper(0.97)); c.fill(CGRect(x: 0, y: g.top, width: d.W, height: d.H - g.top))
      c.setStrokeColor(d.ink(0.35)); c.setLineWidth(1)
      c.beginPath(); c.move(to: CGPoint(x: 0, y: g.top + 0.5)); c.addLine(to: CGPoint(x: d.W, y: g.top + 0.5)); c.strokePath()
      if p.tab == .scale { drawScale(d, g, scl) }
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
