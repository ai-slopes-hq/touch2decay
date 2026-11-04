import Foundation

// Tenebrae (мир I): константы, поле планет в полярных координатах от солнца, формулы звука для вида (tone.js),
// нормы строк плашки и их подписи. Порт app.js:31-232, :553-561, :1252 и worlds/tenebrae/tone.js

private func clamp(_ x: Double, _ a: Double = 0, _ b: Double = 1) -> Double { x.isNaN ? a : min(b, max(a, x)) }
private func lerpLog(_ lo: Double, _ hi: Double, _ t: Double) -> Double { lo * pow(hi / lo, t) }
private func invLog(_ lo: Double, _ hi: Double, _ v: Double) -> Double { log(v / lo) / log(hi / lo) }

enum Ten {
  static let slot = 1
  static let voices = 6, pinMax = 3, tempMax = 3
  static let linkNew = 0.5
  static let beatMin = 0.05, beatMax = 24.0
  static let ampMin = 0.05, ampMax = 1.8
  static let lfoDef = TenLfo(morph: 0, rate: 1.2, depth: 0.35)
  static let lfoRateMin = 0.03, lfoRateMax = 20.0, lfoOff = 0.03       // depth < lfoOff на отпускании — снять LFO
  static let fLo = 55.0, semis = 60.0, warp = 1.45
  static let cutLo = 40.0, cutHi = 18000.0, shiftMax = 1500.0
  static let grabR = 52.0, handleR = 24.0, pinR = 17.0, ghost = 1.6
  static let holeR = 84.0, sunR = 100.0, edge = 26.0, edgeT = 64.0
  static let sunCornerR = 46.0                                           // солнце-угол
  static let zoomMin = 0.35, phoneField = 430.0 * 860
  static let zoomDef = pow(0.8, 1 / 1.45)
  static let menuDead = 40.0
  static let tap = 0.22, tapMove = 14.0, dtap = 0.32, hold = 0.42, holeMoved = 10.0, holdMove = 10.0
  static let pinchWindow = 0.25, pinchDelta = 26.0, pinchTime = 0.7
  static let bridgeCut = 0.06
  // зеркало ядра: заголовок 15, голос 62, контуры с 387 по 129
  static let head = 15, voiceN = 62, scopeN = 129, scopePts = 128
  static let mirrorN = 387, mirrorFull = 1161
  static let rowDef: [Row: Double] = [.cut: 0.68, .res: 0.21, .wave: 0.125, .shift: 0.5, .beat: 0.35, .fm: 0, .amp: 1]
  static let linkTypes = ["fm", "tzfm", "am", "rm"]
}

// коды действий ядра (core/worlds/tenebrae/world.hpp)
enum Act {
  static let spawn = 16, grab = 17, letGo = 18, keep = 19, unkeep = 20, move = 21, sun = 22, set = 23, pin = 24
  static let attack = 26, release = 27, link = 28, linkDepth = 29, linkType = 30, unlink = 31
  static let setLfo = 32, setFx = 33, dice = 34, wipe = 35
}

// строки плашки; rawValue — ключ SET
enum Row: Int, CaseIterable { case wave = 0, cut, res, beat, fm, shift, amp }
// ключи SETLFO
enum LfoKey: Int { case pitch = 0, wave, cut, res, beat, shift, amp, fm }

// ---------- поле ----------
struct TenGeo {
  let W: Double, H: Double
  let top: Double, bot: Double, ox: Double, oy: Double
  let step = 2.0
  private(set) var r: [Double] = []
  private(set) var a: [Double] = []                  // доля площади дуг до радиуса r[i]

  // topY — верхний inset хоста (scopeY + 44): поле начинается на 56 выше, оно же под строкой кнопок; начало (0, bot) — угол слева внизу
  init(W: Double, H: Double, topY: Double, safeBot: Double) {
    self.W = W; self.H = H
    top = topY - 56; bot = H - safeBot - 4; ox = 0; oy = bot
    var acc = 0.0
    var rr = Ten.edge
    while rr < hypot(W, bot - top) + 4 {
      if let sp = arcSpan(rr) { acc += (sp.hi - sp.lo) * rr * step }
      r.append(rr); a.append(acc)
      rr += step
    }
    let d = acc == 0 ? 1 : acc
    for i in 0..<a.count { a[i] /= d }
  }

  // диапазон углов дуги радиуса r; nil — у самого солнца или дуга пуста
  func arcSpan(_ r: Double) -> (lo: Double, hi: Double)? {
    let w = W - Ten.edge, h = oy - top - Ten.edgeT
    if r <= Ten.sunR { return nil }
    let lo = max(asin(min(1, Ten.edge / r)), acos(min(1, w / r)))
    let hi = min(acos(min(1, Ten.edge / r)), asin(min(1, h / r)))
    return hi > lo ? (lo, hi) : nil
  }

  func rOfP(_ p: Double) -> Double {                 // доля площади → радиус
    let t = min(1, max(1e-4, p))
    var lo = 0, hi = a.count - 1
    while lo < hi { let m = (lo + hi) >> 1; if a[m] < t { lo = m + 1 } else { hi = m } }
    if lo == 0 { return r[0] }
    let k = (t - a[lo - 1]) / max(1e-9, a[lo] - a[lo - 1])
    return r[lo - 1] + k * step
  }

  func pOfR(_ rad: Double) -> Double {               // радиус → доля площади
    guard rad.isFinite else { return rad > 0 ? 1 : 0 }
    let x = min(1e9, max(-1e9, (rad - r[0]) / step)), i = Int(floor(x))     // Int(Double) вне Int падает
    if i < 0 { return 0 }
    if i >= a.count - 1 { return 1 }
    return a[i] + (a[i + 1] - a[i]) * (x - Double(i))
  }

  // радиус орбиты высоты p при зуме (за горизонтом — ∞)
  func rAt(_ p: Double, zoom: Double) -> Double { p / zoom > 1.0001 ? .infinity : rOfP(p / zoom) }

  func place(_ p: Double, _ c: Double, zoom: Double) -> (x: Double, y: Double) {
    let rad = rOfP(min(1, p / zoom)), sp = arcSpan(rad) ?? (Double.pi / 4, Double.pi / 4)
    let th = sp.lo + clamp(c) * (sp.hi - sp.lo)
    return (ox + rad * cos(th), oy - rad * sin(th))
  }

  func unplace(_ x: Double, _ y: Double, zoom: Double) -> (p: Double, c: Double) {
    let dx = x - ox, dy = oy - y
    let q = pOfR(hypot(dx, dy))
    let th = atan2(dy, dx)
    guard let sp = arcSpan(rOfP(q)) else { return (q * zoom, 0.5) }
    return (q * zoom, clamp((th - sp.lo) / (sp.hi - sp.lo)))
  }

  // чёрная дыра — угол поля под строкой кнопок
  var holeAt: (x: Double, y: Double) { (0, top + Ten.edgeT) }

  // глубина дыры: ядро 0…1 и краешек вдоль всего шумного края (слабо съедает тон на любой высоте)
  func holeDepth(_ x: Double, _ y: Double) -> Double {
    let c = holeAt, core = clamp((Ten.holeR - hypot(x - c.x, y - c.y)) / (Ten.holeR * 0.6))
    let edge = min(x - Ten.edge, y - (top + Ten.edgeT))
    return max(core, 0.35 * clamp((16 - edge) / 32))
  }

  func outOfHole(_ x: Double, _ y: Double) -> (x: Double, y: Double) {      // точку внутри горизонта — наружу, в сторону поля
    let c = holeAt, dx = max(0, x - c.x), dy = max(0, y - c.y), d = hypot(dx, dy)
    if hypot(x - c.x, y - c.y) > Ten.holeR + 2 { return (x, y) }
    let k = (Ten.holeR + 2) / (d == 0 ? 1 : d)
    let ux = d != 0 ? dx : 0.5.squareRoot(), uy = d != 0 ? dy : 0.5.squareRoot()
    return (c.x + ux * k, c.y + uy * k)
  }

  // зум по умолчанию: на экране больше телефона видно больше (та же доля площади); iPad — все пять октав
  var zoomDef: Double { clamp(Ten.zoomDef * (W * (bot - top)) / Ten.phoneField, Ten.zoomDef, 1) }

  // радиус кольца свойств: на узком экране меньше, чтобы лучи с подписями помещались
  var menuSpan: Double { max(90, min(150, min(W, H) / 2 - Ten.menuDead - 34)) }
}

// ---------- звук вида (worlds/tenebrae/tone.js) ----------
func tenSemi(_ dx: Double) -> Double { Ten.semis * pow(clamp(dx), Ten.warp) }
func tenXOf(_ semi: Double) -> Double { pow(clamp(semi, 0, Ten.semis) / Ten.semis, 1 / Ten.warp) }
func tenFreq(_ dx: Double) -> Double { Ten.fLo * pow(2, tenSemi(dx) / 12) }                // без лада: с ладом x сначала через tenQuantX
func tenCutoff(_ v: Double, y: Double = 0.5, fmOpen: Double = 0) -> Double {
  clamp(lerpLog(Ten.cutLo, Ten.cutHi, v) * pow(2, (y - 0.5) * 4.5) * pow(2, 1.5 * fmOpen), 20, 20000)
}
func tenShiftHz(_ v: Double) -> Double {                 // середина луча — ноль, дальше вверх, ближе к центру — вниз
  let u = 2 * v - 1, a = abs(u)
  return a < 0.04 ? 0 : (u < 0 ? -1 : 1) * (pow(2, ((a - 0.04) / 0.96) * 11) - 1) * (Ten.shiftMax / 2047)
}
// x поля → x ближайшей ноты лада; pcs — ноты по модулю 12 от A (nil — лад выключен, x как есть)
func tenQuantX(_ dx: Double, pcs: [Int]?, root: Int) -> Double {
  guard let pcs, !pcs.isEmpty else { return dx }
  let s = tenSemi(dx)
  var best = s, bd = 99.0
  for n in Int(floor(s)) - 7...Int(ceil(s)) + 7 {
    if n < 0 || n > Int(Ten.semis) || !pcs.contains(((n % 12) + 12) % 12) { continue }
    let d = abs(Double(n) - s)
    if d < bd { bd = d; best = Double(n) }
  }
  return tenXOf(best)
}

// ---------- строки плашки (app.js:189-228, :553-561, :1252) ----------
// значение строки в долях 0…1 (для бегунка)
func tenNorm(_ r: Row, _ v: Double) -> Double {
  switch r {
  case .beat: return invLog(Ten.beatMin, Ten.beatMax, v)
  case .amp: return v > 0 ? invLog(Ten.ampMin, Ten.ampMax, v) : 0
  default: return v
  }
}
// доля 0…1 → значение модели: shift — защёлка на ноль, beat — лог, amp — лог в дБ, у нуля — off, у 0 дБ — ровно 1
func tenSetNorm(_ r: Row, _ t: Double) -> Double {
  switch r {
  case .beat: return lerpLog(Ten.beatMin, Ten.beatMax, t)
  case .shift: return abs(t - 0.5) < 0.02 ? 0.5 : t
  case .amp:
    let amp = lerpLog(Ten.ampMin, Ten.ampMax, clamp(t))
    return t <= 0.005 ? 0 : abs(20 * log10(amp)) < 0.6 ? 1 : amp
  default: return t
  }
}
func tenAmpText(_ amp: Double) -> String {
  if amp == 0 { return "off" }
  let db = 20 * log10(amp)
  return abs(db) < 0.05 ? "0 dB" : "\(db > 0 ? "+" : "−")\(String(format: "%.1f", abs(db))) dB"
}
// подпись значения строки; v — значение модели (beat в Гц, amp множителем); cut — по tenCutoff(v) без оси Y и FM
func tenValueText(_ r: Row, _ v: Double) -> String {
  switch r {
  case .wave: return Waves.morphName(v)
  case .cut:
    let c = tenCutoff(v)
    return c >= 1000 ? String(format: "%.1f", c / 1000) + " kHz" : "\(Int(Horo.jsRound(c))) Hz"
  case .res, .fm: return "\(Int(Horo.jsRound(v * 100)))%"
  case .beat: return String(format: v < 10 ? "%.2f" : "%.1f", v) + " Hz"
  case .shift:
    let h = tenShiftHz(v)
    return h == 0 ? "off" : (h > 0 ? "+" : "−") + String(format: abs(h) < 10 ? "%.1f" : "%.0f", abs(h)) + " Hz"
  case .amp: return tenAmpText(v)
  }
}
