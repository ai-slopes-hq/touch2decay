import Foundation

// XIII · Portus: константы, геометрия бухты, нота кораблика, буй — worlds/portus/{model,view}.js.
enum Por {
  static let slot = 13, nstep = 16, pspan = 12
  static let chords = ["5", "sus", "m7", "m9", "m11"]
  static let dt = [2, 3, 4, 6, 8], dtName = ["1/8", "3/16", "1/4", "3/8", "1/2"]
  static let notes = ["A", "A#", "B", "C", "C#", "D", "D#", "E", "F", "F#", "G", "G#"]
  static let fxKeys = ["wow", "mare", "drive", "spread", "chance"]
  static let mirrorN = 104, head = 24, isleN = 5

  // коды action ядра — core/worlds/portus/world.hpp
  enum Act {
    static let place = 0, sink = 1, move = 2, note = 3, isle = 4, luna = 5, buoy = 6, echo = 7, fog = 8, pharos = 9
    static let bpm = 10, fx = 11, clear = 12, play = 13, kill = 14, audition = 15, dice = 16
  }
  // ACT_LFO: код параметра (fx 0…4, luna 5…7, echo 8…10, fog 11…12)
  enum Lfo { static let fx0 = 0, luna0 = 5, tone = 8, mix = 9, fb = 10, fog0 = 11 }

  // берега бухты (в долях полуширины воды, d — 0 у набережной … 1 на горизонте)
  private static func gs(_ d: Double, _ c: Double, _ w: Double) -> Double { exp(-pow((d - c) / w, 2)) }
  static func edge(_ side: Double, _ d: Double) -> Double {
    let cape = side < 0 ? 0.62 * gs(d, 0.2, 0.13) + 0.3 * gs(d, 0.58, 0.08) + 0.12 * gs(d, 0.86, 0.05)
                        : 0.42 * gs(d, 0.05, 0.12) + 0.32 * gs(d, 0.72, 0.07)
    return side * (1 - cape - 0.022 * sin(d * 17 + side) * (0.3 + d) - 0.012 * sin(d * 43 + 2 * side) * d)
  }
}

private func clamp(_ x: Double, _ a: Double = 0, _ b: Double = 1) -> Double { min(b, max(a, x)) }

// view.js:12-58 — небо, горизонт, бухта между мысами, набережная внизу
struct PorGeo {
  static let K = 2.6, Q1 = 1 / (1 + K)
  let W: Double, H: Double, top: Double, bot: Double, cx: Double, Ws: Double
  let fx0: Double, fx1: Double, hor: Double, qy: Double, Wh: Double
  let moon: (x: Double, y: Double, r: Double, lfo: Double)
  let ph: (x: Double, y: Double)
  let fogTop: Double

  init(W: Double, H: Double, topY: Double, safeBot: Double, cut: Double, fogAmt: Double, cutBase: Double?) {
    self.W = W; self.H = H
    top = topY + 6; bot = H - safeBot - 8
    Ws = min(W, (H - safeBot) * 0.62); cx = W / 2
    fx0 = cx - Ws / 2; fx1 = cx + Ws / 2
    hor = top + (bot - top) * 0.3; qy = bot - 66; Wh = Ws / 2 - 4
    let mr = min(46, W * 0.12)
    // с LFO на cutoff луна стоит на базе, а качание — цвет: ниже базы — кровавая
    moon = (max(0, fx0), hor - mr * 0.35 - (cutBase ?? cut) * (hor - top - mr * 0.9), mr,
            cutBase.map { clamp(0.5 + ($0 - cut) * 1.6) } ?? -1)
    ph = (fx1 - 40, qy - 50)
    fogTop = hor - 6 - fogAmt * (hor - top - 40) * 0.7
  }

  func P(_ u: Double, _ d: Double) -> (x: Double, y: Double, s: Double, wb: Double) {
    let q = 1 / (1 + PorGeo.K * d), k = (q - PorGeo.Q1) / (1 - PorGeo.Q1), wb = Wh * (0.8 + 0.2 * k)
    return (cx + u * wb, hor + (qy - hor) * k, q, wb)
  }
  func unP(_ x: Double, _ y: Double) -> (u: Double, d: Double) {
    let k = clamp((y - hor) / (qy - hor)), q = PorGeo.Q1 + k * (1 - PorGeo.Q1), wb = Wh * (0.8 + 0.2 * k)
    return ((x - cx) / wb, (1 / q - 1) / PorGeo.K)
  }
  static func kOf(_ d: Double) -> Double { (1 / (1 + K * d) - Q1) / (1 - Q1) }       // 1 у набережной … 0 на горизонте
  static func dOfF(_ f: Double) -> Double { let q = Q1 + (1 - f) * (1 - Q1); return (1 / q - 1) / K }
  // фарватер — одна дорожка: 16 мест по высоте экрана, путь изгибается, к горизонту уже
  static func fOf(_ i: Int) -> Double { 0.08 + 0.8 * Double(i) / Double(Por.nstep - 1) }
  static func laneC(_ f: Double) -> Double { 0.08 + 0.24 * sin(f * 3.2 - 0.5) }
  static func laneHW(_ f: Double) -> Double { 0.36 - 0.1 * f }
  func laneAt(_ f: Double, _ a: Double) -> (x: Double, y: Double, s: Double, wb: Double) {   // a: −0.5 … 0.5 поперёк
    P(PorGeo.laneC(f) + a * 2 * PorGeo.laneHW(f), PorGeo.dOfF(f))
  }
  func slotPt(_ i: Int, _ p: Double) -> (x: Double, y: Double, s: Double, wb: Double) {
    laneAt(PorGeo.fOf(i), p / Double(Por.pspan) - 0.5)
  }
  func slotAt(_ x: Double, _ y: Double) -> (i: Int, p: Int)? {         // место и нота под пальцем; мимо фарватера — nil
    let f = (qy - y) / (qy - hor), t = (f - 0.08) / 0.8 * Double(Por.nstep - 1)
    guard t.isFinite else { return nil }
    let i = Int(Horo.jsRound(t))
    guard i >= 0, i < Por.nstep else { return nil }
    let q = unP(x, y), a = (q.u - PorGeo.laneC(f)) / (2 * PorGeo.laneHW(f))
    if abs(a) > 0.66 { return nil }
    return (i, Int(clamp(Horo.jsRound((a + 0.5) * Double(Por.pspan)), 0, Double(Por.pspan))))
  }
  func markPt(_ i: Int) -> (x: Double, y: Double, s: Double, wb: Double) { laneAt(PorGeo.fOf(i), -0.62) }   // веха у левого края
  func inSea(_ x: Double, _ y: Double) -> Bool {
    if y < hor + 3 || y > qy - 6 { return false }
    let q = unP(x, y)
    return q.u > Por.edge(-1, q.d) && q.u < Por.edge(1, q.d)
  }
  static func cliffH(_ side: Double, _ d: Double) -> Double {           // где мыс дальше в воду — там выше скала
    8 + 46 * (1 - abs(Por.edge(side, d))) + 6 * sin(d * 29 + side * 3)
  }
}

struct PorIsle: Equatable { var on = false; var p = 0.0, oct = 0.0, lvl = 1.0, sd = 0.0 }

// тоника от A2: поперёк фарватера — полутоны (с ладом — ступени), плюс октава маяка и кораблика
struct PorScale {
  var pcs: [Int]?
  var root: Int
  func semi(_ p: Double, oct: Double, pharosOct: Double) -> Double {
    var a = p + Double(root)
    if let pcs { a = scaleSnap(a + 24, pcs: pcs) - 24 }
    return a + 12 * (pharosOct + oct)
  }
  func hz(_ p: Double, oct: Double, pharosOct: Double) -> Double { 110 * pow(2, semi(p, oct: oct, pharosOct: pharosOct) / 12) }
  func name(_ p: Double, oct: Double, pharosOct: Double, chord: Int) -> String {
    let m = Int(semi(p, oct: oct, pharosOct: pharosOct).rounded(.down))
    return Por.notes[((m % 12) + 12) % 12] + Por.chords[min(max(chord, 0), Por.chords.count - 1)]
  }
}

func porFc(_ cut: Double) -> Double { 90 * pow(2, 7.2 * cut) }                 // срез: 90 Гц … 13 кГц
func porFb(_ d: Double) -> Double { clamp(0.15 + 0.84 * d, 0, 0.985) }          // дальше буй — дольше эхо
// буй поперёк — по времени эха (0…4)
func porBuoyU(time: Double, d: Double) -> Double {
  let a = Por.edge(-1, d), b = Por.edge(1, d)
  return a + 0.03 + (time / 4) * (b - a - 0.06)
}
// тянешь буй: вдаль — повторы, поперёк (между берегами) — время
func porBuoy(u: Double, d: Double) -> (u: Double, d: Double, time: Double) {
  let d = clamp(d, 0.03, 0.95), a = Por.edge(-1, d), b = Por.edge(1, d)
  let u = clamp(u, a + 0.03, b - 0.03)
  return (u, d, clamp(Horo.jsRound((u - a) / (b - a) * 4), 0, 4))
}
