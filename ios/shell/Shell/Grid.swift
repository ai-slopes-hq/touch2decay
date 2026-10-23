// ПРОБА: сетка ведущих часов — чистая функция (тест: ios/shell/grid-test.sh). Страница сказала «шаг такта в такой-то момент»:
// какой тик это по сетке оболочки. Номер берём ближайший к тому, что сетка и так ждёт, с той же фазой в такте —
// звук страницы вставал (iOS прервал его на 8 с), оболочка шла дальше: иначе она ждала бы, пока страница догонит, и молчала.
enum Grid {
  static let perBar = 96                                // 24 тика на долю × 4

  // expected — какой тик по сетке оболочки приходится на этот момент (дробный); phase — тик шага от пуска страницы
  static func anchor(expected: Double, phase: Int) -> Int {
    let p = ((phase % perBar) + perBar) % perBar
    let bar = ((expected - Double(p)) / Double(perBar)).rounded()
    return Int(bar) * perBar + p
  }
}
