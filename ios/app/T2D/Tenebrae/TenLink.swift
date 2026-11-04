import UIKit

// Нити Tenebrae: мост двух пальцев, кольцо связи, булавка, призрак (порт app.js:325-349, 525-540, 854-858, 885-982).
// Время — часы тика (now). Связь, которой нет в виде, кольцу и мосту уже не принадлежит: ничего по ней не шлём

// мост: палец fa держит A, палец fb — B; B модулирует A. d0 — расстояние между пальцами на старте, depth0 — глубина связи тогда
struct TenBridge {
  let a, b: Int
  let fa, fb: ObjectIdentifier
  let d0, depth0: Double
  var depth: Double
}

// кольцо связи (центр cx, cy; gx, gy — где лёг палец, от этой точки тянут); key — луч: 0 fm, 1 tzfm, 2 am, 3 rm, 4 cut
struct TenRing {
  let dst, src: Int
  let cx, cy: Double
  var gx = 0.0, gy = 0.0
  var key: Int?
  var t = 0.0
  var overPin = true                                          // палец в центре, на булавке: отпустишь — кольцо закрепится
  var cutting = false
  var pinned = false
  var finger: ObjectIdentifier?
}

private func clamp(_ x: Double, _ a: Double = 0, _ b: Double = 1) -> Double { x.isNaN ? a : min(b, max(a, x)) }
private let cutKey = 4
private let sectors: [(key: Int, ang: Double)] = [(0, -90), (1, -18), (2, 54), (3, 126), (4, 198)].map { ($0.0, $0.1 * .pi / 180) }

extension TenebraeView {
  // ---------- вспомогательное ----------

  func linkMod(_ dst: Int, _ src: Int) -> TenMod? {
    guard (0..<Ten.voices).contains(dst), voice(dst).active else { return nil }
    return voice(dst).mods.first { $0.src == src }
  }
  private func linkAlive(_ r: TenRing) -> Bool { linkMod(r.dst, r.src) != nil }

  private var ringR: Double { Ten.menuDead + geo.menuSpan + 34 }
  private var closeChip: (x: Double, y: Double, w: Double, h: Double) { (area.W - 80, area.H - area.safeBot - 320, 64, 26) }

  // середина нити (linkCurve + bez(0.5), app.js:525): квадратичная кривая src → dst, прогнутая к солнцу
  func linkMid(dst: Int, src: Int) -> (x: Double, y: Double) {
    let p1 = screenPos(src), p2 = screenPos(dst)
    let mx = (p1.x + p2.x) / 2, my = (p1.y + p2.y) / 2
    let L = hypot(p2.x - p1.x, p2.y - p1.y)
    let len = L == 0 ? 1 : L
    var nx = -(p2.y - p1.y) / len, ny = (p2.x - p1.x) / len
    if nx * (geo.ox - mx) + ny * (geo.oy - my) < 0 { nx = -nx; ny = -ny }
    let depth = linkMod(dst, src)?.depth ?? 0
    let bend = min(0.3 * L, 64) * (0.5 + 0.5 * clamp(depth))
    let cx = mx + nx * bend, cy = my + ny * bend
    return (0.25 * p1.x + 0.5 * cx + 0.25 * p2.x, 0.25 * p1.y + 0.5 * cy + 0.25 * p2.y)
  }

  // кольцо целиком на экране: у края открывается ближе к середине (app.js:854)
  func ringCenter(_ x: Double, _ y: Double) -> (x: Double, y: Double) {
    let R = Ten.menuDead + geo.menuSpan + 26
    let x0 = R, x1 = area.W - R, y0 = area.topY + 12 + R, y1 = area.H - area.safeBot - 24 - R
    return (x0 < x1 ? clamp(x, x0, x1) : area.W / 2, y0 < y1 ? clamp(y, y0, y1) : (y0 + y1) / 2)
  }

  private func sector(_ a: Double) -> Int? {
    var bd = 9.0, found: Int?
    for s in sectors {
      let diff = abs(atan2(sin(a - s.ang), cos(a - s.ang)))
      if diff < bd { bd = diff; found = s.key }
    }
    return found
  }

  // луч k, значение t: cut — только флаг «режем»; остальные — тип и глубина связи (set в openLink :894 и ringTouch :975)
  private func ringSet(_ k: Int, _ t: Double) {
    guard var r = ring else { return }
    r.t = t
    r.cutting = k == cutKey && t > 0.35
    ring = r
    guard k != cutKey, let m = linkMod(r.dst, r.src) else { return }
    if m.type != k { send(Act.linkType, r.dst, [Double(r.src), Double(k)]) }
    send(Act.linkDepth, r.dst, [Double(r.src), t])
  }

  // ---------- касание: булавки (до плашки) ----------

  // призрак и булавка кольца на весу у другого пальца; любое касание гасит призрак. true — касание съедено
  func ringPinDown(_ f: Finger) -> Bool {
    guard let p = pt(f) else { return false }
    let g = ghost
    ghost = nil
    if var r = g?.ring, let g, now < g.until, hypot(p.x - r.cx, p.y - r.cy) < Ten.pinR + 14 {
      r.pinned = true; r.finger = nil; r.cutting = false
      ring = r
      return true
    }
    if var r = ring, !r.pinned, r.finger != f.id, hypot(p.x - r.cx, p.y - r.cy) < Ten.pinR + 12 {
      r.pinned = true; r.finger = nil; r.cutting = false      // тот палец больше ничего не двигает: его move / up уже не наши
      ring = r
      return true
    }
    return false
  }

  // ---------- касание: закреплённое кольцо и ручка нити (после плашки) ----------

  func linkDown(_ f: Finger) -> Bool {
    guard let p = pt(f) else { return false }
    if var r = ring, r.pinned {                               // закреплённое кольцо берёт любое касание: внутри — луч, мимо — закрыть
      let c = closeChip
      if p.x > c.x - 6, p.x < c.x + c.w + 6, p.y > c.y - 6, p.y < c.y + c.h + 6 { ring = nil; return true }
      let dx = p.x - r.cx, dy = p.y - r.cy, d = hypot(dx, dy)
      guard d < ringR else { ring = nil; return true }
      r.finger = f.id; r.key = nil; r.cutting = false
      if d >= Ten.menuDead { r.key = sector(atan2(dy, dx)) }
      ring = r
      if let k = r.key { ringSet(k, clamp((d - Ten.menuDead) / geo.menuSpan)) }
      return true
    }
    for dst in 0..<Ten.voices where voice(dst).active {       // ручка на середине нити: не auto, источник активен
      for m in voice(dst).mods where voice(m.src).active && !m.auto {
        let c = linkMid(dst: dst, src: m.src)
        if hypot(p.x - c.x, p.y - c.y) < Ten.handleR { openLink(f, p, dst: dst, src: m.src, mid: c); return true }
      }
    }
    return false
  }

  // кольцо на весу: хаос-связь пользователь забирает себе (LINK), кольцо открывается у середины нити
  private func openLink(_ f: Finger, _ p: (x: Double, y: Double), dst: Int, src: Int, mid: (x: Double, y: Double)) {
    send(Act.link, dst, [Double(src)], touchTime: f.touchTime)
    let rc = ringCenter(mid.x, mid.y)
    ring = TenRing(dst: dst, src: src, cx: rc.x, cy: rc.y, gx: p.x, gy: p.y, finger: f.id)
  }

  func linkMove(_ f: Finger) {
    guard var r = ring, r.finger == f.id, let p = pt(f) else { return }
    if r.pinned {                                             // ringTouch: луч выбран на касании, значение — от центра
      guard let k = r.key else { return }
      ringSet(k, clamp((hypot(p.x - r.cx, p.y - r.cy) - Ten.menuDead) / geo.menuSpan))
      return
    }
    let dx = p.x - r.gx, dy = p.y - r.gy, d = hypot(dx, dy)   // menuMove: от точки, где лежал палец
    if d < Ten.menuDead { r.overPin = true; r.key = nil; ring = r; return }
    r.overPin = false
    if r.key == nil && d > Ten.menuDead + 16 { r.key = sector(atan2(dy, dx)) }
    ring = r
    if let k = r.key { ringSet(k, clamp((d - Ten.menuDead) / geo.menuSpan)) }
  }

  func linkUp(_ f: Finger) {
    guard var r = ring, r.finger == f.id else { return }
    r.finger = nil
    if r.pinned {
      if r.cutting { send(Act.unlink, r.dst, [Double(r.src)]); ring = nil } else { ring = r }
      return
    }
    ring = nil
    if r.overPin { r.pinned = true; r.cutting = false; ring = r; return }
    if r.cutting { send(Act.unlink, r.dst, [Double(r.src)]) }
    if linkAlive(r) { ghost = (r, now + Ten.ghost) }          // связь только что удалена — призрака нет
  }

  func linkCancel(_ f: Finger) {                              // система отняла палец: ничего не режем и не фиксируем
    guard var r = ring, r.finger == f.id else { return }
    if r.pinned { r.finger = nil; r.cutting = false; ring = r } else { ring = nil }
  }

  // ---------- мост ----------

  // второй палец на планете b, пока первый держит a одним пальцем: b модулирует a. false — не мост
  func bridgeDown(_ f: Finger, first: ObjectIdentifier, b: Int) -> Bool {
    guard bridge == nil, let p = pt(f), let fa = fingers[first], let a = fa.v, a != b, !fa.opened,
          voice(a).active, voice(b).active, holders(a) == 1, holders(b) == 0 else { return false }
    var t = newFinger(f, p)
    t.v = b; t.caught = true; t.wasBridge = true
    let pp = screenPos(b)
    t.ox = pp.x - p.x; t.oy = pp.y - p.y
    fingers[f.id] = t
    fingers[first]?.wasBridge = true
    if !voice(b).pinned { send(Act.attack, b, touchTime: f.touchTime) }
    send(Act.grab, b)
    send(Act.link, a, [Double(b)])
    let d0 = max(30, hypot(fa.x - p.x, fa.y - p.y)), depth0 = linkMod(a, b)?.depth ?? Ten.linkNew
    bridge = TenBridge(a: a, b: b, fa: first, fb: f.id, d0: d0, depth0: depth0, depth: depth0)
    return true
  }

  func bridgeMove(_ br: TenBridge) {
    guard let fa = fingers[br.fa], let fb = fingers[br.fb], voice(br.a).active, voice(br.b).active else { return }
    let depth = clamp(br.depth0 + hypot(fa.x - fb.x, fa.y - fb.y) / br.d0 - 1)
    bridge?.depth = depth
    send(Act.linkDepth, br.a, [Double(br.b), depth])
  }

  // палец моста поднят: тонкая связь рвётся; оставшийся палец ведёт свою планету дальше, без прыжка
  func endBridge(_ br: TenBridge) {
    bridge = nil
    if br.depth < Ten.bridgeCut, voice(br.a).active, voice(br.b).active { send(Act.unlink, br.a, [Double(br.b)]) }
    for id in [br.fa, br.fb] {
      guard let t = fingers[id], let v = t.v, voice(v).active else { continue }
      let pp = screenPos(v)
      fingers[id]?.moved = true
      fingers[id]?.ox = pp.x - t.x; fingers[id]?.oy = pp.y - t.y
    }
  }

  // ---------- тик ----------

  func linkTick(now: Double) {
    if let br = bridge, !voice(br.a).active || !voice(br.b).active { bridge = nil }
    if let r = ring, !linkAlive(r) { ring = nil }
    if let g = ghost, now >= g.until || !linkAlive(g.ring) { ghost = nil }
  }

  func linkReset() { bridge = nil; ring = nil; ghost = nil }
}
