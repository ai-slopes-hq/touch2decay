import UIKit

private let tau = Double.pi * 2
private let noDash: [CGFloat] = []

// scene.js:324-333 — волны воды и камыши заводи (u, v, длина) и (u, высота)
private let pondWaves: [(u: Double, v: Double, l: Double)] = [(-0.6, -0.35, 0.3), (0.15, -0.45, 0.35), (-0.2, 0.5, 0.4), (0.45, 0.35, 0.25)]
private let pondReeds: [(u: Double, h: Double)] = [(-0.95, 26), (-0.85, 18), (0.93, 22)]
// scene.js:394 — места камышей по реке
private let reedT: [Double] = [0.55, 0.92, 0.7, 0.62, 0.84, 0.97, 0.75, 0.66, 0.88, 0.58, 0.8, 0.94, 0.72, 0.6, 0.86, 0.78]
// scene.js:442 — облака вокруг (delay): (dx, dy, k)
private let extraClouds: [(dx: Double, dy: Double, k: Double)] = [(-0.3, 0.6, 0.55), (0.12, -0.5, 0.6), (-0.55, -0.3, 0.45), (-0.15, 0.9, 0.5), (0.05, 0.4, 0.4)]
// view.js:42 — фазы улёта уток, мс: улетают 0.7 с, вдали до 3 с, за секунду возвращаются
private let goneAway = 700.0, goneBack = 3000.0, goneLand = Nat.goneS * 1000

// картинка Natura в кадре (scene.js, view.js): чтение состояния и рисование; состояние меняет тик (NaturaView.tick), не кадр.
// Время — миллисекунды (nowMs = now·1000), как `now` веба. Тема мира: ink = 38,26,16, бумага = 226,211,174.
extension NaturaView {
  // canvas fill() + stroke() по одному пути: fillPath() в CG путь сбрасывает
  private func fillStroke(_ p: NatPen) { p.g.drawPath(using: .fillStroke) }

  // view.js:30 — садится при медленном темпе: виден весь диск над краем рамки (top = min(sun.y, рамка))
  func drawSun(_ d: Draw, nowMs: Double) {
    let S = geo.sunAt(bpm: bpm)
    d.quarterSun(CGFloat(S.x), CGFloat(S.y), CGFloat(S.r), side: 1, now: nowMs, col: theme.ink, disc: theme.bg, top: CGFloat(min(S.y, geo.sun.y)))
  }

  // view.js:153-169 — птицы хора; позиции — из birdBuf (считает тик)
  func drawBirds(_ p: NatPen, nowMs: Double) {
    p.line(0.8, 1.2)
    for b in birdBuf {
      let s = b.s, f = sin(nowMs * (0.006 + 0.03 * b.fast) + Double(b.i) * 2.1) * 3 * s
      p.begin(); p.move(b.x - 6 * s, b.y - f * 0.4); p.quad(b.x - 3 * s, b.y - 3 * s - f, b.x, b.y)
      p.quad(b.x + 3 * s, b.y - 3 * s - f, b.x + 6 * s, b.y - f * 0.4); p.stroke()
    }
  }

  // scene.js:167-181 — туман: reverb, дальние холмы тонут
  func drawFog(_ p: NatPen, nowMs: Double) {
    let G = geo, r = fxv(0)
    if r < 0.03 { return }
    p.fillPap(0.8 * r); p.fillRect(13, G.hor - 0.15 * G.h, G.W - 26, 0.15 * G.h + 0.02 * G.h)
    p.line(0.3 * r, 0.9)
    let n = Int(Horo.jsRound(2 + r * 5))
    fogDash[0] = CGFloat(10 + 8 * r); p.dash(fogDash)
    for i in 0..<n {
      let yy = G.hor - 0.1 * G.h + Double(i) * 8, ph = nowMs * 0.0003 * (i % 2 == 1 ? 1 : -1) + Double(i)
      p.begin()
      var X = 16.0
      while X < G.W - 16 {
        let Y = yy + sin(X * 0.04 + ph) * 2
        if X == 16 { p.move(X, Y) } else { p.to(X, Y) }
        X += 6
      }
      p.stroke()
    }
    p.dash(noDash)
  }

  // scene.js:382-393 — дождь по воде: кружки, гуще с time
  func drawRainRings(_ p: NatPen, nowMs: Double) {
    let G = geo, n = Int(Horo.jsRound(4 + 14 * fxv(2)))
    p.g.setLineWidth(0.8)
    for i in 0..<max(0, n) {
      let di = Double(i), per = 1300 + Double(i % 5) * 170, u = nowMs + di * 397
      let k = u.truncatingRemainder(dividingBy: per) / per, cyc = Int(floor(u / per))
      let h1 = Double((i * 7919 + cyc * 104729) % 1000) / 1000, h2 = Double((i * 3301 + cyc * 7727) % 1000) / 1000
      let t = 0.15 + h1 * 0.8, q = G.river(t).across((h2 - 0.5) * 0.85), R = (2 + 8 * k) * (0.5 + t)
      p.strokeInk(0.35 * (1 - k)); p.begin(); p.ellipse(q.x, q.y, R, R * 0.4, rot: 0, 0, tau); p.stroke()
    }
  }

  // scene.js:372-381 — причал: настил, столб, свая; пока стоим — верёвка к лодочке
  func drawPier(_ p: NatPen, nowMs: Double) {
    let q = geo.pier(), x = q.x, y = q.y
    p.fillPap(1); p.line(0.9, 1.1)
    p.begin(); p.rect(x - 14, y - 4, 30, 7); fillStroke(p)                              // настил
    p.g.setLineWidth(0.8); p.begin()
    for k in 1..<5 { p.move(x - 14 + Double(k) * 6, y - 4); p.to(x - 14 + Double(k) * 6, y + 3) }
    p.stroke()
    p.g.setLineWidth(1.4); p.begin()                                                    // столб и свая
    p.move(x + 14, y - 12); p.to(x + 14, y + 8); p.move(x - 12, y + 3); p.to(x - 12, y + 9)
    p.stroke()
    if !playing { p.g.setLineWidth(0.8); p.begin(); p.move(x + 14, y - 8); p.quad(x + 20, y, x + 24, y + 2); p.stroke() }   // верёвка к лодочке
  }

  // scene.js:253-264 — запруда: жердь на семи кольях, рябь у основания
  func drawBridge(_ p: NatPen, nowMs: Double) {
    let G = geo, t = G.bridgeT(len: len), r = G.river(t), n = 7, h = 10 + 16 * t
    func pt(_ k: Int) -> (x: Double, y: Double) { r.across(-0.5 - 6 / r.w + (Double(k) / Double(n - 1)) * (1 + 12 / r.w)) }
    p.line(0.9, 1.3); p.fillPap(1)
    p.begin()                                                                           // жердь
    for k in 0..<n { let q = pt(k); if k > 0 { p.to(q.x, q.y - h * 0.7) } else { p.move(q.x, q.y - h * 0.7) } }
    p.stroke()
    for k in 0..<n {                                                                    // колья: столбик с заострённой макушкой
      let q = pt(k)
      p.begin(); p.move(q.x - 2.2, q.y + 1); p.to(q.x - 2.2, q.y - h); p.to(q.x, q.y - h - 4); p.to(q.x + 2.2, q.y - h); p.to(q.x + 2.2, q.y + 1); p.close(); fillStroke(p)
      p.g.setLineWidth(0.8); p.begin(); p.move(q.x - 6, q.y + 2); p.quad(q.x, q.y + 4, q.x + 6, q.y + 2); p.stroke(); p.g.setLineWidth(1.3)
    }
  }

  // scene.js:394-409 — камыши по обоим берегам ближней части
  func drawReeds(_ p: NatPen, nowMs: Double) {
    let G = geo, k = 0.5
    for i in 0..<10 {
      let di = Double(i), t = reedT[i], r = G.river(t), sd = i % 2 == 1 ? 1.0 : -1.0
      let q = r.across(sd * (0.5 + (2 + Double(i % 3) * 5) / r.w)), X = q.x, base = q.y + 2
      if X < 16 || X > G.W - 16 || base > G.bot { continue }
      let hh = (12 + k * 42) * (0.6 + 0.6 * t) * (0.8 + 0.2 * sin(di * 2.7)), sw = sin(nowMs * 0.0012 + di) * 2.5 * (hh / 50)
      let tx = X + sw, ty = base - hh
      p.line(0.85, 1)
      p.begin(); p.move(X, base); p.quad(X, base - hh * 0.5, tx, ty); p.stroke()
      p.begin(); p.move(tx, ty); p.to(tx + sw * 0.2, ty - 5); p.stroke()
      p.fillInk(0.85); p.begin(); p.ellipse(tx, ty + 5, 1.8, 4.5, rot: 0, 0, tau); p.fill()
      p.line(0.7, 0.9); p.begin()
      for s in 0..<2 {
        let dd = s == 0 ? -1.0 : 1.0
        p.move(X, base); p.quad(X + dd * 3, base - hh * 0.45, X + dd * 9 + sw * 0.6, base - hh * 0.7)
      }
      p.stroke()
    }
  }

  // scene.js:410-441 — древо жизни: ствол с корнями, крона-фестон, листья и плоды; тормошат — крона ходит и листья падают
  func drawTree(_ p: NatPen, nowMs: Double) {
    let G = geo, cr = G.crown(), R = cr.R, cy = cr.y, y = G.tree.y, sk = shake
    let x = G.tree.x + sin(nowMs * 0.03) * sk * 5
    p.fillInk(0.9)
    p.begin(); p.move(x - 6, y); p.quad(x - 3, (y + cy) / 2, x - 2.5, cy); p.to(x + 2.5, cy); p.quad(x + 3, (y + cy) / 2, x + 6, y); p.close(); p.fill()
    p.line(0.9, 1.2); p.begin()
    for s in 0..<2 { let d = s == 0 ? -1.0 : 1.0; p.move(x + d * 3, y - 2); p.quad(x + d * 9, y + 1, x + d * 22, y + 5) }
    p.stroke()
    let lobes = 9                                                                       // крона: фестоны по кругу
    p.fillPap(1); p.line(0.9, 1.3)
    p.begin()
    for k in 0..<lobes {
      let a0 = Double(k) / Double(lobes) * tau, a1 = Double(k + 1) / Double(lobes) * tau, am = (a0 + a1) / 2
      let p0x = x + cos(a0) * R, p0y = cy + sin(a0) * R * 0.92
      if k == 0 { p.move(p0x, p0y) }
      p.quad(x + cos(am) * R * 1.32, cy + sin(am) * R * 1.22, x + cos(a1) * R, cy + sin(a1) * R * 0.92)
    }
    p.close(); fillStroke(p)
    NatScene.hatchIn(p, G, { p.arc(x + R * 0.2, cy + R * 0.15, R * 0.95, -0.4, 1.9) }, 0.8, 3, 0.35)   // тень справа-снизу
    for k in 0..<7 {                                                                    // листья и плоды внутри
      let a = Double(k) * 2.4, rr = R * (0.25 + 0.55 * Double((k * 37) % 10) / 10), lx = x + cos(a) * rr, ly = cy + sin(a) * rr * 0.9
      if k % 2 == 1 {
        p.fillPap(1); p.line(0.85, 1); p.begin(); p.arc(lx, ly, 3.2, 0, tau); fillStroke(p)
        p.begin(); p.move(lx, ly - 3.2); p.to(lx + 1.5, ly - 6); p.stroke()
      } else { NatArt.leaf(p, lx, ly + 5, a, 0.75, 0.75) }
    }
    let nf = Int(Horo.jsRound(sk * 8))                                                  // опадают листья
    for k in 0..<max(0, nf) {
      let dk = Double(k), t = (nowMs / (900 + dk * 130) + dk * 0.31).truncatingRemainder(dividingBy: 1)
      let lx = x + sin(dk * 2.7) * R * 0.9 + sin(t * 9 + dk) * 8, ly = cy + R * 0.6 + t * G.h * 0.14
      NatArt.leaf(p, lx, ly, t * 6 + dk, 0.6, 0.7 * (1 - t))
    }
  }

  // scene.js:442-454 — туча над древом поливает его и берег; облака вокруг — delay
  func drawCloud(_ p: NatPen, nowMs: Double) {
    let G = geo, cutoff = fxv(4), delay = fxv(1), c = G.cloud(cutoff: cutoff)
    let n = delay < 0.15 ? 0 : Int(ceil((delay - 0.15) / 0.85 * Double(extraClouds.count)))
    for i in 0..<min(n, extraClouds.count) {
      let e = extraClouds[i], bob = sin(nowMs * 0.0006 + Double(i) * 1.7) * 2
      NatArt.cloud(p, c.cx + e.dx * G.W, c.cy + e.dy * 40 + bob, c.s * e.k, 0.55 + 0.1 * Double(i % 2))
    }
    NatArt.rain(p, c.cx, c.cy + 0.2 * 64 * c.s, G.W * 0.3, G.tree.y + 20, 0.42, nowMs, 0.4 + 1.6 * fxv(2))
    NatArt.cloud(p, c.cx, c.cy, c.s, 0.95, heavy: Nat.clamp((0.6 - cutoff) / 0.6))
  }

  // scene.js:319-335 — заводь: вода волнистыми штрихами и камыши у края
  func drawPond(_ p: NatPen, nowMs: Double) {
    let P = geo.pond()
    p.fillPap(1); p.line(0.8, 1.1)
    p.begin(); p.ellipse(P.x, P.y, P.rx, P.ry, rot: 0, 0, tau); fillStroke(p)
    p.line(0.35, 0.8); p.begin()
    for w in pondWaves {
      let x0 = P.x + w.u * P.rx, y0 = P.y + w.v * P.ry, L = w.l * P.rx
      p.move(x0, y0); p.quad(x0 + L / 4, y0 - 2, x0 + L / 2, y0); p.quad(x0 + 3 * L / 4, y0 + 2, x0 + L, y0)
    }
    p.stroke()
    p.line(0.7, 0.9)
    for r in pondReeds {
      let x0 = P.x + r.u * P.rx, y0 = P.y - 2
      p.begin(); p.move(x0, y0); p.quad(x0 + 1, y0 - r.h / 2, x0 + 3, y0 - r.h); p.stroke()
      p.begin(); p.ellipse(x0 + 2.6, y0 - r.h + 4, 1.8, 4.5, rot: 0.15, 0, tau); p.fillInk(0.75); p.fill()
    }
  }

  // сила огибающей к моменту ms после ноты: атака линейно, дальше спад (view.js:46)
  func envAt(_ ms: Double, _ pd: NatPad) -> Double {
    let a = attSec(pd) * 1000
    return ms < a ? ms / a : exp(-(ms - a) / (relSec(pd) * 1000 / 2.5))
  }
  private func attSec(_ pd: NatPad) -> Double { Nat.attOf(state.envOpen(now: now) ? 0 : val(pd, "att")) }   // model.js:51
  private func relSec(_ pd: NatPad) -> Double { Nat.relOf(state.envOpen(now: now) ? 1 : val(pd, "rel")) }

  // view.js:59-111 — заводь, плюх, утки (кивают на ноту, улетают от кораблика и возвращаются), утята, отражения
  func drawDucks(_ p: NatPen, nowMs: Double) {
    let G = geo, rel = fxv(7), reverb = fxv(0)
    drawPond(p, nowMs: nowMs)
    if let s = splash {                                                                  // плюх: брызги и круги
      let k = (nowMs - s.t0 * 1000) / 900
      if k <= 1 {
        p.line(0.6 * (1 - k), 1)
        for qi in 0..<2 {
          let kk = k - (qi == 0 ? 0 : 0.3)
          if kk > 0 { p.begin(); p.ellipse(s.x, s.y + 2, 8 + 30 * kk, (8 + 30 * kk) * 0.3, rot: 0, 0, tau); p.stroke() }
        }
        p.begin()
        for i in 0..<6 {
          let an = Double.pi * (1.15 + Double(i) * 0.14), r = 6 + 16 * k, lift = 10 * sin(Double.pi * k)
          p.move(s.x + cos(an) * r, s.y + sin(an) * r * 1.4 - lift); p.to(s.x + cos(an) * (r + 3), s.y + sin(an) * (r + 3) * 1.4 - lift)
        }
        p.stroke()
      }
    }
    let D = G.ducks(att: fxv(6), rel: rel, now: nowMs / 1000)
    if let g0 = state.goneAt {                                                           // утки улетели: за горы, вдали, обратно — садятся
      let e = nowMs - g0 * 1000
      if e < goneLand {
        let far = (x: G.W * 0.2, y: G.hor - G.h * 0.12)
        var k = e < goneAway ? e / goneAway : e < goneBack ? 1 : 1 - (e - goneBack) / (goneLand - goneBack)
        k = k * k * (3 - 2 * k)
        if k < 0.995 {
          for side in 0..<2 {
            let d = side == 0 ? D.a : D.r, sd = Double(side)
            let x = d.x + (far.x + sd * 22 - d.x) * k, y = d.y - 10 + (far.y + sd * 8 - (d.y - 10)) * k - sin(Double.pi * k) * 30
            let back = e > goneBack, dir = (far.x - d.x) * (back ? -1 : 1) > 0 ? 1.0 : -1.0
            NatArt.flyer(p, x, y, d.s * 1.1 * (1 - 0.6 * k), dir, sin(nowMs * 0.018 + sd * 1.3))
          }
        }
        NatArt.ducklings(p, G, nowMs, rel: rel)                                          // утята не летают — ждут в заводи
        return
      }
    }
    // нота: последняя прозвучавшая кувшинка задаёт кивок и круги
    var ni = -1
    for i in 0..<Nat.npad where state.noteAt[i] > -1e5 && (ni < 0 || state.noteAt[i] > state.noteAt[ni]) { ni = i }
    var nod = 0.0
    if ni >= 0 {
      let pd = pad(ni), ms = nowMs - state.noteAt[ni] * 1000, a = attSec(pd) * 1000, r = relSec(pd) * 1000
      let dur = max(a, 140)
      nod = ms > 0 && ms < dur ? sin(Double.pi * ms / dur) : 0
      if ms > a && ms < a + r * 2 {                                                      // круги от правой утки: расходятся за release
        let k = (ms - a) / (r * 2), e = envAt(ms, pd)
        for qi in 0..<2 {
          let kk = k - (qi == 0 ? 0 : 0.35)
          if kk <= 0 { continue }
          let R = D.r.s * (1.3 + kk * 2.2)
          p.line(0.55 * e * (1 - kk), 1); p.begin(); p.ellipse(D.r.x, D.r.y + 1, R, R * 0.3, rot: 0, 0, tau); p.stroke()
        }
      }
    }
    if nod > 0.05 {                                                                      // где голова под водой — кружок
      p.line(0.5 * nod, 1); p.begin(); p.ellipse(D.a.x + D.a.s * 0.9, D.a.y + 1, D.a.s * 0.5 * (1 + nod), D.a.s * 0.14, rot: 0, 0, tau); p.stroke()
    }
    let P = G.pond(), kids = NatArt.ducklingCount(rel: rel)
    p.g.saveGState(); p.begin(); p.ellipse(P.x, P.y, P.rx - 1, P.ry - 1, rot: 0, 0, tau); p.g.clip()   // отражения в заводи: бледные, перевёрнутые; с reverb — размытее
    let nb = reverb > 0.35 ? 2 : 1
    p.g.setAlpha(CGFloat(0.16 / Double(nb)))
    func reflect(_ d: NatDuck, _ n: Double, _ ox: Double) {
      p.g.saveGState()
      p.g.translateBy(x: CGFloat(ox + sin(nowMs * 0.002 + d.x) * reverb * 1.5), y: CGFloat(2 * d.y + 4)); p.g.scaleBy(x: 1, y: -1)
      NatArt.duck(p, d, nod: n)
      p.g.restoreGState()
    }
    for bi in 0..<nb {
      let ox = nb == 2 ? (bi == 0 ? -1.5 : 1.5) : 0.0
      reflect(D.a, nod, ox); reflect(D.r, 0, ox)
      for k in 0..<max(0, kids) { reflect(NatArt.duckling(k, G, nowMs), 0, ox) }
    }
    p.g.restoreGState()
    NatArt.duck(p, D.a, nod: nod); NatArt.duck(p, D.r, nod: 0)
    NatArt.ducklings(p, G, nowMs, rel: rel)                                              // утята ближе к нам — поверх
  }

  // scene.js:455-470 — четверть надгробия из левого нижнего угла: ось камня — край экрана
  func drawStone(_ p: NatPen, nowMs: Double) {
    let G = geo, yb = G.bot + 40, R = min(84, G.W * 0.22), top = yb - R * 1.55, sh = yb - R * 0.55
    p.g.saveGState(); p.begin(); p.rect(0, 0, G.W, yb); p.g.clip()
    func outline(_ d: Double) { p.move(0, top + d); p.arc(0, sh, R - d, -Double.pi / 2, 0); p.to(R - d, yb + 2) }
    p.fillPap(1); p.begin(); outline(0); p.to(0, yb + 2); p.close(); p.fill()
    p.line(0.95, 1.7); p.begin(); outline(0); p.stroke()
    p.line(0.55, 0.9); p.begin(); outline(7); p.stroke()
    NatScene.hatchIn(p, G, {
      p.move(R * 0.7, sh); p.arc(0, sh, R, -0.75, 0); p.to(R, yb); p.to(R * 0.7, yb); p.close()
    }, Double.pi / 2, 2.6, 0.45)
    p.line(0.85, 2.2); p.begin()                                                          // крест — половина, по оси камня
    p.move(1, top + R * 0.3); p.to(1, top + R * 0.95); p.move(0, top + R * 0.5); p.to(R * 0.3, top + R * 0.5); p.stroke()
    p.line(0.55, 0.9)
    for k in 0..<3 { let yy = top + R * (1.12 + Double(k) * 0.1); p.begin(); p.move(0, yy); p.to(R * 0.5, yy); p.stroke() }   // стёртая надпись
    p.strokeInk(0.6); p.begin()                                                           // трещина
    p.move(R * 0.72, top + R * 0.42); p.to(R * 0.6, top + R * 0.62); p.to(R * 0.66, top + R * 0.75); p.to(R * 0.55, top + R * 0.95); p.stroke()
    p.g.restoreGState()
    p.line(0.6, 0.9); NatScene.tuft(p, R + 8, yb - 2, 0.9); NatScene.tuft(p, R + 22, yb - 1, 0.7)
  }
}
