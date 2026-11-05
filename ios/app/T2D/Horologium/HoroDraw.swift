import UIKit

// рисование Horologium (view.js:120-250): стена в кеше, кольца, часовая стрелка и стрелка-солнце.
// Состояние кадра — в HoroDrawState (расширения не хранят поля)
final class HoroDrawState {
  struct WallKey: Equatable { var W, H, sc, cy, R: CGFloat }
  var wall: CGImage?, wallKey: WallKey?, wallBuilds = 0
  var slots: [(j: Int, a: Double, hit: Bool)] = []           // гнёзда кольца — буфер кадра, выделен раз
  var gaps: [Double] = []                                    // углы гнёзд с ударом по возрастанию — для числа кольца
  init() { slots.reserveCapacity(16); gaps.reserveCapacity(16) }
}

extension HorologiumView {
  private static let tau = CGFloat.pi * 2
  var wallBuilds: Int { dr.wallBuilds }

  private func arc(_ g: CGContext, _ x: CGFloat, _ y: CGFloat, _ r: CGFloat) { g.strokeEllipse(in: CGRect(x: x - r, y: y - r, width: 2 * r, height: 2 * r)) }
  private func disc(_ g: CGContext, _ x: CGFloat, _ y: CGFloat, _ r: CGFloat) { g.fillEllipse(in: CGRect(x: x - r, y: y - r, width: 2 * r, height: 2 * r)) }
  private func cl(_ x: Double) -> CGFloat { CGFloat(Horo.clamp(x)) }

  // стена: обод, деления, цифры часов; ключ — W×H×масштаб|cy|R (view.js:123-146)
  func wallImage() -> CGImage? {
    let sc = Draw.scale, G = geo
    let key = HoroDrawState.WallKey(W: G.W, H: G.H, sc: sc, cy: G.cy, R: G.R)
    if let w = dr.wall, key == dr.wallKey { return w }
    dr.wallKey = key; dr.wallBuilds += 1
    guard let g = CGContext(data: nil, width: Int((G.W * sc).rounded()), height: Int((G.H * sc).rounded()), bitsPerComponent: 8, bytesPerRow: 0,
                            space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedFirst.rawValue) else { dr.wall = nil; return nil }
    g.translateBy(x: 0, y: CGFloat(g.height)); g.scaleBy(x: sc, y: -sc)   // начало слева сверху
    let d = Draw(g: g, W: G.W, H: G.H); d.setTheme(theme)
    let tau = HorologiumView.tau, cx = G.cx, cy = G.cy, R = G.R
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
    dr.wall = g.makeImage()
    return dr.wall
  }

  // гнёзда кольца: L штук по часовой от верха; бьёт ли — по Эвклиду (view.js drawRings)
  private func fillSlots(_ r: HoroRing) {
    dr.slots.removeAll(keepingCapacity: true)
    let L = min(16, max(1, r.len)), k = min(r.n, L)
    for j in 0..<L { dr.slots.append((j, Double(j) / Double(L) * 2 * .pi, Horo.euclid(j, k, L))) }
  }

  private func drawRings(_ d: Draw, _ now: Double, _ P: Double) {
    let g = d.g, G = geo, fast = mirror.F > 4, held = ringHeld()
    for i in 0..<Horo.nr {
      let r = mirror.rings[i], rr = G.ringR(i), on = r.on
      let hit = cl(1 - (now - ringHit[i]) / 0.26), cur = Horo.slot(r, P: P)
      g.setLineWidth(1); g.setStrokeColor(d.ink(on ? 0.5 + 0.2 * CGFloat(r.lvl) : 0.13))
      if !on { g.setLineDash(phase: 0, lengths: [2, 4]) }
      arc(g, G.cx, G.cy, rr); g.setLineDash(phase: 0, lengths: [])
      if on && r.under { g.setStrokeColor(d.ink(0.3)); arc(g, G.cx, G.cy, rr - 3) }   // унтертон — двойной обвод
      fillSlots(r)
      dr.gaps.removeAll(keepingCapacity: true)
      for q in dr.slots {
        let sn = CGFloat(sin(q.a)), cs = CGFloat(cos(q.a)), x = G.cx + sn * rr, y = G.cy - cs * rr
        if !q.hit {                                       // пустое гнездо — короткая засечка; бегунок на нём ярче
          g.setStrokeColor(d.ink(q.j == cur ? 0.45 : on ? 0.12 : 0.06)); g.beginPath()
          g.move(to: CGPoint(x: x - sn * 1.5, y: y + cs * 1.5)); g.addLine(to: CGPoint(x: x + sn * 1.5, y: y - cs * 1.5)); g.strokePath(); continue
        }
        dr.gaps.append(q.a)
        if !on { g.setStrokeColor(d.ink(0.22)); arc(g, x, y, 1.8); continue }
        let gl: CGFloat = fast ? 0.35 + 0.4 * CGFloat(r.lvl) : q.j == cur ? hit : 0
        if gl > 0.05 { d.glowAt(x, y, 10 + 8 * gl, 0.35 * gl) }
        g.setFillColor(d.ink(min(1, 0.55 + 0.45 * gl)))
        if r.under {
          g.beginPath(); g.move(to: CGPoint(x: x, y: y - 3.6)); g.addLine(to: CGPoint(x: x + 3, y: y)); g.addLine(to: CGPoint(x: x, y: y + 3.6)); g.addLine(to: CGPoint(x: x - 3, y: y)); g.closePath(); g.fillPath()
        } else { disc(g, x, y, 3.1) }
      }
      var la = Double.pi + 0.35                           // число кольца — внизу слева, в просвете между метками
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
      if i == held {                                      // название инструмента — только пока кольцо в руке
        let nm = Horo.instNames[r.inst], nw = d.mapTextWidth(nm, 10.5)
        g.setFillColor(theme.bg.cgColor); g.fill(CGRect(x: lx - nw / 2 - 2, y: ly + 7, width: nw + 4, height: 12))
        d.mapText(nm, lx, ly + 13, 10.5, 0.85, align: .center)
      }
    }
  }

  private func ray(_ g: CGContext, _ cx: CGFloat, _ cy: CGFloat, _ a: CGFloat, _ R: CGFloat) {
    g.move(to: CGPoint(x: cx, y: cy)); g.addLine(to: CGPoint(x: cx + sin(a) * R, y: cy - cos(a) * R))
  }

  // часовая стрелка — считает такты: деление за такт, круг — 12 тактов (view.js:171-183)
  private func drawHour(_ d: Draw, _ P: Double) {
    let g = d.g, G = geo, tau = HorologiumView.tau, Fh = mirror.F / 12, R = G.R * 0.58
    let bar = P.isFinite ? Int(fmod(fmod(P.rounded(.down), 12) + 12, 12)) : 0, na = CGFloat(bar + 1) / 12 * tau, rr = G.R + 11   // цифра такта, к которому идёт стрелка, — ярче
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
    if !mirror.run {
      g.setFillColor(d.ink(0.8)); let s: CGFloat = 5
      g.beginPath(); g.move(to: CGPoint(x: G.cx - s * 0.6, y: G.cy - s)); g.addLine(to: CGPoint(x: G.cx + s, y: G.cy)); g.addLine(to: CGPoint(x: G.cx - s * 0.6, y: G.cy + s)); g.closePath(); g.fillPath()
    } else { g.setFillColor(d.ink(0.9)); disc(g, G.cx, G.cy, 3.2) }
  }

  // порядок кадра — view.js:232-248: стена → кольца → стрелки → отношение → подпись длины → солнце
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
    if let i = lenHeld(), let t = holds.values.first(where: { $0.kind == .ring && $0.ph }) {
      let r = mirror.rings[i]
      d.reading { d.mapText("\(Horo.roman[r.n]) · \(t.sent) / 16", G.cx, G.cy + G.R + 14, 12, 0.85, align: .center, italic: true) }
    }
    guard sun else { return }
    d.quarterSun(G.sun.x, G.sun.y, G.sun.r, side: -1, now: now * 1000, col: theme.ink, disc: theme.bg)
  }
}
