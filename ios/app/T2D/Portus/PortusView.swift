import UIKit
import T2DCore

// Portus (мир XIII) — связка ядра и Swift: единственный путь действий send, тик, чтение значений, легенда
// (порт worlds/portus/view.js; модель и звук — в ядре, плашки и веер — PorSheets.swift; касания — задача 6, картинка — план (б))
final class PortusView: World {
  static let slotN = 13

  let slot = PortusView.slotN
  let theme = Worlds.info(PortusView.slotN)?.theme ?? .base

  let title = "Portus", sub = "pharos · echo · nebula"
  private(set) lazy var fx: SheetSpec? = fxSpec              // веер собран раз: замыкания читают состояние вживую
  var openSheet: ((SheetSpec) -> Void)?
  var objGone: ((Int) -> Void)?
  var rowLfoOff: ((Int) -> Void)?
  var goMap: (() -> Void)?
  var lfoBase: ((Int, Int) -> Double?)?
  // view.js:370-373
  let legend: [LegendRow] = [
    LegendRow(glyph: .tap, gesture: "tap the fairway", does: "a paper boat: along — its sixteenth, across — the note"),
    LegendRow(glyph: .drag, gesture: "drag a boat", does: "along — another step, across — another note · tap — it sinks"),
    LegendRow(glyph: .tap, gesture: "tap a marker lamp on the left", does: "a boat on that step, or away"),
    LegendRow(glyph: .tap, gesture: "the lighthouse · drag sideways", does: "play · stop · tempo · hold — chord, octave −2…+2"),
    LegendRow(glyph: .drag, gesture: "drag the moon", does: "filter: up — open, down — it sets · sideways — resonance"),
    LegendRow(glyph: .drag, gesture: "drag the bell buoy", does: "echo: across — time, out to sea — longer"),
    LegendRow(glyph: .up, gesture: "drag the fog up", does: "more reverb"),
    LegendRow(glyph: .tap, gesture: "tap the night sky", does: "a falling star — the echoes die"),
    LegendRow(glyph: .hold, gesture: "hold the moon, buoy, fog, lighthouse, a boat", does: "its sheet"),
    LegendRow(glyph: .tap, gesture: "tap the moon", does: "map of worlds"),
  ]

  typealias Reader = (inout [Double]) -> Int
  typealias Act = Por.Act
  let core: Core
  private(set) var geo: PorGeo
  private(set) var mirror = PorMirror()
  var state = PorState()                                     // единственный экземпляр; касания зовут его мутирующие методы
  var scl = PorScale(pcs: nil, root: 0)
  let readMirror: Reader, readHeard: Reader
  let rng: () -> Double
  private var mbuf = [Double](repeating: 0, count: 128)
  private var hbuf = [Double](repeating: 0, count: 64)
  private var hks: [Int] = []
  private var prevOn = [Bool](repeating: false, count: Por.nstep)
  private var area: (W: Double, H: Double, topY: Double, safeBot: Double) = (390, 844, 59, 34)
  private(set) var now = 0.0

  init(core: Core, readMirror: Reader? = nil, readHeard: Reader? = nil, rng: (() -> Double)? = nil) {
    self.core = core
    geo = PorGeo(W: 390, H: 844, topY: 59, safeBot: 34, cut: 0.42, fogAmt: 0.45, cutBase: nil)
    self.readMirror = readMirror ?? { b in Int(t2d_app_mirror(Int32(PortusView.slotN), &b, Int32(b.count))) }
    self.readHeard = readHeard ?? { b in Int(t2d_app_heard(Int32(PortusView.slotN), &b, Int32(b.count))) }
    self.rng = rng ?? { var g = SystemRandomNumberGenerator(); return Double.random(in: 0..<1, using: &g) }
    hks.reserveCapacity(64)
  }

  func layout(W: CGFloat, H: CGFloat, topY: CGFloat, safeBot: CGFloat) {
    area = (Double(W), Double(H), Double(topY), Double(safeBot))
    rebuildGeo()
  }
  // луна с LFO на cutoff стоит на базе (кровавая — ниже неё); база не конечная — как без LFO
  private func rebuildGeo() {
    let base = lfoBase?(-1, Por.Lfo.luna0).flatMap { $0.isFinite ? $0 : nil }
    geo = PorGeo(W: area.W, H: area.H, topY: area.topY, safeBot: area.safeBot, cut: luna(0), fogAmt: fog(0), cutBase: base)
  }
  func cornerHit(_ x: CGFloat, _ y: CGFloat) -> Bool { false }   // ночью солнца нет: луна в углу — и карта (тап), и фильтр (тянешь)
  var objs: Int { (0..<Por.nstep).reduce(0) { $0 + (isle($1).on ? 1 : 0) } }

  // ---------- значения для картинки, касаний и тестов: свои, пока зеркало не догнало ----------
  func isle(_ j: Int) -> PorIsle { state.isle(j, mirror: mirror, now: now) }
  func luna(_ k: Int) -> Double { state.luna(k, mirror: mirror, now: now) }
  func echo(_ k: Int) -> Double { state.echo(k, mirror: mirror, now: now) }
  var buoy: (u: Double, d: Double) { state.buoy(mirror: mirror, now: now) }
  func fog(_ k: Int) -> Double { state.fog(k, mirror: mirror, now: now) }
  func pharos(_ k: Int) -> Double { state.pharos(k, mirror: mirror, now: now) }
  func fx(_ k: Int) -> Double { state.fx(k, mirror: mirror, now: now) }
  var bpm: Double { state.bpm(mirror: mirror, now: now) }
  var playing: Bool { state.playing(mirror: mirror, now: now) }
  var step: Int { playing ? mirror.step : -1 }
  func hzOf(_ j: Int) -> Double { let s = isle(j); return scl.hz(s.p, oct: s.oct, pharosOct: pharos(1)) }
  func nameOf(_ j: Int) -> String { let s = isle(j); return scl.name(s.p, oct: s.oct, pharosOct: pharos(1), chord: Int(pharos(0))) }

  // ---------- действия: единственный путь — ядро и свои значения получают одно и то же ----------
  func send(_ kind: Int, _ i: Int, _ a: [Double] = []) {
    core.action(kind, i, a, touchTime: 0)
    state.own(kind, i, a, mirror: mirror, now: now)
  }
  func audition(_ j: Int) { if state.audition(playing: playing, now: now) { send(Act.audition, j) } }

  func dice() {
    send(Act.dice, 0)
    if !playing { send(Act.play, 0, [1]) }
  }
  func clear() { send(Act.clear, 0) }

  func scale(pcs: [Int]?, root: Int) { scl = PorScale(pcs: pcs, root: root) }

  func restored() {                                          // undo: пальцы и своё сброшены
    touchReset()
    state.reset()
  }

  func idle() { for _ in 0..<64 { if readHeard(&hbuf) <= 0 { break } } }   // слить heard без событий: вход в мир не отыграет прошлое

  // ---------- тик ----------
  func tick(now: Double, dt: Double) {
    self.now = now
    let n = min(max(0, readMirror(&mbuf)), mbuf.count)
    _ = mirror.load(mbuf, n: n)
    let sec = 60 / bpm / 4                                    // stepSec, model.js:45
    for _ in 0..<4 {                                         // записей может быть больше буфера — читаем до пустого, но не бесконечно
      let hn = min(max(0, readHeard(&hbuf)), hbuf.count)
      if hn == 0 { break }
      hks.removeAll(keepingCapacity: true)
      _ = porHeard(hbuf, n: hn, into: &hks)
      let ti = min(max(0, Int(echo(0))), Por.dt.count - 1)
      for s in hks { state.heard(s, isleOn: isle(s).on, dt: Double(Por.dt[ti]) * sec, fb: porFb(buoy.d), now: now) }
    }
    for j in 0..<Por.nstep {                                 // кораблик пропал (тап, корзина, кубик, отмена, MOVE) — хост закроет плашку и LFO
      let on = isle(j).on
      if prevOn[j] && !on { objGone?(j) }
      prevOn[j] = on
    }
    rebuildGeo()
    touchTick(now: now)
  }

  // касания — задача 6 (PorTouch.swift): пока заглушки
  func touchTick(now: Double) {}
  func touchReset() {}
  func down(_ f: Finger) {}
  func move(_ f: Finger) {}
  func up(_ f: Finger) {}
  func cancel(_ f: Finger) {}

  func draw(_ d: Draw, now: Double) {}                       // картинка — план (б)
  func drawShot(_ d: Draw, now: Double) {}
}
