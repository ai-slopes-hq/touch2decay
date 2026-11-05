import Foundation
import QuartzCore

/// Таймер MIDI-часов на главной очереди: раз в 25 мс миры освежают зеркало,
/// события ядра (старт, стоп, темп, бит, launch) — политике MidiFollow.
/// Сетку Cymatica и мастер-темп ядро берёт само (внешний MIDI главнее мастер-сетки).
final class MidiClock {
  static let period = 0.025

  private let core: HostCore
  private let follow: MidiFollow
  private let worlds: () -> [WorldTempo]
  private var timer: DispatchSourceTimer?

  init(core: HostCore, follow: MidiFollow, worlds: @escaping () -> [WorldTempo]) {
    self.core = core; self.follow = follow; self.worlds = worlds
  }

  func step(now: Double) {
    let ws = worlds()
    for w in ws { w.refresh(now: now) }
    follow.events(core.hevents())
    follow.scan()
  }

  var on: Bool {
    get { timer != nil }
    set {
      if newValue == (timer != nil) { return }
      if newValue {
        _ = core.hevents()                                // накопленное, пока часы были выкл. (Stop, launch), не проигрываем
        let t = DispatchSource.makeTimerSource(queue: .main)
        t.schedule(deadline: .now() + Self.period, repeating: Self.period)
        t.setEventHandler { [weak self] in self?.step(now: CACurrentMediaTime()) }
        t.resume()
        timer = t
      } else {
        timer?.cancel(); timer = nil
        follow.reset()
      }
    }
  }

  deinit { timer?.cancel() }
}
