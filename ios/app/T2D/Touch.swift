import Foundation
import T2DCore

// константы касаний — как host/touch.js (мс и пиксели)
enum Touch {
  static let tapMs = 220.0, tapMove: CGFloat = 14, dtapMs = 320.0, holdMs = 420.0, holdMove: CGFloat = 10
  static let cornerPt: CGFloat = 44                     // правый нижний угол: касание миру не идёт (его ловит Stage)
}

// путь действий в ядро: живой — t2d_app_action, тестовый — запись
protocol Core {
  @discardableResult func action(_ kind: Int, _ i: Int, _ a: [Double], touchTime: Double) -> Bool   // false — действие отброшено (кольцо полно)
}

// живое ядро: слот мира, метка касания (UITouch.timestamp, сек) → такты mach
struct AppCore: Core {
  let slot: Int
  func action(_ kind: Int, _ i: Int, _ a: [Double], touchTime: Double) -> Bool {
    let t = touchTime > 0 ? UInt64(touchTime * Clock.ticksPerSec) : 0
    var buf = a
    return t2d_app_action(Int32(slot), Int32(kind), Int32(i), &buf, Int32(a.count), t) != 0
  }
}
