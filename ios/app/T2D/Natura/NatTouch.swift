import Foundation

// Касания Natura (порт worlds/natura/view.js:162-301, 330-337, 111-124): кувшинки, вода, glide, пристань, плотина, облако, горы, утки,
// дерево, птицы, лягушка, челнок с броском и меню цветков. Координаты — сцены: палец минус geo.ox. Все действия — только через send.
// Время — секунды часов тика (now): удержание, полёт и возврат челнока идут из touchTick, а не из кадра, как в вебе.
// Метки касаний для истории броска — f.touchTime (если нет — now): история и её возраст на одних часах.

enum NatKind { case none, skiff, pad, plant, boat, bridge, cloud, mountains, duckA, duckR, tree, birds }

// палец: что под ним лежало и куда ведёт
struct NatFinger {
  var kind = NatKind.none
  var i = 0                                                  // кувшинка (pad): место; при переносе — новое
  var frog = false                                           // кувшинка взята через лягушку: тап по ней квакает
  var t0 = 0.0, x0 = 0.0, y0 = 0.0, x = 0.0, y = 0.0, lx = 0.0, ly = 0.0
  var v0 = 0.0                                               // fx (облако, горы, утки) или bpm (пристань) в начале
  var moved = false, cycled = false                          // сдвинут дальше 8 px; плашка / меню уже открыты
  var path: [(Double, Double)] = []                          // путь по воде (plant), ≤ 64: при переполнении вдвое реже
  var hist: [(x: Double, y: Double, t: Double)] = []         // последние 8 точек челнока для броска
  var seen: UInt16 = 0                                       // кувшинки, задетые путём (path может быть прорежен)
}

// запасной челнок: у берега, в руке, на воде, в полёте к уткам, плывёт домой
struct NatSkiff {
  var x = 0.0, y = 0.0, dx = 0.0, dy = 0.0                   // dx, dy — где взяли: челнок идёт за пальцем со смещением
  var held = false, home = true, onRiver = false
  var fly: (x0: Double, y0: Double, x1: Double, y1: Double, t0: Double, dur: Double)?
  var back: (x: Double, y: Double, t0: Double)?
  var trail: [(x: Double, y: Double, t: Double)] = []        // след на воде (≤ 1.4 с)
  var label = ""                                             // нота под челноком
}

// меню цветков: пять цветов дугой над челноком; owner — палец, которым открыли (nil — отпущен)
struct NatMenu {
  var x = 0.0, y = 0.0
  var held = true
  var hover = -1
  var owner: ObjectIdentifier?
}

private typealias A = Nat.Act

extension NaturaView {
  private static let holdS = Touch.holdMs / 1000, shift = 8.0, pathCap = 64, histCap = 8

  // ---------- меню цветков (view.js:331-337) ----------
  func menuOpts() -> [(x: Double, y: Double)] {
    guard let m = menu else { return [] }
    let R = 74.0, cx = Nat.clamp(m.x, R + 26, geo.W - R - 26)
    let up = m.y - R - 30 > geo.top + 40, cy = up ? m.y - 8 : m.y + 8
    let n = Double(Nat.waves.count)
    return (0..<Nat.waves.count).map { k in
      let a = (Double(k) + 0.5) / n * Double.pi, an = up ? Double.pi + a : Double.pi - a
      return (cx + cos(an) * R, cy + sin(an) * R)
    }
  }
  func menuHit(_ x: Double, _ y: Double) -> Int {
    menuOpts().firstIndex { hypot(x - $0.x, y - $0.y) < 26 } ?? -1
  }

  // ---------- действия мира (фасад model.js) ----------
  private func pickWave(_ k: Int) { send(A.wave, 0, [Double(k)]) }
  private func plant(_ i: Int, _ note: Int) {
    guard !pad(i).on else { return }
    send(A.plant, i, [Double(note), Double(state.lastWave)]); send(A.hear, i)
  }
  private func movePad(_ i: Int, _ j: Int) -> Bool {         // на другое место — если свободно
    guard j != i, pad(i).on, !pad(j).on else { return false }
    send(A.move, i, [Double(j)]); return true
  }
  private func setNote(_ i: Int, _ n: Int) {
    let p = pad(i)
    guard p.on, p.note != n else { return }
    send(A.note, i, [Double(n)]); send(A.hear, i)
  }
  private func croak() {
    guard let fr = frogAt, pad(fr.i).on else { return }
    state.croakAt = now
    send(A.croak, 0, [Double(pad(fr.i).note)])
  }
  private func skiffTo(_ o: (t: Double, q: Double)?) {       // на воде — SKIFF, иначе SKIFF_OFF (на каждом сдвиге, как веб)
    if let o {
      send(A.skiff, 0, [o.q, o.t, Double(state.lastWave)])
      skiff.label = natNoteName(scl.skiffHz(o.q)); skiff.onRiver = true
    } else { send(A.skiffOff, 0); skiff.onRiver = false }
  }

  // ближайшая кувшинка под пальцем (листья крупные и могут касаться соседей)
  private func padAt(_ x: Double, _ y: Double, extra: Double = 12) -> Int {
    var best = -1, bd = 1e9
    for i in 0..<Nat.npad {
      let p = pad(i)
      guard p.on else { continue }
      let g = geo.padXY(i, p.note), d = hypot(x - g.x, (y - g.y) * 1.4)
      if d < Nat.lily * g.s + extra && d < bd { bd = d; best = i }
    }
    return best
  }

  // ---------- касания ----------
  func down(_ f: Finger) {
    fingers[f.id] = touchDown(f.id, Double(f.x) - geo.ox, Double(f.y))
  }

  private func touchDown(_ id: ObjectIdentifier, _ x: Double, _ y: Double) -> NatFinger {
    var t = NatFinger(t0: now, x0: x, y0: y, x: x, y: y, lx: x, ly: y)
    if let m = menu, !m.held {                               // открытое меню: тап по цветку — выбрать, мимо — закрыть
      let k = menuHit(x, y)
      if k >= 0 { pickWave(k) }
      menu = nil; return t
    }
    if hypot(x - skiff.x, y - skiff.y + 4) < 26 {            // запасной челнок — взять
      skiff.held = true; skiff.home = false; skiff.fly = nil; skiff.back = nil
      skiff.dx = skiff.x - x; skiff.dy = skiff.y - y
      t.kind = .skiff; t.hist.reserveCapacity(Self.histCap + 1); return t
    }
    let br = geo.river(geo.bridgeT(len: len)), bdx = x - br.x, bdy = y - br.y
    let al = bdx * br.tx + bdy * br.ty, ac = bdx * br.nx + bdy * br.ny
    if abs(al) < 24 && abs(ac) < br.w / 2 + 22 { t.kind = .bridge; return t }
    if !state.envOpen(now: now) {                            // утки улетели — их не поймать
      let d = geo.ducks(att: fxv(6), rel: fxv(7), now: now)
      for (kind, k, u) in [(NatKind.duckA, 6, d.a), (NatKind.duckR, 7, d.r)]
      where hypot(x - u.x, y - (u.y - u.s * 0.35)) < max(28, u.s * 1.6) {
        t.kind = kind; t.v0 = fxv(k); return t
      }
    }
    if let fr = frogAt, fr.i >= 0, pad(fr.i).on, hypot(x - fr.x, y - fr.y) < 16 {   // лягушка: тап — квакает; потянул или держишь — её кувшинка
      t.kind = .pad; t.i = fr.i; t.frog = true; return t
    }
    let pi = padAt(x, y)                                     // кувшинки — раньше пристани: лодочка плывёт мимо и не должна перехватывать
    if pi >= 0 { t.kind = .pad; t.i = pi; return t }
    let pq = geo.pier()
    if hypot(x - pq.x - 4, y - pq.y) < 30 { t.kind = .boat; t.v0 = bpm; return t }
    if geo.inRiver(x, y) {
      t.kind = .plant; t.path.reserveCapacity(Self.pathCap + 1); t.path.append((x, y)); return t
    }
    let cl = geo.cloud(cutoff: fxv(4))
    if abs(x - cl.cx) < 34 * cl.s && y > cl.cy - 22 * cl.s && y < cl.cy + 12 * cl.s { t.kind = .cloud; t.v0 = fxv(4); return t }
    let cr = geo.crown(), tr = geo.tree
    if hypot(x - tr.x, y - cr.y) < cr.R * 1.3 || (abs(x - tr.x) < 14 && y > cr.y && y < tr.y + 6) { t.kind = .tree; return t }
    geo.birds(chorus: fxv(3), now: now, birdsAt: state.birdsAt, into: &birdBuf)
    if birdBuf.contains(where: { hypot(x - $0.x, y - $0.y) < 22 }) { t.kind = .birds; return t }
    if y > geo.hor - 0.24 * geo.h && y < geo.hor + 4 { t.kind = .mountains; t.v0 = fxv(5); return t }
    return t
  }

  func move(_ f: Finger) {
    guard var t = fingers.removeValue(forKey: f.id) else { return }
    defer { fingers[f.id] = t }
    let x = Double(f.x) - geo.ox, y = Double(f.y)
    let dx = x - t.x0, dy = y - t.y0
    t.x = x; t.y = y
    if let m = menu, m.owner == f.id { let h = menuHit(x, y); menu?.hover = h; return }   // меню цветков: тот же палец ведёт по цветкам
    if !t.moved && hypot(dx, dy) > Self.shift { t.moved = true }
    switch t.kind {
    case .skiff:                                             // ведёшь челнок: на воде — звучит
      skiff.x = x + skiff.dx; skiff.y = y + skiff.dy
      t.hist.append((skiff.x, skiff.y, f.touchTime > 0 ? f.touchTime : now))
      if t.hist.count > Self.histCap { t.hist.removeFirst() }
      let o = geo.inRiver(skiff.x, skiff.y) ? geo.onRiver(skiff.x, skiff.y) : nil
      skiffTo(o)
      if o != nil, skiff.trail.last.map({ hypot($0.x - skiff.x, $0.y - skiff.y) > 10 }) ?? true {
        skiff.trail.append((skiff.x, skiff.y, now))
      }
      return
    case .cloud: send(A.setfx, 4, [Nat.clamp(t.v0 - dy / 220)]); t.moved = true; return          // туча выше — ярче
    case .mountains: send(A.setfx, 5, [Nat.clamp(t.v0 - dy / 160)]); t.moved = true; return      // горы выше — резонанс
    case .duckA: send(A.setfx, 6, [Nat.clamp(t.v0 - dy / 160)]); t.moved = true; return          // утку вверх — длиннее attack / release
    case .duckR: send(A.setfx, 7, [Nat.clamp(t.v0 - dy / 160)]); t.moved = true; return
    case .tree:                                              // тормошим: чем быстрее водишь по дереву, тем сильнее
      let v = hypot(x - t.lx, y - t.ly); t.lx = x; t.ly = y
      send(A.shakeby, 0, [v / 260]); return
    case .plant where t.moved: pushPath(&t, x, y); return    // рисуем по воде
    default: break
    }
    guard t.moved else { return }
    switch t.kind {
    case .boat: send(A.setbpm, 0, [Horo.jsRound(Nat.clamp(t.v0 + dx / 2, 40, 200))])
    case .bridge:
      let o = geo.onRiver(x, y)
      send(A.len, 0, [Double(min(16, max(2, NatGeo.slotOf(o.t + 0.02) + 1)))])
    case .pad where !t.cycled:                               // поперёк — нота, вдоль — на другое место (если свободно)
      let o = geo.onRiver(x, y), j = NatGeo.slotOf(o.t), n = NatGeo.noteOf(o.q)
      if movePad(t.i, j) { t.i = j }
      setNote(t.i, n)
    default: break
    }
  }

  func up(_ f: Finger) {
    guard let t = fingers.removeValue(forKey: f.id) else { return }
    let x = Double(f.x) - geo.ox, y = Double(f.y)
    if let m = menu, m.owner == f.id {                       // отпустил на цветке — выбран; мимо — меню ждёт тапа
      let k = menuHit(x, y)
      if t.kind == .skiff { skiff.held = false; skiff.home = true; skiffTo(nil) }
      menu?.owner = nil
      if k >= 0 { pickWave(k); menu = nil } else { menu?.held = false; menu?.hover = -1 }
      return
    }
    switch t.kind {
    case .skiff: skiff.held = false; skiffTo(nil); release(t, f)
    case .boat where !t.moved: send(A.play, 0, [playing ? 0 : 1])
    case .pad where t.frog && !t.moved && !t.cycled: croak()
    case .pad where !t.moved && !t.cycled: send(A.remove, t.i)                     // тап по кувшинке — убрать
    case .birds where !t.moved: send(A.laser, 0)                                    // спугнули — лазер
    case .plant where t.moved: glide(t)
    case .plant:                                                                    // тап по воде — посадить
      let o = geo.onRiver(x, y)
      plant(NatGeo.slotOf(o.t), NatGeo.noteOf(o.q))
    default: break
    }
  }

  // система отняла палец: без действий тапа и броска; челнок с воды — домой
  func cancel(_ f: Finger) {
    guard let t = fingers.removeValue(forKey: f.id) else { return }
    if let m = menu, m.owner == f.id { menu = nil }
    if t.kind == .skiff {
      skiff.held = false; skiff.home = true; skiff.fly = nil; skiff.back = nil
      if skiff.onRiver { skiffTo(nil) }
    }
  }

  // путь по воде: до 64 точек (при переполнении — каждая вторая), задетые кувшинки помним отдельно
  private func pushPath(_ t: inout NatFinger, _ x: Double, _ y: Double) {
    if t.path.count >= Self.pathCap {
      var k = 0
      for j in stride(from: 0, to: t.path.count, by: 2) { t.path[k] = t.path[j]; k += 1 }
      t.path.removeLast(t.path.count - k)
    }
    t.path.append((x, y))
    for i in 0..<Nat.npad {
      let p = pad(i)
      guard p.on else { continue }
      let g = geo.padXY(i, p.note)
      if hypot(x - g.x, (y - g.y) * 1.4) < Nat.lily * g.s + 8 { t.seen |= 1 << UInt16(i) }
    }
  }

  // провёл по воде через кувшинки — глайд в них (все уже скользили — снять); след на воде
  private func glide(_ t: NatFinger) {
    var hit: [Int] = []
    for i in 0..<Nat.npad {
      let p = pad(i)
      guard p.on else { continue }
      let g = geo.padXY(i, p.note), r = Nat.lily * g.s + 8
      if t.seen & (1 << UInt16(i)) != 0 || t.path.contains(where: { hypot($0.0 - g.x, ($0.1 - g.y) * 1.4) < r }) { hit.append(i) }
    }
    let on = !hit.allSatisfy { pad($0).glide }
    for i in hit { send(A.pglide, i, [on ? 1 : 0]) }
    wake = (t.path, now)
  }

  // отпустили челнок: в заводи или бросок по истории пальца (< 250 мс, последние 4 точки, |v| > 0.35 px/мс) — летит; иначе плывёт домой
  private func release(_ t: NatFinger, _ f: Finger) {
    let tn = f.touchTime > 0 ? f.touchTime : now, P = geo.pond(), gone = state.envOpen(now: now)
    func inPond(_ x: Double, _ y: Double) -> Bool { pow((x - P.x) / P.rx, 2) + pow((y - P.y) / P.ry, 2) < 1.3 }
    var hit: (x: Double, y: Double)? = inPond(skiff.x, skiff.y) ? (skiff.x, skiff.y) : nil
    if hit == nil, !gone {
      let h = t.hist.filter { tn - $0.t < 0.25 }.suffix(4)
      if h.count >= 2, let a = h.first, let b = h.last {
        let dt = max(16, (b.t - a.t) * 1000), vx = (b.x - a.x) / dt, vy = (b.y - a.y) / dt, sp = hypot(vx, vy)
        if sp > 0.35 {
          for d in stride(from: 0.0, to: 520, by: 8) {
            let x = skiff.x + vx / sp * d, y = skiff.y + vy / sp * d
            if inPond(x, y) { hit = (P.x + (x - P.x) * 0.5, P.y + (y - P.y) * 0.3); break }
          }
        }
      }
    }
    if let hit, !gone {
      let dist = hypot(hit.x - skiff.x, hit.y - skiff.y)
      skiff.fly = (skiff.x, skiff.y, hit.x, hit.y, now, (120 + 0.6 * dist) / 1000)
    } else { skiff.back = (skiff.x, skiff.y, now) }
  }

  // ---------- тик касаний ----------
  func touchTick(now: Double) {
    // держишь кувшинку — плашка; челнок у берега — меню цветков (view.js:292-301)
    if !fingers.isEmpty {
      for id in Array(fingers.keys) {
        guard var t = fingers[id], t.kind == .pad || t.kind == .skiff, !t.moved, !t.cycled,
              now - t.t0 >= Self.holdS, menu == nil else { continue }
        if t.kind == .pad && !pad(t.i).on { continue }
        t.cycled = true; fingers[id] = t
        if t.kind == .pad { openSheet?(lilySpec(t.i)) }
        else { menu = NatMenu(x: skiff.x, y: skiff.y, held: true, hover: -1, owner: id) }
      }
    }
    // челнок: дома, в полёте к уткам (плюх, испуг, домой через 0.6 с) или плывёт к берегу за 1.2 с (view.js:112-124)
    let home = geo.skiffHome()
    if skiff.home { skiff.x = home.x; skiff.y = home.y }
    else if !skiff.held, let F = skiff.fly {
      let k = Nat.clamp((now - F.t0) / F.dur)
      skiff.x = F.x0 + (F.x1 - F.x0) * k; skiff.y = F.y0 + (F.y1 - F.y0) * k - sin(Double.pi * k) * 40
      if k >= 1 {
        skiff.fly = nil; splash = (F.x1, F.y1, now); send(A.scare, 0)
        skiff.back = (F.x1, F.y1, now + 0.6)
      }
    } else if !skiff.held, let b = skiff.back, now >= b.t0 {
      let k = Nat.clamp((now - b.t0) / 1.2), e = 1 - pow(1 - k, 3)
      skiff.x = b.x + (home.x - b.x) * e; skiff.y = b.y + (home.y - b.y) * e
      if k >= 1 { skiff.home = true; skiff.back = nil }
    }
    if !skiff.trail.isEmpty { skiff.trail.removeAll { now - $0.t >= 1.4 } }
    // лягушка: раз за тик (state.frog тратит случайность и двигает прыжок); касания и картинка читают frogAt
    for i in 0..<Nat.npad { padBuf[i] = pad(i) }
    frogAt = state.frog(geo: geo, pads: padBuf, len: len, now: now, R: rng)
  }

  // undo: пальцы, меню, полёт и след забыты; челнок на воде — SKIFF_OFF один раз, и он дома
  func touchReset() {
    if skiff.onRiver { skiffTo(nil) }
    fingers.removeAll(keepingCapacity: true)
    menu = nil; wake = nil
    skiff.held = false; skiff.home = true; skiff.onRiver = false
    skiff.fly = nil; skiff.back = nil
    skiff.trail.removeAll(keepingCapacity: true)
  }
}
