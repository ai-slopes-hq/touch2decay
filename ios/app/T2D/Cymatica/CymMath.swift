import Foundation

// II · Cymatica: константы, раскладка ханга, высота с луной, геометрия пластины — worlds/cymatica/{core,model,view}.js.
enum Cym {
  static let slot = 2, slots = 16
  static let fMin = 55.0, fMax = 880.0, fDef = 110.0
  static let notes = ["A", "A♯", "B", "C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯"]
  // доли эха в четвертях: t — триоль, d — с точкой
  static let echoDivs: [(String, Double)] = [("1/16t", 1.0 / 6), ("1/16", 1.0 / 4), ("1/8t", 1.0 / 3), ("1/16d", 3.0 / 8), ("1/8", 1.0 / 2),
                                             ("1/4t", 2.0 / 3), ("1/8d", 3.0 / 4), ("1/4", 1), ("1/4d", 3.0 / 2)]
  static let driftRates: [(String, Int)] = [("4 bars", 16), ("2 bars", 8), ("1 bar", 4), ("1/2", 2), ("1/4", 1)]
  static let structs = 7                                    // ручек structure в model.hpp — по числу fx
  static let fxKeys = ["structure", "damping", "brightness", "hall", "echo", "time", "chance"]   // Fx в model.hpp
  static let driftKeys = ["depth", "rate", "shape"]         // DriftKey
  static let ringR = [0.9, 0.7, 0.33]                       // середины колец ханга: край, середина, центр
  static let mirrorN = 175

  // коды action ядра — core/worlds/cymatica/world.hpp
  enum Act {
    static let strike = 2, strikeAt = 7, play = 8, rec = 9, stepRec = 10, skip = 11, cursor = 12, grid = 13, bpm = 14, len = 15
    static let chanceAt = 16, beat = 17, nudge = 18, moveMark = 19, dropMark = 20, comb = 21, turn = 22, driftToggle = 23, driftSet = 24
    static let setF0 = 25, stepScale = 26, setFx = 27, dice = 29, clear = 30
  }

  static func noteName(_ hz: Double) -> String {
    let s = Int(Horo.jsRound(12 * log2(hz / fMin)))
    let o = Int(((Double(s + 9)) / 12).rounded(.down)) + 1
    return notes[((s % 12) + 12) % 12] + String(o)
  }
  private static func pick<T>(_ a: [T], _ x: Double) -> T { a[min(a.count - 1, max(0, Int(Horo.jsRound(x))))] }
  static func echoDiv(_ time: Double) -> (String, Double) { pick(echoDivs, time * 8) }
  static func driftRate(_ rate: Double) -> (String, Int) { pick(driftRates, rate * 4) }
  static func driftDepth(_ depth: Double) -> Int { max(1, Int(Horo.jsRound(depth * 7))) }
}

// лад: pcs — классы высоты (nil — без лада, пентатоника 0 3 5 7 10)
struct CymScale {
  var pcs: [Int]?
  var root: Int
  var on: Bool { pcs != nil }
  private func list(_ top: Int) -> [Int] {
    (0...top).filter { s in pcs.map { $0.contains(((s % 12) + 12) % 12) } ?? [0, 3, 5, 7, 10].contains(s % 12) }
  }
  func noteList() -> [Int] { list(60) }                      // 55–1760 Гц
  func semis() -> [Int] { list(48) }                         // ступени для кубика и луны
  var degPerOct: Int { pcs?.count ?? 5 }
  func snap(_ s: Double) -> Double { pcs.map { scaleSnap(s, pcs: $0) } ?? s }
}

private func clamp(_ x: Double, _ a: Double = 0, _ b: Double = 1) -> Double { min(b, max(a, x)) }

// строгое <, при равенстве — первый
func cymNearestIdx(_ list: [Int], _ s: Double) -> Int {
  var j = 0
  for i in 1..<max(1, list.count) where abs(Double(list[i]) - s) < abs(Double(list[j]) - s) { j = i }
  return j
}

// ханг: по кругу — n секторов от верха по часовой, от края к центру — 3 кольца равной площади; b — индекс ступени пластины
func cymCellIdx(_ x: Double, _ y: Double, b: Int, n: Int) -> Int? {
  let r = hypot(x, y)
  if r > 1 { return nil }
  let ring = r > (2.0 / 3).squareRoot() ? 0 : r > (1.0 / 3).squareRoot() ? 1 : 2
  let tau = Double.pi * 2
  let a = r < 1e-9 ? 0 : (atan2(x, -y) + tau).truncatingRemainder(dividingBy: tau)   // в самом центре угла нет — сектор 0
  return b + ring * n + Int((a / tau * Double(n)).rounded(.down)) % n
}
func cymNoteAt(_ x: Double, _ y: Double, b: Int, n: Int, list: [Int]) -> Int? {
  guard let i = cymCellIdx(x, y, b: b, n: n), i < list.count else { return nil }
  return list[i]
}
func cymCellOf(_ idx: Int, b: Int, n: Int) -> (ring: Int, sector: Int)? {
  let k = idx - b
  return k < 0 || k >= 3 * n ? nil : (k / n, k % n)
}
func cymCellCenter(ring: Int, sector: Int, n: Int) -> (x: Double, y: Double) {
  let a = (Double(sector) + 0.5) / Double(n) * Double.pi * 2, r = Cym.ringR[ring]
  return (r * sin(a), -r * cos(a))
}

// два пальца: поворот или щипок — что изменилось сильнее (угол через ±180° — в градусах, расстояние — в px)
enum CymTwo { case twist, pinch }
func cymTwistOrPinch(a0: Double, a1: Double, d0: Double, d1: Double) -> CymTwo? {
  let dA = abs((((a1 - a0) * 180 / Double.pi + 540).truncatingRemainder(dividingBy: 360)) - 180), dD = abs(d1 - d0)
  if dA < 10 && dD < 20 { return nil }
  return dA / 10 >= dD / 20 ? .twist : .pinch
}

// высота с луной: база (щипок) + k ступеней по ступеням лада — model.js:49-60
func cymEffF0(f0: Double, driftOn: Bool, k: Int, scale: CymScale) -> Double {
  if !driftOn || k == 0 { return f0 }
  let list = scale.semis()
  let i = Int(clamp(Double(cymNearestIdx(list, cymFs(f0)) + k), 0, Double(list.count - 1)))
  return clamp(Cym.fMin * pow(2, Double(list[i]) / 12), Cym.fMin, Cym.fMax)
}
func cymFs(_ eff: Double) -> Double { 12 * log2(eff / Cym.fMin) }
func cymBase(_ fs: Double, scale: CymScale) -> Int { cymNearestIdx(scale.noteList(), fs) }

// view.js:71-89 — пластина посередине (r ∝ f^−¼), кольца астролябии над ней (+64), ▶/● под ней (+104)
struct CymGeo {
  let cx: Double, cy: Double, rMax: Double, r: Double
  let R1: Double, R2: Double, RM: Double, ty: Double
  let playX: Double, recX: Double, gridX: Double, driftX: Double

  init(W: Double, H: Double, topY: Double, safeBot: Double, shownF0: Double) {
    let top = topY, bot = H - safeBot
    rMax = max(40, min(W / 2 - 64, (bot - top - 176) / 2))
    cy = top + (bot - top - (2 * rMax + 168)) / 2 + rMax + 64
    cx = W / 2
    r = rMax * pow(Cym.fMin / shownF0, 0.25)
    R1 = rMax + 22; R2 = rMax + 48; RM = rMax + 35; ty = cy + rMax + 82
    playX = cx - 90; recX = cx - 30; gridX = cx + 30; driftX = cx + 90
  }
  func toPlate(_ x: Double, _ y: Double) -> (x: Double, y: Double) { ((x - cx) / r, (y - cy) / r) }
  func fromPlate(_ x: Double, _ y: Double) -> (x: Double, y: Double) { (cx + x * r, cy + y * r) }
  // 16 гнёзд от верха по часовой
  static func slotAng(_ i: Int) -> Double { -Double.pi / 2 + Double(i) * Double.pi * 2 / Double(Cym.slots) }
  func slotXY(_ i: Int, _ R: Double) -> (x: Double, y: Double) { (cx + R * cos(CymGeo.slotAng(i)), cy + R * sin(CymGeo.slotAng(i))) }
  func slotOf(_ x: Double, _ y: Double) -> Double {
    let s = Double(Cym.slots)
    let v = ((atan2(y - cy, x - cx) + Double.pi / 2) / (Double.pi * 2) * s).truncatingRemainder(dividingBy: s)
    return (v + s).truncatingRemainder(dividingBy: s)
  }
}

// угол экрана справа внизу — резонатор (view.js:672)
func cymResonatorHit(_ x: Double, _ y: Double, W: Double, H: Double, safeBot: Double) -> Bool {
  hypot(x - W, y - (H - safeBot)) < 46
}

struct CymStep: Equatable { var on = false; var vel = 0.0, chance = 1.0, has = false }
struct CymMark: Equatable { var on = false; var x = 0.0, y = 0.0 }
