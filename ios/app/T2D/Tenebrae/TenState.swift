import Foundation

// Чистый слой Tenebrae: свои значения вида поверх зеркала ядра (правило Natura / Portus / Cymatica).
// После своего действия вид видит своё значение, пока оно не сошлось с зеркалом или не прошло ttl с этого действия.
// Правила — фасад worlds/tenebrae/model.js и ядро core/worlds/tenebrae/model.cpp. Время — секунды, аргумент; часов внутри нет

// одно своё значение поля: v — значение, t — когда выставлено
struct TenOv<T: Equatable> {
  var v: T?
  var t = 0.0
  func get(_ m: T, _ now: Double) -> T {
    if let v, v != m, now - t < TenState.ttl { return v }
    return m
  }
  mutating func set(_ x: T, _ now: Double) { v = x; t = now }
  mutating func sync(_ m: T, _ now: Double) {
    if let v, v == m || now - t >= TenState.ttl { self.v = nil }
  }
}

// свои значения одного голоса. Для active и envT это не картинка, а ответ фасаду (pick, pin): ядро ещё не успело показать
struct TenVoiceOv {
  var active = TenOv<Bool>(), envT = TenOv<Double>()
  var x = TenOv<Double>(), y = TenOv<Double>(), holeT = TenOv<Double>()
  var rows = [TenOv<Double>](repeating: TenOv<Double>(), count: Row.allCases.count)
  var pinned = TenOv<Bool>()
  var held = TenOv<Int>()                              // счётчик захватов; зеркало знает только «есть / нет» — 0 или 1
  var mods = TenOv<[TenMod]>()
  var lfo = TenOv<[TenLfo?]>()
}

enum PinResult: Equatable { case pinned, unpinned, full, none }

struct TenState {
  static let ttl = 0.25
  private var o = [TenVoiceOv](repeating: TenVoiceOv(), count: Ten.voices)
  private var keptOv = TenOv<[Int]>()
  private var fxOv = TenOv<[Double]>()

  mutating func reset() { self = TenState() }

  // ---------- чтение ----------

  // голос целиком: свои поля поверх зеркала; active, live, env, envT, sunT — всегда зеркала
  func voice(_ i: Int, mirror m: TenMirror, now: Double) -> TenVoiceM {
    var e = eff(i, m, now)
    let z = m.v[i]
    e.active = z.active; e.live = z.live; e.env = z.env; e.envT = z.envT; e.sunT = z.sunT
    return e
  }
  func kept(mirror m: TenMirror, now: Double) -> [Int] { keptOv.get(m.kept, now) }
  func fx(mirror m: TenMirror, now: Double) -> [Double] { fxOv.get(m.fx, now) }

  // выкинуть сошедшееся и просроченное: после этого правка зеркала видна сразу, а не ждёт конца ttl
  mutating func sync(mirror m: TenMirror, now: Double) {
    for i in 0..<Ten.voices {
      let z = m.v[i]
      o[i].active.sync(z.active, now); o[i].envT.sync(z.envT, now)
      o[i].x.sync(z.x, now); o[i].y.sync(z.y, now); o[i].holeT.sync(z.holeT, now)
      for r in Row.allCases { o[i].rows[r.rawValue].sync(rowOf(z, r), now) }
      o[i].pinned.sync(z.pinned, now); o[i].held.sync(z.held ? 1 : 0, now)
      o[i].mods.sync(z.mods, now); o[i].lfo.sync(z.lfo, now)
    }
    keptOv.sync(m.kept, now); fxOv.sync(m.fx, now)
  }

  // ---------- синхронные ответы фасада по текущему виду ----------

  // голос под новый кружок, −1 — нет места (model.cpp:86-99): временных не больше TEMP_MAX, уступает самый тихий затухающий
  func pick(mirror m: TenMirror, now: Double) -> Int {
    let V = (0..<Ten.voices).map { eff(m: m, now: now, $0) }
    let kp = kept(mirror: m, now: now)
    let temps = V.filter { $0.active && !$0.pinned }.count
    var v = -1
    if temps < Ten.tempMax { v = V.firstIndex { !$0.active } ?? -1 }
    if v < 0 {
      for k in 0..<Ten.voices {
        let u = V[k]
        if !u.active || u.pinned || u.held || kp.contains(k) || u.envT != 0 { continue }
        if v < 0 || u.env < V[v].env { v = k }
      }
    }
    return v
  }

  func pinResult(_ i: Int, mirror m: TenMirror, now: Double) -> PinResult {
    guard ok(i) else { return .none }
    let e = eff(i, m, now)
    if !e.active { return .none }
    if e.pinned { return .unpinned }
    var pins = 0
    for k in 0..<Ten.voices { let u = eff(k, m, now); if u.active && u.pinned { pins += 1 } }
    return pins >= Ten.pinMax ? .full : .pinned
  }

  // есть звучащий (не затухающий) голос — кубику есть что менять (model.cpp:336)
  func anyLive(mirror m: TenMirror, now: Double) -> Bool {
    for i in 0..<Ten.voices { let e = eff(i, m, now); if e.active && e.envT > 0 { return true } }
    return false
  }

  // ---------- свои значения по действию ----------

  mutating func own(_ kind: Int, _ i: Int, _ a: [Double], mirror m: TenMirror, now: Double) {
    switch kind {
    case Act.spawn:
      guard ok(i), a.count >= 3 else { return }
      o[i].held.set(0, now)
      o[i].mods.set([], now); o[i].lfo.set([TenLfo?](repeating: nil, count: 8), now)
      for k in 0..<Ten.voices where k != i {           // связи других с источником i тоже снимаются
        let md = eff(k, m, now).mods
        if md.contains(where: { $0.src == i }) { o[k].mods.set(md.filter { $0.src != i }, now) }
      }
      o[i].x.set(a[0], now); o[i].y.set(a[1], now); o[i].holeT.set(a[2], now)
      for r in Row.allCases { o[i].rows[r.rawValue].set(Ten.rowDef[r] ?? 0, now) }
      o[i].pinned.set(false, now)
      o[i].active.set(true, now); o[i].envT.set(1, now)
    case Act.grab:
      guard ok(i), eff(i, m, now).active else { return }
      o[i].held.set(heldN(i, m, now) + 1, now)
    case Act.letGo:
      guard ok(i) else { return }
      let n = heldN(i, m, now)
      if n == 0 { return }
      o[i].held.set(n - 1, now)
      let e = eff(i, m, now)
      let fade = (a.first ?? 1) != 0
      if fade && n == 1 && !e.pinned && !kept(mirror: m, now: now).contains(i) { o[i].envT.set(0, now) }
    case Act.keep:
      keptOv.set(a.compactMap { $0.isFinite && $0 >= 0 && $0 < Double(Ten.voices) ? Int($0) : nil }, now)
    case Act.unkeep:
      let old = kept(mirror: m, now: now)
      keptOv.set([], now)
      for k in old where ok(k) {
        let e = eff(k, m, now)
        if e.active && !e.pinned && !e.held { o[k].envT.set(0, now) }
      }
    case Act.move:
      guard ok(i), a.count >= 3, eff(i, m, now).active else { return }
      o[i].x.set(a[0], now); o[i].y.set(a[1], now); o[i].holeT.set(a[2], now)
    case Act.set:
      guard ok(i), a.count >= 2, let k = idx(a[0], Row.allCases.count), let r = Row(rawValue: k), eff(i, m, now).active else { return }
      o[i].rows[r.rawValue].set(a[1], now)
    case Act.pin:
      guard ok(i) else { return }
      let e = eff(i, m, now)
      let free = !e.held && !kept(mirror: m, now: now).contains(i)
      switch pinResult(i, mirror: m, now: now) {
      case .none: return
      case .unpinned: o[i].pinned.set(false, now); if free { o[i].envT.set(0, now) }
      case .full: if free { o[i].envT.set(0, now) }
      case .pinned: o[i].pinned.set(true, now)
      }
    case Act.link:
      guard ok(i), let s = srcOf(a), s != i else { return }
      var md = eff(i, m, now).mods
      if let k = md.firstIndex(where: { $0.src == s }) { md[k].auto = false }
      else { md.append(TenMod(src: s, type: 1, depth: Ten.linkNew, auto: false)) }
      o[i].mods.set(md, now)
    case Act.linkDepth:
      guard ok(i), let s = srcOf(a), a.count >= 2, a[1].isFinite else { return }
      var md = eff(i, m, now).mods
      guard let k = md.firstIndex(where: { $0.src == s }) else { return }
      md[k].depth = a[1]
      o[i].mods.set(md, now)
    case Act.linkType:
      guard ok(i), let s = srcOf(a), a.count >= 2, a[1].isFinite else { return }
      guard let t = idx(a[1], Ten.linkTypes.count) else { return }
      var md = eff(i, m, now).mods
      guard let k = md.firstIndex(where: { $0.src == s }) else { return }
      md[k].type = t
      o[i].mods.set(md, now)
    case Act.unlink:
      guard ok(i), let s = srcOf(a) else { return }
      var md = eff(i, m, now).mods
      guard let k = md.firstIndex(where: { $0.src == s }) else { return }
      md.remove(at: k)
      o[i].mods.set(md, now)
    case Act.setLfo:
      guard ok(i), a.count >= 4, a.allSatisfy({ $0.isFinite }), eff(i, m, now).active,
            let k = idx(a[0], 8) else { return }
      var l = eff(i, m, now).lfo
      l[k] = a[3] < 0 ? nil : TenLfo(morph: a[1], rate: a[2], depth: a[3])
      o[i].lfo.set(l, now)
    case Act.setFx:
      guard a.count >= 5, a.allSatisfy({ $0.isFinite }) else { return }
      fxOv.set(Array(a.prefix(5)), now)
    default: break
    }
  }

  // ---------- внутреннее ----------

  private func ok(_ i: Int) -> Bool { i >= 0 && i < Ten.voices }
  // целый индекс 0..<n из числа действия; вне диапазона, не конечное или дробное за пределами — nil (Int(Double) вне Int падает)
  private func idx(_ x: Double, _ n: Int) -> Int? { x.isFinite && x >= 0 && x < Double(n) ? Int(x) : nil }
  private func srcOf(_ a: [Double]) -> Int? {
    guard let s = a.first, s.isFinite, s >= 0, s < Double(Ten.voices) else { return nil }
    return Int(s)
  }
  private func heldN(_ i: Int, _ m: TenMirror, _ now: Double) -> Int { o[i].held.get(m.v[i].held ? 1 : 0, now) }
  private func rowOf(_ v: TenVoiceM, _ r: Row) -> Double {
    switch r {
    case .wave: return v.wave
    case .cut: return v.cut
    case .res: return v.res
    case .beat: return v.beat
    case .fm: return v.fm
    case .shift: return v.shift
    case .amp: return v.amp
    }
  }

  private func eff(m: TenMirror, now: Double, _ i: Int) -> TenVoiceM { eff(i, m, now) }

  // голос с учётом всех своих значений, включая active и envT (нужны фасаду)
  private func eff(_ i: Int, _ m: TenMirror, _ now: Double) -> TenVoiceM {
    var e = m.v[i]
    let q = o[i]
    e.active = q.active.get(e.active, now); e.envT = q.envT.get(e.envT, now)
    e.x = q.x.get(e.x, now); e.y = q.y.get(e.y, now); e.holeT = q.holeT.get(e.holeT, now)
    e.wave = q.rows[Row.wave.rawValue].get(e.wave, now); e.cut = q.rows[Row.cut.rawValue].get(e.cut, now)
    e.res = q.rows[Row.res.rawValue].get(e.res, now); e.beat = q.rows[Row.beat.rawValue].get(e.beat, now)
    e.fm = q.rows[Row.fm.rawValue].get(e.fm, now); e.shift = q.rows[Row.shift.rawValue].get(e.shift, now)
    e.amp = q.rows[Row.amp.rawValue].get(e.amp, now)
    e.pinned = q.pinned.get(e.pinned, now)
    e.held = q.held.get(e.held ? 1 : 0, now) > 0
    e.mods = q.mods.get(e.mods, now); e.lfo = q.lfo.get(e.lfo, now)
    return e
  }
}
