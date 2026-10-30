import Foundation

// плашки Oceanus: веер FX, Луна и город (view.js:88-105, :250-258); LFO только у веера
extension OceanusView {
  // порядок ядра: TENSION 0, DAMPING 1, WIND 2, TIDE 3, HALL 4; на веере — tension, damping, tide, wind, hall
  static let fxKeys = ["tension", "damping", "tide", "wind", "hall"]
  static let coreFx = ["tension": 0, "damping": 1, "wind": 2, "tide": 3, "hall": 4]
  static let swayTo = ["tension", "pitch", "damping"]
  static let paths = ["orbis", "retro", "pendulum"]        // путь скана: по кругу, против, туда-обратно

  var fxSpec: SheetSpec {
    let keys = OceanusView.fxKeys, idx = OceanusView.coreFx
    return SheetSpec(
      title: "oceanus", hint: "FX — tap outside to close",
      rows: keys.map { SheetRow(key: $0, label: $0, code: 4 + (idx[$0] ?? 0)) },   // код LFO — по индексу FX ядра, не по порядку на веере
      get: { [unowned self] k in mirror.fx[idx[k] ?? 0] },
      set: { [unowned self] k, v in core.action(4, idx[k] ?? 0, [v], touchTime: 0) },
      text: { [unowned self] k in "\(Int((mirror.fx[idx[k] ?? 0] * 100).rounded()))%" },
      lfo: SheetLfo(obj: -1, keys: Set(keys), shape: 0),
      reset: nil,
      arc: { [unowned self] in mirror.fx[4] })
  }

  func lunaSpec() -> SheetSpec {
    let keys = ["orbit", "storm", "pull", "sway", "to"], labels = ["orbit": "orbit", "storm": "shape", "pull": "pull", "sway": "sway", "to": "sway to"]
    let lk = ["orbit": 0, "storm": 1, "sway": 2, "to": 3]
    return SheetSpec(
      title: "luna", hint: "the moon — tap outside to close",
      rows: keys.map { SheetRow(key: $0, label: labels[$0] ?? $0, code: 0) },
      get: { [unowned self] k in
        let m = mirror
        return k == "pull" ? m.fx[3] : k == "to" ? (m.luna[3] + 0.5) / 3 : m.luna[lk[k] ?? 0]
      },
      set: { [unowned self] k, v in
        if k == "pull" { core.action(4, 3, [v], touchTime: 0) }                          // pull — это TIDE
        else if k == "storm" { core.action(5, 1, [v >= 0.5 ? 1 : 0], touchTime: 0) }
        else if k == "to" { core.action(5, 3, [Double(min(2, Int((v * 3).rounded(.down))))], touchTime: 0) }
        else { core.action(5, lk[k] ?? 0, [v], touchTime: 0) }
      },
      text: { [unowned self] k in
        let m = mirror
        switch k {
        case "orbit": return "\(Int((1 / (0.005 * pow(40, m.luna[0]))).rounded())) s"
        case "storm": return m.luna[1] >= 0.5 ? "storm" : "sine"
        case "to": return OceanusView.swayTo[min(2, max(0, Int(m.luna[3])))]
        case "sway" where m.luna[2] < 0.01: return "off"
        default: return "\(Int(((k == "pull" ? m.fx[3] : m.luna[lk[k] ?? 0]) * 100).rounded()))%"
        }
      },
      lfo: nil, reset: nil, arc: nil)
  }

  func citySpec(_ id: Int) -> SheetSpec {
    let skey = ["lvl": 0, "oct": 1, "path": 2]
    func city() -> City? { mirror.cities.first { $0.id == id } }
    return SheetSpec(
      title: "civitas", hint: "city — tap outside to close",
      rows: [SheetRow(key: "lvl", label: "level", code: 0), SheetRow(key: "oct", label: "octave", code: 0), SheetRow(key: "path", label: "path", code: 0)],
      get: { [unowned self] k in
        guard let c = city() else { return 0 }
        return k == "oct" ? (c.oct + 1) / 2 : k == "path" ? c.path / 2 : c.lvl
      },
      set: { [unowned self] k, x in
        guard city() != nil else { return }                 // города нет (кубик, корзина, откат) — чужому id не пишем
        let v = k == "oct" ? (x * 2).rounded() - 1 : k == "path" ? (x * 2).rounded() : x
        edit(id) { c in if k == "oct" { c.oct = v } else if k == "path" { c.path = v } else { c.lvl = v } }
        core.action(3, id, [Double(skey[k] ?? 0), v], touchTime: 0)
      },
      text: { [unowned self] k in
        guard let c = city() else { return "" }
        return k == "oct" ? ["octave −1", "octave 0", "octave +1"][min(2, max(0, Int(c.oct) + 1))]
          : k == "path" ? OceanusView.paths[min(2, max(0, Int(c.path)))] : "\(Int((c.lvl * 100).rounded()))%"
      },
      lfo: nil, reset: nil, arc: nil)
  }
}
