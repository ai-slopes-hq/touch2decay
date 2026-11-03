import Foundation

// веер FX и плашка луны — view.js:351-357 и плашка дрейфа
extension CymaticaView {
  private static func pct(_ v: Double) -> String { "\(Int(Horo.jsRound(v * 100)))%" }

  // веер «aether»: порядок лучей — как в виде; индекс действия — по FX_KEYS ядра (time 5, chance 6)
  var fanSpec: SheetSpec {
    let order = ["structure", "damping", "brightness", "hall", "echo", "chance", "time"]
    func idx(_ k: String) -> Int { Cym.fxKeys.firstIndex(of: k) ?? 0 }
    return SheetSpec(
      title: "aether", hint: "FX — tap outside to close",
      rows: order.map { SheetRow(key: $0, label: $0, code: -1) },
      get: { [unowned self] k in fx(idx(k)) },
      set: { [unowned self] k, v in send(Cym.Act.setFx, idx(k), [v]) },
      text: { [unowned self] k in
        let v = fx(idx(k))
        switch k {
        case "structure": return Cym.structs[min(Cym.structs.count - 1, max(0, Int(Horo.jsRound(v * Double(Cym.structs.count - 1)))))]
        case "time": return Cym.echoDiv(v).0
        case "damping":
          let s = 0.08 * pow(150, v)
          return String(format: s < 10 ? "%.1f s" : "%.0f s", s)
        default: return Self.pct(v)
        }
      },
      lfo: nil, reset: nil, arc: { [unowned self] in fx(3) })
  }

  // луна — дрейф пластины: глубина, скорость, форма
  var driftSpec: SheetSpec {
    func idx(_ k: String) -> Int { Cym.driftKeys.firstIndex(of: k) ?? 0 }
    func field(_ d: (on: Bool, depth: Double, rate: Double, shape: Double, k: Int), _ k: String) -> Double {
      k == "depth" ? d.depth : k == "rate" ? d.rate : d.shape
    }
    return SheetSpec(
      title: "luna", hint: "plate drift — tap outside to close",
      rows: Cym.driftKeys.map { SheetRow(key: $0, label: $0, code: -1) },
      get: { [unowned self] k in field(drift, k) },
      set: { [unowned self] k, v in send(Cym.Act.driftSet, idx(k), [v]) },
      text: { [unowned self] k in
        let d = drift
        switch k {
        case "depth": return "±\(Cym.driftDepth(d.depth)) steps"
        case "rate": return Cym.driftRate(d.rate).0
        default: return d.shape < 0.5 ? "sine" : "random"
        }
      },
      lfo: nil, reset: nil, arc: nil)
  }
}
