import Foundation

// плашки Horologium: кольцо, ступица и веер FX (view.js:97-115, :251-256); значения — только из зеркала
extension HorologiumView {
  static let fxKeys = ["aequalis", "materia", "concursus", "chance", "hall"]   // порядок Fx в ядре и код LFO
  static let ringKeys = ["on", "under", "phi", "lvl", "flt", "inst"]            // порядок строк плашки; индекс в ядре — ringIdx
  static let ringIdx = ["on": 0, "under": 1, "phi": 2, "lvl": 3, "inst": 4, "flt": 6]   // RingKey ядра (flt = 6, inst остаётся 4)

  private func pct(_ v: Double) -> String { "\(v.isFinite ? Int(Horo.clamp(Horo.jsRound(v * 100), -1e6, 1e6)) : 0)%" }

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
        case "materia": return "\(v < 0.5 ? "corium" : "metallum") \(pct(v))"
        default: return pct(v)
        }
      },
      lfo: SheetLfo(obj: -1, keys: Set(keys), shape: 1),
      reset: nil,
      arc: { [unowned self] in mirror.fx[4] })
  }

  func ringSpec(_ i: Int) -> SheetSpec {
    let keys = HorologiumView.ringKeys, labels = ["sounds", "ratio", "phase", "level", "filtrum", "instrument"]
    let codes = [-1, -1, 5 + 2 * i, 6 + 2 * i, 21 + i, -1]   // LFO: фаза, громкость и фильтр; sounds / ratio / instrument — без LFO
    func k(_ key: String) -> Int { HorologiumView.ringIdx[key] ?? 0 }
    return SheetSpec(
      title: "circulus \(Horo.roman[i + 2])", hint: "ring — tap outside to close",
      rows: keys.enumerated().map { SheetRow(key: $1, label: labels[$0], code: codes[$0]) },
      get: { [unowned self] key in
        let r = mirror.rings[i]
        switch key {
        case "on": return r.on ? 1 : 0
        case "under": return Double(r.under) / 2
        case "phi": return r.phi
        case "flt": return r.flt
        case "inst": return Double(r.inst) / 7
        default: return r.lvl
        }
      },
      set: { [unowned self] key, v in
        let val = key == "on" ? (v >= 0.5 ? 1 : 0) : key == "under" ? (v * 2).rounded() : key == "inst" ? (v * 7).rounded() : v
        core.action(Act.ring, i, [Double(k(key)), val], touchTime: 0)
      },
      text: { [unowned self] key in
        let r = mirror.rings[i]
        switch key {
        case "on": return r.on ? "yes" : "no"
        case "under": return r.under == 1 ? "1/\(r.n) · \(Horo.num2(12 / Double(r.n))) a turn" : r.under == 2 ? "×2 · \(r.n) a turn, twice as fast" : "\(r.n) a turn"
        case "phi": return "\(Horo.rot(r.phi, r.len)) / \(r.len)"
        case "flt": return Horo.filterText(r.flt)
        case "inst": return Horo.instNames[r.inst]
        default: return pct(r.lvl)
        }
      },
      lfo: SheetLfo(obj: -1, keys: ["phi", "lvl", "flt"], shape: 0),
      reset: nil, arc: nil,
      tap: { [unowned self] key in                           // тап по строке instrument — следующий по кругу, по ratio — следующее отношение; прочие строки не трогаем
        if key == "under" { core.action(Act.ring, i, [1, Double((mirror.rings[i].under + 1) % 3)], touchTime: 0); return }
        guard key == "inst" else { return }
        core.action(Act.ring, i, [4, Double((mirror.rings[i].inst + 1) % 8)], touchTime: 0)
      })
  }

  func hubSpec() -> SheetSpec {
    SheetSpec(
      title: "tempus", hint: "one turn of the wheel = one bar — tap outside to close",
      rows: [SheetRow(key: "bpm", label: "tempo", code: -1)],
      get: { [unowned self] _ in (mirror.bpm - 40) / 160 },
      set: { [unowned self] _, v in
        let b = Horo.jsRound(40 + v * 160)
        core.action(Act.bpm, 0, [b], touchTime: 0); tempoSet?(b)
      },
      text: { [unowned self] _ in "\(Int(mirror.bpm.rounded())) bpm" },
      lfo: nil, reset: nil, arc: nil)
  }
}
