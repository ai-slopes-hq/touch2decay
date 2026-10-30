import UIKit

// рисование Oceanus (view.js:111-257): стена в кеше, вода, течения, голоса. Состояние кадра — в OceanDrawState (расширения не хранят поля)

// сидированный генератор для пены (вместо Math.random): один сид — один кадр
struct OceanRng {
  var s: UInt64
  mutating func next() -> Double {                          // SplitMix64 → [0, 1)
    s &+= 0x9E3779B97F4A7C15
    var z = s
    z = (z ^ (z >> 30)) &* 0xBF58476D1CE4E5B9
    z = (z ^ (z >> 27)) &* 0x94D049BB133111EB
    return Double((z ^ (z >> 31)) >> 11) / Double(1 << 53)
  }
}

final class OceanDrawState {
  struct Foam { var a, lane, len: Double; var dir: Double }
  struct WallKey: Equatable { var W, H, sc, cy: CGFloat; var pcs: [Int]?; var root: Int }
  static let tau = Double.pi * 2
  var pcs: [Int]?, root = 0                                  // лад мира (World.scale)
  var wall: CGImage?, wallKey: WallKey?, wallBuilds = 0
  var foam: [Foam], foamT = 0.0
  var ring = [CGPoint](repeating: .zero, count: 3 * 97)      // три кольца по 97 точек — выделено раз
  init(seed: UInt64) {
    var r = OceanRng(s: seed)
    foam = (0..<44).map { i in
      let a = r.next() * OceanDrawState.tau, lane = 0.2 + 0.7 * r.next(), len = 0.03 + r.next() * 0.05
      return Foam(a: a, lane: lane, len: len, dir: i % 2 == 1 ? 1 : -1)
    }
  }
}

extension OceanusView {
  private static let winds = ["Septentrio", "Aquilo", "Subsolanus", "Eurus", "Auster", "Africus", "Favonius", "Corus"]
  private static let clima = ["litus", "medium", "Hierusalem"]
  private static let notes = ["A", "A#", "B", "C", "C#", "D", "D#", "E", "F", "F#", "G", "G#"]
  private static let tau = CGFloat.pi * 2
  private static let ringK: [CGFloat] = [1, 0.66, 0.33]
  private static let ringStyle: [(a: CGFloat, w: CGFloat)] = [(0.85, 1.2), (0.3, 0.8), (0.18, 0.8)]

  // view.js:13; hz ≤ 0 (город ещё без звука) — прочерк
  static func noteName(_ f: Double) -> String {
    guard f > 0 else { return "–" }
    let m = Int((12 * log2(f / 55)).rounded(.toNearestOrAwayFromZero))
    return "\(notes[((m % 12) + 12) % 12])\(Int((Double(m + 9) / 12).rounded(.down)) + 1)"
  }

  var wallBuilds: Int { dr.wallBuilds }

  // стена: рамка ветров с румбами, земля T-O с климатами, деления нот по краю земли; ключ — W×H×масштаб|cy|лад|тоника (view.js:114-158)
  func wallImage() -> CGImage? {
    let sc = Draw.scale, G = geo
    let key = OceanDrawState.WallKey(W: G.W, H: G.H, sc: sc, cy: G.cy, pcs: dr.pcs, root: dr.root)
    if let w = dr.wall, key == dr.wallKey { return w }
    dr.wallKey = key; dr.wallBuilds += 1
    guard let g = CGContext(data: nil, width: Int((G.W * sc).rounded()), height: Int((G.H * sc).rounded()), bitsPerComponent: 8, bytesPerRow: 0,
                            space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedFirst.rawValue) else { dr.wall = nil; return nil }
    g.translateBy(x: 0, y: CGFloat(g.height)); g.scaleBy(x: sc, y: -sc)   // начало слева сверху
    let d = Draw(g: g, W: G.W, H: G.H); d.setTheme(theme)
    let tau = OceanusView.tau, cx = G.cx, cy = G.cy, Rd = G.Rd, Rf = G.Rf
    func at(_ a: CGFloat, _ r: CGFloat) -> CGPoint { G.at(Double(a), r) }
    func arc(_ x: CGFloat, _ y: CGFloat, _ r: CGFloat) { g.strokeEllipse(in: CGRect(x: x - r, y: y - r, width: 2 * r, height: 2 * r)) }
    g.setFillColor(theme.bg.cgColor); g.fill(CGRect(x: 0, y: 0, width: G.W, height: G.H))
    g.setLineWidth(1)
    g.setStrokeColor(d.ink(0.07)); g.beginPath()              // румбы портолана — из центра и с 16 точек рамки
    for k in 0..<16 {
      let p = at(CGFloat(k) / 16 * tau, Rf)
      g.move(to: CGPoint(x: cx, y: cy)); g.addLine(to: p)
      var j = k + 3
      while j < k + 14 { g.move(to: p); g.addLine(to: at(CGFloat(j) / 16 * tau, Rf)); j += 5 }
    }
    g.strokePath()
    g.setStrokeColor(d.ink(0.6)); arc(cx, cy, Rf)
    g.setStrokeColor(d.ink(0.25)); arc(cx, cy, Rf - 4)
    g.setStrokeColor(d.ink(0.4)); g.beginPath()
    for k in 0..<32 {
      let a = CGFloat(k) / 32 * tau, l: CGFloat = k % 4 != 0 ? 2.5 : 5
      g.move(to: at(a, Rf)); g.addLine(to: at(a, Rf + l))
    }
    g.strokePath()
    g.setFillColor(theme.bg.cgColor); g.fillEllipse(in: CGRect(x: cx - Rd, y: cy - Rd, width: 2 * Rd, height: 2 * Rd))   // земля
    g.setStrokeColor(d.ink(0.75)); arc(cx, cy, Rd)
    g.setStrokeColor(d.ink(0.16)); g.setLineDash(phase: 0, lengths: [2, 4])               // климаты — октавы
    arc(cx, cy, Rd / 3); arc(cx, cy, Rd * 2 / 3)
    g.setLineDash(phase: 0, lengths: [])
    g.setStrokeColor(d.ink(0.5)); g.beginPath()                                           // T: Танаис — Нил поперёк, Средиземное море вниз
    g.move(to: CGPoint(x: cx - Rd, y: cy)); g.addLine(to: CGPoint(x: cx + Rd, y: cy))
    g.move(to: CGPoint(x: cx, y: cy)); g.addLine(to: CGPoint(x: cx, y: cy + Rd)); g.strokePath()
    g.setStrokeColor(d.ink(0.6)); arc(cx, cy, 3)                                          // Иерусалим — пуп земли
    d.mapText("Tanais", cx - Rd * 0.5, cy - 8, 11, 0.42, align: .center); d.mapText("Nilus", cx + Rd * 0.5, cy - 8, 11, 0.42, align: .center)
    d.mapText("Mare Magnum", cx + 8, cy + Rd * 0.55, 11, 0.42, align: .center, angle: .pi / 2)
    d.mapText("Sem", cx - Rd * 0.42, cy - Rd * 0.3, 10, 0.26, align: .center)             // части света — по сыновьям Ноя
    d.mapText("Iafeth", cx - Rd * 0.42, cy + Rd * 0.62, 10, 0.26, align: .center)
    d.mapText("Cham", cx + Rd * 0.42, cy + Rd * 0.62, 10, 0.26, align: .center)
    d.mapText("Hierusalem", cx, cy + 11, 10, 0.26, align: .center)
    let py = cy - Rd * 0.68, pr = max(7, Rd * 0.07)                                       // земной рай на востоке (наверху): ограда и четыре реки
    g.setStrokeColor(d.ink(0.55)); arc(cx, py, pr)
    g.setStrokeColor(d.ink(0.25)); arc(cx, py, pr - 2.5)
    g.setStrokeColor(d.ink(0.35)); g.beginPath()
    for a in [-0.9, -0.3, 0.3, 0.9] as [CGFloat] {
      let sx = cx + sin(a) * pr, sy = py + cos(a) * pr
      g.move(to: CGPoint(x: sx, y: sy))
      g.addQuadCurve(to: CGPoint(x: sx + sin(a) * 16, y: sy + 16 + abs(a) * 4), control: CGPoint(x: sx + sin(a) * 10, y: sy + 8))
    }
    g.strokePath()
    d.mapText("Paradisus", cx, py + pr + 27, 10, 0.4, align: .center)
    for k in 0..<12 {                                                                     // полутоны по краю земли; ступени лада — длиннее
      let pc = (k + dr.root) % 12, inScale = dr.pcs?.contains(pc) ?? true, a = CGFloat(k) / 12 * tau
      g.setStrokeColor(d.ink(inScale ? 0.55 : 0.22)); g.beginPath()
      g.move(to: at(a, Rd)); g.addLine(to: at(a, Rd - (inScale ? 7 : 3))); g.strokePath()
    }
    dr.wall = g.makeImage()
    return dr.wall
  }

  // порядок кадра — view.js:244-249: стена → вода → голоса → солнце
  func frame(_ d: Draw, _ now: Double, sun: Bool) {
    let g = d.g, G = geo, u = ui, m = mirror
    if let w = wallImage() {
      g.saveGState(); g.translateBy(x: 0, y: G.H); g.scaleBy(x: 1, y: -1)               // контекст — началом сверху, картинка — снизу
      g.draw(w, in: CGRect(x: 0, y: 0, width: G.W, height: G.H)); g.restoreGState()
    }
    drawOcean(d, m, u, now)
    drawVoices(d, m, u, now)
    guard sun else { return }
    quarterSun(d, G.sun.x, G.sun.y, G.sun.r, now * 1000)
  }

  // угловое солнце веба (host/draw.js:121-160, side = 1, top = oy): четверть вниз и вправо с лицом и кромкой; now — мс
  private func quarterSun(_ d: Draw, _ ox: CGFloat, _ oy: CGFloat, _ r: CGFloat, _ now: Double) {
    let g = d.g, N = 28, tau = Double.pi * 2, rot = now * 0.00003, col = theme.ink
    g.saveGState(); g.clip(to: CGRect(x: ox, y: oy, width: geo.W, height: geo.H))
    g.translateBy(x: ox, y: oy)
    func ink(_ a: CGFloat) -> CGColor { Draw.color(col, a) }
    for k in 0..<N {
      let a = Double(k) / Double(N) * tau + rot, aa = (fmod(a, tau) + tau).truncatingRemainder(dividingBy: tau)
      if aa > Double.pi / 2 + 0.1 { continue }
      let cs = CGFloat(cos(a)), sn = CGFloat(sin(a)), px = -sn, py = cs
      g.beginPath()
      if k % 2 == 1 {
        let l = r * 2.05, w: CGFloat = 5
        g.move(to: CGPoint(x: cs * r + px * w, y: sn * r + py * w)); g.addLine(to: CGPoint(x: cs * l, y: sn * l))
        g.addLine(to: CGPoint(x: cs * r - px * w, y: sn * r - py * w)); g.closePath()
        g.setFillColor(theme.bg.cgColor); g.setStrokeColor(ink(0.75)); g.setLineWidth(1.1); g.drawPath(using: .fillStroke)
      } else {
        let l = r * 1.65
        for i in 0...18 {
          let t = CGFloat(i) / 18, rr = r + t * (l - r), wv = sin(t * .pi * 3) * 3.5 * (1 - t * 0.5)
          let p = CGPoint(x: cs * rr + px * wv, y: sn * rr + py * wv)
          i > 0 ? g.addLine(to: p) : g.move(to: p)
        }
        g.setStrokeColor(ink(0.55)); g.setLineWidth(1); g.strokePath()
      }
    }
    g.setFillColor(theme.bg.cgColor); g.fillEllipse(in: CGRect(x: -r, y: -r, width: 2 * r, height: 2 * r))
    g.setStrokeColor(ink(0.9)); g.setLineWidth(1.6); g.strokeEllipse(in: CGRect(x: -r, y: -r, width: 2 * r, height: 2 * r))
    g.setStrokeColor(ink(0.45)); g.setLineWidth(0.9); g.strokeEllipse(in: CGRect(x: -r + 5, y: -r + 5, width: 2 * r - 10, height: 2 * r - 10))
    let f0 = r * 0.46, k = r / 46                                                          // лицо — в видимой четверти
    func P(_ x: CGFloat, _ y: CGFloat) -> CGPoint { CGPoint(x: x, y: y) }
    g.setLineWidth(1.1); g.setStrokeColor(ink(0.85)); g.beginPath()
    g.move(to: P(f0 - 11 * k, f0 - 2 * k)); g.addQuadCurve(to: P(f0 - 5 * k, f0 - 2 * k), control: P(f0 - 8 * k, f0 + 1 * k))
    g.move(to: P(f0 + 5 * k, f0 - 2 * k)); g.addQuadCurve(to: P(f0 + 11 * k, f0 - 2 * k), control: P(f0 + 8 * k, f0 + 1 * k))
    g.move(to: P(f0 - 12 * k, f0 - 7 * k)); g.addQuadCurve(to: P(f0 - 4 * k, f0 - 7 * k), control: P(f0 - 8 * k, f0 - 10 * k))
    g.move(to: P(f0 + 4 * k, f0 - 7 * k)); g.addQuadCurve(to: P(f0 + 12 * k, f0 - 7 * k), control: P(f0 + 8 * k, f0 - 10 * k))
    g.move(to: P(f0, f0 - 4 * k)); g.addLine(to: P(f0 - 2 * k, f0 + 5 * k)); g.addLine(to: P(f0 + 1.5 * k, f0 + 5.5 * k))
    g.move(to: P(f0 - 7 * k, f0 + 11 * k)); g.addQuadCurve(to: P(f0 + 7 * k, f0 + 11 * k), control: P(f0, f0 + 15 * k))
    g.strokePath()
    g.setStrokeColor(ink(0.8)); g.setLineWidth(1.2); g.beginPath(); g.move(to: P(0, 0.5)); g.addLine(to: P(r * 2.1, 0.5)); g.strokePath()   // кромка
    g.restoreGState()
  }

  private func arcPath(_ g: CGContext, _ x: CGFloat, _ y: CGFloat, _ r: CGFloat, _ a0: CGFloat, _ a1: CGFloat) {
    g.addArc(center: CGPoint(x: x, y: y), radius: r, startAngle: a0, endAngle: a1, clockwise: false)   // a0 < a1: по возрастанию угла
  }

  // течения: пена бежит по кругу двумя потоками — быстрее с натяжением; круги от всплесков (view.js:160-172)
  private func drawCurrents(_ d: Draw, _ m: OceanMirror, _ u: OceanUI, _ now: Double) {
    let g = d.g, G = geo, tau = OceanDrawState.tau
    let dt = dr.foamT > 0 ? min(0.1, now - dr.foamT) : 0, w = 0.05 + 0.35 * m.fx[0]
    dr.foamT = now
    g.setLineWidth(0.8)
    for i in 0..<dr.foam.count {
      var f = dr.foam[i]
      f.a = (f.a + f.dir * w * dt * (0.6 + f.lane) + tau).truncatingRemainder(dividingBy: tau)
      dr.foam[i] = f
      let r = G.Rd + (G.surf(m.shape, f.a) - G.Rd) * CGFloat(f.lane), al = 0.1 + 0.25 * f.lane + 0.25 * m.fx[2]
      let s = CGFloat(f.a) - .pi / 2, e = s + CGFloat(f.len * f.dir)
      g.setStrokeColor(d.ink(CGFloat(al))); g.beginPath()
      arcPath(g, G.cx, G.cy, r, min(s, e), max(s, e)); g.strokePath()
    }
    g.setLineWidth(1)
    for q in u.ripples {
      let k = CGFloat((now - q.t0) / 1.3)
      if k >= 1 { continue }
      g.setStrokeColor(d.ink(0.5 * (1 - k) * CGFloat(q.k)))
      for mm in [1, 0.6] as [CGFloat] { let r = 4 + 30 * k * mm; g.strokeEllipse(in: CGRect(x: q.x - r, y: q.y - r, width: 2 * r, height: 2 * r)) }
    }
  }

  // луна отражается в воде: дрожащие штрихи под поверхностью, по форме кольца (view.js:173-182)
  private func drawReflection(_ d: Draw, _ m: OceanMirror, _ now: Double) {
    let tide = m.fx[3]
    if tide < 0.03 { return }
    let g = d.g, G = geo, ma = m.moon * OceanDrawState.tau, r0 = G.surf(m.shape, ma), n = OceanGeo.n
    g.setLineWidth(1)
    for j in 0..<5 {
      let r = r0 - 6 - CGFloat(j) * 5
      let idx = ((Int((ma / OceanDrawState.tau * Double(n) + Double(j)).rounded(.down)) % n) + n) % n
      let wob = sin(now * 4 + Double(j) * 1.7) * 0.02 + m.shape[idx] * 0.03, half = (0.07 - Double(j) * 0.011) * (0.6 + 0.4 * tide)
      if r < G.Rd + 3 { break }
      g.setStrokeColor(d.ink(CGFloat((0.4 - Double(j) * 0.06) * min(1, tide * 1.5))))
      g.beginPath(); arcPath(g, G.cx, G.cy, r, CGFloat(ma + wob - half) - .pi / 2, CGFloat(ma + wob + half) - .pi / 2); g.strokePath()
    }
  }

  // вода: поверхность — форма кольца, две линии штриховки следуют за ней; луна; ветры по кругу (view.js:183-216)
  private func drawOcean(_ d: Draw, _ m: OceanMirror, _ u: OceanUI, _ now: Double) {
    let g = d.g, G = geo, tau = OceanusView.tau, n = OceanGeo.n
    drawCurrents(d, m, u, now); drawReflection(d, m, now)
    let M = 96
    for i in 0...M {                                                                      // sin/cos и радиус — раз на точку для всех трёх колец
      let a = Double(i) / Double(M) * Double(tau), s = G.surf(m.shape, a), sn = CGFloat(sin(a)), cs = CGFloat(cos(a))
      for j in 0..<3 {
        let r = G.Rd + (s - G.Rd) * OceanusView.ringK[j]
        dr.ring[j * 97 + i] = CGPoint(x: G.cx + sn * r, y: G.cy - cs * r)
      }
    }
    for j in 0..<3 {
      g.setStrokeColor(d.ink(OceanusView.ringStyle[j].a)); g.setLineWidth(OceanusView.ringStyle[j].w); g.beginPath()
      let o = j * 97
      g.move(to: dr.ring[o])
      for i in 1...M { g.addLine(to: dr.ring[o + i]) }
      g.closePath(); g.strokePath()
    }
    g.setStrokeColor(d.ink(0.22)); g.setLineWidth(0.8); g.beginPath()                     // гребешки волн: короткие штрихи там, где вода круче
    for i in 0..<n {
      let dd = m.shape[(i + 1) % n] - m.shape[i], a = (Double(i) + 0.5) / Double(n) * Double(tau)
      if abs(dd) < 0.06 { continue }
      let r = G.surf(m.shape, a) + 3
      g.move(to: G.at(a, r)); g.addLine(to: G.at(a + (dd > 0 ? 0.05 : -0.05), r + min(6, CGFloat(abs(dd) * 30))))
    }
    g.strokePath()
    let ma = m.moon * Double(tau), mp = G.moonPos(m.moon), tide = m.fx[3], mr = 5 + 4 * CGFloat(tide), sway = m.luna[2]   // луна тянет воду на себя
    if sway > 0.01 {                                                                      // качание: ореол дышит с луной
      g.setStrokeColor(d.ink(CGFloat(0.15 + 0.35 * sway))); g.setLineWidth(1)
      if m.luna[1] > 0.5 { g.setLineDash(phase: 0, lengths: [2, 3]) }
      let r = mr + 4 + 6 * CGFloat(sway * (0.5 + 0.5 * sin(ma)))
      g.strokeEllipse(in: CGRect(x: mp.x - r, y: mp.y - r, width: 2 * r, height: 2 * r)); g.setLineDash(phase: 0, lengths: [])
    }
    g.setFillColor(d.ink(0.85)); g.fillEllipse(in: CGRect(x: mp.x - mr, y: mp.y - mr, width: 2 * mr, height: 2 * mr))
    let br = mr * 0.88, bx = mp.x + mr * 0.45, by = mp.y - mr * 0.2
    g.setFillColor(theme.bg.cgColor); g.fillEllipse(in: CGRect(x: bx - br, y: by - br, width: 2 * br, height: 2 * br))
    if tide > 0.05 {
      g.setStrokeColor(d.ink(CGFloat(0.12 + 0.2 * tide))); g.setLineDash(phase: 0, lengths: [2, 5]); g.beginPath()
      g.move(to: mp); g.addLine(to: G.at(ma, G.surf(m.shape, ma) + 4)); g.strokePath(); g.setLineDash(phase: 0, lengths: [])
    }
    for (k, nm) in OceanusView.winds.enumerated() {                                       // ветры по кругу: ярче с ветром
      let a = Double(k) / 8 * Double(tau), p = G.at(a, G.Rf + 10)
      let flip = a > Double.pi / 2 && a < Double.pi * 1.5
      d.mapText(nm, p.x, p.y, 10.5, CGFloat(0.28 + 0.6 * m.fx[2] * (0.6 + 0.4 * sin(now * 2 + Double(k)))), align: .center, angle: CGFloat(flip ? a + Double.pi : a))
    }
  }

  // голоса: луч скана, свечение, город — крест в круге; подписи — только пока трогаешь (view.js:217-241)
  private func drawVoices(_ d: Draw, _ m: OceanMirror, _ u: OceanUI, _ now: Double) {
    let g = d.g, G = geo, tau = Double.pi * 2
    for c in m.cities {
      let ph = fmod(now * 0.25 * (c.hz / 55).squareRoot(), 1)
      let qq = c.path == 1 ? 1 - ph : c.path == 2 ? (ph < 0.5 ? 2 * ph : 2 - 2 * ph) : ph   // луч скана идёт по своему пути
      let p = G.at(c.ang, CGFloat(c.rn) * G.Rd), sa = qq * tau, q = G.at(sa, G.surf(m.shape, sa))
      g.setStrokeColor(d.ink(CGFloat(0.12 + 0.35 * c.gain))); g.setLineWidth(0.8)
      g.beginPath(); g.move(to: p); g.addLine(to: q); g.strokePath()                      // луч скана: голос читает кольцо по кругу
      if c.gain > 0.05 { d.glowAt(p.x, p.y, 18, CGFloat(c.gain * 0.35)) }
      g.setFillColor(theme.bg.cgColor); g.setStrokeColor(d.ink(0.9)); g.setLineWidth(1)
      g.fillEllipse(in: CGRect(x: p.x - 6, y: p.y - 6, width: 12, height: 12)); g.strokeEllipse(in: CGRect(x: p.x - 6, y: p.y - 6, width: 12, height: 12))
      if c.pinned { g.strokeEllipse(in: CGRect(x: p.x - 9, y: p.y - 9, width: 18, height: 18)) }
      g.beginPath(); g.move(to: CGPoint(x: p.x, y: p.y - 4)); g.addLine(to: CGPoint(x: p.x, y: p.y + 4))
      g.move(to: CGPoint(x: p.x - 4, y: p.y)); g.addLine(to: CGPoint(x: p.x + 4, y: p.y)); g.strokePath()
    }
    for id in u.heldCities {
      guard let c = m.cities.first(where: { $0.id == id }) else { continue }
      let p = G.at(c.ang, CGFloat(c.rn) * G.Rd), zone = c.rn > 2.0 / 3 ? 0 : c.rn > 1.0 / 3 ? 1 : 2
      d.mapText("\(OceanusView.noteName(c.hz)) · \(Int(c.hz.rounded())) Hz", p.x, p.y - 26, 14, 0.95, align: .center)
      d.mapText("clima \(OceanusView.clima[zone])", p.x, p.y - 12, 11, 0.55, align: .center)
    }
  }
}
