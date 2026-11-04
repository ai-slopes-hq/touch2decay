import UIKit
import T2DCore

// Tenebrae (мир I) — связка ядра и Swift: единственный путь действий send, тик, чтение значений, кубик, веер FX, легенда
// (порт app.js: solTick :1857, rollDice :513, FX :830-840; модель и звук — в ядре, слот 1; касания — TenTouch.swift, картинка — план (б))

// волна от планеты (host/waves: кольцо расходится от x, y); wait — пауза эха delay
struct TenWave { var x, y, r, a, sp: Double; var dash: Bool; var wait = 0.0 }

// вид голоса (VW веба, app.js:77): где планету видно и что качает LFO
struct TenVW {
  var dx = 0.0, wob = 0.0, wv = 0.0, hole = 0.0
  var ph = [Double](repeating: 0, count: 8), vph = [Double](repeating: 0, count: 8)   // фазы LFO по LfoKey: ph — как звучит, vph — как рисуем (≤ 2.5 Гц)
}

private func lerpLog(_ lo: Double, _ hi: Double, _ t: Double) -> Double { lo * pow(hi / lo, t) }
private func invLog(_ lo: Double, _ hi: Double, _ v: Double) -> Double { log(v / lo) / log(hi / lo) }

final class TenebraeView: World {
  static let slotN = 1

  let slot = TenebraeView.slotN
  let theme = Worlds.info(TenebraeView.slotN)?.theme ?? .base

  let title = "Tenebrae", sub = "orbes · strepitus"
  private(set) lazy var fx: SheetSpec? = fanSpec              // веер собран раз: замыкания читают состояние вживую
  var openSheet: ((SheetSpec) -> Void)?
  var objGone: ((Int) -> Void)?
  var rowLfoOff: ((Int) -> Void)?
  var goMap: (() -> Void)?
  var lfoBase: ((Int, Int) -> Double?)?
  // host/legend.js:11-14
  let legend: [LegendRow] = [
    LegendRow(glyph: .tap, gesture: "touch the field", does: "sounds while held · farther from the sun — higher"),
    LegendRow(glyph: .drag, gesture: "drag along the arc", does: "clean low right · noise up left"),
    LegendRow(glyph: .double, gesture: "double tap a planet", does: "pin · unpin"),
    LegendRow(glyph: .hold, gesture: "hold a planet", does: "its sheet: wave, filter, beat, fm, LFO"),
    LegendRow(glyph: .two, gesture: "hold one, touch another", does: "a thread: the second modulates the first"),
    LegendRow(glyph: .pinch, gesture: "pinch empty space", does: "zoom through the octaves"),
    LegendRow(glyph: .drag, gesture: "into the sun · into the hole", does: "lightning strikes · eaten by noise"),
    LegendRow(glyph: .tap, gesture: "tap the sun", does: "map of worlds"),
  ]

  typealias Reader = (inout [Double]) -> Int
  let core: Core
  var geo: TenGeo
  private(set) var mirror = TenMirror()
  var state = TenState()                                     // единственный экземпляр; касания зовут его мутирующие методы
  let readMirror: Reader, readHeard: Reader
  let readLevel: () -> Double
  let rng: () -> Double
  private var mbuf = [Double](repeating: 0, count: 2048)
  private var hbuf = [Double](repeating: 0, count: 256)
  private var evs: [TenHeard] = []
  var area: (W: Double, H: Double, topY: Double, safeBot: Double) = (390, 844, 59, 34)
  private(set) var now = 0.0

  // зум: zoomT — цель, zoom — сглаженный (τ 0.06 с); zoomShow — до какого времени видна подпись
  var zoom: Double, zoomT: Double
  var zoomShow = 0.0
  var vw = [TenVW](repeating: TenVW(), count: Ten.voices)
  var emit = [Double](repeating: 0, count: Ten.voices)       // таймер импульса волн голоса; 1e9 — сразу (рождение)
  var waves: [TenWave] = []                                   // ≤ 60 (вспышка burst — сверх)
  var strikes: [(i: Int, t0: Double, p: Double)] = []        // удары солнца: молния 110 мс, отдача 700 мс
  var full: [(x: Double, y: Double, t: Double)] = []         // отказ «нет голоса» для картинки
  var sunLevel = 0.0
  var sunT = [Double](repeating: -1, count: Ten.voices)      // кеш последнего посланного SUN; −1 — не слали
  var sheetVoice: Int? = nil                                  // планета с открытой плашкой (задача 6)
  var fingers: [ObjectIdentifier: TenFinger] = [:]            // пальцы на поле (TenTouch.swift); restored и cancel их забывают
  var pinch: TenPinch? = nil                                  // пара пальцев щипка зума: договорились (zooming — зум пошёл)
  var lastTap: (v: Int?, t: Double, x: Double, y: Double)? = nil   // последний тап по планете — для двойного
  var refuse: (x: Double, y: Double, t0: Double)? = nil       // отказ «нет голоса» / «закреплённых три» (0.6 с, рисует план (б))
  var hold: (id: ObjectIdentifier, t0: Double)? = nil         // палец, чьё удержание идёт к плашке (кольцо прогресса — план (б))
  var bridge: TenBridge? = nil                                // мост двух пальцев (TenLink.swift)
  var ring: TenRing? = nil                                    // кольцо связи: на весу у пальца или закреплённое
  var ghost: (ring: TenRing, until: Double)? = nil            // погасшее кольцо: 1.6 с можно тапнуть булавку
  var sclPcs: [Int]? = nil, sclRoot = 0                       // лад: ноты по модулю 12 от A; nil — выключен
  var slideUntil = 0.0                                        // после смены лада кружки плавно съезжают к нотам
  private var sized: (Double, Double, Double, Double)?

  init(core: Core, readMirror: Reader? = nil, readHeard: Reader? = nil, readLevel: (() -> Double)? = nil, rng: (() -> Double)? = nil) {
    self.core = core
    geo = TenGeo(W: 390, H: 844, topY: 59, safeBot: 34)
    zoom = geo.zoomDef; zoomT = geo.zoomDef
    self.readMirror = readMirror ?? { b in Int(t2d_app_mirror(Int32(TenebraeView.slotN), &b, Int32(b.count))) }
    self.readHeard = readHeard ?? { b in Int(t2d_app_heard(Int32(TenebraeView.slotN), &b, Int32(b.count))) }
    var lv = [Float](repeating: 0, count: 16)                 // буфер уровней — один на вид
    self.readLevel = readLevel ?? {
      _ = t2d_app_levels(&lv, 16)                              // копирует всегда; false — то же, что в прошлый раз
      return Double(lv.reduce(0) { $0 + $1 * $1 }).squareRoot()
    }
    self.rng = rng ?? { Double.random(in: 0..<1) }
    evs.reserveCapacity(24); waves.reserveCapacity(64); strikes.reserveCapacity(24)
  }

  func layout(W: CGFloat, H: CGFloat, topY: CGFloat, safeBot: CGFloat) {
    area = (Double(W), Double(H), Double(topY), Double(safeBot))
    geo = TenGeo(W: area.W, H: area.H, topY: area.topY, safeBot: area.safeBot)
    let key = (area.W, area.H, area.topY, area.safeBot)
    if sized == nil || sized! != key {                         // ручной зум держится до смены размера (app.js:1013)
      zoomT = geo.zoomDef; zoom = zoomT
      sized = key
    }
  }
  // солнце — предмет-угол: круг r 46 в (0, bot); пока открыта плашка планеты — не карта
  func cornerHit(_ x: CGFloat, _ y: CGFloat) -> Bool {
    sheetVoice == nil && hypot(Double(x) - 0, Double(y) - geo.bot) < Ten.sunCornerR
  }
  var objs: Int { (0..<Ten.voices).reduce(0) { $0 + (voice($1).active ? 1 : 0) } }

  // ---------- значения для картинки, касаний и тестов: свои, пока зеркало не догнало ----------
  func voice(_ i: Int) -> TenVoiceM {
    guard (0..<Ten.voices).contains(i) else { return TenVoiceM() }
    return state.voice(i, mirror: mirror, now: now)
  }
  var fxValues: [Double] { state.fx(mirror: mirror, now: now) }
  var kept: [Int] { state.kept(mirror: mirror, now: now) }
  var sclOn: Bool { sclPcs != nil }
  // x, по которому планета звучит: с ладом — ближайшая нота (soundX веба)
  func soundX(_ v: TenVoiceM) -> Double { tenQuantX(v.x, pcs: sclPcs, root: sclRoot) }
  // где планету видно сейчас (vx / vy веба)
  func screenPos(_ i: Int) -> (x: Double, y: Double) { geo.place(vw[i].dx + vw[i].wob, voice(i).y, zoom: zoom) }

  // ---------- действия: единственный путь — ядро и свои значения получают одно и то же ----------
  func send(_ kind: Int, _ i: Int = 0, _ a: [Double] = [], touchTime: Double = 0) {
    core.action(kind, i, a, touchTime: touchTime)
    state.own(kind, i, a, mirror: mirror, now: now)
  }
  // SUN планете i: только при изменении t (model.js:211); кеш сбрасывают restored и enter
  func sendSun(_ i: Int, _ t: Double, touchTime: Double) {
    guard (0..<Ten.voices).contains(i), sunT[i] != t else { return }
    sunT[i] = t
    send(Act.sun, i, [t], touchTime: touchTime)
  }

  // новая планета на пустом месте (палец или кубик): точку выталкивает из дыры вид, остальное — ядро (app.js:279).
  // nil — голосов нет (отказ рисует вызвавший); ox, oy — сдвиг вытолкнутой точки, палец ведёт планету с ним
  func spawnAt(_ x: Double, _ y: Double, touchTime: Double = 0) -> (i: Int, ox: Double, oy: Double)? {
    let sp = geo.outOfHole(x, y), q = geo.unplace(sp.x, sp.y, zoom: zoom), h = geo.holeDepth(sp.x, sp.y)
    let i = state.pick(mirror: mirror, now: now)
    if i < 0 { return nil }
    send(Act.spawn, i, [q.p, q.c, h], touchTime: touchTime)
    if lastTap?.v == i { lastTap = nil }                       // индекс занят заново — прежний тап к нему не относится
    for k in fingers.keys where fingers[k]?.v == i { fingers[k]?.v = nil }
    vw[i].dx = q.p; vw[i].hole = h; emit[i] = 1e9
    return (i, sp.x - x, sp.y - y)
  }

  // кубик: живые есть — только DICE; нет — сперва закреплённый тон в случайном месте видимой части (app.js:513)
  func dice() {
    if state.anyLive(mirror: mirror, now: now) { send(Act.dice); return }
    let p = zoom * (0.08 + 0.75 * rng()), c = 0.1 + 0.6 * rng()
    let pt = geo.place(p, c, zoom: zoom)
    if let s = spawnAt(pt.x, pt.y) { send(Act.pin, s.i) }
    else { full.append((pt.x, pt.y, now)) }
    send(Act.dice)
  }
  func clear() { send(Act.wipe) }

  func scale(pcs: [Int]?, root: Int) {
    sclPcs = pcs; sclRoot = pcs == nil ? 0 : root
    slideUntil = now + 0.5                                    // dx → soundX плавно; RETUNE не шлём
  }
  func enter() { sunT = [Double](repeating: -1, count: Ten.voices) }

  func restored() {                                          // undo / корзина: пальцы, плашка, свои значения сброшены; вид — из зеркала
    touchReset()
    sheetVoice = nil
    state.reset()
    sunT = [Double](repeating: -1, count: Ten.voices)
    let n = min(max(0, readMirror(&mbuf)), mbuf.count)
    if mirror.load(mbuf, n: n) { state.sync(mirror: mirror, now: now) }
    for i in 0..<Ten.voices {
      let v = voice(i)
      vw[i] = TenVW(dx: v.x, wob: 0, wv: 0, hole: v.holeT)
    }
  }

  func idle() { for _ in 0..<64 { if readHeard(&hbuf) <= 0 { break } } }   // слить heard без событий: вход в мир не отыграет прошлое

  // ---------- тик (solTick :1857-1904 и волны :1911-1936) ----------
  func tick(now: Double, dt: Double) {
    self.now = now
    let dt = dt > 0 ? min(dt, 0.05) : 1.0 / 60
    let n = min(max(0, readMirror(&mbuf)), mbuf.count)
    if mirror.load(mbuf, n: n) { state.sync(mirror: mirror, now: now) }   // сошедшееся своё — прочь: правка зеркала видна сразу

    zoom += (zoomT - zoom) * (1 - exp(-dt / 0.06))
    if abs(zoomT - zoom) < 1e-4 { zoom = zoomT }

    stepVoices(dt)
    stepWaves(dt)
    readEvents()

    sunLevel += (min(1, max(0, readLevel()) * 2.2) - sunLevel) * 0.08
    strikes.removeAll { now - $0.t0 > 0.8 }
    if strikes.count > 24 { strikes.removeFirst(strikes.count - 24) }
    touchTick(now: now)
  }

  // вид голосов: dx → нота лада, LFO качает планету и форму, дыра сглажена
  private func stepVoices(_ dt: Double) {
    let sliding = now < slideUntil
    for i in 0..<Ten.voices {
      let v = voice(i)
      let tx = soundX(v)
      vw[i].dx = sliding || sclOn ? vw[i].dx + (tx - vw[i].dx) * (1 - exp(-dt / 0.07)) : v.x
      vw[i].wob = 0; vw[i].wv = 0
      for k in 0..<8 {
        guard let l = v.lfo[k] else { continue }
        vw[i].ph[k] = (vw[i].ph[k] + dt * l.rate).truncatingRemainder(dividingBy: 1)
        vw[i].vph[k] = (vw[i].vph[k] + dt * min(l.rate, 2.5)).truncatingRemainder(dividingBy: 1)
        let val = Waves.morph(l.morph, vw[i].ph[k]) * l.depth
        if k == LfoKey.pitch.rawValue { vw[i].wob = tenXOf(tenSemi(vw[i].dx) + val * 700 / 100) - vw[i].dx }
        else if k == LfoKey.wave.rawValue { vw[i].wv = val }
      }
      vw[i].hole += (v.holeT - vw[i].hole) * (1 - exp(-dt / 0.15))
    }
  }

  // волны живых планет в ритме биений и их ход; радиус гашения растёт от hall и decay
  private func stepWaves(_ dt: Double) {
    let f = fxValues
    let rmax = hypot(area.W, area.H) * (0.3 + 0.35 * f[0] + 0.35 * invLog(0.6, 14, f[1]))
    var k = waves.count - 1
    while k >= 0 {
      if waves[k].wait > 0 { waves[k].wait -= dt }
      else {
        waves[k].r += waves[k].sp * dt
        if waves[k].r > rmax { waves.remove(at: k) }
      }
      k -= 1
    }
    for i in 0..<Ten.voices {
      let v = voice(i)
      if !v.active || v.env < 0.02 || vw[i].hole > 0.5 { continue }   // из дыры свет не выходит
      emit[i] += dt
      if emit[i] < min(4, max(0.7, v.beat > 0 ? 1 / v.beat : 4)) { continue }
      emit[i] = 0
      let pos = screenPos(i)
      let w = TenWave(x: pos.x, y: pos.y, r: 36, a: v.env * 0.7, sp: 40 + tenFreq(soundX(v)) * 0.1, dash: false)
      if waves.count < 60 { waves.append(w) }
      if f[2] > 0.04 {                                         // delay: тот же импульс пунктиром, каждый повтор бледнее
        for e in 1...3 {
          let a = w.a * f[2] * 1.6 * pow(0.46, Double(e - 1))
          if a > 0.04 && waves.count < 60 { waves.append(TenWave(x: w.x, y: w.y, r: w.r, a: a, sp: w.sp, dash: true, wait: 0.45 * Double(e))) }
        }
      }
    }
  }

  // «услышанное»: вспышка планеты (две подряд у одного i — одна) и удар солнца; читаем, пока буфер полон, но не больше 4 раз
  private func readEvents() {
    var prev = -1
    for _ in 0..<4 {
      let hn = min(max(0, readHeard(&hbuf)), hbuf.count)
      if hn == 0 { break }
      tenHeard(hbuf, n: hn, into: &evs)
      for e in evs {
        switch e {
        case .flash(let i):
          if i == prev { continue }
          prev = i
          let p = screenPos(i)
          waves.append(TenWave(x: p.x, y: p.y, r: 36, a: 1.6, sp: 420, dash: false))
        case .strike(let i, let p):
          prev = -1
          strikes.append((i, now, p))
        }
      }
      if hn + 3 > hbuf.count { continue }
      break
    }
  }

  // touchTick / touchReset — TenTouch.swift

  func draw(_ d: Draw, now: Double) {}                        // картинка — план (б)
  func drawShot(_ d: Draw, now: Double) {}
}

// ---------- веер FX «aether» (host/sheet.js:18, app.js:87-93, 830-840) ----------
extension TenebraeView {
  static let fanKeys = ["hall", "decay", "delay", "chaos", "drive"]      // rev, decay, dly, chaos, dirt — порядок SETFX

  private func fanIdx(_ k: String) -> Int { TenebraeView.fanKeys.firstIndex(of: k) ?? 0 }
  private func fanGet(_ k: String) -> Double {
    let v = fxValues[fanIdx(k)]
    return k == "decay" ? invLog(0.6, 14, v) : v
  }

  var fanSpec: SheetSpec {
    SheetSpec(
      title: "aether", hint: "FX — tap outside to close",
      rows: TenebraeView.fanKeys.map { SheetRow(key: $0, label: $0, code: -1) },
      get: { [unowned self] k in fanGet(k) },
      set: { [unowned self] k, t in
        var f = fxValues
        f[fanIdx(k)] = k == "decay" ? lerpLog(0.6, 14, t) : t
        send(Act.setFx, 0, f)
      },
      text: { [unowned self] k in
        if k == "decay" {
          let d = fxValues[1]
          return String(format: d < 10 ? "%.1f" : "%.0f", d) + " s"
        }
        let pct = Horo.jsRound(max(-1e6, min(1e6, fanGet(k) * 100)))      // конечное, но огромное — в диапазон: Int(Double) вне Int падает
        return "\(Int(pct))%"
      },
      lfo: nil, reset: nil, arc: { [unowned self] in fxValues[0] })
  }
}
