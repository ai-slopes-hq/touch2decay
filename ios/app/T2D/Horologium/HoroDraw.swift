import UIKit

// рисование Horologium (view.js:120-250): стена в кеше, кольца, часовая стрелка и стрелка-солнце, шкала tempus, маятник.
// Состояние кадра — в HoroDrawState (расширения не хранят поля)
final class HoroDrawState {
  struct WallKey: Equatable { var W, H, sc, cy, R, sy: CGFloat }
  var wall: CGImage?, wallKey: WallKey?, wallBuilds = 0
  var marks: [(k: Int, a: Double)] = []                      // удары кольца в этом обороте — буфер кадра, выделен раз
  var gaps: [Double] = []                                    // углы ударов по возрастанию — для числа кольца
  init() { marks.reserveCapacity(24); gaps.reserveCapacity(24) }
}

extension HorologiumView {
  private static let tau = CGFloat.pi * 2
  var wallBuilds: Int { dr.wallBuilds }

  private func arc(_ g: CGContext, _ x: CGFloat, _ y: CGFloat, _ r: CGFloat) { g.strokeEllipse(in: CGRect(x: x - r, y: y - r, width: 2 * r, height: 2 * r)) }
  private func disc(_ g: CGContext, _ x: CGFloat, _ y: CGFloat, _ r: CGFloat) { g.fillEllipse(in: CGRect(x: x - r, y: y - r, width: 2 * r, height: 2 * r)) }
  private func cl(_ x: Double) -> CGFloat { CGFloat(Horo.clamp(x)) }

  // стена: обод, деления, цифры часов, шкала tempus, ось маятника; ключ — W×H×масштаб|cy|R|strip.y (view.js:123-146)
  func wallImage() -> CGImage? {
    let sc = Draw.scale, G = geo
    let key = HoroDrawState.WallKey(W: G.W, H: G.H, sc: sc, cy: G.cy, R: G.R, sy: G.strip.y)
    if let w = dr.wall, key == dr.wallKey { return w }
    dr.wallKey = key; dr.wallBuilds += 1
    guard let g = CGContext(data: nil, width: Int((G.W * sc).rounded()), height: Int((G.H * sc).rounded()), bitsPerComponent: 8, bytesPerRow: 0,
                            space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedFirst.rawValue) else { dr.wall = nil; return nil }
    g.translateBy(x: 0, y: CGFloat(g.height)); g.scaleBy(x: sc, y: -sc)   // начало слева сверху
    let d = Draw(g: g, W: G.W, H: G.H); d.setTheme(theme)
    let tau = HorologiumView.tau, cx = G.cx, cy = G.cy, R = G.R, S = G.strip
    g.setFillColor(theme.bg.cgColor); g.fill(CGRect(x: 0, y: 0, width: G.W, height: G.H))
    g.setLineWidth(1)
    g.setStrokeColor(d.ink(0.85)); arc(g, cx, cy, R)
    g.setStrokeColor(d.ink(0.3)); arc(g, cx, cy, R - 4)
    g.setStrokeColor(d.ink(0.45)); g.beginPath()
    for k in 0..<96 {
      let a = CGFloat(k) / 96 * tau, l: CGFloat = k % 4 != 0 ? 3 : 7
      g.move(to: CGPoint(x: cx + sin(a) * (R - 4), y: cy - cos(a) * (R - 4))); g.addLine(to: CGPoint(x: cx + sin(a) * (R - 4 - l), y: cy - cos(a) * (R - 4 - l)))
    }
    g.strokePath()
    let fs = max(9, min(12, R * 0.07))                                        // цифры, как на часах: XII наверху
    for k in 1...12 {
      let a = CGFloat(k) / 12 * tau, rr = R + 11
      d.mapText(Horo.roman[k], cx + sin(a) * rr, cy - cos(a) * rr, fs, 0.75, align: .center, italic: false, angle: a)
    }
    g.setStrokeColor(d.ink(0.12)); g.setLineDash(phase: 0, lengths: [1, 3]); g.beginPath()   // «раз»: здесь все кольца сходятся
    g.move(to: CGPoint(x: cx, y: cy - G.r0 + 4)); g.addLine(to: CGPoint(x: cx, y: cy - R + 10)); g.strokePath(); g.setLineDash(phase: 0, lengths: [])
    g.setStrokeColor(d.ink(0.5)); g.beginPath()                               // шкала tempus: от ритма к тону
    g.move(to: CGPoint(x: S.x0, y: S.y)); g.addLine(to: CGPoint(x: S.x1, y: S.y)); g.strokePath()
    g.beginPath()
    for k in 0...40 {
      let px = S.x0 + (S.x1 - S.x0) * CGFloat(k) / 40, l: CGFloat = k % 5 != 0 ? 3 : 6
      g.move(to: CGPoint(x: px, y: S.y)); g.addLine(to: CGPoint(x: px, y: S.y + l))
    }
    g.strokePath()
    d.mapText("rhythmus", S.x0, S.y - 9, 10.5, 0.45, align: .left); d.mapText("tonus", S.x1, S.y - 9, 10.5, 0.45, align: .right)
    g.setFillColor(d.ink(0.7)); disc(g, G.piv.x, G.piv.y, 3)
    dr.wall = g.makeImage()
    return dr.wall
  }

  // удары кольца в этом обороте: k и угол — в буфер кадра (view.js:147-151)
  private func fillMarks(_ r: HoroRing, _ P: Double) {
    dr.marks.removeAll(keepingCapacity: true)
    let m = Horo.mOf(r, aequalis: mirror.fx[0]), P0 = P.rounded(.down)
    var k = (P0 * m + r.phi).rounded(.up)
    while k < (P0 + 1) * m + r.phi { dr.marks.append((Int(k), ((k - r.phi) / m - P0) * 2 * .pi)); k += 1 }
  }

  private func drawRings(_ d: Draw, _ now: Double, _ P: Double) {
    let g = d.g, G = geo, fast = mirror.F > 4
    for i in 0..<Horo.nr {
      let r = mirror.rings[i], rr = G.ringR(i), on = r.on, m = Horo.mOf(r, aequalis: mirror.fx[0])
      let hit = cl(1 - (now - ringHit[i]) / 0.26), cur = Int((P * m + r.phi).rounded(.down))
      g.setLineWidth(1); g.setStrokeColor(d.ink(on ? 0.5 + 0.2 * CGFloat(r.lvl) : 0.13))
      if !on { g.setLineDash(phase: 0, lengths: [2, 4]) }
      arc(g, G.cx, G.cy, rr); g.setLineDash(phase: 0, lengths: [])
      if on && r.under { g.setStrokeColor(d.ink(0.3)); arc(g, G.cx, G.cy, rr - 3) }   // унтертон — двойной обвод
      fillMarks(r, P)
      for q in dr.marks {
        let x = G.cx + CGFloat(sin(q.a)) * rr, y = G.cy - CGFloat(cos(q.a)) * rr
        if !on { g.setStrokeColor(d.ink(0.22)); arc(g, x, y, 1.8); continue }
        let gl: CGFloat = fast ? 0.35 + 0.4 * CGFloat(r.lvl) : q.k == cur ? hit : 0
        if gl > 0.05 { d.glowAt(x, y, 10 + 8 * gl, 0.35 * gl) }
        g.setFillColor(d.ink(min(1, 0.55 + 0.45 * gl)))
        if r.under {
          g.beginPath(); g.move(to: CGPoint(x: x, y: y - 3.6)); g.addLine(to: CGPoint(x: x + 3, y: y)); g.addLine(to: CGPoint(x: x, y: y + 3.6)); g.addLine(to: CGPoint(x: x - 3, y: y)); g.closePath(); g.fillPath()
        } else { disc(g, x, y, 3.1) }
      }
      var la = Double.pi + 0.35                           // число кольца — внизу слева, в просвете между метками
      dr.gaps.removeAll(keepingCapacity: true)
      for q in dr.marks { dr.gaps.append((q.a.truncatingRemainder(dividingBy: 2 * .pi) + 2 * .pi).truncatingRemainder(dividingBy: 2 * .pi)) }
      dr.gaps.sort()
      if !dr.gaps.isEmpty {
        var best = la, bd = 9.0
        for j in 0..<dr.gaps.count {
          let a0 = dr.gaps[j], a1 = j + 1 < dr.gaps.count ? dr.gaps[j + 1] : dr.gaps[0] + 2 * .pi, mid = (a0 + a1) / 2
          let dd = abs(((mid - la + .pi).truncatingRemainder(dividingBy: 2 * .pi) + 2 * .pi).truncatingRemainder(dividingBy: 2 * .pi) - .pi)
          if dd < bd { bd = dd; best = mid }
        }
        la = best
      }
      let lx = G.cx + CGFloat(sin(la)) * rr, ly = G.cy - CGFloat(cos(la)) * rr, fs: CGFloat = on ? 11 : 9.5
      let lab = r.under ? "1/\(Horo.roman[r.n])" : Horo.roman[r.n], w = d.mapTextWidth(lab, fs)
      g.setFillColor(theme.bg.cgColor); g.fill(CGRect(x: lx - w / 2 - 2, y: ly - 6, width: w + 4, height: 12))
      d.mapText(lab, lx, ly, fs, on ? 0.9 : 0.32, align: .center)
    }
  }

  private func ray(_ g: CGContext, _ cx: CGFloat, _ cy: CGFloat, _ a: CGFloat, _ R: CGFloat) {
    g.move(to: CGPoint(x: cx, y: cy)); g.addLine(to: CGPoint(x: cx + sin(a) * R, y: cy - cos(a) * R))
  }

  // часовая стрелка — считает такты: деление за такт, круг — 12 тактов (view.js:171-183)
  private func drawHour(_ d: Draw, _ P: Double) {
    let g = d.g, G = geo, tau = HorologiumView.tau, Fh = mirror.F / 12, R = G.R * 0.58
    let bar = ((Int(P.rounded(.down)) % 12) + 12) % 12, na = CGFloat(bar + 1) / 12 * tau, rr = G.R + 11   // цифра такта, к которому идёт стрелка, — ярче
    d.glowAt(G.cx + sin(na) * rr, G.cy - cos(na) * rr, 16, 0.25)
    d.mapText(Horo.roman[bar + 1], G.cx + sin(na) * rr, G.cy - cos(na) * rr, max(9, min(12, G.R * 0.07)), 1, align: .center, italic: false, angle: na)
    if Fh > 4 {
      g.setLineWidth(1); g.setStrokeColor(d.ink(0.05)); g.beginPath()
      for j in 0..<60 { ray(g, G.cx, G.cy, CGFloat(j) / 60 * tau, R) }
      g.strokePath(); return
    }
    let a = CGFloat((P / 12 - (P / 12).rounded(.down))) * tau, sx = sin(a), sy = -cos(a), px = sy, py = -sx   // ромб-наконечник, широкая игла
    let tip = CGPoint(x: G.cx + sx * R, y: G.cy + sy * R), mid = CGPoint(x: G.cx + sx * R * 0.78, y: G.cy + sy * R * 0.78), w: CGFloat = 5
    g.setFillColor(theme.bg.cgColor); g.setStrokeColor(d.ink(0.8)); g.setLineWidth(1)
    g.beginPath()
    g.move(to: CGPoint(x: G.cx + px * 2.5, y: G.cy + py * 2.5)); g.addLine(to: CGPoint(x: mid.x + px * 1.2, y: mid.y + py * 1.2))
    g.addLine(to: CGPoint(x: mid.x + sx * 4 + px * w, y: mid.y + sy * 4 + py * w)); g.addLine(to: tip)
    g.addLine(to: CGPoint(x: mid.x + sx * 4 - px * w, y: mid.y + sy * 4 - py * w)); g.addLine(to: CGPoint(x: mid.x - px * 1.2, y: mid.y - py * 1.2))
    g.addLine(to: CGPoint(x: G.cx - px * 2.5, y: G.cy - py * 2.5)); g.closePath(); g.drawPath(using: .fillStroke)
  }

  // стрелка-солнце, луч concursus, ступица (view.js:184-208)
  private func drawHand(_ d: Draw, _ now: Double, _ P: Double) {
    let g = d.g, G = geo, tau = HorologiumView.tau
    drawHour(d, P)
    let R = G.R - 14, Fm = mirror.F
    g.setLineWidth(1)
    if Fm > 4 {                                           // быстро — стрелка слилась в диск
      let k = cl((Fm - 4) / 12)
      g.setStrokeColor(d.ink(0.05 * k + 0.02)); g.beginPath()
      for j in 0..<120 { ray(g, G.cx, G.cy, CGFloat(j) / 120 * tau, R) }
      g.strokePath()
      g.setStrokeColor(d.ink(0.5)); arc(g, G.cx, G.cy, R)
    } else {
      let a = CGFloat(P - P.rounded(.down)) * tau, hx = G.cx + sin(a) * R, hy = G.cy - cos(a) * R
      for j in 1..<10 {
        let b = a - CGFloat(j) * 0.04 * cl(Fm)
        g.setStrokeColor(d.ink(0.05 * (1 - CGFloat(j) / 10))); g.beginPath(); ray(g, G.cx, G.cy, b, R); g.strokePath()
      }
      g.setStrokeColor(d.ink(0.85)); g.setLineWidth(1.2); g.beginPath(); g.move(to: CGPoint(x: G.cx, y: G.cy)); g.addLine(to: CGPoint(x: hx, y: hy)); g.strokePath(); g.setLineWidth(1)
      g.setFillColor(theme.bg.cgColor); disc(g, hx, hy, 7); g.setStrokeColor(d.ink(0.95)); arc(g, hx, hy, 7)
      g.beginPath()
      for k in 0..<12 {
        let b = CGFloat(k) / 12 * tau + CGFloat(now) * 0.4
        g.move(to: CGPoint(x: hx + cos(b) * 9, y: hy + sin(b) * 9)); g.addLine(to: CGPoint(x: hx + cos(b) * 13, y: hy + sin(b) * 13))
      }
      g.strokePath()
    }
    let ck = cl(1 - (now - concAt) / 0.35)                // concursus: кольца совпали — луч
    if ck > 0 && Fm <= 4 { g.setStrokeColor(d.ink(0.5 * ck)); g.beginPath(); ray(g, G.cx, G.cy, CGFloat(concA), G.R - 4); g.strokePath() }
    g.setFillColor(theme.bg.cgColor); disc(g, G.cx, G.cy, G.r0 - 8)   // ступица: тап — пуск, держишь — темп
    g.setStrokeColor(d.ink(mirror.run ? 0.8 : 0.5)); arc(g, G.cx, G.cy, G.r0 - 8)
    if !mirror.run && !pend.held {
      g.setFillColor(d.ink(0.8)); let s: CGFloat = 5
      g.beginPath(); g.move(to: CGPoint(x: G.cx - s * 0.6, y: G.cy - s)); g.addLine(to: CGPoint(x: G.cx + s, y: G.cy)); g.addLine(to: CGPoint(x: G.cx - s * 0.6, y: G.cy + s)); g.closePath(); g.fillPath()
    } else { g.setFillColor(d.ink(0.9)); disc(g, G.cx, G.cy, 3.2) }
  }

  // маятник: веер при быстром качании, расплыв при броске через верх (view.js:209-225)
  private func drawPendulum(_ d: Draw) {
    let g = d.g, G = geo, tau = HorologiumView.tau, px = G.piv.x, py = G.piv.y, L = G.L
    let rate = mirror.run && !pend.held ? Horo.z * mirror.F / 2 : 0
    g.setLineWidth(1)
    if pend.spin && rate > 3 {                            // крутится — расплылся
      g.setStrokeColor(d.ink(0.1)); arc(g, px, py, L)
      for j in 0..<7 {
        let a = CGFloat(pend.th) + CGFloat(j) / 7 * tau, ex = px + sin(a) * L, ey = py + cos(a) * L
        g.setStrokeColor(d.ink(0.12)); g.beginPath(); g.move(to: CGPoint(x: px, y: py)); g.addLine(to: CGPoint(x: ex, y: ey)); g.strokePath()
        arc(g, ex, ey, G.bob)
      }
      return
    }
    if rate > 2.5 && !pend.spin {                         // качается быстро — веером
      let A = CGFloat(acos(1 - min(1.9, Horo.eOfU(mirror.u))))
      g.setStrokeColor(d.ink(0.1))
      for s in [-1, -0.5, 0, 0.5, 1] as [CGFloat] {
        let a = s * A; g.beginPath(); g.move(to: CGPoint(x: px, y: py)); g.addLine(to: CGPoint(x: px + sin(a) * L, y: py + cos(a) * L)); g.strokePath()
      }
    }
    let b = G.bobXY(pend.th)
    g.setStrokeColor(d.ink(0.65)); g.beginPath(); g.move(to: CGPoint(x: px, y: py)); g.addLine(to: b); g.strokePath()
    g.setFillColor(theme.bg.cgColor); disc(g, b.x, b.y, G.bob)
    g.setStrokeColor(d.ink(pend.held ? 1 : 0.9)); arc(g, b.x, b.y, G.bob)
    g.setStrokeColor(d.ink(0.35)); arc(g, b.x, b.y, G.bob - 4)
  }

  // порядок кадра — view.js:232-248: стена → кольца → стрелки → отношение → шкала → маятник → подпись фазы → солнце
  func frame(_ d: Draw, _ now: Double, sun: Bool) {
    let g = d.g, G = geo, P = pVis(now: now), Fm = mirror.F
    if let w = wallImage() {
      g.saveGState(); g.translateBy(x: 0, y: G.H); g.scaleBy(x: 1, y: -1)               // контекст — началом сверху, картинка — снизу
      g.draw(w, in: CGRect(x: 0, y: 0, width: G.W, height: G.H)); g.restoreGState()
    }
    drawRings(d, now, P)
    drawHand(d, now, P)
    let rt = Horo.ratio(mirror.rings, F: Fm)
    d.mapText(rt.a, G.cx, G.ty, 19, 0.95, align: .center)
    d.mapText(rt.b, G.cx, G.ty + 21, 12, 0.6, align: .center)
    let S = G.strip, act = mirror.rings.filter { $0.on }
    let mAvg = act.isEmpty ? 4 : act.reduce(0.0) { $0 + Horo.mOf($1, aequalis: mirror.fx[0]) } / Double(act.count)
    let lim = G.stripX(20 / mAvg)                         // limen: где удары сливаются в тон
    g.setLineWidth(1); g.setStrokeColor(d.ink(0.35)); g.setLineDash(phase: 0, lengths: [2, 3]); g.beginPath()
    g.move(to: CGPoint(x: lim, y: S.y - 14)); g.addLine(to: CGPoint(x: lim, y: S.y + 14)); g.strokePath(); g.setLineDash(phase: 0, lengths: [])
    d.mapText("limen", lim, S.y + 22, 10.5, 0.45, align: .center)
    if Fm > 0.01 {
      let mx = G.stripX(Fm)
      g.setFillColor(d.ink(0.95)); g.beginPath(); g.move(to: CGPoint(x: mx, y: S.y - 3)); g.addLine(to: CGPoint(x: mx - 5, y: S.y - 11)); g.addLine(to: CGPoint(x: mx + 5, y: S.y - 11)); g.closePath(); g.fillPath()
      d.mapText("\(Fm < 10 ? String(format: "%.2f", Fm) : String(Int(Horo.jsRound(Fm)))) / s", mx, S.y - 20, 11, 0.75, align: .center)
    }
    drawPendulum(d)
    if let i = phaseHeld() {
      let r = mirror.rings[i]
      d.mapText("\(Horo.roman[r.n]) · \(Int(Horo.jsRound(r.phi * 360)))°", G.cx, G.cy + G.R + 14, 12, 0.85, align: .center)
    }
    guard sun else { return }
    d.quarterSun(G.sun.x, G.sun.y, G.sun.r, side: -1, now: now * 1000, col: theme.ink, disc: theme.bg)
  }
}
