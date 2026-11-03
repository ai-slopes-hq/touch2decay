import Foundation

// плашки Portus и веер FX — дословно view.js:108-143, 362-374 (решение 13 спеки)
extension PortusView {
  private static func pct(_ v: Double) -> String { "\(Int(Horo.jsRound(v * 100)))%" }

  // луна — фильтр: «~» на cutoff — та самая медленная волна
  var lunaSpec: SheetSpec {
    let keys = ["cut", "res", "env"]
    func idx(_ k: String) -> Int { keys.firstIndex(of: k) ?? 0 }
    return SheetSpec(
      title: "luna", hint: "the moon is the filter — tap outside to close",
      rows: [SheetRow(key: "cut", label: "cutoff", code: Por.Lfo.luna0), SheetRow(key: "res", label: "resonance", code: Por.Lfo.luna0 + 1),
             SheetRow(key: "env", label: "envelope", code: Por.Lfo.luna0 + 2)],
      get: { [unowned self] k in luna(idx(k)) },
      set: { [unowned self] k, v in send(Act.luna, idx(k), [v]) },
      text: { [unowned self] k in k == "cut" ? "\(Int(Horo.jsRound(porFc(luna(0))))) Hz" : Self.pct(luna(idx(k))) },
      lfo: SheetLfo(obj: -1, keys: Set(keys), shape: 0), reset: nil, arc: nil)
  }

  // буй — эхо: feedback живёт в дальности буя (buoy.d)
  var echoSpec: SheetSpec {
    let keys = ["time", "tone", "mix", "fb"]                  // ECHO k: 0 time, 1 tone, 2 mix, 3 fb
    func idx(_ k: String) -> Int { keys.firstIndex(of: k) ?? 0 }
    func fbOf() -> Double { porFb(buoy.d) }
    return SheetSpec(
      title: "echo", hint: "the bell buoy is the delay — tap outside to close",
      rows: [SheetRow(key: "time", label: "time", code: -1), SheetRow(key: "fb", label: "feedback", code: Por.Lfo.fb),
             SheetRow(key: "tone", label: "dark", code: Por.Lfo.tone), SheetRow(key: "mix", label: "send", code: Por.Lfo.mix)],
      get: { [unowned self] k in k == "time" ? echo(0) / 4 : k == "fb" ? (buoy.d - 0.03) / 0.92 : echo(idx(k)) },
      set: { [unowned self] k, v in send(Act.echo, idx(k), [k == "time" ? Horo.jsRound(v * 4) : v]) },
      text: { [unowned self] k in
        k == "time" ? Por.dtName[min(max(0, Int(echo(0))), Por.dtName.count - 1)]
          : k == "fb" ? (fbOf() > 0.95 ? "endless" : Self.pct(fbOf())) : Self.pct(echo(idx(k)))
      },
      lfo: SheetLfo(obj: -1, keys: ["fb", "tone", "mix"], shape: 1), reset: nil, arc: nil)
  }

  // туман — ревербератор
  var fogSpec: SheetSpec {
    let keys = ["amt", "size"]
    func idx(_ k: String) -> Int { keys.firstIndex(of: k) ?? 0 }
    return SheetSpec(
      title: "nebula", hint: "the fog is the reverb — tap outside to close",
      rows: [SheetRow(key: "amt", label: "amount", code: Por.Lfo.fog0), SheetRow(key: "size", label: "size", code: Por.Lfo.fog0 + 1)],
      get: { [unowned self] k in fog(idx(k)) },
      set: { [unowned self] k, v in send(Act.fog, idx(k), [v]) },
      text: { [unowned self] k in k == "size" ? String(format: "%.1f s", 1.2 + fog(1) * 8) : Self.pct(fog(0)) },
      lfo: SheetLfo(obj: -1, keys: Set(keys), shape: 1), reset: nil, arc: nil)
  }

  // маяк: аккорд, октава, длина, свинг, громкость
  var pharosSpec: SheetSpec {
    let keys = ["chord", "oct", "len", "swing", "lvl"]
    func idx(_ k: String) -> Int { keys.firstIndex(of: k) ?? 0 }
    return SheetSpec(
      title: "pharos", hint: "the lighthouse — tap outside to close",
      rows: [SheetRow(key: "chord", label: "chord", code: -1), SheetRow(key: "oct", label: "octave", code: -1),
             SheetRow(key: "len", label: "length", code: -1), SheetRow(key: "swing", label: "swing", code: -1), SheetRow(key: "lvl", label: "level", code: -1)],
      get: { [unowned self] k in k == "chord" ? pharos(0) / 4 : k == "oct" ? (pharos(1) + 2) / 4 : pharos(idx(k)) },
      set: { [unowned self] k, v in send(Act.pharos, idx(k), [k == "chord" ? Horo.jsRound(v * 4) : k == "oct" ? Horo.jsRound(v * 4) - 2 : v]) },
      text: { [unowned self] k in
        if k == "chord" { return Por.chords[min(max(0, Int(pharos(0))), Por.chords.count - 1)] }
        if k == "oct" { let o = pharos(1); return "octave \(o > 0 ? "+" : o < 0 ? "−" : "")\(Int(abs(o)))" }
        if k == "len" { let l = pharos(2); return l > 0.9 ? "endless" : "\(Int(Horo.jsRound((0.035 + l * l * 1.8) * 1000))) ms" }
        return Self.pct(pharos(idx(k)))
      },
      lfo: nil, reset: nil, arc: nil)
  }

  // кораблик: октава (0 — как маяк) и громкость; нет кораблика — ничего не шлём
  func isleSpec(_ j: Int) -> SheetSpec {
    SheetSpec(
      title: "navicula", hint: "paper boat · its note — tap outside to close",
      rows: [SheetRow(key: "oct", label: "octave", code: -1), SheetRow(key: "lvl", label: "level", code: -1)],
      get: { [unowned self] k in k == "oct" ? (isle(j).oct + 2) / 4 : isle(j).lvl },
      set: { [unowned self] k, v in
        guard isle(j).on else { return }
        send(Act.isle, j, k == "oct" ? [0, Horo.jsRound(v * 4) - 2] : [1, v])
      },
      text: { [unowned self] k in
        let s = isle(j)
        if k == "oct" { return s.oct != 0 ? "\(s.oct > 0 ? "+" : "−")\(Int(abs(s.oct))) · \(nameOf(j))" : "as lighthouse · \(nameOf(j))" }
        return Self.pct(s.lvl)
      },
      lfo: nil, reset: nil, arc: nil, obj: j)
  }

  // веер: порядок секторов wow 180°, mare 150°, drive 130°, chance 110°, spread 90°; коды LFO — по Por.fxKeys
  var fxSpec: SheetSpec {
    let keys = ["wow", "mare", "drive", "chance", "spread"]
    func idx(_ k: String) -> Int { Por.fxKeys.firstIndex(of: k) ?? 0 }
    return SheetSpec(
      title: "aether", hint: "FX — tap outside to close",
      rows: keys.map { SheetRow(key: $0, label: $0, code: Por.Lfo.fx0 + idx($0)) },
      get: { [unowned self] k in fx(idx(k)) },
      set: { [unowned self] k, v in send(Act.fx, idx(k), [v]) },
      text: { [unowned self] k in k == "mare" && fx(1) < 0.01 ? "calm" : Self.pct(fx(idx(k))) },
      lfo: SheetLfo(obj: -1, keys: Set(keys), shape: 1), reset: nil,
      arc: { [unowned self] in fx(2) })
  }
}
