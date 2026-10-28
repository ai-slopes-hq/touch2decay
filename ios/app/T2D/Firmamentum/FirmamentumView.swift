import UIKit
import T2DCore

// Firmamentum — касания и состояние картинки (рисование — в Draw-расширении, задача 8)
final class FirmamentumView: World {
  static let slotN = 10, smax = 6
  let slot = FirmamentumView.slotN
  let theme = Theme(ink: (232, 224, 200), paper: (10, 9, 20), bg: UIColor(red: 10 / 255, green: 9 / 255, blue: 20 / 255, alpha: 1))
  static let gold: RGB = (236, 204, 130)

  var geo: Geo
  var mirror = FirmMirror()
  var flash: [Int: Double] = [:]                        // id звезды → когда прозвучал её последний пульсарет
  var specks: [(x: CGFloat, y: CGFloat, a: Double, t: Double)] = []   // пылинки треска, ≤ 60, 260 мс
  var bolts: [(slot: Int, t: Double)] = []              // лучи вспышек, ≤ 12, 110 мс
  private let core: Core
  private let readMirror: () -> [Double]
  private let readHeard: () -> [Double]
  private var issued = 0                                // наибольший выданный Swift id
  private var now = 0.0
  private var rng = SystemRandomNumberGenerator()

  private struct Hold { var id: Int?; var x0, y0: CGFloat; var moved = false, fresh = false, seen = false }
  private var holds: [ObjectIdentifier: Hold] = [:]

  init(core: Core, geo: Geo, readMirror: (() -> [Double])? = nil, readHeard: (() -> [Double])? = nil) {
    self.core = core; self.geo = geo
    self.readMirror = readMirror ?? {
      var m = [Double](repeating: 0, count: 1024)
      let n = Int(t2d_app_mirror(Int32(FirmamentumView.slotN), &m, 1024)); return Array(m[0..<max(0, n)])
    }
    self.readHeard = readHeard ?? {
      var m = [Double](repeating: 0, count: 256)
      let n = Int(t2d_app_heard(Int32(FirmamentumView.slotN), &m, 256)); return Array(m[0..<max(0, n)])
    }
  }

  func tick(now: Double, dt: Double) {
    self.now = now
    mirror = FirmMirror.parse(readMirror())
    for h in Heard.parse(readHeard()) { hear(h, now: now) }
    specks.removeAll { now - $0.t > 0.26 }
    bolts.removeAll { now - $0.t > 0.11 }
  }

  func draw(_ d: Draw, now: Double) {}                  // задача 8

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
      issued = id
      core.action(0, 0, [q.h, q.u, -1, Double(id)], touchTime: f.touchTime)
      h.id = id; h.fresh = true
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

  func up(_ f: Finger) {
    guard let t = holds.removeValue(forKey: f.id), let id = t.id else { return }
    if !t.moved, !t.fresh, (f.touchTime - f.t0) * 1000 < 300, mirror.stars.contains(where: { $0.id == id }) {
      core.action(1, id, [], touchTime: f.touchTime)    // тап по звезде — закрыть дыру
    }
  }
}
