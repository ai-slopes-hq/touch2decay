import UIKit
import T2DCore

// Natura (мир IV) — связка ядра и Swift: единственный путь действий send, тик, плашка кувшинки, веер, легенда
// (порт worlds/natura/view.js; модель и звук — в ядре, картинка — план (б), касания — NatTouch.swift)
final class NaturaView: World {
  static let slotN = 4

  let slot = NaturaView.slotN
  let theme = Worlds.info(NaturaView.slotN)?.theme ?? .base

  let title = "Natura", sub = "flumen · nymphaeae"
  private(set) lazy var fx: SheetSpec? = fxSpec              // веер собран раз: замыкания читают состояние вживую
  var openSheet: ((SheetSpec) -> Void)?
  var objGone: ((Int) -> Void)?
  var rowLfoOff: ((Int) -> Void)?
  // host/legend.js:25-31
  let legend: [LegendRow] = [
    LegendRow(glyph: .tap, gesture: "tap water · tap a lily", does: "plant a lily · remove it"),
    LegendRow(glyph: .drag, gesture: "drag a lily", does: "across — note · along — step"),
    LegendRow(glyph: .hold, gesture: "hold a lily", does: "its sheet: wave, filter, envelope, chance"),
    LegendRow(glyph: .draw, gesture: "draw through lilies", does: "glide between their notes"),
    LegendRow(glyph: .tap, gesture: "the pier · drag sideways", does: "play · stop · tempo"),
    LegendRow(glyph: .drag, gesture: "drag the weir", does: "loop length"),
    LegendRow(glyph: .up, gesture: "cloud · mountains · ducks — up", does: "cutoff · res · attack, release"),
    LegendRow(glyph: .shake, gesture: "shake the tree", does: "high-pass, leaves rustle"),
    LegendRow(glyph: .throw, gesture: "throw the skiff at the ducks", does: "they fly — envelope wide open"),
    LegendRow(glyph: .tap, gesture: "tap the birds · the sun", does: "laser chirp · map of worlds"),
  ]

  typealias Reader = (inout [Double]) -> Int
  let core: Core
  private(set) var geo: NatGeo
  private(set) var mirror = NatMirror()
  var state = NatState()                                     // единственный экземпляр; касания (NatTouch) зовут его мутирующие методы
  var scl = NatScale(pcs: nil, root: 0)
  let readMirror: Reader, readHeard: Reader
  let rng: () -> Double
  private var mbuf = [Double](repeating: 0, count: 192)
  private var hbuf = [Double](repeating: 0, count: 256)
  private var hks: [(kind: Int, i: Int)] = []
  private var prevOn = [Bool](repeating: false, count: Nat.npad)
  private(set) var now = 0.0
  private(set) var mAt = 0.0                                 // когда пришёл кадр зеркала (для фазы)
  var frogAt: (x: Double, y: Double, s: Double, air: Bool, i: Int)?   // результат state.frog — считает touchTick раз за тик

  // касания (NatTouch.swift): пальцы по Finger.id, челнок, меню цветков, след glide и всплеск — их читает и картинка
  var fingers: [ObjectIdentifier: NatFinger] = [:]
  var skiff = NatSkiff()
  var menu: NatMenu?
  var wake: (path: [(Double, Double)], at: Double)?
  var splash: (x: Double, y: Double, t0: Double)?
  var birdBuf: [(x: Double, y: Double, s: Double, i: Int, fast: Double)] = []   // птицы для попадания, без выделений в кадре
  var padBuf = [NatPad](repeating: NatPad(), count: Nat.npad)                     // места для state.frog

  init(core: Core, readMirror: Reader? = nil, readHeard: Reader? = nil, rng: (() -> Double)? = nil) {
    self.core = core; geo = NatGeo(W: 390, H: 844, topY: 59, safeBot: 34)
    self.readMirror = readMirror ?? { b in Int(t2d_app_mirror(Int32(NaturaView.slotN), &b, Int32(b.count))) }
    self.readHeard = readHeard ?? { b in Int(t2d_app_heard(Int32(NaturaView.slotN), &b, Int32(b.count))) }
    self.rng = rng ?? { var g = SystemRandomNumberGenerator(); return Double.random(in: 0..<1, using: &g) }
    hks.reserveCapacity(64); birdBuf.reserveCapacity(16)
  }

  func layout(W: CGFloat, H: CGFloat, topY: CGFloat, safeBot: CGFloat) { geo = NatGeo(W: Double(W), H: Double(H), topY: Double(topY), safeBot: Double(safeBot)) }
  func cornerHit(_ x: CGFloat, _ y: CGFloat) -> Bool {       // солнце ведёт на карту (координаты сцены — без ox)
    let s = geo.sunAt(bpm: bpm), sx = Double(x) - geo.ox, sy = Double(y)
    return sy > s.y && hypot(sx - s.x, sy - s.y) < s.r + 6
  }
  var objs: Int { (0..<Nat.npad).reduce(0) { $0 + (pad($1).on ? 1 : 0) } }

  // ---------- значения для картинки, касаний и тестов: свои, пока зеркало не догнало ----------
  func pad(_ i: Int) -> NatPad { state.pad(i, mirror: mirror, now: now) }
  var len: Int { state.len(mirror: mirror, now: now) }
  var bpm: Double { state.bpm(mirror: mirror, now: now) }
  var playing: Bool { state.playing(mirror: mirror, now: now) }
  func fxv(_ k: Int) -> Double { state.fx(k, mirror: mirror, now: now) }
  var shake: Double { state.shake(mirror: mirror, now: now) }
  var phase: Double? { state.phase(mirror: mirror, mAt: mAt, now: now) }

  // ---------- действия: единственный путь — ядро и свои значения получают одно и то же ----------
  func send(_ kind: Int, _ i: Int, _ a: [Double] = []) {
    core.action(kind, i, a, touchTime: 0)
    state.own(kind, i, a, mirror: mirror, now: now)
  }

  func dice() {
    send(Act.dice, 0)
    if !playing { send(Act.play, 0, [1]) }
  }
  func clear() { send(Act.clear, 0) }

  func scale(pcs: [Int]?, root: Int) { scl = NatScale(pcs: pcs, root: root) }

  func restored() {                                          // undo: пальцы, меню, своё сброшены
    touchReset()
    state.reset()
  }

  func idle() { for _ in 0..<64 { if readHeard(&hbuf) <= 0 { break } } }   // слить heard без событий: вход в мир не отыграет прошлое

  // ---------- тик ----------
  func tick(now: Double, dt: Double) {
    self.now = now
    let n = min(max(0, readMirror(&mbuf)), mbuf.count)
    if mirror.load(mbuf, n: n) { mAt = now }
    for _ in 0..<4 {                                         // записей может быть больше буфера — читаем до пустого, но не бесконечно
      let hn = min(max(0, readHeard(&hbuf)), hbuf.count)
      if hn == 0 { break }
      hks.removeAll(keepingCapacity: true)
      _ = natHeard(hbuf, n: hn, into: &hks)
      for h in hks { state.heard(h.kind, h.i, now: now) }
    }
    for i in 0..<Nat.npad {                                  // кувшинка пропала (тап, корзина, кубик, отмена, MOVE) — хост закроет плашку и LFO
      let on = pad(i).on
      if prevOn[i] && !on { objGone?(i) }
      prevOn[i] = on
    }
    touchTick(now: now)
  }

  // ---------- плашки ----------
  private static let lockBase = 4                             // fxKeys: cutoff, res, att, rel — с индекса 4, как замки LOCKS
  private func lockIdx(_ k: String) -> Int? { Nat.locks.firstIndex(of: k) }
  private func val(_ p: NatPad, _ k: String) -> Double {
    guard let l = lockIdx(k) else { return 0 }
    return p.lock[l] >= 0 ? p.lock[l] : fxv(Self.lockBase + l)
  }

  // веер: cutoff, res и огибающая — в сцене (туча, горы, утки)
  private static let fanKeys = ["reverb", "delay", "time", "chorus", "chance"]
  private func fxIdx(_ k: String) -> Int { Nat.fxKeys.firstIndex(of: k) ?? 0 }
  var fxSpec: SheetSpec {
    SheetSpec(
      title: "aether", hint: "FX — tap outside to close",
      rows: Self.fanKeys.map { SheetRow(key: $0, label: $0, code: fxIdx($0)) },
      get: { [unowned self] k in fxv(fxIdx(k)) },
      set: { [unowned self] k, v in send(Act.setfx, fxIdx(k), [v]) },
      text: { [unowned self] k in k == "time" ? Nat.div(fxv(fxIdx(k))).name : "\(Int(Horo.jsRound(fxv(fxIdx(k)) * 100)))%" },
      lfo: nil, reset: nil,
      arc: { [unowned self] in fxv(0) })
  }

  // плашка кувшинки: в скобках — общее значение из пейзажа, двойной тап по строке — снова общее
  private static let lilyRows = [("form", "wave"), ("cutoff", "cutoff"), ("res", "res"), ("att", "attack"), ("rel", "release"), ("chance", "chance")]
  private final class HearBox { var at = -1e9 }
  func lilySpec(_ i: Int) -> SheetSpec {
    let hb = HearBox()
    let note = pad(i).note
    return SheetSpec(
      title: "lily \(i + 1) · \(natNoteName(scl.noteHz(note)))", hint: "( ) general · double tap — reset",
      rows: Self.lilyRows.map { SheetRow(key: $0.0, label: $0.1, code: -1) },
      get: { [unowned self] k in
        let p = pad(i)
        return k == "form" ? Double(p.wave) / Double(Nat.waves.count - 1) : k == "chance" ? p.chanceV : val(p, k)
      },
      set: { [unowned self] k, v in
        let p = pad(i)
        guard p.on else { return }
        if k == "form" {
          let w = Int(Horo.jsRound(v * Double(Nat.waves.count - 1)))
          if w != p.wave { send(Act.pwave, i, [Double(w)]); hb.at = -1e9 }
        } else if k == "chance" { send(Act.pchance, i, [Horo.jsRound(v * 20) / 20]) }
        else if let l = lockIdx(k) { send(Act.plock, i, [Double(l), v]) }
        if !playing && now - hb.at > 0.26 { hb.at = now; send(Act.hear, i) }   // послушать
      },
      text: { [unowned self] k in
        let p = pad(i)
        if k == "form" { return Nat.waves[min(max(0, p.wave), Nat.waves.count - 1)] }
        if k == "chance" { return "\(Int(Horo.jsRound(p.chanceV * 100)))%" }
        let v = val(p, k)
        let t = k == "cutoff" ? natHz(180 * pow(2, v * 6.6)) : k == "res" ? "\(Int(Horo.jsRound(v * 100)))%" : natMs(k == "att" ? Nat.attOf(v) : Nat.relOf(v))
        return lockIdx(k).map { p.lock[$0] >= 0 } == true ? t : "(\(t))"
      },
      lfo: nil,
      reset: { [unowned self] k in
        guard pad(i).on else { return }
        if k == "chance" { send(Act.punlock, i, [4]) } else if let l = lockIdx(k) { send(Act.punlock, i, [Double(l)]) }
      },
      arc: nil, obj: i)
  }

  private typealias Act = Nat.Act

  func draw(_ d: Draw, now: Double) {}                       // картинка — план (б)
  func drawShot(_ d: Draw, now: Double) {}
}
