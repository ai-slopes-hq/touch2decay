import Foundation

/// Политика MIDI-часов: кто стартует, останавливается и меняет темп по событиям ядра.
/// Порт `createMidi` из host/midi.js (l.25–99). Сетка и разбор байтов — в ядре.
final class MidiFollow {
  static let tempoEps = 0.3                                   // порог перестройки темпа миров, BPM

  private let worlds: () -> [WorldTempo]
  private let here: () -> WorldTempo?
  private var stopped = Set<ObjectIdentifier>()               // миры, игравшие в момент прошлого Stop
  private var joined = Set<ObjectIdentifier>()                // запускали руками в этой сессии
  private var was = [ObjectIdentifier: Bool]()                // последнее состояние, которое знает служба

  init(worlds: @escaping () -> [WorldTempo], here: @escaping () -> WorldTempo?) {
    self.worlds = worlds
    self.here = here
  }

  /// События ядра: по 2 числа — код (1 START, 2 STOP, 3 TEMPO, 4 BEAT, 5 LAUNCH), bpm.
  func events(_ ev: [Double]) {
    var i = 0
    while i + 1 < ev.count {
      let code = Int(ev[i]), bpm = ev[i + 1]
      i += 2
      switch code {
      case 2: stop()
      case 3, 4: setTempo(bpm)
      case 5: launch()
      default: break                                          // start: ждём первый бит (launch)
      }
    }
  }

  /// Мир пошёл не от службы — его запустили руками.
  func scan() {
    for w in worlds() {
      let id = ObjectIdentifier(w), on = w.playing
      if on && was[id] != true { joined.insert(id) }
      was[id] = on
    }
  }

  /// MIDI-clock выключен: забыть остановленные Stop.
  func reset() { stopped = [] }

  private func play(_ w: WorldTempo, _ on: Bool) {           // пуск службой — не «руками»
    w.play(on)
    was[ObjectIdentifier(w)] = on
  }

  private func setTempo(_ bpm: Double) {
    guard bpm > 0 else { return }                             // темп ещё не известен
    let b = (bpm * 10).rounded() / 10
    for w in worlds() where !(abs(b - w.bpm) <= Self.tempoEps) { w.setBpm(b) }
  }

  private func stop() {
    scan()
    var on = Set<ObjectIdentifier>()                          // повторный пустой Stop прежний набор не затирает
    for w in worlds() where w.playing {
      on.insert(ObjectIdentifier(w))
      play(w, false)
    }
    if !on.isEmpty { stopped = on }
  }

  private func launch() {
    scan()
    let cur = here().map(ObjectIdentifier.init)
    for w in worlds() {
      let id = ObjectIdentifier(w), playing = w.playing
      guard joined.contains(id) || playing || stopped.contains(id) || (id == cur && w.armed) else { continue }
      if playing { play(w, false) }
      play(w, true)
    }
    stopped = []
  }
}
