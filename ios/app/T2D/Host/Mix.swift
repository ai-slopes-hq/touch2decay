import Foundation

// микшер: фейдеры миров, mute и мастер (значения 0…1, как в вебе — host/audio.js, host/mixer.js)
struct Mix: Equatable {
  var g: [Int: Double] = [:]          // фейдер слота; нет — faderDef
  var mute: [Int: Bool] = [:]
  var lpf = 1.0, thr = 0.75, ratio = 0.136, ceil = 1.0
  static let def = Mix()
  static let faderDef = 36.0 / 42     // 0 дБ; шкала −36…+6, ниже 0.01 — выкл

  func fader(_ slot: Int) -> Double { g[slot] ?? Mix.faderDef }
  func gain(_ slot: Int) -> Double {
    let t = fader(slot)
    return mute[slot] == true || t < 0.01 ? 0 : pow(10, Mix.faderDb(t) / 20)
  }
  static func faderDb(_ t: Double) -> Double { -36 + 42 * t }
  static func faderText(_ t: Double) -> String {
    if t < 0.01 { return "off" }
    let db = faderDb(t)
    return (db > 0 ? "+" : "") + String(format: "%.0f", db)
  }

  subscript(m: MixM) -> Double {
    get {
      switch m { case .lpf: return lpf; case .thr: return thr; case .ratio: return ratio; case .ceil: return ceil }
    }
    set {
      switch m { case .lpf: lpf = newValue; case .thr: thr = newValue; case .ratio: ratio = newValue; case .ceil: ceil = newValue }
    }
  }

  // величины для ядра: Гц (выше 19000 — 22000, фильтр открыт), дБ, N : 1, дБ
  func master() -> (lpf: Double, thr: Double, ratio: Double, ceil: Double) {
    let hz = MixM.lpf.value(lpf)
    return (hz > 19000 ? 22000 : hz, MixM.thr.value(thr), MixM.ratio.value(ratio), MixM.ceil.value(ceil))
  }
}

// ключи словарей в JSON — строками ("10"), чтобы файл читался (Int-ключи JSONEncoder кладёт массивом)
extension Mix: Codable {
  private enum K: String, CodingKey { case g, mute, lpf, thr, ratio, ceil }

  init(from d: Decoder) throws {
    let c = try d.container(keyedBy: K.self)
    func ints<V>(_ m: [String: V]) -> [Int: V] { Dictionary(uniqueKeysWithValues: m.compactMap { k, v in Int(k).map { ($0, v) } }) }
    // prefs: значения вне 0…1 не доверяем — g: 2 дало бы +48 дБ в ядро
    func unit(_ v: Double) -> Double { v.isFinite ? min(max(v, 0), 1) : 0 }
    g = ints(try c.decodeIfPresent([String: Double].self, forKey: .g) ?? [:]).mapValues(unit)
    mute = ints(try c.decodeIfPresent([String: Bool].self, forKey: .mute) ?? [:])
    lpf = unit(try c.decodeIfPresent(Double.self, forKey: .lpf) ?? 1)
    thr = unit(try c.decodeIfPresent(Double.self, forKey: .thr) ?? 0.75)
    ratio = unit(try c.decodeIfPresent(Double.self, forKey: .ratio) ?? 0.136)
    ceil = unit(try c.decodeIfPresent(Double.self, forKey: .ceil) ?? 1)
  }

  func encode(to e: Encoder) throws {
    var c = e.container(keyedBy: K.self)
    try c.encode(Dictionary(uniqueKeysWithValues: g.map { (String($0.key), $0.value) }), forKey: .g)
    try c.encode(Dictionary(uniqueKeysWithValues: mute.map { (String($0.key), $0.value) }), forKey: .mute)
    try c.encode(lpf, forKey: .lpf); try c.encode(thr, forKey: .thr)
    try c.encode(ratio, forKey: .ratio); try c.encode(ceil, forKey: .ceil)
  }
}

// строки мастера: подпись, значение по умолчанию, величина и текст по положению 0…1
enum MixM: CaseIterable {
  case lpf, thr, ratio, ceil
  var label: String {
    switch self { case .lpf: return "low-pass"; case .thr: return "compressor"; case .ratio: return "ratio"; case .ceil: return "ceiling" }
  }
  var def: Double { switch self { case .lpf: return Mix.def.lpf; case .thr: return Mix.def.thr; case .ratio: return Mix.def.ratio; case .ceil: return Mix.def.ceil } }
  // Гц / дБ / N / дБ
  func value(_ t: Double) -> Double {
    switch self { case .lpf: return 200 * pow(100, t); case .thr: return -40 + 40 * t; case .ratio: return 1 + 11 * t; case .ceil: return -12 + 12 * t }
  }
  func text(_ t: Double) -> String {
    switch self {
    case .lpf: return t > 0.99 ? "open" : "\(Int(value(t).rounded())) Hz"
    case .thr: return "\(Int(value(t).rounded())) dB"
    case .ratio: return String(format: "%.1f : 1", value(t))
    case .ceil: return String(format: "%.1f dB", value(t))
    }
  }
}

// связь с внешними часами и ладом (в настройках; UI — позже)
struct Link: Codable, Equatable { var clock = false; var scale = true }
// настройки звука: stable — буфер 1024 вместо 256
struct AudioPref: Codable, Equatable { var stable = false }
