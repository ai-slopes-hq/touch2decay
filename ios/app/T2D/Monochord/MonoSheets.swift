import Foundation

// плашки Monochordum: струна, земля, ветер и веер FX (view.js:38-49, :119-145, :294-303); значения — только из зеркала
extension MonochordView {
  static let fxKeys = ["decay", "bright", "body", "sympathy", "chorus", "chance", "hall"]
  static let fxLabels = ["decay", "brightness", "body", "sympathy", "chorus", "chance", "hall"]
  static let romans = ["I", "II", "III", "IV"]
  static let strKeys = ["pitch", "bright", "decay", "level"]                   // порядок k в коде LFO и в STRING ядра
  private static let notes = ["A", "A#", "B", "C", "C#", "D", "D#", "E", "F", "F#", "G", "G#"]

  // view.js:10 — нота по частоте от A1 = 55 Гц (round как в JS: половина вверх)
  static func noteOf(_ f: Double) -> String {
    let m = Int((12 * log2(f / 55) + 0.5).rounded(.down))
    return "\(notes[((m % 12) + 12) % 12])\(Int((Double(m + 9) / 12).rounded(.down)) + 1)"
  }
  func hzOf(_ i: Int) -> Double { MonochordView.fOpen[i] * tonic / mirror.str[i].r }
  var tonic: Double { pow(2, Double(root) / 12) }

  private func pct(_ v: Double) -> String { "\(Int((v * 100).rounded()))%" }

  var fxSpec: SheetSpec {
    let keys = MonochordView.fxKeys
    func idx(_ k: String) -> Int { keys.firstIndex(of: k) ?? 0 }
    return SheetSpec(
      title: "chorda mundi", hint: "FX — tap outside to close",
      rows: keys.enumerated().map { SheetRow(key: $1, label: MonochordView.fxLabels[$0], code: $0) },
      get: { [unowned self] k in mirror.fx[idx(k)] },
      set: { [unowned self] k, v in core.action(Act.fx, idx(k), [v], touchTime: 0) },
      text: { [unowned self] k in pct(mirror.fx[idx(k)]) },
      lfo: SheetLfo(obj: -1, keys: Set(keys), shape: 0),
      reset: nil,
      arc: { [unowned self] in mirror.fx[6] })
  }

  func stringSpec(_ i: Int) -> SheetSpec {
    let keys = MonochordView.strKeys, labels = ["pitch", "brightness", "decay", "level"]
    func k(_ key: String) -> Int { keys.firstIndex(of: key) ?? 0 }
    func field(_ s: MonoString, _ key: String) -> Double { key == "bright" ? s.bright : key == "decay" ? s.decay : s.level }
    return SheetSpec(
      title: "chorda \(MonochordView.romans[i])", hint: "string — tap outside to close",
      rows: keys.enumerated().map { SheetRow(key: $1, label: labels[$0], code: 10 + 4 * i + $0) },
      get: { [unowned self] key in
        let s = mirror.str[i]
        return key == "pitch" ? log2(1 / s.r) / 2 : field(s, key)
      },
      set: { [unowned self] key, v in core.action(Act.string, i, [Double(k(key)), v], touchTime: 0) },   // pitch: v как есть, r считает ядро
      text: { [unowned self] key in key == "pitch" ? MonochordView.noteOf(hzOf(i)) : pct(field(mirror.str[i], key)) },
      lfo: SheetLfo(obj: -1, keys: Set(keys), shape: 0),
      reset: nil, arc: nil)
  }

  func earthSpec() -> SheetSpec {
    let div = MonochordView.divs, pats = MonochordView.patterns
    let ap = ["tempo": 1, "rate": 2, "pattern": 3, "strength": 4, "swing": 5]
    func a(_ i: Int) -> Double { mirror.auto[i] }
    func step(_ v: Double) -> Double { Double(min(3, Int((v * 4).rounded(.down)))) }
    return SheetSpec(
      title: "terra", hint: "the earth strums — tap outside to close",
      rows: [SheetRow(key: "tempo", label: "tempo", code: -1), SheetRow(key: "rate", label: "rate", code: -1), SheetRow(key: "pattern", label: "pattern", code: -1),
             SheetRow(key: "strength", label: "strength", code: 8), SheetRow(key: "swing", label: "swing", code: 9)],
      get: { k in
        switch k {
        case "tempo": return (a(1) - 40) / 160
        case "rate": return (a(2) + 0.5) / 4
        case "pattern": return (a(3) + 0.5) / 4
        default: return a(ap[k] ?? 4)
        }
      },
      set: { [unowned self] k, v in
        let val = k == "tempo" ? (40 + v * 160).rounded() : (k == "rate" || k == "pattern") ? step(v) : v
        core.action(Act.autopar, ap[k] ?? 4, [val], touchTime: 0)
      },
      text: { [unowned self] k in
        switch k {
        case "tempo": return "\(Int(a(1).rounded())) bpm"
        case "rate": return div[min(3, max(0, Int(a(2))))].1
        case "pattern": return pats[min(3, max(0, Int(a(3))))]
        default: return pct(a(ap[k] ?? 4))
        }
      },
      lfo: SheetLfo(obj: -1, keys: ["strength", "swing"], shape: 0),
      reset: nil, arc: nil)
  }

  func windSpec() -> SheetSpec {
    SheetSpec(
      title: "ventus", hint: "wind — tap outside to close",
      rows: [SheetRow(key: "wind", label: "wind", code: 7)],
      get: { [unowned self] _ in mirror.wind },
      set: { [unowned self] _, v in core.action(Act.wind, 0, [min(1, max(0, v))], touchTime: 0) },
      text: { [unowned self] _ in mirror.wind > 0.01 ? pct(mirror.wind) : "calm" },
      lfo: SheetLfo(obj: -1, keys: ["wind"], shape: 1),                 // «~» со случайной формой — порывы
      reset: nil, arc: nil)
  }
}
