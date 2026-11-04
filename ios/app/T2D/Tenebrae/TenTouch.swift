import UIKit

// Касания Tenebrae, ветка «поле» (порт app.js:233-299, 393-502): палец, тяга, солнце, двойной тап, удержание, щипок.
// Время — часы тика (now) и Finger.t0 (оба CACurrentMediaTime). Планета, которой в зеркале нет, пальцу уже не принадлежит

// палец на поле: планета под ним, смещение от центра, ушёл ли дальше 10 px (свой порог, не Finger.moved)
struct TenFinger {
  let id: ObjectIdentifier
  var x0: Double, y0: Double, t0: Double
  var x = 0.0, y = 0.0, touchTime = 0.0
  var moved = false
  var v: Int?
  var ox = 0.0, oy = 0.0
  var caught = false, spawned = false, opened = false
  var wasBridge = false                                      // палец был в мосте: его тап не считается
}

// пара пальцев щипка: d0, z0, t0 — на момент пары; d1 — расстояние, с которого пошёл зум
struct TenPinch {
  let a, b: ObjectIdentifier
  let d0, z0, t0: Double
  var zooming = false
  var d1 = 0.0
}

private let big = 1e6                                        // координаты событий в пределах экрана с запасом: дальше Int(Double) падает

extension TenebraeView {
  // ---------- вспомогательное ----------

  // конечная точка события, вне экрана — к границе; NaN / inf — nil (событие бросаем)
  func pt(_ f: Finger) -> (x: Double, y: Double)? {
    let x = Double(f.x), y = Double(f.y)
    guard x.isFinite, y.isFinite else { return nil }
    return (min(big, max(-big, x)), min(big, max(-big, y)))
  }
  func holders(_ i: Int) -> Int { fingers.values.reduce(0) { $0 + ($1.v == i ? 1 : 0) } }
  private func dist(_ p: TenPinch) -> Double? {
    guard let a = fingers[p.a], let b = fingers[p.b] else { return nil }
    return hypot(a.x - b.x, a.y - b.y)
  }

  // планета под точкой в GRAB_R; удерживаемые и затухшие не берём (hit :233)
  private func hit(_ x: Double, _ y: Double) -> Int? {
    var best = Ten.grabR, found: Int?
    for i in 0..<Ten.voices {
      let v = voice(i)
      if !v.active || v.held { continue }
      let p = screenPos(i), d = hypot(p.x - x, p.y - y)
      if d < best { best = d; found = i }
    }
    return found
  }

  // голос пропал (ядро погасило, зеркало показало active 0): палец его забывает и ничего больше не шлёт
  private func alive(_ id: ObjectIdentifier) -> Int? {
    guard let v = fingers[id]?.v else { return nil }
    if activeEff(v) { return v }
    fingers[id]?.v = nil
    return nil
  }

  // планета идёт за пальцем (follow :252)
  private func follow(_ id: ObjectIdentifier) {
    guard let f = fingers[id], let v = f.v, holders(v) == 1 else { return }
    let x = f.x + f.ox, y = f.y + f.oy
    let q = geo.unplace(x, y, zoom: zoom)
    send(Act.move, v, [q.p, q.c, geo.holeDepth(x, y)], touchTime: f.touchTime)
  }

  func newFinger(_ f: Finger, _ p: (x: Double, y: Double)) -> TenFinger {
    var t = TenFinger(id: f.id, x0: p.x, y0: p.y, t0: f.t0)
    t.x = p.x; t.y = p.y; t.touchTime = f.touchTime
    return t
  }

  // ---------- касание ----------

  func down(_ f: Finger) {
    touchedOnce = true                                        // любой палец, дошедший до мира: подсказка «touch» больше не нужна
    guard let p = pt(f) else { return }
    if ringPinDown(f) || sheetDown(f) || linkDown(f) { return }   // призрак и булавка на весу → плашка → закреплённое кольцо, ручка (спека, решение 9)
    var t = newFinger(f, p)
    var v = hit(p.x, p.y)
    if let h = v {
      // другой палец уже держит планету одним пальцем — это мост (решает linkDown-часть: bridgeDown)
      for o in fingers.values.sorted(by: { $0.t0 < $1.t0 }) {
        if let ov = o.v, ov != h, !o.opened, voice(ov).active, holders(ov) == 1, bridgeDown(f, first: o.id, b: h) { return }
      }
      t.caught = true
      if !voice(h).pinned { send(Act.attack, h, touchTime: t.touchTime) }
    } else {
      if let s = spawnAt(p.x, p.y, touchTime: t.touchTime) {
        v = s.i; t.ox = s.ox; t.oy = s.oy
      } else {
        refuse = (p.x, p.y, f.t0)
      }
      t.spawned = true
      // два пальца почти разом по пустому — возможно, щипок зума (:412)
      if pinch == nil {
        for o in fingers.values.sorted(by: { $0.t0 < $1.t0 }) where o.spawned && !o.moved && f.t0 - o.t0 < Ten.pinchWindow {
          pinch = TenPinch(a: o.id, b: f.id, d0: hypot(o.x - p.x, o.y - p.y), z0: zoomT, t0: f.t0)
          break
        }
      }
    }
    fingers[f.id] = t
    guard let i = v else { return }
    t.v = i
    if t.caught {                                            // ox, oy: палец лёг не в центр — планета не прыгает
      let pp = screenPos(i)
      t.ox = pp.x - p.x; t.oy = pp.y - p.y
    }
    fingers[f.id] = t
    send(Act.grab, i)                                        // MOVE — только на тяге: на касании планета уже там (иначе снап с ноты лада)
  }

  func move(_ f: Finger) {
    if sheetFingers[f.id] != nil { sheetMove(f); return }
    if ring?.finger == f.id { linkMove(f); return }
    guard var t = fingers[f.id], let p = pt(f) else { return }
    t.x = p.x; t.y = p.y; t.touchTime = f.touchTime
    if !t.moved && hypot(t.x - t.x0, t.y - t.y0) > Ten.holeMoved { t.moved = true }
    fingers[f.id] = t
    if let br = bridge, f.id == br.fa || f.id == br.fb { bridgeMove(br); return }
    if var z = pinch {
      if !z.zooming, now - z.t0 < Ten.pinchTime, let d = dist(z), abs(d - z.d0) > Ten.pinchDelta { startZoom(&z) }
      if z.zooming {
        pinch = z
        if let d = dist(z) { setZoom(z.z0 * z.d1 / max(20, d)) }
        return
      }
      pinch = z
    }
    if alive(f.id) != nil, !t.opened { follow(f.id) }
  }

  // щипок начался: оба кружка, что успели зазвучать, гасим почти сразу (startZoom :460)
  private func startZoom(_ z: inout TenPinch) {
    for id in [z.a, z.b] {
      if let v = alive(id) {
        send(Act.letGo, v, [0])
        let u = voice(v)
        if !u.pinned && !u.held && !kept.contains(v) { send(Act.release, v, [0.03]) }
      }
      fingers[id]?.v = nil
    }
    z.zooming = true
    z.d1 = max(20, dist(z) ?? 20)
  }

  private func setZoom(_ z: Double) {
    guard z.isFinite else { return }
    zoomT = tenClamp(z, Ten.zoomMin, 1)
    zoomShow = now + 1.2                                     // подписи диапазонов видны во время зума и ещё секунду после
  }

  func up(_ f: Finger) {
    if sheetFingers[f.id] != nil { sheetUp(f); return }
    if ring?.finger == f.id { linkUp(f); return }
    guard let t0 = fingers[f.id] else { return }
    var t = t0
    if let p = pt(f) { t.x = p.x; t.y = p.y }
    fingers[f.id] = nil
    if hold?.id == f.id { hold = nil }
    if let br = bridge, f.id == br.fa || f.id == br.fb { endBridge(br) }
    if let z = pinch, z.a == f.id || z.b == f.id {
      pinch = nil
      if z.zooming { return }
    }
    guard let v = t.v, activeEff(v) else { return }
    if t.opened { send(Act.letGo, v, [kept.contains(v) ? 0 : 1]); return }          // плашка открыта удержанием: планета в KEEP, хвост не нужен
    let tap = now - t.t0 < Ten.tap && hypot(t.x - t.x0, t.y - t.y0) < Ten.tapMove
    if tap && !t.wasBridge && holders(v) == 0 {                              // держал её только этот палец
      if let lt = lastTap, lt.v == v, now - lt.t < Ten.dtap {
        lastTap = nil
        send(Act.letGo, v, [0])                              // хвост отпускания не нужен: закрепить / открепить решает pin
        if state.pinResult(v, mirror: mirror, now: now) == .full { refuse = (t.x, t.y, now) }
        send(Act.pin, v)                                     // и при full: ядро отпускает свободный голос, иначе он зазвучал бы навсегда
        return
      }
      lastTap = (v, now, t.x, t.y)
    }
    send(Act.letGo, v, [1])
  }

  func cancel(_ f: Finger) {
    if sheetFingers[f.id] != nil { sheetUp(f); return }
    if ring?.finger == f.id { linkCancel(f); return }
    guard let t = fingers[f.id] else { return }
    fingers[f.id] = nil
    if hold?.id == f.id { hold = nil }
    if let br = bridge, f.id == br.fa || f.id == br.fb { endBridge(br) }
    if let z = pinch, z.a == f.id || z.b == f.id { pinch = nil }
    if let v = t.v, activeEff(v) { send(Act.letGo, v, [kept.contains(v) ? 0 : 1]) }
  }

  // ---------- тик: удержание и удары солнца ----------

  func touchTick(now: Double) {
    for id in Array(fingers.keys) { _ = alive(id) }
    linkTick(now: now)
    if let sv = sheetVoice, !voice(sv).active { closePlanetSheet() }   // планету погасило — плашка уходит с ней
    // удержание пойманной планеты одним пальцем — плашка (solTick :1861)
    var h: TenFinger?
    if fingers.count == 1, pinch == nil, let f = fingers.values.first, f.caught, !f.moved, !f.opened, let v = f.v, holders(v) == 1 { h = f }
    hold = h.map { ($0.id, $0.t0) }
    if let f = h, now - f.t0 > Ten.hold, let v = f.v {
      fingers[f.id]?.opened = true
      hold = nil
      openPlanetSheet(v)
    }
    // солнце бьёт планету, которую тянут в его зону; глубже — сильнее (sunStrikes :1586)
    var depth = [Double](repeating: 0, count: Ten.voices), tt = [Double](repeating: 0, count: Ten.voices)
    for f in fingers.values {
      guard let v = f.v, f.moved, !f.opened else { continue }
      let t = tenClamp((Ten.sunR + 24 - hypot(f.x + f.ox - geo.ox, f.y + f.oy - geo.oy)) / 70)
      if t > depth[v] { depth[v] = t; tt[v] = f.touchTime }
    }
    for i in 0..<Ten.voices {                                 // всем шести: без пальца — 0, прежняя глубина не залипает
      if depth[i] == 0 && sunT[i] < 0 && voice(i).sunT == 0 { sunT[i] = 0; continue }   // кеш пуст, а ядро и так на нуле — слать нечего
      sendSun(i, depth[i], touchTime: tt[i])
    }
  }

  // отпустить в ядре всё, что держат пальцы, плашка и мост; состояние касаний не трогает (его забудет touchReset)
  func releaseTouches() {
    if let br = bridge { endBridge(br) }
    for (_, t) in fingers {
      if let v = t.v, activeEff(v) { send(Act.letGo, v, [kept.contains(v) ? 0 : 1]) }
    }
    fingers = [:]
    if sheetVoice != nil { closePlanetSheet() }
  }

  func touchReset() {                                        // restored: пальцы, пара, тап, отказ, удержание забыты
    fingers = [:]; pinch = nil; lastTap = nil; refuse = nil; hold = nil
    linkReset()
    sheetReset()
  }
}
