import CoreGraphics
import Foundation

// плашка со строками (веер FX мира или своя у мира) и панель LFO строки: типы, геометрия, попадания (порт host/sheet.js; рисование — отдельно)

struct SheetRow { let key, label: String; let code: Int }                 // code — код строки для ACT_LFO
struct SheetLfo { let obj: Int; let keys: Set<String>; let shape: Int }  // obj −1 — FX; shape — набор форм (random)

struct SheetSpec {
  var title, hint: String
  var rows: [SheetRow]
  var get: (String) -> Double                  // 0…1
  var set: (String, Double) -> Void
  var text: (String) -> String
  var lfo: SheetLfo?
  var reset: ((String) -> Void)?               // двойной тап по строке
  var arc: (() -> Double)?                     // дуга на кнопке FX
  var obj: Int? = nil                          // объект-владелец плашки без LFO (город Oceanus): пропал — хост её закрывает
}

// открытая плашка: что показывает, у какой строки открыта панель LFO, мир-владелец
final class Sheet {
  let spec: SheetSpec
  var lfoKey: String?
  let slot: Int
  init(spec: SheetSpec, slot: Int) { self.spec = spec; self.slot = slot }
}

// геометрия — fxGeo + slPanel + slOff
struct SheetGeo {
  struct Row { let k: String; let label: String; let y: CGFloat; let h: CGFloat }
  struct Panel { let x, w, top, bottom: CGFloat; let shape: (y: CGFloat, h: CGFloat); let pad: (y: CGFloat, h: CGFloat) }
  let x, w, top, bottom, lfoTop: CGFloat
  let rows: [Row]
  let tx0, tx1, lfoX: CGFloat
  let panel: Panel
  let off: CGRect

  static func make(_ s: Sheet, W: CGFloat, H: CGFloat, safeBot: CGFloat) -> SheetGeo {
    let sp = s.spec, n = CGFloat(sp.rows.count)
    let bottom = H - safeBot - 8, x: CGFloat = 16, w = W - 32
    let lfoH: CGFloat = sp.lfo != nil && s.lfoKey != nil ? 196 : 0
    let top = bottom - lfoH - 52 - n * 46, lfoTop = bottom - lfoH
    let rows = sp.rows.enumerated().map { Row(k: $1.key, label: $1.label, y: top + 48 + CGFloat($0) * 46, h: 46) }
    let p = Panel(x: x, w: w, top: lfoTop + 8, bottom: bottom, shape: (lfoTop + 30, 40), pad: (lfoTop + 78, bottom - lfoTop - 78))
    return SheetGeo(x: x, w: w, top: top, bottom: bottom, lfoTop: lfoTop, rows: rows,
                    tx0: x + 82, tx1: x + w - (sp.lfo != nil ? 124 : 84), lfoX: x + w - 18,
                    panel: p, off: CGRect(x: p.x + p.w - 46, y: p.top - 6, width: 46, height: 24))
  }
}

enum SheetHit: Equatable { case close, off, strip, pad, lfo(String), row(String), none }

// касания плашки: кнопка FX или мимо — закрыть, «~» — LFO строки, панель (off, полоса форм, пад), строки
func sheetHit(_ s: Sheet, _ g: SheetGeo, x: CGFloat, y: CGFloat, fxBtn: (x: CGFloat, y: CGFloat, r: CGFloat)) -> SheetHit {
  if hypot(x - fxBtn.x, y - fxBtn.y) < fxBtn.r + 6 { return .close }
  let sp = s.spec
  if sp.lfo != nil, s.lfoKey != nil, y >= g.lfoTop {
    let p = g.panel
    if inBox(x, y, g.off) { return .off }
    if y > p.shape.y - 6 && y < p.shape.y + p.shape.h + 4 { return .strip }
    if y > p.pad.y - 4 { return .pad }
    return .none
  }
  if y >= g.top {
    guard let r = g.rows.first(where: { y >= $0.y - 4 && y < $0.y + $0.h }) else { return .none }
    if let l = sp.lfo, l.keys.contains(r.k), x > g.tx1 + 4 + 50 { return .lfo(r.k) }
    return .row(r.k)
  }
  return .close
}

private func inBox(_ x: CGFloat, _ y: CGFloat, _ b: CGRect, pad: CGFloat = 6) -> Bool {   // util.js inBox
  x > b.minX - pad && x < b.maxX + pad && y > b.minY - pad && y < b.maxY + pad
}
private func clamp01(_ v: Double) -> Double { min(1, max(0, v)) }
private func lerpLog(_ a: Double, _ b: Double, _ t: Double) -> Double { a * pow(b / a, t) }
private func invLog(_ a: Double, _ b: Double, _ v: Double) -> Double { log(v / a) / log(b / a) }

// пад панели LFO: скорость по x (логарифм), глубина по y; полоса форм — shapeT
enum Pad {
  static func shapeT(_ p: SheetGeo.Panel, _ x: CGFloat) -> Double { clamp01(Double((x - p.x - 22) / (p.w - 44))) }
  static func rate(_ p: SheetGeo.Panel, _ x: CGFloat) -> Double {
    lerpLog(LFO_RATE_MIN, LFO_RATE_MAX, clamp01(Double((x - p.x - PAD_IN) / (p.w - 2 * PAD_IN))))
  }
  static func depth(_ p: SheetGeo.Panel, _ y: CGFloat) -> Double { clamp01(Double(1 - (y - p.pad.y - PAD_IN) / (p.pad.h - 2 * PAD_IN))) }
  static func rateX(_ p: SheetGeo.Panel, _ hz: Double) -> CGFloat {
    p.x + PAD_IN + CGFloat(invLog(LFO_RATE_MIN, LFO_RATE_MAX, hz)) * (p.w - 2 * PAD_IN)
  }
  static func depthY(_ p: SheetGeo.Panel, _ d: Double) -> CGFloat { p.pad.y + PAD_IN + CGFloat(1 - d) * (p.pad.h - 2 * PAD_IN) }
}
