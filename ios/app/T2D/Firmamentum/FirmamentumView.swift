import UIKit
import T2DCore

// Firmamentum — касания, состояние и картинка: твердь Фламмариона (порт worlds/firmamentum/view.js)
final class FirmamentumView: World {
  static let slotN = 10, smax = 6
  let slot = FirmamentumView.slotN
  let theme = Theme(ink: (232, 224, 200), paper: (10, 9, 20), bg: UIColor(red: 10 / 255, green: 9 / 255, blue: 20 / 255, alpha: 1))
  static let gold: RGB = (236, 204, 130)
  static let ink: RGB = (232, 224, 200)

  var geo: Geo
  var mirror = FirmMirror()
  var flash: [Int: Double] = [:]                        // id звезды → когда прозвучал её последний пульсарет
  var specks: [(x: CGFloat, y: CGFloat, a: Double, t: Double)] = []   // пылинки треска, ≤ 60, 260 мс
  var bolts: [(slot: Int, t: Double)] = []              // лучи вспышек, ≤ 12, 110 мс
  private let core: Core
  // читатель снимка: заполняет буфер (ёмкость — его count), возвращает длину
  typealias Reader = (inout [Double]) -> Int
  private let readMirror: Reader
  private let readHeard: Reader
  private var mbuf = [Double](repeating: 0, count: 1024), mprev = [Double](repeating: 0, count: 1024)   // буферы кадра — выделены раз
  private var mlen = 0, mprevLen = -1                    // -1: разбирать всегда (первый кадр)
  private var hbuf = [Double](repeating: 0, count: 256)
  private(set) var mirrorParses = 0                      // сколько раз разбирали зеркало (для теста пропуска)
  private var issued = 0                                // наибольший выданный Swift id
  private var now = 0.0
  private var rng = SystemRandomNumberGenerator()

  private struct Hold { var id: Int?; var x0, y0: CGFloat; var moved = false, fresh = false, seen = false }
  private var holds: [ObjectIdentifier: Hold] = [:]

  init(core: Core, geo: Geo, readMirror: Reader? = nil, readHeard: Reader? = nil) {
    self.core = core; self.geo = geo
    self.readMirror = readMirror ?? { b in Int(t2d_app_mirror(Int32(FirmamentumView.slotN), &b, Int32(b.count))) }
    self.readHeard = readHeard ?? { b in Int(t2d_app_heard(Int32(FirmamentumView.slotN), &b, Int32(b.count))) }
  }

  func tick(now: Double, dt: Double) {
    self.now = now
    mlen = min(max(0, readMirror(&mbuf)), mbuf.count)
    if mlen != mprevLen || !mbuf[0..<mlen].elementsEqual(mprev[0..<mlen]) {   // снимок не изменился — разбор не нужен
      mirror = FirmMirror.parse(Array(mbuf[0..<mlen])); mirrorParses += 1
      swap(&mbuf, &mprev); mprevLen = mlen
    }
    let hn = min(max(0, readHeard(&hbuf)), hbuf.count)
    if hn > 0 { for h in Heard.parse(Array(hbuf[0..<hn])) { hear(h, now: now) } }
    specks.removeAll { now - $0.t > 0.26 }
    bolts.removeAll { now - $0.t > 0.11 }
  }

  // ---------- рисование (view.js:82-184) ----------
  static let limen = log(20 / 0.7) / log(520 / 0.7)       // model.js:14 — высота, где ритм становится тоном
  private static let notes = ["A", "A#", "B", "C", "C#", "D", "D#", "E", "F", "F#", "G", "G#"]
  private(set) var wallBuilds = 0                         // сколько раз строился фон (для теста кеша)
  private var wall: CGImage?
  private var wallKey = ""

  private static func noteName(_ f: Double) -> String {   // view.js:7
    let m = Int((12 * log2(f / 55)).rounded(.toNearestOrAwayFromZero))
    return "\(notes[((m % 12) + 12) % 12])\(Int((Double(m + 9) / 12).rounded(.down)) + 1)"
  }

  private static func halfEllipse(_ g: CGContext, _ cx: CGFloat, _ cy: CGFloat, _ rx: CGFloat, _ ry: CGFloat, move: Bool = true) {
    for k in 0...120 {                                    // верхняя половина: от π до 2π
      let a = CGFloat.pi + CGFloat(k) / 120 * .pi, p = CGPoint(x: cx + cos(a) * rx, y: cy + sin(a) * ry)
      if k == 0 && move { g.move(to: p) } else { g.addLine(to: p) }
    }
  }

  // view.js:82-125 — Эмпирей за куполом, колёса, свод с делениями, неподвижные звёзды, земля; строится раз на размер
  private func wall(_ d: Draw) -> CGImage? {
    let sc = Draw.scale, G = geo
    let key = "\(G.W)x\(G.H)x\(sc)|\(G.hy)|\(G.RY)"
    if let w = wall, key == wallKey { return w }
    wallKey = key; wallBuilds += 1
    guard let g = CGContext(data: nil, width: Int((G.W * sc).rounded()), height: Int((G.H * sc).rounded()), bitsPerComponent: 8, bytesPerRow: 0,
                            space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedFirst.rawValue) else { wall = nil; return nil }
    g.translateBy(x: 0, y: CGFloat(g.height)); g.scaleBy(x: sc, y: -sc)   // начало слева сверху
    let w = Draw(g: g, W: G.W, H: G.H); w.setTheme(theme)
    let gold = FirmamentumView.gold, cx = G.cx, hy = G.hy, RX = G.RX, RY = G.RY
    func E(_ a: CGFloat, _ k: CGFloat = 0) -> CGPoint { CGPoint(x: cx + cos(a) * (RX + k), y: hy + sin(a) * (RY + k)) }
    func line(_ pts: [CGPoint]) { g.beginPath(); for (i, p) in pts.enumerated() { i == 0 ? g.move(to: p) : g.addLine(to: p) }; g.strokePath() }
    g.setFillColor(theme.bg.cgColor); g.fill(CGRect(x: 0, y: 0, width: G.W, height: G.H))
    g.setLineWidth(1)
    g.saveGState()                                        // за сводом: лучи Эмпирея и колёса
    g.beginPath(); g.addRect(CGRect(x: 0, y: 0, width: G.W, height: hy)); FirmamentumView.halfEllipse(g, cx, hy, RX + 4, RY + 4); g.closePath(); g.clip(using: .evenOdd)
    g.setStrokeColor(Draw.color(gold, 0.12)); g.beginPath()
    for j in 0..<60 {
      let a = CGFloat.pi + CGFloat(j) / 59 * .pi, p = E(a, 10)
      g.move(to: p); g.addLine(to: CGPoint(x: p.x + cos(a) * 600, y: p.y + sin(a) * 600))
    }
    g.strokePath()
    let by = (G.top + 20 + hy - RY) / 2, bh = hy - RY - G.top - 20
    for (wx, wy, wr) in [(cx + RX * 0.55, by, min(bh * 0.42, RX * 0.3)), (cx + RX * 0.05, by + bh * 0.15, min(bh * 0.28, RX * 0.2))] {   // колёса в колёсах
      g.setStrokeColor(Draw.color(gold, 0.35))
      g.strokeEllipse(in: CGRect(x: wx - wr, y: wy - wr, width: 2 * wr, height: 2 * wr))
      for (rx, ry) in [(wr, wr * 0.35), (wr * 0.35, wr)] {
        g.saveGState(); g.translateBy(x: wx, y: wy); g.rotate(by: 0.6)
        g.strokeEllipse(in: CGRect(x: -rx, y: -ry, width: 2 * rx, height: 2 * ry)); g.restoreGState()
      }
      g.setFillColor(Draw.color(gold, 0.35))
      for k in 0..<10 {                                   // глаза на ободе
        let a = CGFloat(k) / 10 * 2 * .pi
        g.fillEllipse(in: CGRect(x: wx + cos(a) * wr - 1.3, y: wy + sin(a) * wr - 1.3, width: 2.6, height: 2.6))
      }
    }
    g.restoreGState()
    g.setStrokeColor(w.ink(0.8)); g.beginPath(); FirmamentumView.halfEllipse(g, cx, hy, RX, RY); g.strokePath()   // свод
    g.setStrokeColor(w.ink(0.3)); g.beginPath(); FirmamentumView.halfEllipse(g, cx, hy, RX - 5, RY - 5); g.strokePath()
    g.setStrokeColor(w.ink(0.45)); g.beginPath()
    for k in 0...48 {                                     // засечки
      let a = CGFloat.pi + CGFloat(k) / 48 * .pi, l: CGFloat = k % 4 != 0 ? 3 : 6
      g.move(to: E(a)); g.addLine(to: E(a, l))
    }
    g.strokePath()
    var seed = 7                                          // неподвижные звёзды — всегда те же (LCG)
    func rnd() -> Double { seed = (seed * 16807) % 2147483647; return Double(seed) / 2147483647 }
    for _ in 0..<180 {
      let a = CGFloat.pi + CGFloat(rnd()) * .pi, r = CGFloat(rnd().squareRoot()) * 0.95
      let px = cx + cos(a) * r * RX, py = hy + sin(a) * r * RY
      if py < hy - 4 { g.setFillColor(w.ink(0.4 * CGFloat(0.25 + 0.6 * rnd()))); g.fill(CGRect(x: px, y: py, width: 1, height: 1)) }
    }
    let L = CGFloat(FirmamentumView.limen), ly = hy - L * RY, lh = RX * (1 - L * L).squareRoot()   // limen: ниже — ритм, выше — тон
    g.setStrokeColor(w.ink(0.18)); g.setLineDash(phase: 0, lengths: [2, 5])
    line([CGPoint(x: cx - lh + 8, y: ly), CGPoint(x: cx + lh - 8, y: ly)]); g.setLineDash(phase: 0, lengths: [])
    w.mapText("limen", cx - lh + 12, ly - 8, 10.5, 0.32)
    w.mapText("rhythmus", cx, hy - L * RY * 0.45, 10.5, 0.32, align: .center)
    w.mapText("tonus", cx, hy - RY * 0.62, 10.5, 0.32, align: .center)
    g.setStrokeColor(w.ink(0.75)); line([CGPoint(x: 0, y: hy + 0.5), CGPoint(x: G.W, y: hy + 0.5)])   // земля: горизонт, холмы, штриховка
    g.setStrokeColor(w.ink(0.35))
    line(stride(from: CGFloat(0), through: G.W, by: 4).map { px in CGPoint(x: px, y: hy + 10 + sin(px * 0.031) * 4 + sin(px * 0.011 + 1) * 6) })
    g.setStrokeColor(w.ink(0.08)); g.beginPath()
    for y in stride(from: hy + 18, to: G.H, by: 5) { g.move(to: CGPoint(x: 0, y: y)); g.addLine(to: CGPoint(x: G.W, y: y)) }
    g.strokePath()
    wall = g.makeImage()
    return wall
  }

  // view.js:126-134 — голова и хвост бледным золотом; положение — по времени зеркала (model.cometAt)
  private func drawComet(_ d: Draw) {
    guard let c = mirror.comet else { return }
    let g = d.g, gold = FirmamentumView.gold
    let k = min(1, (mirror.time - c.t0) / c.dur), A = geo.fromSky(h: c.a.h, u: c.a.u), B = geo.fromSky(h: c.b.h, u: c.b.u)
    let x = A.x + (B.x - A.x) * CGFloat(k), y = A.y + (B.y - A.y) * CGFloat(k)
    let dx = B.x - A.x, dy = B.y - A.y, L = max(hypot(dx, dy), 0.001), ux = dx / L, uy = dy / L
    let fade = CGFloat(max(0, min(1, k * 6, (1 - k) * 6)))
    if fade <= 0 { return }
    g.setLineWidth(1)
    for j in 0..<4 {
      let o = CGFloat(j) - 1.5, l = CGFloat(70 + j * 18)
      g.setStrokeColor(Draw.color(gold, (0.5 - CGFloat(j) * 0.11) * fade))
      g.beginPath(); g.move(to: CGPoint(x: x - uy * o * 1.6, y: y + ux * o * 1.6)); g.addLine(to: CGPoint(x: x - ux * l - uy * o * 4, y: y - uy * l + ux * o * 4)); g.strokePath()
    }
    d.glowAt(x, y, 16, 0.35 * fade)
    g.setFillColor(Draw.color(gold, 0.95 * fade)); g.fillEllipse(in: CGRect(x: x - 2.6, y: y - 2.6, width: 5.2, height: 5.2))
  }

  // view.js:135-150 — пылинки треска гаснут за ~¼ с; лучи вспышек — тонкая прямая до свода, ~0.1 с
  private func drawDust(_ d: Draw, _ now: Double) {
    let g = d.g
    g.setLineWidth(1)
    for p in specks {
      let k = (now - p.t) / 0.26
      if k > 1 || k < 0 { continue }
      let a = CGFloat(p.a * (1 - k) * (1 - k))
      g.setFillColor(d.ink(0.9 * a)); g.fill(CGRect(x: p.x - 0.5, y: p.y - 0.5, width: 1.3, height: 1.3))
      if p.a > 0.6 {
        g.setStrokeColor(d.ink(0.5 * a)); g.beginPath()
        g.move(to: CGPoint(x: p.x - 3, y: p.y)); g.addLine(to: CGPoint(x: p.x + 3, y: p.y)); g.move(to: CGPoint(x: p.x, y: p.y - 3)); g.addLine(to: CGPoint(x: p.x, y: p.y + 3)); g.strokePath()
      }
    }
    for b in bolts {
      let k = CGFloat((now - b.t) / 0.11)
      guard k <= 1, let s = mirror.stars.first(where: { $0.slot == b.slot }) else { continue }
      let p = geo.fromSky(h: s.h, u: s.u), t = geo.hy - geo.RY * max(0, 1 - ((p.x - geo.cx) / geo.RX) * ((p.x - geo.cx) / geo.RX)).squareRoot() + 6
      g.setStrokeColor(CGColor(red: 1, green: 1, blue: 1, alpha: 0.75 * (1 - k)))
      g.beginPath(); g.move(to: CGPoint(x: p.x + 0.5, y: p.y - 9)); g.addLine(to: CGPoint(x: p.x + 0.5, y: t)); g.strokePath()
      g.setStrokeColor(d.ink(0.4 * (1 - k)))
      g.beginPath(); g.move(to: CGPoint(x: p.x - 5, y: t + 3)); g.addLine(to: CGPoint(x: p.x + 6, y: t + 3)); g.strokePath()
    }
  }

  // view.js:151-174 — звезда: свечение, луч вниз (форма пульсарета), прокол с лучами, ободок маски; у удерживаемой — подписи
  private func drawStar(_ d: Draw, _ s: Star, _ now: Double, held: Bool) {
    let g = d.g, gold = FirmamentumView.gold, p = geo.fromSky(h: s.h, u: s.u), fp = s.fp
    var blink: CGFloat = 1                                // ритм — вспышка на пульсарет; тон — ровный свет
    if fp < 18 {
      let since: Double = now - (flash[s.id] ?? -1e9), tau: Double = (80 + 300 / max(1, fp)) / 1000
      blink = CGFloat(exp(-since / tau))
    }
    let e = CGFloat(min(1, max(0, s.gain * 1.4))) * (0.35 + 0.65 * blink)
    if e > 0.05 { d.glowAt(p.x, p.y, 22 + 10 * blink, 0.25 * e) }
    let len = 30 + 26 * e, w: CGFloat = 6, cyc = s.cyc
    g.setLineWidth(1); g.setStrokeColor(Draw.color(gold, 0.15 + 0.5 * e)); g.beginPath()
    for k in 0...40 {                                     // луч вниз — форма пульсарета
      let x = Double(k) / 40, w0 = pow(sin(Double.pi * x), 2), w1 = min(1, x * 40) * exp(-x * 5)
      let wv = s.win < 0.5 ? w0 + (w1 - w0) * s.win * 2 : w1 + (1 - w1) * (s.win - 0.5) * 2
      let pt = CGPoint(x: p.x + CGFloat(sin(2 * Double.pi * cyc * x) * wv) * w, y: p.y + 7 + CGFloat(x) * len)
      k == 0 ? g.move(to: pt) : g.addLine(to: pt)
    }
    g.strokePath()
    g.setStrokeColor(Draw.color(gold, 0.5 + 0.5 * e)); g.beginPath()
    for k in 0..<8 {                                      // звезда: прокол с лучами
      let a = CGFloat(k) / 8 * 2 * .pi, l = CGFloat(k % 2 == 1 ? 4 : 8) * (0.7 + 0.5 * e)
      g.move(to: CGPoint(x: p.x + cos(a) * 2, y: p.y + sin(a) * 2)); g.addLine(to: CGPoint(x: p.x + cos(a) * l, y: p.y + sin(a) * l))
    }
    g.strokePath()
    g.setFillColor(Draw.color(gold, 0.6 + 0.4 * e)); g.fillEllipse(in: CGRect(x: p.x - 2.2, y: p.y - 2.2, width: 4.4, height: 4.4))
    if s.mask > 0.05 {                                    // пропускает — пунктирный ободок
      g.setStrokeColor(d.ink(0.35)); g.setLineDash(phase: 0, lengths: [1.5, 3])
      g.strokeEllipse(in: CGRect(x: p.x - 11, y: p.y - 11, width: 22, height: 22)); g.setLineDash(phase: 0, lengths: [])
    }
    if held {
      g.setStrokeColor(d.ink(0.6)); g.strokeEllipse(in: CGRect(x: p.x - 14, y: p.y - 14, width: 28, height: 28))
      let top = fp >= 20 ? "\(FirmamentumView.noteName(fp)) · \(Int(fp.rounded())) Hz" : String(format: "%.*f / s", fp < 4 ? 1 : 0, fp)
      d.mapText(top, p.x, p.y - 30, 14, 0.95, align: .center)
      d.mapText("formant \(Int(s.ff.rounded())) Hz", p.x, p.y - 15, 11, 0.6, align: .center)
    }
  }

  // порядок кадра — view.js:176-184: фон → комета → искры и молнии → звёзды → солнце
  func draw(_ d: Draw, now: Double) {
    let g = d.g, G = geo
    if let w = wall(d) {
      g.saveGState(); g.translateBy(x: 0, y: G.H); g.scaleBy(x: 1, y: -1)    // контекст — началом сверху, картинка — снизу
      g.draw(w, in: CGRect(x: 0, y: 0, width: G.W, height: G.H)); g.restoreGState()
    }
    let held = Set(holds.values.compactMap(\.id))
    drawComet(d)
    drawDust(d, now)
    for s in mirror.stars { drawStar(d, s, now, held: held.contains(s.id)) }
    g.saveGState(); g.clip(to: CGRect(x: 0, y: 0, width: G.W, height: G.sun.y))
    d.sunGlyph(G.sun.x, G.sun.y, -.pi / 2, 0, scale: 1.2, now: now * 1000, col: FirmamentumView.ink, disc: theme.bg)
    g.restoreGState()
  }

  // что услышано: вспышки звёзд, пылинки на своде, лучи
  func hear(_ h: Heard, now: Double) {
    for s in mirror.stars where h.pulsed.contains(s.slot) { flash[s.id] = now }
    for (pan, a) in h.dust {
      let hh = 0.05 + Double.random(in: 0..<1, using: &rng) * 0.85
      let u = min(max(pan * 0.9 + (Double.random(in: 0..<1, using: &rng) - 0.5) * 0.2, -1), 1)
      let p = geo.fromSky(h: hh, u: u)
      specks.append((p.x, p.y, min(1, 0.25 + a * 3), now))
    }
    if specks.count > 60 { specks.removeFirst(specks.count - 60) }
    for i in h.bolts { bolts.append((i, now)) }
    if bolts.count > 12 { bolts.removeFirst(bolts.count - 12) }
  }

  // ---------- касания ----------
  private func starAt(_ x: CGFloat, _ y: CGFloat) -> Star? {
    var best: Star?, bd: CGFloat = 24
    for s in mirror.stars {
      let p = geo.fromSky(h: s.h, u: s.u), d = hypot(x - p.x, y - p.y)
      if d < bd { bd = d; best = s }
    }
    return best
  }
  private func inCorner(_ f: Finger) -> Bool { f.x0 > geo.W - Touch.cornerPt && f.y0 > geo.H - Touch.cornerPt }

  func down(_ f: Finger) {
    if inCorner(f) { return }
    if let hit = starAt(f.x, f.y) { holds[f.id] = Hold(id: hit.id, x0: f.x, y0: f.y, seen: true); return }
    var h = Hold(id: nil, x0: f.x, y0: f.y)
    if let q = geo.toSky(CGPoint(x: f.x, y: f.y)), mirror.stars.count < FirmamentumView.smax {
      let id = max(mirror.stars.map(\.id).max() ?? 0, issued) + 1
      if core.action(0, 0, [q.h, q.u, -1, Double(id)], touchTime: f.touchTime) {   // кольцо полно — добавление отброшено: ни id, ни держания
        issued = id
        h.id = id; h.fresh = true
      }
    }
    holds[f.id] = h
  }

  func move(_ f: Finger) {
    guard var t = holds[f.id], let id = t.id else { return }
    if mirror.stars.contains(where: { $0.id == id }) { t.seen = true }
    else if t.seen || !t.fresh { holds[f.id] = t; return }   // звезды уже нет — чужую не двигаем
    if hypot(f.x - t.x0, f.y - t.y0) > 8 { t.moved = true }
    holds[f.id] = t
    guard t.moved else { return }
    let dy = max(6, geo.hy - f.y), e = hypot((f.x - geo.cx) / geo.RX, dy / geo.RY), k = e > 0.95 ? 0.95 / e : 1   // за свод не уйти
    if let q = geo.toSky(CGPoint(x: geo.cx + (f.x - geo.cx) * k, y: geo.hy - dy * k)) {
      core.action(2, id, [q.h, q.u], touchTime: f.touchTime)
    }
  }

  func cancel(_ f: Finger) { holds[f.id] = nil }          // без закрытия звезды; уже добавленная свежая остаётся

  func up(_ f: Finger) {
    guard let t = holds.removeValue(forKey: f.id), let id = t.id else { return }
    if !t.moved, !t.fresh, (f.touchTime - f.t0) * 1000 < 300, mirror.stars.contains(where: { $0.id == id }) {
      core.action(1, id, [], touchTime: f.touchTime)    // тап по звезде — закрыть дыру
    }
  }
}
