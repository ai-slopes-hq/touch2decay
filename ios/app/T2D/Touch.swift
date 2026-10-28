import Foundation
import T2DCore

// константы касаний — как host/touch.js (мс и пиксели)
enum Touch {
  static let tapMs = 220.0, tapMove: CGFloat = 14, dtapMs = 320.0, holdMs = 420.0, holdMove: CGFloat = 10
  static let cornerPt: CGFloat = 44                     // правый нижний угол: касание миру не идёт (его ловит Stage)
}

// путь действий в ядро: живой — t2d_app_action, тестовый — запись
protocol Core {
  func action(_ kind: Int, _ i: Int, _ a: [Double], touchTime: Double)
}

// живое ядро: слот мира, метка касания (UITouch.timestamp, сек) → такты mach
struct AppCore: Core {
  let slot: Int
  private static let ticksPerSec: Double = {
    var tb = mach_timebase_info_data_t(); mach_timebase_info(&tb)
    return 1e9 * Double(tb.denom) / Double(tb.numer)
  }()
  func action(_ kind: Int, _ i: Int, _ a: [Double], touchTime: Double) {
    let t = touchTime > 0 ? UInt64(touchTime * AppCore.ticksPerSec) : 0
    var buf = a
    _ = t2d_app_action(Int32(slot), Int32(kind), Int32(i), &buf, Int32(a.count), t)
  }
}
