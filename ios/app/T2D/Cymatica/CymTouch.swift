import Foundation

// Касания Cymatica, один палец: кнопки ▶ ● сетка луна, кольца ритма и мелодии, метки, удар (порт worlds/cymatica/view.js:90-153, 201-287, 323-338).
// Координаты — экрана. Все действия — только через send. Время — часы тика (now) и Finger.t0 (оба — CACurrentMediaTime).

enum CymKind { case none, play, rec, grid, drift, len, rtick, mtick, mark, away, live, two }

// палец: что под ним лежало и куда ведёт
struct CymFinger {
  var kind = CymKind.none
  var i = 0                                                  // гнездо кольца или место-метка
  var ring = 0                                               // кольцо длины: 0 ритм, 1 мелодия
  var r0 = 0.0, c0 = 0.0, bpm0 = 0.0                         // радиус и шанс удара в начале; темп в начале
  var ci: Int?                                               // клетка бусины в списке нот
  var moved = false                                          // сдвиг дальше 10 px от места, где лёг; раз выставлен — не снимается (как f.moved в вебе)
  var menu = false, combed = false, two = false              // плашка луны открыта; сетка причёсана; палец в паре
  var t0 = 0.0, x0 = 0.0, y0 = 0.0, x = 0.0, y = 0.0
}

// два пальца: поворот или щипок (view.js:155-199)
struct CymPair {
  var a: ObjectIdentifier, b: ObjectIdentifier              // первый и второй палец пары
  var a0: Double, d0: Double                                // угол и расстояние (≥ 20 px) в начале
  var kind: CymTwo?                                         // решается один раз
  var target: Int                                           // 0 ритм, 1 мелодия, 2 пластина
  var f00: Double, fromSemi: Double                         // высота в начале жеста и она же в полутонах от F_MIN
  var orig: [Double], mel: [Double]                         // узор из зеркала на начало: ритм 16 × (on, vel, chance, has), мелодия 16 × (on, x, y)
  var last: Double, deg = 0.0, k = 0                        // последний угол, накопленный поворот (°), ступень
  var sent: Double?                                         // что щипок послал последним — шлём при смене значения
}

private typealias A = Cym.Act
private func clamp(_ x: Double, _ a: Double = 0, _ b: Double = 1) -> Double { min(b, max(a, x)) }

extension CymaticaView {
  private static let holdS = Touch.holdMs / 1000, shift = 10.0, tapMove = 12.0, pxSemi = 12.0, pxDeg = 18.0

  // сдвинут — раз ушёл на 10 px от места, где лёг, остаётся сдвинутым, даже вернувшись
  func moved(_ f: CymFinger) -> Bool { f.moved }
  private func follow(_ t: inout CymFinger, _ f: Finger) {
    t.x = Double(f.x); t.y = Double(f.y)
    if hypot(t.x - t.x0, t.y - t.y0) >= Self.shift { t.moved = true }
  }
  private func isButton(_ k: CymKind) -> Bool { k == .play || k == .rec || k == .grid || k == .drift }

  // ---------- попадания (view.js:91-109) ----------
  func astroHit(_ x: Double, _ y: Double) -> CymFinger? {
    let g = geo, d = hypot(x - g.cx, y - g.cy)
    var h = CymFinger()
    if hypot(x - g.playX, y - g.ty) < 22 { h.kind = .play; return h }
    if hypot(x - g.recX, y - g.ty) < 22 { h.kind = .rec; return h }
    if hypot(x - g.gridX, y - g.ty) < 22 { h.kind = .grid; return h }
    if hypot(x - g.driftX, y - g.ty) < 22 { h.kind = .drift; return h }
    let s = g.slotOf(x, y), sl = Double(Cym.slots)
    let ring = d >= g.RM && d < g.R2 + 14 ? 0 : d >= g.R1 - 14 && d < g.RM ? 1 : -1
    guard ring >= 0 else { return nil }
    let len = Double(ring == 0 ? rlen : mlen)             // край заливки длины кольца (между гнёздами) — тянуть по кругу
    let e = abs(((s - (len - 0.5)).truncatingRemainder(dividingBy: sl) + sl + sl / 2).truncatingRemainder(dividingBy: sl) - sl / 2)
    if e < 0.3 { h.kind = .len; h.ring = ring; return h }
    let i = Int(Horo.jsRound(s)) % Cym.slots
    h.i = i; h.r0 = d
    if ring == 0 {
      h.kind = .rtick
      let st = step(i)
      h.c0 = st.on ? st.chance : 1
    } else {                                                // бусина — нота места этого шага: его клетка
      h.kind = .mtick
      let m = mark(i)
      h.ci = m.on ? cymCellIdx(m.x, m.y, b: base(), n: scl.degPerOct) : nil
    }
    return h
  }

  // метка места мелодии на пластине
  private func markAt(_ x: Double, _ y: Double) -> Int {
    for i in 0..<Cym.slots {
      let m = mark(i)
      guard m.on else { continue }
      let p = geo.fromPlate(m.x, m.y)
      if hypot(x - p.x, y - p.y) < 11 { return i }
    }
    return -1
  }

  // ---------- два пальца: что крутим — по средней дистанции от центра (при повороте она не меняется): стол — пластина, до границы между кольцами — мелодия, дальше — ритм ----------
  func startTwo(_ other: ObjectIdentifier, _ f: Finger) {
    guard var o = fingers[other] else { return }
    let g = geo, x = Double(f.x), y = Double(f.y)
    o.kind = .two; o.two = true
    fingers[other] = o
    var t = CymFinger(t0: Double(f.t0), x0: x, y0: y, x: x, y: y)
    t.kind = .two; t.two = true
    fingers[f.id] = t
    let d = (hypot(o.x - g.cx, o.y - g.cy) + hypot(x - g.cx, y - g.cy)) / 2
    let a0 = atan2(y - o.y, x - o.x), f00 = f0
    var orig: [Double] = []
    for i in 0..<Cym.slots { let s = mirror.rhythm[i]; orig += [s.on ? 1 : 0, s.vel, s.chance, s.has ? 1 : 0] }
    var mel: [Double] = []
    for i in 0..<Cym.slots { let m = mirror.melody[i]; mel += [m.on ? 1 : 0, m.x, m.y] }
    pair = CymPair(a: other, b: f.id, a0: a0, d0: max(20, hypot(x - o.x, y - o.y)), kind: nil,
                   target: d < g.rMax ? 2 : d < g.RM ? 1 : 0, f00: f00, fromSemi: cymFs(f00), orig: orig, mel: mel, last: a0)
  }

  private func wrapDeg(_ d: Double) -> Double { ((d + 180).truncatingRemainder(dividingBy: 360) + 360).truncatingRemainder(dividingBy: 360) - 180 }

  private func moveTwo() {
    guard var p = pair, let a = fingers[p.a], let b = fingers[p.b] else { return }
    let a1 = atan2(b.y - a.y, b.x - a.x), d1 = max(20, hypot(b.x - a.x, b.y - a.y))
    if p.kind == nil { p.kind = cymTwistOrPinch(a0: p.a0, a1: a1, d0: p.d0, d1: d1) }
    defer { pair = p }
    if p.kind == .pinch {                                      // развёл — пластина больше и ниже
      let dd = d1 - p.d0
      labelUntil = now + 1
      if !scl.on {
        let hz = p.f00 * pow(2, -dd / Self.pxSemi / 12)
        if hz != p.sent { p.sent = hz; send(A.setF0, 0, [hz]) }
      } else {
        let steps = Horo.jsRound(-dd / Self.pxDeg)
        if steps != p.sent { p.sent = steps; send(A.stepScale, 0, [p.fromSemi, steps]) }
      }
    }
    guard p.kind == .twist else { return }
    p.deg += wrapDeg((a1 - p.last) * 180 / Double.pi); p.last = a1
    // кольца — 22.5° на гнездо, пластина — 20° на ступень лада; кольцо идёт за пальцами, отпустил — встаёт в гнездо
    let k = Int(Horo.jsRound(p.deg / (p.target == 2 ? 20 : 22.5)))
    if p.target != 2 { ringTurn[p.target] = p.deg - Double(k) * 22.5 }
    twistLabel = ((k > 0 ? "+" : "") + String(k), (a.x + b.x) / 2, (a.y + b.y) / 2, now + 1)
    if k == p.k { return }
    p.k = k
    send(A.turn, p.target, [Double(k)] + (p.target == 0 ? p.orig : p.mel))   // пластина: каждое место — на k ступеней; вернул в ноль — места как были
  }

  // отпустил — кольцо встаёт в гнездо, его узор остаётся повёрнутым
  private func endTurn() {
    if let p = pair, p.target != 2 { ringOrn[p.target] = (ringOrn[p.target] + Double(p.k) * 22.5).truncatingRemainder(dividingBy: 360) }
    ringTurn = [0, 0]
    pair = nil
  }
  private func inPair(_ id: ObjectIdentifier) -> Bool { pair.map { $0.a == id || $0.b == id } ?? false }

  // ---------- касания ----------
  func down(_ f: Finger) {
    let x = Double(f.x), y = Double(f.y), g = geo
    var t = CymFinger(t0: Double(f.t0), x0: x, y0: y, x: x, y: y)
    let h = astroHit(x, y)
    if var b = h, isButton(b.kind) {                          // ▶ и ● работают и вторым пальцем — в пару не идут
      b.t0 = t.t0; b.x0 = x; b.y0 = y; b.x = x; b.y = y; b.bpm0 = bpm
      fingers[f.id] = b; return
    }
    if pair == nil, let o = fingers.first(where: { $0.key != f.id && !isButton($0.value.kind) && $0.value.kind != .two }) {   // второй палец — поворот или щипок
      startTwo(o.key, f); return
    }
    if var a = h { a.t0 = t.t0; a.x0 = x; a.y0 = y; a.x = x; a.y = y; a.bpm0 = bpm; fingers[f.id] = a; return }
    if hypot(x - g.cx, y - g.cy) > g.rMax { t.kind = .away; fingers[f.id] = t; return }   // мимо стола: убирает курсор, второй палец — вращение
    let mk = rec || (cursor != -1 && !playing) ? -1 : markAt(x, y)   // при записи и пошаговом вводе метки не мешают: тап в ту же точку — снова пишется
    if mk >= 0 {                                              // тап по метке звучит сразу; повёл — тащишь метку
      t.kind = .mark; t.i = mk; fingers[f.id] = t
      let m = mark(mk)
      if let note = noteOf(m.x, m.y) {
        send(A.strike, 0, [m.x, m.y, Cym.fMin * pow(2, Double(note) / 12), 1, 0.5, 0], touchTime: f.touchTime)
        markHot = (mk, now)
      }
      return
    }
    let p = g.toPlate(x, y)
    if hypot(p.x, p.y) > 1 { t.kind = .away; fingers[f.id] = t; return }   // вне пластины (но на столе) — как мимо стола
    if noteOf(p.x, p.y) == nil { return }                     // клетка за 1760 Гц — молчит
    send(A.strikeAt, 0, [p.x, p.y], touchTime: f.touchTime)
    state.starPush(p.x, p.y, now)
    t.kind = .live; fingers[f.id] = t
  }

  func move(_ f: Finger) {
    guard var t = fingers[f.id] else { return }
    follow(&t, f)
    defer { fingers[f.id] = t }
    let g = geo, mv = moved(t)
    switch t.kind {
    case .play where mv:                                      // зажал ▶ и ведёшь — темп
      let b = Horo.jsRound(clamp(t.bpm0 + (t.x - t.x0) * 0.5, 40, 200))
      if b != bpm { send(A.bpm, 0, [b]) }
      bpmUntil = now + 1
    case .len:                                                // у каждого кольца своя длина
      let len = Int(Horo.jsRound(clamp(g.slotOf(t.x, t.y) + 0.5, 1, Double(Cym.slots))))
      if len != (t.ring == 0 ? rlen : mlen) { send(A.len, t.ring, [Double(len)]) }
    case .rtick where mv && step(t.i).on:                     // удар тянешь к центру — реже (шанс), наружу — чаще
      let ch = Horo.jsRound(clamp(t.c0 + (hypot(t.x - g.cx, t.y - g.cy) - t.r0) / 70, 0.05, 1) * 20) / 20
      if ch != chance(t.i) { send(A.chanceAt, t.i, [ch]) }
      chanceEdit = (t.i, now + 1)
    case .mtick where mv && t.ci != nil:                      // бусину — от центра выше, к центру ниже на ступени; место переезжает в клетку ноты
      let m = mark(t.i)
      guard m.on, let ci = t.ci else { return }
      let steps = Int(Horo.jsRound((hypot(t.x - g.cx, t.y - g.cy) - t.r0) / 6))
      let b = base(), n = scl.degPerOct, top = min(b + 3 * n, noteList.count) - 1
      if top >= b, let cl = cymCellOf(min(top, max(b, ci + steps)), b: b, n: n) {
        let p = cymCellCenter(ring: cl.ring, sector: cl.sector, n: n)
        if p.x != m.x || p.y != m.y { send(A.nudge, t.i, [Double(ci), Double(steps)]) }
      }
      noteEdit = (t.i, now + 1)
    case .mark where mv:                                      // метку тащишь — место меняется
      let p = g.toPlate(t.x, t.y)
      send(A.moveMark, t.i, [p.x, p.y])
    case .two:
      fingers[f.id] = t; moveTwo()                            // moveTwo читает оба пальца — свежий кладём до него
    default: break
    }
  }

  func up(_ f: Finger) {
    guard var t = fingers.removeValue(forKey: f.id) else { return }
    follow(&t, f)
    let mv = moved(t)
    switch t.kind {
    case .grid:
      if !t.combed { send(A.grid, 0, [Double(grid == 1 ? 2 : grid == 2 ? 4 : 1)]) }   // тап — сетка 1/16 → 1/8 → 1/4
    case .play:
      if !mv { send(A.cursor, 0, [-1]); send(A.play, 0, [playing ? 0 : 1]) }
    case .rec:
      send(A.cursor, 0, [-1])
      if playing { send(A.rec, 0, [rec ? 0 : 1]) }
      else { send(A.stepRec, 0, [stepRec.on ? 0 : 1, 0, 0]) }   // часы стоят — запись по шагам
    case .rtick: if !mv { send(A.beat, t.i) }
    case .drift: if !mv && !t.menu { send(A.driftToggle) }
    case .mtick: if !mv && !playing { send(A.cursor, 0, [Double(t.i % mlen)]) }   // тап по гнезду мелодии, часы стоят — курсор пошагового ввода туда
    case .mark:
      let m = mark(t.i)
      if m.on && mv && hypot(m.x, m.y) > 1.05 { send(A.dropMark, t.i) }   // за край — место удалено, шаг — пауза
    case .two: if inPair(f.id) { endTurn() }                 // любой палец пары: кольцо встаёт в гнездо; второй палец больше ничего не шлёт
    case .away:
      if stepRec.on && hypot(t.x - t.x0, t.y - t.y0) < Self.tapMove { send(A.skip) }   // запись по шагам: тап мимо пластины — пауза, курсоры дальше
      else { send(A.cursor, 0, [-1]) }
    default: break
    }
  }

  // система отняла палец: без действий up
  func cancel(_ f: Finger) { fingers.removeValue(forKey: f.id); if inPair(f.id) { endTurn() } }

  // держишь, не двигая: луна — плашка, сетка — причесать ритм (view.js:323-338)
  func touchTick(now: Double) {
    guard !fingers.isEmpty else { return }
    for (id, var t) in fingers where !moved(t) && now - t.t0 > Self.holdS {
      if t.kind == .drift && !t.menu { t.menu = true; fingers[id] = t; openSheet?(driftSpec) }   // зажал луну — плашка: глубина, такт, форма
      else if t.kind == .grid && !t.combed { t.combed = true; fingers[id] = t; send(A.comb) }
    }
  }

  // undo: пальцы и пара забыты — move / up прежних ничего не шлют
  func touchReset() { fingers.removeAll(keepingCapacity: true); pair = nil; ringTurn = [0, 0]; twistLabel = nil }
}
