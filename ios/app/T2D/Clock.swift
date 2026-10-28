import Foundation

// такты mach в секунде: один источник для Audio (t2d_app_init) и AppCore (метка касания) — иначе задержка считается мимо
enum Clock {
  static let ticksPerSec: Double = {
    var tb = mach_timebase_info_data_t(); mach_timebase_info(&tb)
    return 1e9 * Double(tb.denom) / Double(tb.numer)
  }()
}
