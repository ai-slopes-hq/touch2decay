import XCTest
import AVFoundation

// решение движка по событию сессии — без запуска аудио (на железе не проверить)
final class AudioPlanTests: XCTestCase {
  private func plan(_ t: AudioTrigger, core: Double = 48000, rate: Double = 48000, running: Bool = true) -> AudioPlan {
    AudioPlan.make(t, coreRate: core, rate: rate, running: running)
  }

  func testStartInitsCoreOnce() {
    XCTAssertEqual(plan(.start, core: 0), AudioPlan(rebuild: true, reinit: true))
    XCTAssertEqual(plan(.start), AudioPlan(rebuild: true, reinit: false))
  }

  func testInterruptionAndMediaResetKeepCoreState() {
    for t in [AudioTrigger.interruptionEnded, .mediaServicesReset] {
      XCTAssertEqual(plan(t, running: false), AudioPlan(rebuild: true, reinit: false), "граф заново, ядро не трогаем")
      XCTAssertEqual(plan(t, rate: 44100), AudioPlan(rebuild: true, reinit: true), "частота сменилась — init")
    }
  }

  func testRouteChangeOnlyOnDeviceChange() {
    for r in [AVAudioSession.RouteChangeReason.categoryChange, .override, .wakeFromSleep, .routeConfigurationChange, .unknown] {
      XCTAssertEqual(plan(.route(r), rate: 44100, running: false), AudioPlan(rebuild: false, reinit: false), "\(r)")
    }
    for r in [AVAudioSession.RouteChangeReason.newDeviceAvailable, .oldDeviceUnavailable] {
      XCTAssertEqual(plan(.route(r)), AudioPlan(rebuild: false, reinit: false), "та же частота, движок идёт — ничего")
      XCTAssertEqual(plan(.route(r), running: false), AudioPlan(rebuild: true, reinit: false))
      XCTAssertEqual(plan(.route(r), rate: 44100), AudioPlan(rebuild: true, reinit: true))
    }
  }
}
