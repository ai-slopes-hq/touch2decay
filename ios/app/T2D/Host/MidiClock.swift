import Foundation
import QuartzCore

/// Таймер MIDI-часов на главной очереди: раз в 25 мс миры освежают зеркало, сетка ядра идёт мирам,
/// события ядра (старт, стоп, темп, бит, launch) — политике MidiFollow.
/// Порядок шага важен: сетка раньше событий — Cymatica должна получить LOCK до launch (веб: `model.onAct(syncLock)`).
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
    let g = core.grid()
    for w in ws { w.grid(g) }
    follow.events(core.hevents())
    follow.scan()
  }

  /// После re-init ядра: LOCK в ядре стёрт, а адаптер помнит отправленное — следующий шаг пошлёт сетку заново.
  func forgetGrid() { for w in worlds() { w.grid(nil) } }

  var on: Bool {
    get { timer != nil }
    set {
      if newValue == (timer != nil) { return }
      if newValue {
        let t = DispatchSource.makeTimerSource(queue: .main)
        t.schedule(deadline: .now() + Self.period, repeating: Self.period)
        t.setEventHandler { [weak self] in self?.step(now: CACurrentMediaTime()) }
        t.resume()
        timer = t
      } else {
        timer?.cancel(); timer = nil
        forgetGrid()
        follow.reset()
      }
    }
  }

  deinit { timer?.cancel() }
}
