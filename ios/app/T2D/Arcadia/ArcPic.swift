import Foundation
import T2DCore

// страна из ядра: рельеф, вершины, озёра, реки (t2d_app_arc_*). Единственное место, где Swift зовёт ядро Arcadia.
final class ArcPic {
  struct Peak { var u: Double, v: Double, h: Double, name: String? }
  struct Lake { var u: Double, v: Double, w: Double, level: Double, pond: Bool, name: String? }
  struct River { var name: String?; var pts: [(Double, Double)] }

  let seed: UInt32
  let z: [Float], lake: [Float]
  let peaks: [Peak], lakes: [Lake], rivers: [River]

  init(seed: UInt32, z: [Float], lake: [Float], peaks: [Peak], lakes: [Lake], rivers: [River]) {
    self.seed = seed; self.z = z; self.lake = lake; self.peaks = peaks; self.lakes = lakes; self.rivers = rivers
  }

  func zAt(_ u: Double, _ v: Double) -> Double { Arc.bil(z, u, v) }
  func lakeAt(_ u: Double, _ v: Double) -> Double { Arc.bil(lake, u, v) }

  typealias Builder = (UInt32) -> ArcPic?
  typealias Router = (ArcPic, Double, Double, Int) -> [Double]

  private static func name(_ kind: Int32, _ idx: Double) -> String? {
    guard idx >= 0, let c = t2d_app_arc_name(kind, Int32(idx)) else { return nil }
    return String(cString: c)
  }

  static let core: Builder = { seed in
    let n = Arc.gx * Arc.gy, cap = 1400
    var z = [Float](repeating: 0, count: n), lake = [Float](repeating: 0, count: n), meta = [Double](repeating: 0, count: cap)
    let len = Int(t2d_app_arc_pic(seed, &z, &lake, &meta, Int32(cap)))
    guard len >= 3 else { return nil }
    var o = 3
    let np = Int(meta[0]), nl = Int(meta[1]), nr = Int(meta[2])
    var peaks: [Peak] = [], lakes: [Lake] = [], rivers: [River] = []
    for _ in 0..<np { peaks.append(Peak(u: meta[o], v: meta[o + 1], h: meta[o + 2], name: name(0, meta[o + 3]))); o += 4 }
    for _ in 0..<nl {
      lakes.append(Lake(u: meta[o], v: meta[o + 1], w: meta[o + 2], level: meta[o + 3], pond: meta[o + 4] != 0, name: name(1, meta[o + 5]))); o += 6
    }
    for _ in 0..<nr {
      let m = Int(meta[o]), nm = name(2, meta[o + 1]); o += 2
      var pts: [(Double, Double)] = []
      for _ in 0..<m { pts.append((meta[o], meta[o + 1])); o += 2 }
      rivers.append(River(name: nm, pts: pts))
    }
    return ArcPic(seed: seed, z: z, lake: lake, peaks: peaks, lakes: lakes, rivers: rivers)
  }

  // путь mode 3 / 4 от дома: пары u, v
  static let coreRoute: Router = { pic, u, v, mode in
    var out = [Double](repeating: 0, count: 182)
    let n = Int(t2d_app_arc_route(pic.z, pic.lake, u, v, Int32(mode), &out, 182))
    return Array(out.prefix(n))
  }
}

final class ArcPicLoader {
  private let build: ArcPic.Builder
  private let queue: DispatchQueue?
  init(build: @escaping ArcPic.Builder = ArcPic.core, queue: DispatchQueue? = DispatchQueue.global(qos: .userInitiated)) {
    self.build = build; self.queue = queue
  }
  func load(seed: UInt32, done: @escaping (ArcPic) -> Void) {
    guard let q = queue else { if let p = build(seed) { done(p) }; return }
    q.async { [build] in
      guard let p = build(seed) else { return }
      DispatchQueue.main.async { done(p) }
    }
  }
}
