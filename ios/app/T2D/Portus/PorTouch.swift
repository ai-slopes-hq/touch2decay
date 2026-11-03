import Foundation

// Касания Portus (порт worlds/portus/view.js:54-106, 144-146): маяк, луна, вехи, буй, кораблики, туман, небо, вода.
// Координаты — экрана (сдвига нет). Все действия — только через send / audition / goMap.
// Время — секунды часов тика (now): тап и удержание идут из него, а не из кадра.

enum PorKind { case none, ph, moon, buoy, isle, fog }

// палец: что под ним лежало и куда ведёт
struct PorFinger {
  var kind = PorKind.none
  var j = 0                                                  // кораблик: место (при переносе — новое)
  var fresh = false                                          // кораблик только что посажен этим пальцем: тап его не топит
  var moved = false, sheet = false                           // сдвиг дальше 8 px; плашка уже открыта
  var t0 = 0.0, x0 = 0.0, y0 = 0.0
  var v0 = 0.0, v1 = 0.0                                     // bpm | cut, res | amt в начале
}

private typealias A = Por.Act
private func clamp(_ x: Double, _ a: Double = 0, _ b: Double = 1) -> Double { min(b, max(a, x)) }

extension PortusView {
  private static let holdS = Touch.holdMs / 1000, tapS = 0.3, shift = 8.0

  // ---------- попадания (view.js:55-56) ----------
  func isleAt(_ x: Double, _ y: Double) -> Int? {
    var best: Int?, bd = 1e9
    for j in 0..<Por.nstep {
      let s = isle(j)
      guard s.on else { continue }
      let p = geo.slotPt(j, s.p), r = 12 + 26 * p.s, d = hypot(x - p.x, (y - p.y + 8 * p.s) * 1.4)
      if d < r && d < bd { bd = d; best = j }
    }
    return best
  }
  func markAt(_ x: Double, _ y: Double) -> Int {
    for i in 0..<Por.nstep {
      let m = geo.markPt(i), h = 10 + 14 * m.s
      if abs(x - m.x) < 8 + 6 * m.s && y < m.y + 4 && y > m.y - h - 8 { return i }
    }
    return -1
  }

  // ---------- действия мира ----------
  // на свободное место — PLACE, на занятое — только нота; ноту запоминаем для вех
  private func place(_ i: Int, _ p: Int) {
    if isle(i).on { send(A.note, i, [Double(p)]) }
    else { send(A.place, i, [Double(p), rng() * 1000]) }
    lastP = p; audition(i)
  }

  // ---------- касания ----------
  func down(_ f: Finger) {
    let x = Double(f.x), y = Double(f.y), G = geo, M = G.moon, B = G.P(buoy.u, buoy.d)
    var t = PorFinger(t0: now, x0: x, y0: y)
    if abs(x - G.ph.x) < 22 && y > G.ph.y - 100 && y < G.ph.y + 24 {
      t.kind = .ph; t.v0 = bpm; fingers[f.id] = t; return
    }
    if x >= M.x - 4 && hypot(x - M.x, y - M.y) < M.r + 14 {   // луна: тап — карта, тянешь — фильтр, держишь — плашка
      t.kind = .moon; t.v0 = luna(0); t.v1 = luna(1); fingers[f.id] = t; return
    }
    let li = markAt(x, y)
    if li >= 0 {
      if isle(li).on { send(A.sink, li) }
      else { send(A.place, li, [Double(lastP), rng() * 1000]); audition(li) }
      return
    }
    if hypot(x - B.x, y - B.y + 8) < 22 { t.kind = .buoy; fingers[f.id] = t; return }
    if let j = isleAt(x, y) { t.kind = .isle; t.j = j; fingers[f.id] = t; return }
    if abs(y - G.fogTop) < 16 && y < G.hor + 10 { t.kind = .fog; t.v0 = fog(0); fingers[f.id] = t; return }
    if y < G.fogTop - 16 && y > G.top {                       // небо: падает звезда — эхо гаснет
      send(A.kill, 0); state.kill(x: x, y: y, now: now); return
    }
    if G.inSea(x, y), let sl = G.slotAt(x, y) {
      place(sl.i, sl.p)
      t.kind = .isle; t.j = sl.i; t.fresh = true; fingers[f.id] = t
    }
  }

  func move(_ f: Finger) {
    guard var t = fingers[f.id], !t.sheet else { return }
    let x = Double(f.x), y = Double(f.y), G = geo
    if hypot(x - t.x0, y - t.y0) > Self.shift { t.moved = true }
    defer { fingers[f.id] = t }
    guard t.moved else { return }
    switch t.kind {
    case .ph:
      let b = Horo.jsRound(clamp(t.v0 + (x - t.x0) / 2, 60, 180))
      if b != bpm { send(A.bpm, 0, [b]) }
    case .moon:
      send(A.luna, 0, [clamp(t.v0 + (t.y0 - y) / (G.hor - G.top - G.moon.r * 0.9))])
      send(A.luna, 1, [clamp(t.v1 + (x - t.x0) / (G.Ws * 0.5))])
    case .fog:
      send(A.fog, 0, [clamp(t.v0 + (t.y0 - y) / ((G.hor - G.top - 40) * 0.7))])
    case .buoy:                                               // сырые u, d (как веб): зажим делает ядро и своё значение
      let q = G.unP(x, clamp(y, G.hor + 6, G.qy - 10))
      send(A.buoy, 0, [q.u, q.d])
    case .isle:                                               // вдоль фарватера — другое место (если свободно), поперёк — нота
      guard isle(t.j).on, let sl = G.slotAt(x, clamp(y, G.hor + 4, G.qy - 6)) else { return }
      if sl.i != t.j && !isle(sl.i).on { send(A.move, t.j, [Double(sl.i)]); t.j = sl.i }
      if Double(sl.p) != isle(t.j).p { send(A.note, t.j, [Double(sl.p)]); lastP = sl.p; audition(t.j) }
    case .none: break
    }
  }

  func up(_ f: Finger) {
    guard let t = fingers.removeValue(forKey: f.id), !t.sheet else { return }
    let quick = !t.moved && now - t.t0 < Self.tapS
    switch t.kind {
    case .ph where quick: send(A.play, 0, [playing ? 0 : 1])
    case .moon where quick: goMap?()
    case .isle where quick && !t.fresh && isle(t.j).on: send(A.sink, t.j)   // тап по кораблику — уходит под воду
    default: break
    }
  }

  // система отняла палец: без тапа
  func cancel(_ f: Finger) { fingers.removeValue(forKey: f.id) }

  // держишь, не двигая, не свежий кораблик — плашка (view.js:144-146); палец с плашкой больше ничего не шлёт
  func touchTick(now: Double) {
    guard !fingers.isEmpty else { return }
    for (id, var t) in fingers where !t.moved && !t.sheet && !t.fresh && now - t.t0 >= Self.holdS {
      let spec: SheetSpec
      switch t.kind {
      case .moon: spec = lunaSpec
      case .buoy: spec = echoSpec
      case .fog: spec = fogSpec
      case .ph: spec = pharosSpec
      case .isle: guard isle(t.j).on else { continue }; spec = isleSpec(t.j)
      case .none: continue
      }
      t.sheet = true; fingers[id] = t
      openSheet?(spec)
    }
  }

  // undo: пальцы забыты — move / up прежних ничего не шлют
  func touchReset() { fingers.removeAll(keepingCapacity: true) }
}
