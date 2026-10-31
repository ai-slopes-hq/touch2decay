import Foundation

// плашки Arcadia: viator (view.js:84-93) и веер aether (view.js:272-278); значения — свои, потом зеркало
extension ArcadiaView {
  static let fanKeys = ["relief", "pace", "wind", "chorus", "phaser", "hall"]
  static let fanIdx = [0, 1, 2, 3, 4, 6]                // индекс Fx в ядре (spread 5 — не в веере); он же код LFO
  static let viatorKeys = ["oct", "r", "fig", "mode", "sp", "lvl"]
  static let viatorKeyNo = [2, 3, 4, 5, 6, 7]           // Key ядра (T_KEYS)

  private func pct(_ v: Double) -> String { "\(Int(Horo.jsRound(v * 100)))%" }

  var fxSpec: SheetSpec {
    let keys = ArcadiaView.fanKeys, idxs = ArcadiaView.fanIdx
    func idx(_ k: String) -> Int { idxs[keys.firstIndex(of: k) ?? 0] }
    return SheetSpec(
      title: "aether", hint: "FX — tap outside to close",
      rows: keys.enumerated().map { SheetRow(key: $1, label: $1, code: idxs[$0]) },
      get: { [unowned self] k in fxValue(idx(k)) },
      set: { [unowned self] k, v in sheetSetFx(idx(k), v) },
      text: { [unowned self] k in
        let v = fxValue(idx(k))
        if k == "pace" { return "\(Int((1 / (0.01 * pow(40, v))).rounded())) s" }
        if k == "wind" && v < 0.01 { return "calm" }
        if (k == "phaser" || k == "chorus") && v < 0.01 { return "off" }
        return pct(v)
      },
      lfo: SheetLfo(obj: -1, keys: Set(keys), shape: 1),
      reset: nil,
      arc: { [unowned self] in fxValue(6) })
  }

  func viatorSpec(_ slot: Int) -> SheetSpec {
    let keys = ArcadiaView.viatorKeys, nos = ArcadiaView.viatorKeyNo
    let labels = ["octave", "orbit", "figure", "path", "range", "level"], codes = [-1, 3, -1, -1, 6, 7]
    func no(_ k: String) -> Int { nos[keys.firstIndex(of: k) ?? 0] }
    func val(_ k: String) -> Double { value(slot, key: no(k)) }
    return SheetSpec(
      title: "viator", hint: "wanderer — tap outside to close",
      rows: keys.enumerated().map { SheetRow(key: $1, label: labels[$0], code: codes[$0]) },
      get: { k in
        let v = val(k)
        switch k {
        case "oct": return (v + 1) / 2
        case "r": return (v - 0.03) / 0.57
        case "fig": return v / 2
        case "mode": return v / 4
        case "sp": return v / 0.6
        default: return v
        }
      },
      set: { [unowned self] k, v in
        let x: Double
        switch k {
        case "oct": x = Horo.jsRound(v * 2) - 1
        case "r": x = 0.03 + v * 0.57
        case "fig": x = Horo.jsRound(v * 2)
        case "mode": x = Horo.jsRound(v * 4)
        case "sp": x = v * 0.6
        default: x = v
        }
        sheetSet(slot, key: no(k), x, route: k == "mode")
      },
      text: { k in
        let v = val(k)
        switch k {
        case "oct": return ["octave −1", "octave 0", "octave +1"][min(2, max(0, Int(v.rounded()) + 1))]
        case "fig": return Arc.figs[min(2, max(0, Int(v.rounded())))]
        case "mode": return Arc.paths[min(4, max(0, Int(v.rounded())))]
        case "r": return self.pct(v)
        case "sp": return self.pct(v / 0.6)
        default: return self.pct(v)
        }
      },
      lfo: SheetLfo(obj: slot, keys: ["r", "sp", "lvl"], shape: 1),
      reset: nil, arc: nil, obj: slot)
  }
}
