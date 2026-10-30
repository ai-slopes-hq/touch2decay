import Foundation

// маятник Horologium — касание и картинка (model.js:57-90): где груз, энергия броска, проход через низ, качание по скорости хода.
// В ядро уходят итоги (Out): «в руке», пуск / стоп и u, спуск на 1/Z оборота. Без Core и UIKit.
struct HoroPendulum {
  var th = 0.0, ph = 0.0, spin = false, held = false
  private(set) var handSteps = 0

  enum Out: Equatable { case held(Bool), step(Double), run(Double), stop }   // run(u) → RUN [1, u]; stop → RUN [0, u зеркала]

  private static let tau = 2 * Double.pi
  private static func sign(_ x: Double) -> Double { x > 0 ? 1 : (x < 0 ? -1 : 0) }

  // фаза под ход: качание продолжается с того места, где груз (model.js:57)
  mutating func start(u: Double) {
    let A = acos(1 - min(1.9, Horo.eOfU(u)))
    ph = asin(Horo.clamp(th / A, -1, 1))
  }

  mutating func grab(_ th: Double) -> [Out] {            // схватил маятник — колесо стоит
    held = true; spin = false; self.th = th
    return [.held(true)]
  }

  // ведёшь маятник: каждый проход через низ — спуск, колесо на 1/Z оборота
  mutating func swing(from prev: Double, to th: Double) -> [Out] {
    var out: [Out] = []
    if Self.sign(th) != Self.sign(prev), abs(th) < .pi / 2, abs(prev) < .pi / 2 { out.append(.step(1 / Horo.z)); handSteps += 1 }
    self.th = th
    return out
  }

  mutating func tap(running: Bool, uT: Double) -> [Out] {   // тап — пуск / стоп
    held = false
    if running { return [.held(false), .stop] }
    start(u: uT)
    return [.held(false), .run(uT)]
  }

  // отпустил: энергия броска → скорость хода
  mutating func release(th: Double, om: Double) -> [Out] {
    let e = pow(om / Horo.om0, 2) / 2 + (1 - cos(th))
    held = false
    if e < Horo.et / 6 || (abs(om) < 0.3 && abs(th) < 0.45) { return [.held(false), .stop] }   // поймал и отпустил у низа — стоп
    spin = e >= 1.95
    if !spin {
      let A = acos(1 - e), a = asin(Horo.clamp(th / A, -1, 1))
      ph = om >= 0 ? a : .pi - a
    }
    return [.held(false), .run(Horo.uOfE(e))]
  }

  // только картинка: ход (u) успокаивает ядро; F — скорость колеса сейчас
  mutating func tick(dt: Double, run: Bool, u: Double, F: Double) {
    if run && !held {
      let e = Horo.eOfU(u)
      if e < 1.95 {
        let A = acos(1 - e)
        if spin { spin = false; ph = asin(Horo.clamp(sin(th) / A, -1, 1)) }
        ph += Self.tau * (Horo.z * F / 2) * dt; th = A * sin(ph)
      } else {
        spin = true
        let x = th + Self.tau * Horo.z * F * dt / 2 + .pi
        th = (x.truncatingRemainder(dividingBy: Self.tau) + Self.tau).truncatingRemainder(dividingBy: Self.tau) - .pi
      }
    } else if !held { th *= exp(-dt * 3) }   // стоит — повисает отвесно
  }
}
