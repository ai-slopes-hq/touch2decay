import Foundation

// IV · Natura: константы, геометрия реки и предметов, ноты, тексты — worlds/natura/{model,scene,view}.js.
// Время для картинки — секунды; в формулах веба (мс) — now·1000.
enum Nat {
  static let slot = 4, npad = 16
  static let waves = ["sine", "square", "triangle", "saw", "sharp"]
  static let fxKeys = ["reverb", "delay", "time", "chorus", "cutoff", "res", "att", "rel", "chance"]
  static let fxDef: [Double] = [0.4, 0.45, 0.5, 0.4, 0.62, 0.25, 0.08, 0.45, 1]
  static let locks = ["cutoff", "res", "att", "rel"]
  // демо: место → (нота, цветок)
  static let demo: [(i: Int, note: Int, wave: Int)] = [
    (0, 2, 0), (2, 7, 1), (3, 5, 0), (5, 11, 2), (6, 9, 0), (8, 4, 1), (9, 7, 2), (11, 0, 0), (13, 12, 1)]
  static let bpm0 = 96.0, len0 = 12, goneS = 4.0
  static let t0 = 0.14, ts = 0.72, lily = 18.0
  static let mirrorN = 160, head = 16, padN = 9

  // коды action ядра — core/worlds/natura/world.hpp
  enum Act {
    static let state = 0, play = 1, hear = 2, shake = 3, skiff = 4, skiffOff = 5, wave = 6, croak = 7, laser = 8, scare = 9
    static let plant = 10, remove = 11, move = 12, note = 13, len = 14, pglide = 15, pwave = 16, pchance = 17
    static let plock = 18, punlock = 19, setfx = 20, setbpm = 21, shakeby = 22, clear = 23, dice = 24
  }

  // огибающая: attack 2 мс … 0.6 с, release 50 мс … 1.9 с
  static func attOf(_ v: Double) -> Double { 0.002 + v * v * 0.6 }
  static func relOf(_ v: Double) -> Double { 0.05 + v * v * 1.85 }
  static let divs: [(name: String, beats: Double)] = [("1/16", 0.25), ("1/8", 0.5), ("1/8d", 0.75), ("1/4", 1), ("1/4d", 1.5), ("1/2", 2)]
  static func div(_ time: Double) -> (name: String, beats: Double) {
    let k = Int(Horo.jsRound(time * Double(divs.count - 1)))
    return divs[min(divs.count - 1, max(0, k))]
  }
  static func clamp(_ x: Double, _ a: Double = 0, _ b: Double = 1) -> Double { min(b, max(a, x)) }
}

struct NatRiver {
  var x, y, w, tx, ty, nx, ny: Double
  // q: −0.5 … 0.5 — от берега до берега
  func across(_ q: Double) -> (x: Double, y: Double) { (x + nx * q * w, y + ny * q * w) }
}

struct NatDuck { var x, y, s, dir: Double }

// геометрия сцены (scene.js:16-50, 166, 264-295, 369-380, 453); x — в координатах сцены (без ox)
struct NatGeo {
  let ox: Double, W: Double, H: Double, top: Double, bot: Double, h: Double, hor: Double, y1: Double
  let sun: (x: Double, y: Double, r: Double)
  let tree: (x: Double, y: Double)
  let cloudY: Double
  let P: [(x: Double, y: Double)]

  // W — полный экран; сцена не шире 0.62 высоты и стоит по центру
  init(W full: Double, H: Double, topY: Double, safeBot: Double) {
    let w = min(full, Horo.jsRound((H - safeBot) * 0.62))
    ox = Horo.jsRound((full - w) / 2); W = w; self.H = H
    top = topY + 26; bot = H - safeBot - 40; h = bot - top
    hor = top + 0.3 * h; y1 = bot - 6
    sun = (13, topY + 2, min(70, w * 0.18))
    tree = (w * 0.85, top + 0.47 * h)
    cloudY = top + 0.06 * h
    P = [(w * 0.44, hor), (w * 0.12, hor + 0.66 * (top + 0.76 * h - hor)), (w * 1.12, top + 0.76 * h)]
  }

  func river(_ t: Double) -> NatRiver {
    let u = 1 - t, a = P[0], b = P[1], d = P[2]
    let x = u * u * a.x + 2 * u * t * b.x + t * t * d.x, y = u * u * a.y + 2 * u * t * b.y + t * t * d.y
    var tx = 2 * u * (b.x - a.x) + 2 * t * (d.x - b.x), ty = 2 * u * (b.y - a.y) + 2 * t * (d.y - b.y)
    let l = hypot(tx, ty); let ll = l == 0 ? 1 : l
    tx /= ll; ty /= ll
    return NatRiver(x: x, y: y, w: W * (0.12 + 0.5 * pow(t, 0.9)), tx: tx, ty: ty, nx: ty, ny: -tx)
  }

  // точка экрана → место на реке (t, поперёк в долях ширины)
  func onRiver(_ x: Double, _ y: Double) -> (t: Double, q: Double) {
    var best = (t: 0.0, q: 0.0), bd = 1e9
    for k in 0...96 {
      let t = Double(k) / 96, r = river(t), dx = x - r.x, dy = y - r.y, al = dx * r.tx + dy * r.ty
      if abs(al) < bd { bd = abs(al); best = (t, (dx * r.nx + dy * r.ny) / r.w) }
    }
    return best
  }
  func inRiver(_ x: Double, _ y: Double) -> Bool {
    let o = onRiver(x, y)
    return o.t > 0.1 && o.t < 0.995 && abs(o.q) < 0.5 + 6 / river(o.t).w
  }

  static func slotT(_ i: Int) -> Double { Nat.t0 + (Double(i) + 0.5) / 16 * Nat.ts }
  func padXY(_ i: Int, _ note: Int) -> (x: Double, y: Double, s: Double) {
    let t = Self.slotT(i), p = river(t).across((Double(note) / 14 - 0.5) * 0.78)
    return (p.x, p.y, 0.6 + 0.8 * t)
  }
  static func slotOf(_ t: Double) -> Int { Int(Nat.clamp(Horo.jsRound((t - Nat.t0) / Nat.ts * 16 - 0.5), 0, 15)) }
  static func noteOf(_ q: Double) -> Int { Int(Nat.clamp(Horo.jsRound((q / 0.78 + 0.5) * 14), 0, 14)) }
  func bridgeT(len: Int) -> Double { Self.slotT(len - 1) + Nat.ts / 16 * 0.75 }

  func sunAt(bpm: Double) -> (x: Double, y: Double, r: Double) {
    (sun.x, sun.y + Nat.clamp((96 - bpm) / 56) * (hor - sun.y - sun.r * 0.35), sun.r)
  }
  func pond() -> (x: Double, y: Double, rx: Double, ry: Double) { (W * 0.36, y1 - h * 0.115, W * 0.16, 19) }

  // утки: левая — attack, правая — release; now — секунды
  func ducks(att: Double, rel: Double, now: Double) -> (a: NatDuck, r: NatDuck) {
    let p = pond(), gap = p.rx * 0.4, ry = p.y + 3
    func bob(_ k: Double) -> Double { sin(now * 1000 * 0.0014 + k * 2.1) * 1.2 }
    func S(_ v: Double) -> Double { 12 + 14 * v }
    return (NatDuck(x: p.x - gap, y: ry + bob(0), s: S(att), dir: 1), NatDuck(x: p.x + gap, y: ry + bob(1), s: S(rel), dir: -1))
  }
  func skiffHome() -> (x: Double, y: Double) {
    let r = river(0.3), p = r.across(-0.5 - 30 / r.w)
    return (p.x, p.y + 4)
  }
  func pier() -> (x: Double, y: Double) { let p = river(0.06).across(-0.5); return (p.x - 8, p.y) }
  func cloud(cutoff: Double) -> (s: Double, cx: Double, cy: Double) {
    let s = W * 0.34 / 64
    return (s, min(tree.x, W - 34 * s), cloudY + h * 0.04 + (1 - cutoff) * h * 0.07)
  }
  func crown() -> (x: Double, y: Double, R: Double) {
    let R = min(W * 0.16, h * 0.09)
    return (tree.x, tree.y - h * 0.13 - R * 0.6, R)
  }

  // лист-лодочка: плывёт по течению между местами; стоит — у причала
  func boat(phase: Double?, len: Int, now: Double) -> (x: Double, y: Double, s: Double) {
    guard let ph = phase else { let q = pier(); return (q.x + 16, q.y + 3, 0.8) }
    let t = Nat.t0 + (ph.truncatingRemainder(dividingBy: Double(len)) / 16) * Nat.ts
    let p = river(t).across(sin(now * 1000 * 0.0015) * 0.06)
    return (p.x, p.y - 2, 0.75 + 1.0 * t)
  }

  // птицы — хор; birdsAt — когда спугнули (секунды)
  func birds(chorus: Double, now: Double, birdsAt: Double, into out: inout [(x: Double, y: Double, s: Double, i: Int, fast: Double)]) {
    out.removeAll(keepingCapacity: true)
    let ms = now * 1000
    let n = Int(Horo.jsRound(chorus * 16)), k = Nat.clamp((ms - birdsAt * 1000) / 2600)
    let up = k < 1 ? sin(k * Double.pi) : 0
    guard n > 0 else { return }
    for i in 0..<n {
      let h1 = Double((i * 7919) % 1000) / 1000, h2 = Double((i * 3301) % 1000) / 1000, di = Double(i)
      let X = W * (0.3 + 0.55 * h1) + sin(ms * 0.0002 + di) * 18 + up * (h1 - 0.5) * 160
      let Y = top + h * (0.12 + 0.13 * h2) + cos(ms * 0.00027 + di * 1.3) * 6 - up * (60 + 50 * h2)
      out.append((X, Y, 1 + 0.8 * h2, i, up))
    }
  }
}

// лад мира: pcs nil — минор от ля (110 Гц), иначе ступени лада от тоники
struct NatScale {
  var pcs: [Int]?
  var root: Int
  func noteHz(_ n: Int) -> Double {
    let steps: [Int] = pcs.map { $0.map { ($0 - root + 12) % 12 }.sorted() } ?? [0, 2, 3, 5, 7, 8, 10]
    let c = steps.count, q = Int((Double(n) / Double(c)).rounded(.down))
    let semis = steps[((n % c) + c) % c] + 12 * q
    return 110 * pow(2, Double(root + semis) / 12)
  }
  // голос челнока: поперёк реки — высота (с ладом по ступеням, без — плавно между ступенями)
  func skiffHz(_ q: Double) -> Double {
    let d = Nat.clamp((q / 0.78 + 0.5) * 14, 0, 14)
    if pcs != nil { return noteHz(Int(Horo.jsRound(d))) }
    let lo = Int(d.rounded(.down)), hi = min(14, lo + 1), a = log2(noteHz(lo)), b = log2(noteHz(hi))
    return pow(2, a + (b - a) * (d - Double(lo)))
  }
}

private let natNames = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
func natNoteName(_ hz: Double) -> String {
  let m = Int(Horo.jsRound(33 + 12 * log2(hz / 55)))
  return "\(natNames[((m % 12) + 12) % 12])\(Int((Double(m) / 12).rounded(.down)) - 1)"
}
func natHz(_ hz: Double) -> String {
  hz >= 1000 ? String(format: "%.1f kHz", hz / 1000) : "\(Int(Horo.jsRound(hz))) Hz"
}
func natMs(_ s: Double) -> String {
  s < 1 ? "\(Int(Horo.jsRound(s * 1000))) ms" : String(format: "%.2f s", s)
}
