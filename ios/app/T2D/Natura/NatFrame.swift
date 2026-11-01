import UIKit

private let tau = Double.pi * 2
private let noDash: [CGFloat] = []
private let trailDash: [CGFloat] = [4, 4]

// рыба и стрекоза: состояние живёт здесь, двигает его только artTick (из tick) на rng мира; кадр читает
struct NatFish: Equatable { var x = 0.0, y = 0.0, t0 = 0.0, dir = 1.0, s = 1.0 }
struct NatFly: Equatable { var x = 0.0, y = 0.0; var ok = false; var i = -1; var until = 0.0 }

// кадр Natura (view.js:504-532): порядок слоёв — как у веба; ничего не меняет — всё состояние в tick (touchTick, artTick).
// Время кадра now — секунды, в картинке — миллисекунды (nowMs = now·1000), как `now` веба.
extension NaturaView {
  private func fillStroke(_ p: NatPen) { p.g.drawPath(using: .fillStroke) }

  // ---------- жизнь реки: раз за тик ----------
  // рыба (view.js:392-397, 400): на первом шаге петли выпрыгивает, гаснет при k > 1.6; стрекозы (:423-436, 447): число — от chorus,
  // цель — недавно сыгравшая кувшинка (висит 6–12 с), плавное сглаживание; брызги и след пальца, у которых вышел срок, — снять
  func artTick(now: Double, dt: Double) {
    if let ph = phase {
      let st = Int(floor(ph))
      if st != fishStep {
        fishStep = st
        if st % max(1, len) == 0 {
          let t = 0.25 + rng() * 0.5, r = geo.river(t), q = (rng() - 0.5) * 0.5, p = r.across(q)
          fish = NatFish(x: p.x, y: p.y, t0: now, dir: rng() < 0.5 ? -1 : 1, s: 0.7 + 0.6 * t)
        }
      }
    }
    if let f = fish, (now - f.t0) * 1000 / 650 > 1.6 { fish = nil }
    if let s = splash, (now - s.t0) * 1000 / 900 > 1 { splash = nil }
    if let w = wake, (now - w.at) * 1000 / 900 >= 1 { wake = nil }

    let nowMs = now * 1000, G = geo, chorus = fxv(3), step = min(0.1, dt)
    let n = chorus < 0.2 ? 0 : Int(ceil(((chorus - 0.2) / 0.8) * 3))
    for j in 0..<min(n, flies.count) {
      var F = flies[j]
      if F.until == 0 || now > F.until || F.i < 0 || !pad(F.i).on {   // цель меняет редко: висит над кувшинкой 6–12 с, потом — к недавно сыгравшей
        F.i = playedRank(j); F.until = now + 6 + rng() * 6
      }
      let dj = Double(j)
      var tx = G.W * (0.3 + 0.2 * dj), ty = G.hor + G.h * (0.25 + 0.1 * dj)
      if F.i >= 0, pad(F.i).on {
        let q = G.padXY(F.i, pad(F.i).note)
        tx = q.x + sin(nowMs * 0.0003 + dj * 2) * 6; ty = q.y - 22 * q.s - 8 + sin(nowMs * 0.0005 + dj) * 2
      }
      if !F.ok { F.x = tx; F.y = ty; F.ok = true }
      let k = min(1, step * 0.8)                                // плавно, без рывков
      F.x += (tx - F.x) * k; F.y += (ty - F.y) * k
      flies[j] = F
    }
    for j in n..<max(n, flies.count) { flies[j].ok = false }
  }

  // m-я (по кругу) из звучащих кувшинок шага по давности: сыгранные позже — раньше; при равенстве — меньший номер (view.js:425-426)
  private func playedRank(_ m: Int) -> Int {
    let L = min(len, Nat.npad)
    var cnt = 0
    for i in 0..<L where pad(i).on { cnt += 1 }
    guard cnt > 0 else { return -1 }
    let want = m % cnt
    for i in 0..<L where pad(i).on {
      var before = 0
      let pi = state.playedAt[i]
      for j in 0..<L where j != i && pad(j).on && (state.playedAt[j] > pi || (state.playedAt[j] == pi && j < i)) { before += 1 }
      if before == want { return i }
    }
    return -1
  }

  // ---------- кувшинки (view.js:31-58) ----------
  private func drawPads(_ p: NatPen, nowMs: Double, held: UInt16) {
    let L = max(1, len), ph = phase, playing = ph != nil, pos = ph ?? 0, Ld = Double(L)
    let cur = playing ? Int(floor(pos)) % L : -1
    let stepMs = 60 / bpm / 4 * 1000, echoes = 1 + Int(Horo.jsRound(fxv(1) * 3)), gap = Nat.div(fxv(2)).beats * 60 / bpm * 1000
    if playing {                                                  // круги от задетых кувшинок — только что и эхом (через время задержки)
      for i in 0..<min(L, Nat.npad) {
        let pd = pad(i)
        guard pd.on else { continue }
        let q = geo.padXY(i, pd.note), since = (((pos - Double(i)).truncatingRemainder(dividingBy: Ld) + Ld).truncatingRemainder(dividingBy: Ld)) * stepMs
        for e in 0..<echoes {
          let k = (since - Double(e) * gap) / 700
          if k < 0 || k > 1 { continue }
          p.line(0.6 * (1 - k) * pow(0.7, Double(e)), 1)
          let R = 12 * q.s + 26 * q.s * k
          p.begin(); p.ellipse(q.x, q.y, R, R * 0.45, rot: 0, 0, tau); p.stroke()
        }
      }
    }
    for i in 0..<Nat.npad {
      if i == L { drawBridge(p, nowMs: nowMs) }                   // запруда — между последним шагом и бледными за ним
      let pd = pad(i)
      guard pd.on else { continue }
      let q = geo.padXY(i, pd.note), on = i == cur && i < L
      let open = on ? envAt((pos.truncatingRemainder(dividingBy: 1)) * stepMs, pd) : 0
      let isHeld = held & (1 << UInt16(i)) != 0
      NatArt.lily(p, q.x, q.y, q.s, wave: pd.wave, open: open, i < L ? (isHeld ? 1 : 0.95) : 0.3, locked: pd.lock.max() >= 0, chance: pd.chanceV)   // за запрудой — бледные, не играют
    }
    if L >= 16 { drawBridge(p, nowMs: nowMs) }
    let b = geo.boat(phase: ph, len: L, now: nowMs / 1000)       // лист-лодочка плывёт по течению: между местами — плавно
    NatArt.boatShape(p, b.x, b.y, b.s, -0.15, paused: !playing)
  }

  // ---------- глайд (view.js:449-469): струя между кувшинками и свежий след пальца ----------
  private func drawGlides(_ p: NatPen, nowMs: Double) {
    var prev: (x: Double, y: Double)?
    p.line(0.55, 1.1)
    for i in 0..<min(len, Nat.npad) {
      let pd = pad(i)
      guard pd.on else { continue }
      let q = geo.padXY(i, pd.note)
      if pd.glide, let a = prev {
        p.begin()
        for k in 0...16 {
          let u = Double(k) / 16, x = a.x + (q.x - a.x) * u, y = a.y + (q.y - a.y) * u + sin(u * tau * 2 + nowMs * 0.004) * 2.2
          if k > 0 { p.to(x, y) } else { p.move(x, y) }
        }
        p.stroke()
      }
      prev = (q.x, q.y)
    }
    for t in fingers.values where t.kind == .plant && t.moved { drawTrail(p, t.path, 0.7) }
    if let w = wake {
      let k = (nowMs - w.at * 1000) / 900
      if k < 1 { drawTrail(p, w.path, 0.6 * (1 - k)) }
    }
  }
  private func drawTrail(_ p: NatPen, _ path: [(Double, Double)], _ a: Double) {
    p.line(a, 1.4); p.dash(trailDash)
    p.begin()
    for (k, q) in path.enumerated() { if k > 0 { p.to(q.0, q.1) } else { p.move(q.0, q.1) } }
    p.stroke(); p.dash(noDash)
  }

  // ---------- рыба (view.js:398-421): только рисунок ----------
  private func drawFish(_ p: NatPen, nowMs: Double) {
    guard let f = fish else { return }
    let k = (nowMs - f.t0 * 1000) / 650
    if k > 1.6 { return }
    let L = 34 * f.s
    p.line(0.5 * max(0, 1 - abs(k - 0.05) * 2), 0.9)             // круги: где нырнула вверх и где вошла
    for e in 0..<2 {
      let x0 = e == 0 ? f.x - f.dir * L / 2 : f.x + f.dir * L / 2, kk = (k - Double(e)) / 0.6
      if kk < 0 || kk > 1 { continue }
      p.strokeInk(0.5 * (1 - kk)); p.begin(); p.ellipse(x0, f.y, 5 + 16 * kk, (5 + 16 * kk) * 0.35, rot: 0, 0, tau); p.stroke()
    }
    if k > 1 { return }
    let x = f.x + f.dir * L * (k - 0.5), y = f.y - sin(Double.pi * k) * 22 * f.s
    let ang = atan2(-cos(Double.pi * k) * 22 * Double.pi * f.s, f.dir * L), sz = 7 * f.s
    p.g.saveGState(); p.g.translateBy(x: CGFloat(x), y: CGFloat(y)); p.g.rotate(by: CGFloat(f.dir > 0 ? ang : ang + Double.pi)); p.g.scaleBy(x: f.dir > 0 ? 1 : -1, y: 1)
    p.fillPap(1); p.line(0.9, 1)
    p.begin(); p.move(sz, 0); p.quad(0, -sz * 0.5, -sz * 0.8, 0); p.quad(0, sz * 0.5, sz, 0); fillStroke(p)
    p.begin(); p.move(-sz * 0.75, 0); p.to(-sz * 1.25, -sz * 0.35); p.to(-sz * 1.2, sz * 0.35); p.close(); fillStroke(p)
    p.begin(); p.arc(sz * 0.55, -sz * 0.08, 0.9, 0, tau); p.fillInk(0.9); p.fill()
    p.g.restoreGState()
  }

  // ---------- лягушка (view.js:369-383): позицию считает touchTick (frogAt) ----------
  private func drawFrog(_ p: NatPen, nowMs: Double) {
    guard let f = frogAt else { return }
    let s = 7 * f.s
    p.g.saveGState(); p.g.translateBy(x: CGFloat(f.x), y: CGFloat(f.y))
    p.fillPap(1); p.line(0.9, 1)
    p.begin()
    if f.air { p.move(-s * 0.6, s * 0.3); p.to(-s * 1.5, s * 0.9); p.move(s * 0.6, s * 0.3); p.to(s * 1.5, s * 0.9) }   // в прыжке — ноги вытянуты
    else { p.move(-s * 0.8, s * 0.4); p.to(-s * 1.2, -s * 0.05); p.to(-s * 0.7, s * 0.55); p.move(s * 0.8, s * 0.4); p.to(s * 1.2, -s * 0.05); p.to(s * 0.7, s * 0.55) }
    p.stroke()
    p.begin(); p.ellipse(0, 0, s * 0.85, s * 0.6, rot: 0, 0, tau); fillStroke(p)
    for ex in [-0.38, 0.38] as [Double] {
      p.begin(); p.arc(ex * s, -s * 0.5, s * 0.24, 0, tau); fillStroke(p)
      p.begin(); p.arc(ex * s, -s * 0.52, s * 0.08, 0, tau); p.fillInk(0.9); p.fill(); p.fillPap(1)
    }
    let ck = (nowMs - state.croakAt * 1000) / 320
    if ck >= 0 && ck < 1 { p.begin(); p.arc(0, s * 0.45, s * 0.35 * (1 + sin(Double.pi * ck)), 0, tau); fillStroke(p) }   // горловой мешок
    p.g.restoreGState()
  }

  // ---------- челнок (view.js:112-135): только рисунок и след; движет его touchTick ----------
  private func drawSkiff(_ d: Draw, _ p: NatPen, nowMs: Double) {
    for w in skiff.trail {                                        // след на воде — расходящиеся дуги
      let k = (nowMs - w.t * 1000) / 1400
      if k > 1 { continue }
      p.line(0.45 * (1 - k), 0.9)
      p.begin(); p.ellipse(w.x, w.y + 2, 6 + 22 * k, (6 + 22 * k) * 0.4, rot: 0, Double.pi * 0.1, Double.pi * 0.9); p.stroke()
    }
    let onWater = skiff.held && skiff.onRiver
    NatArt.boatShape(p, skiff.x, skiff.y - (onWater ? 2 : 0), 1.25, skiff.home ? -0.35 : sin(nowMs * 0.004) * 0.08, paused: false)
    if onWater && !skiff.label.isEmpty { d.mapText(skiff.label, CGFloat(skiff.x), CGFloat(skiff.y - 30), 15, 0.95, align: .center) }
  }

  // ---------- стрекозы (view.js:437-446): только рисунок ----------
  private func drawFlies(_ p: NatPen, nowMs: Double) {
    let chorus = fxv(3), n = chorus < 0.2 ? 0 : Int(ceil(((chorus - 0.2) / 0.8) * 3))
    for j in 0..<min(n, flies.count) where flies[j].ok {
      let F = flies[j], dj = Double(j), fl = 0.7 + 0.3 * sin(nowMs * 0.03 + dj)
      p.g.saveGState(); p.g.translateBy(x: CGFloat(F.x), y: CGFloat(F.y)); p.g.rotate(by: CGFloat(sin(nowMs * 0.0003 + dj) * 0.12))
      p.line(0.85, 1.1); p.begin(); p.move(-7, 0); p.to(6, 0); p.stroke()
      p.begin(); p.arc(7, 0, 1.4, 0, tau); p.fillInk(0.85); p.fill()
      p.line(0.65 * fl, 0.8)
      for w in 0..<4 {
        let x0 = w < 2 ? 2.0 : -1.0, sy = w % 2 == 0 ? -1.0 : 1.0
        p.begin(); p.ellipse(x0, sy * 4, 1.6, 4.2, rot: sy * 0.4, 0, tau); p.stroke()
      }
      p.g.restoreGState()
    }
  }

  // ---------- подписи — только пока тянешь (view.js:470-499) ----------
  private func drawTouches(_ d: Draw) {
    let G = geo
    for t in fingers.values where t.moved {
      switch t.kind {
      case .boat:
        let q = G.pier()
        d.mapText("\(Int(Horo.jsRound(bpm))) BPM", CGFloat(q.x), CGFloat(q.y - 26), 15, 0.9, align: .center)
      case .cloud:
        let cl = G.cloud(cutoff: fxv(4))
        d.mapText("cutoff · \(Int(Horo.jsRound(180 * pow(2, fxv(4) * 6.6)))) Hz", CGFloat(min(cl.cx, G.W - 90)), CGFloat(cl.cy + 24 * cl.s), 14, 0.9, align: .center)
      case .mountains:
        d.mapText("res · \(Int(Horo.jsRound(fxv(5) * 100)))%", CGFloat(G.W / 2), CGFloat(G.hor - 0.26 * G.h), 14, 0.9, align: .center)
      case .duckA, .duckR:
        let D = G.ducks(att: fxv(6), rel: fxv(7), now: now), u = t.kind == .duckA ? D.a : D.r
        let v = t.kind == .duckA ? Nat.attOf(fxv(6)) : Nat.relOf(fxv(7))
        let ms = v < 1 ? "\(Int(Horo.jsRound(v * 1000))) ms" : String(format: "%.2f s", v)
        d.mapText("\(t.kind == .duckA ? "attack" : "release") · \(ms)", CGFloat(Nat.clamp(u.x, 80, G.W - 80)), CGFloat(u.y - u.s * 1.4 - 14), 14, 0.9, align: .center)
      case .bridge:
        let r = G.river(G.bridgeT(len: len)), q = r.across(0.5 + 22 / r.w)
        d.mapText(String(len), CGFloat(q.x), CGFloat(q.y - 12), 16, 0.9, align: .center)
      case .pad where pad(t.i).on:
        let pd = pad(t.i), q = G.padXY(t.i, pd.note)
        d.mapText(natNoteName(scl.noteHz(pd.note)), CGFloat(q.x), CGFloat(q.y - 24 - 8 * q.s), 15, 0.95, align: .center)
      default: break
      }
    }
  }

  // ---------- меню цветков (view.js:338-351) ----------
  private func drawMenu(_ d: Draw, _ p: NatPen) {
    guard let m = menu else { return }
    let O = menuOpts(), cur = state.lastWave
    for (k, o) in O.enumerated() {
      let on = k == m.hover || (m.hover < 0 && k == cur)
      p.fillPap(1); p.begin(); p.arc(o.x, o.y, 22, 0, tau); p.fill()
      d.ring(CGFloat(o.x), CGFloat(o.y), 22, on ? 0.95 : 0.6, 1)
      if k == cur { d.ring(CGFloat(o.x), CGFloat(o.y), 25, 0.5, 0.7) }
      NatArt.flower(p, o.x, o.y + 1, wave: k, 10, on ? 1 : 0.75)
    }
    let k = m.hover >= 0 ? m.hover : cur
    if k >= 0 && k < O.count { d.mapText(Nat.waves[k], CGFloat(O[k].x), CGFloat(O[k].y - 30), 14, 0.9, align: .center) }
  }

  // CGImage-кеш на весь вид: образ лежит «вверх ногами» к нашему перевёрнутому контексту
  private func drawLayer(_ img: CGImage?, _ d: Draw) {
    guard let img else { return }
    let g = d.g
    g.saveGState(); g.translateBy(x: 0, y: d.H); g.scaleBy(x: 1, y: -1)
    g.draw(img, in: CGRect(x: 0, y: 0, width: d.W, height: d.H)); g.restoreGState()
  }

  // ---------- кадр (view.js:504-532) ----------
  func drawFrame(_ d: Draw, now: Double) {
    let g = d.g, G = geo, nowMs = now * 1000, th = theme
    let p = NatPen(g: g, inkC: th.ink, papC: th.paper)
    layers.update(G, size: CGSize(width: d.W, height: d.H), dpr: Draw.scale, res: fxv(5), ink: th.ink, pap: th.paper)
    if G.ox > 0 { p.fillPap(1); p.fillRect(0, 0, Double(d.W), Double(d.H)) }   // по бокам — бумага
    g.saveGState(); g.translateBy(x: CGFloat(G.ox), y: 0)
    drawLayer(layers.sky, d)
    g.saveGState(); p.begin(); p.rect(13, 13, G.W - 26, G.bot + 14); g.clip()   // рамка: T.H − safeBot − 26
    drawSun(d, nowMs: nowMs)
    drawBirds(p, nowMs: nowMs)
    g.restoreGState()
    drawLayer(layers.land, d)
    drawFog(p, nowMs: nowMs)
    drawRainRings(p, nowMs: nowMs)
    drawPier(p, nowMs: nowMs)
    drawGlides(p, nowMs: nowMs)
    drawFish(p, nowMs: nowMs)
    var held: UInt16 = 0
    for t in fingers.values where t.kind == .pad && t.i >= 0 && t.i < Nat.npad { held |= 1 << UInt16(t.i) }
    drawPads(p, nowMs: nowMs, held: held)
    drawFrog(p, nowMs: nowMs)
    drawReeds(p, nowMs: nowMs)
    drawTree(p, nowMs: nowMs)
    drawCloud(p, nowMs: nowMs)
    drawDucks(p, nowMs: nowMs)                                   // с заводью
    drawSkiff(d, p, nowMs: nowMs)
    drawFlies(p, nowMs: nowMs)
    drawStone(p, nowMs: nowMs)
    drawTouches(d)
    drawMenu(d, p)
    g.restoreGState()
  }
}
