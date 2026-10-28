import UIKit

// палец: x, y — сейчас, x0, y0 — где лёг; t0 — когда лёг, touchTime — метка текущего события (UITouch.timestamp, сек)
struct Finger {
  var id: ObjectIdentifier
  var x, y, x0, y0: CGFloat
  var t0: Double
  var moved: Bool
  var touchTime: Double
}

// мир: слот ядра, тема, шаг, рисование и касания (как интерфейс мира в host/)
protocol World: AnyObject {
  var slot: Int { get }
  var theme: Theme { get }
  func tick(now: Double, dt: Double)
  func draw(_ d: Draw, now: Double)
  func down(_ f: Finger)
  func move(_ f: Finger)
  func up(_ f: Finger)
  func cancel(_ f: Finger)                               // система отняла касание: бросить палец без действий тапа и удержания
}
