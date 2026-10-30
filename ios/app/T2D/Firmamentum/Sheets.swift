import Foundation

// плашки Firmamentum: веер FX и плашка звезды (view.js:70-77, :186-193)
extension FirmamentumView {
  private static let fxKeys = ["scintilla", "drift", "cometa", "crepitus", "fulgur", "spread", "hall"]

  var fxSpec: SheetSpec {
    let keys = FirmamentumView.fxKeys
    func idx(_ k: String) -> Int { keys.firstIndex(of: k) ?? 0 }
    return SheetSpec(
      title: "", hint: "",
      rows: keys.enumerated().map { SheetRow(key: $1, label: $1, code: 6 + $0) },
      get: { [unowned self] k in mirror.fx[idx(k)] },
      set: { [unowned self] k, v in core.action(4, idx(k), [v], touchTime: 0) },
      text: { [unowned self] k in
        let v = mirror.fx[idx(k)]
        return ["cometa", "crepitus", "fulgur"].contains(k) && v <= 0.01 ? "off" : "\(Int((v * 100).rounded()))%"
      },
      lfo: SheetLfo(obj: -1, keys: Set(keys), shape: 1),
      reset: nil,
      arc: { [unowned self] in mirror.fx[6] })
  }

  func starSheet(_ id: Int) -> SheetSpec {
    let rows: [(String, String, Int)] = [("h", "pulse", 4), ("u", "formant", 5), ("cyc", "cycles", 0), ("win", "window", 1), ("mask", "mask", 2), ("lvl", "level", 3)]
    func star() -> Star? { mirror.stars.first { $0.id == id } }
    func field(_ s: Star, _ k: String) -> Double {
      switch k { case "h": return s.h; case "u": return s.u; case "cyc": return s.cyc; case "win": return s.win; case "mask": return s.mask; default: return s.lvl }
    }
    return SheetSpec(
      title: "stella", hint: "star — tap outside to close",
      rows: rows.map { SheetRow(key: $0.0, label: $0.1, code: $0.2) },
      get: { k in
        guard let s = star() else { return 0 }
        return k == "cyc" ? (s.cyc - 1) / 7 : k == "u" ? (s.u + 1) / 2 : field(s, k)
      },
      set: { [unowned self] k, v in
        let code = rows.first { $0.0 == k }?.2 ?? 0
        let val = k == "cyc" ? 1 + (v * 7).rounded() : k == "u" ? v * 2 - 1 : k == "h" ? min(max(v, 0.02), 0.97) : v
        core.action(3, id, [Double(code), val], touchTime: 0)
      },
      text: { k in
        guard let s = star() else { return "" }
        switch k {
        case "h": return s.fp >= 20 ? "\(Int(s.fp.rounded())) Hz" : String(format: "%.1f / s", s.fp)
        case "u": return "\(Int(s.ff.rounded())) Hz"
        case "cyc": return "\(Int(s.cyc))"
        case "win": return s.win < 0.33 ? "bell" : s.win < 0.66 ? "strike" : "square"
        default: return "\(Int((field(s, k) * 100).rounded()))%"
        }
      },
      lfo: SheetLfo(obj: id, keys: ["h", "u", "win", "mask", "lvl"], shape: 1),
      reset: nil, arc: nil)
  }
}
