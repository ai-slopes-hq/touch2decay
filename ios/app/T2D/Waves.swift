import Foundation

// таблицы волн Tenebrae — порт host/waves.js: девять циклов (как у аналоговых генераторов), морфинг между соседями;
// их берут звук (в ядре свои копии), рисование форм и фаза LFO строк
enum Waves {
  static let labels = ["triangle", "sharp", "saw", "pulse", "fold", "sync", "crush", "metal", "grain"]
  static let count = 9
  static let n = 1024

  private static func clamp(_ x: Double) -> Double { x.isNaN ? 0 : min(1, max(0, x)) }

  // застывший кусок шума: LCG 16807, зерно 11, 40 точек
  private static let grain: [Double] = {
    var s = 11
    return (0..<40).map { _ in
      s = (s * 16807) % 2147483647
      return tanh(3 * (Double(s) / 2147483647 * 2 - 1))
    }
  }()

  private static func tri(_ t: Double) -> Double {
    1 - 4 * abs((((t + 0.25).truncatingRemainder(dividingBy: 1)) + 1).truncatingRemainder(dividingBy: 1) - 0.5)
  }

  // цикл волны i в точке t 0…1 (до нормировки)
  private static let fns: [(Double) -> Double] = [
    { t in let x = tri(t); return x + 0.1 * x * x },
    { t in tanh(2.6 * tri(t) + 0.35) },
    { t in let k = 1.4; return (2 * (1 - exp(-k * t))) / (1 - exp(-k)) - 1 },
    { t in tanh(9 * (sin(2 * Double.pi * t) - 0.35)) },
    { t in sin(2.8 * sin(2 * Double.pi * t) + 0.4) },
    { t in (2 * ((t * 2.63).truncatingRemainder(dividingBy: 1)) - 1) * (1 - 0.35 * t) },
    { t in Horo.jsRound(sin(2 * Double.pi * (floor(t * 8) + 0.5) / 8) * 2.5) / 2.5 },
    { t in sin(2 * Double.pi * t + 2.2 * sin(2 * Double.pi * 7 * t)) },
    { t in
      let x = t * Double(grain.count), fl = floor(x), i = Int(fl) % grain.count, fr = x - fl
      return grain[i] + (grain[(i + 1) % grain.count] - grain[i]) * fr
    },
  ]

  // нормированные циклы (минус среднее, деление на пик); Float32, как Float32Array веба — те же шаги округления
  static let samp: [[Float]] = fns.map { fn in
    var s = (0..<n).map { Float(fn(Double($0) / Double(n))) }
    var mean = 0.0, peak = 0.0
    for v in s { mean += Double(v) / Double(n) }
    for i in 0..<n { s[i] = Float(Double(s[i]) - mean); peak = max(peak, abs(Double(s[i]))) }
    for i in 0..<n { s[i] = Float(Double(s[i]) / peak) }
    return s
  }

  // вес таблицы i при позиции морфинга p: треугольный, соседние перетекают
  static func weight(_ i: Int, _ p: Double) -> Double { max(0, 1 - abs(clamp(p) * Double(count - 1) - Double(i))) }

  // форма в точке t при позиции p (= morphFn(p)(t) веба): для рисования и фазы LFO
  static func morph(_ p: Double, _ t: Double) -> Double {
    guard t.isFinite else { return 0 }
    let idx = Int(floor(((t.truncatingRemainder(dividingBy: 1)) + 1).truncatingRemainder(dividingBy: 1) * Double(n))) % n
    var y = 0.0
    for i in 0..<count { let k = weight(i, p); if k != 0 { y += k * Double(samp[i][idx]) } }
    return y
  }

  static func morphName(_ p: Double) -> String {
    let x = clamp(p) * Double(count - 1), i = min(count - 2, Int(floor(x))), fr = x - Double(i)
    if fr < 0.08 { return labels[i] }
    if fr > 0.92 { return labels[i + 1] }
    return "\(labels[i]) → \(labels[i + 1])"
  }
}
