import Foundation

// плашки Horologium: кольцо, ступица и веер FX (view.js:97-115, :251-256); значения — только из зеркала
extension HorologiumView {
  static let fxKeys = ["aequalis", "materia", "concursus", "chance", "hall"]   // порядок Fx в ядре и код LFO
  static let ringKeys = ["on", "under", "phi", "lvl"]                          // порядок RingKey в RING ядра

  private func pct(_ v: Double) -> String { "\(Int(Horo.jsRound(v * 100)))%" }

  var fxSpec: SheetSpec {
    let keys = HorologiumView.fxKeys
    func idx(_ k: String) -> Int { keys.firstIndex(of: k) ?? 0 }
    return SheetSpec(
      title: "aether", hint: "FX — tap outside to close",
      rows: keys.enumerated().map { SheetRow(key: $1, label: $1, code: $0) },
      get: { [unowned self] k in mirror.fx[idx(k)] },
      set: { [unowned self] k, v in core.action(Act.fx, idx(k), [v], touchTime: 0) },
      text: { [unowned self] k in
        let v = mirror.fx[idx(k)]
        switch k {
        case "aequalis": return v < 0.01 ? "pure" : v > 0.99 ? "equal" : "\(pct(v)) equal"
        case "materia": return "\(v < 0.5 ? "lignum" : "metallum") \(pct(v))"
        default: return pct(v)
        }
      },
      lfo: SheetLfo(obj: -1, keys: Set(keys), shape: 1),
      reset: nil,
      arc: { [unowned self] in mirror.fx[4] })
  }

  func ringSpec(_ i: Int) -> SheetSpec {
    let keys = HorologiumView.ringKeys, labels = ["sounds", "undertone", "phase", "level"]
    let codes = [-1, -1, 5 + 2 * i, 6 + 2 * i]               // LFO: фаза и громкость; sounds / undertone — без LFO
    func k(_ key: String) -> Int { keys.firstIndex(of: key) ?? 0 }
    return SheetSpec(
      title: "circulus \(Horo.roman[i + 2])", hint: "ring — tap outside to close",
      rows: keys.enumerated().map { SheetRow(key: $1, label: labels[$0], code: codes[$0]) },
      get: { [unowned self] key in
        let r = mirror.rings[i]
        switch key {
        case "on": return r.on ? 1 : 0
        case "under": return r.under ? 1 : 0
        case "phi": return r.phi
        default: return r.lvl
        }
      },
      set: { [unowned self] key, v in
        let val = key == "on" || key == "under" ? (v >= 0.5 ? 1 : 0) : v
        core.action(Act.ring, i, [Double(k(key)), val], touchTime: 0)
      },
      text: { [unowned self] key in
        let r = mirror.rings[i]
        switch key {
        case "on": return r.on ? "yes" : "no"
        case "under": return r.under ? "1/\(r.n) · \(Horo.num2(12 / Double(r.n))) a turn" : "\(r.n) a turn"
        case "phi": return "\(Int(Horo.jsRound(r.phi * 360)))°"
        default: return pct(r.lvl)
        }
      },
      lfo: SheetLfo(obj: -1, keys: ["phi", "lvl"], shape: 0),
      reset: nil, arc: nil)
  }

  func hubSpec() -> SheetSpec {
    SheetSpec(
      title: "tempus", hint: "one turn of the wheel = one bar — tap outside to close",
      rows: [SheetRow(key: "bpm", label: "tempo", code: -1)],
      get: { [unowned self] _ in (mirror.bpm - 40) / 160 },
      set: { [unowned self] _, v in core.action(Act.bpm, 0, [Horo.jsRound(40 + v * 160)], touchTime: 0) },
      text: { [unowned self] _ in "\(Int(mirror.bpm.rounded())) bpm" },
      lfo: nil, reset: nil, arc: nil)
  }
}
