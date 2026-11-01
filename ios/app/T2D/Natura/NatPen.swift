import UIKit

// кисть Natura: canvas-семантика поверх CGContext (y вниз, углы как у canvas arc — как в InfDraw.swift).
// Цвет — ink(a) / pap(a) темы мира; без аллокаций CGColor и массивов в кадре.
struct NatPen {
  let g: CGContext
  let inkC: RGB
  let papC: RGB

  // scene.js:70 — `line(x, a, w)`: цвет штриха ink(a) и толщина
  func line(_ a: Double, _ w: Double) { strokeInk(a); g.setLineWidth(CGFloat(w)) }
  func fillInk(_ a: Double) { g.setFillColor(red: inkC.r / 255, green: inkC.g / 255, blue: inkC.b / 255, alpha: CGFloat(a)) }
  func fillPap(_ a: Double) { g.setFillColor(red: papC.r / 255, green: papC.g / 255, blue: papC.b / 255, alpha: CGFloat(a)) }
  func strokeInk(_ a: Double) { g.setStrokeColor(red: inkC.r / 255, green: inkC.g / 255, blue: inkC.b / 255, alpha: CGFloat(a)) }

  func begin() { g.beginPath() }
  func close() { g.closePath() }
  func fill() { g.fillPath() }
  func stroke() { g.strokePath() }
  func move(_ x: Double, _ y: Double) { g.move(to: CGPoint(x: x, y: y)) }
  func to(_ x: Double, _ y: Double) { g.addLine(to: CGPoint(x: x, y: y)) }
  func quad(_ cx: Double, _ cy: Double, _ x: Double, _ y: Double) { g.addQuadCurve(to: CGPoint(x: x, y: y), control: CGPoint(x: cx, y: cy)) }
  func bez(_ c1x: Double, _ c1y: Double, _ c2x: Double, _ c2y: Double, _ x: Double, _ y: Double) {
    g.addCurve(to: CGPoint(x: x, y: y), control1: CGPoint(x: c1x, y: c1y), control2: CGPoint(x: c2x, y: c2y))
  }
  func rect(_ x: Double, _ y: Double, _ w: Double, _ h: Double) { g.addRect(CGRect(x: x, y: y, width: w, height: h)) }
  func fillRect(_ x: Double, _ y: Double, _ w: Double, _ h: Double) { g.fill(CGRect(x: x, y: y, width: w, height: h)) }
  func strokeRect(_ x: Double, _ y: Double, _ w: Double, _ h: Double) { g.stroke(CGRect(x: x, y: y, width: w, height: h)) }
  // canvas arc: по возрастанию угла; ccw — против (в CG clockwise при нашем перевороте осей совпадает с canvas anticlockwise)
  func arc(_ x: Double, _ y: Double, _ r: Double, _ a0: Double, _ a1: Double, ccw: Bool = false) {
    g.addArc(center: CGPoint(x: x, y: y), radius: CGFloat(r), startAngle: CGFloat(a0), endAngle: CGFloat(a1), clockwise: ccw)
  }
  // canvas ellipse: путь строится под матрицей, толщина штриха не масштабируется (путь в CG хранится уже преобразованным)
  func ellipse(_ x: Double, _ y: Double, _ rx: Double, _ ry: Double, rot: Double, _ a0: Double, _ a1: Double, ccw: Bool = false) {
    g.saveGState()
    g.translateBy(x: CGFloat(x), y: CGFloat(y)); g.rotate(by: CGFloat(rot)); g.scaleBy(x: CGFloat(rx), y: CGFloat(ry))
    g.addArc(center: .zero, radius: 1, startAngle: CGFloat(a0), endAngle: CGFloat(a1), clockwise: ccw)
    g.restoreGState()
  }
  // pattern — статический массив (не собирать в кадре); пустой — сплошная
  func dash(_ pattern: [CGFloat]) { g.setLineDash(phase: 0, lengths: pattern) }
}

// scene.js:58 — `seed = seed·16807 % 2147483647`
struct NatLCG {
  var seed: Int64 = 11
  mutating func next() -> Double {
    seed = seed * 16807 % 2147483647
    return Double(seed) / 2147483647
  }
}
