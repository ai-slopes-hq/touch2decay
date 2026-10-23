// ПРОБА: MIDI в оболочке — любые источники CoreMIDI (USB, сетевая сессия с Mac). Часы 0xF8 (24 на долю) → BPM, start / continue / stop.
import CoreMIDI
import Foundation

final class Midi: ObservableObject {
  @Published var sources: [String] = []
  @Published var bpm: Double = 0
  @Published var running = false
  @Published var clocks = 0
  @Published var last = "—"

  private var client = MIDIClientRef(), port = MIDIPortRef()
  private var ticks: [UInt64] = []                      // время последних тиков часов (mach): 4 доли — BPM без дрожи
  private var count = 0                                 // тиков с start: каждый 24-й — доля
  private var run = false                               // между start/continue и stop; Elektron шлёт часы и на стопе
  private var total = 0                                 // тиков всего — для плашки
  var send: ((String) -> Void)?                         // в страницу: window.t2dMidi({...})

  init() {
    let net = MIDINetworkSession.default()              // сетевой MIDI: Mac → «Настройка Audio-MIDI» → Сеть
    net.isEnabled = true
    net.connectionPolicy = .anyone
    MIDIClientCreateWithBlock("shell" as CFString, &client) { [weak self] _ in DispatchQueue.main.async { self?.connectAll() } }
    MIDIInputPortCreateWithProtocol(client, "in" as CFString, ._1_0, &port) { [weak self] list, _ in self?.receive(list) }
    connectAll()
  }

  private func connectAll() {
    var names: [String] = []
    for i in 0..<MIDIGetNumberOfSources() {
      let src = MIDIGetSource(i)
      MIDIPortConnectSource(port, src, nil)
      var name: Unmanaged<CFString>?
      MIDIObjectGetStringProperty(src, kMIDIPropertyDisplayName, &name)
      names.append((name?.takeRetainedValue() as String?) ?? "?")
    }
    sources = names
  }

  private func receive(_ list: UnsafePointer<MIDIEventList>) {
    for packet in list.unsafeSequence() {
      let n = Int(packet.pointee.wordCount)
      let words = withUnsafeBytes(of: packet.pointee.words) { Array($0.bindMemory(to: UInt32.self).prefix(n)) }
      for w in words where w >> 28 == 0x1 {                // UMP: системные сообщения реального времени
        let status = UInt8((w >> 16) & 0xFF)
        handle(status, at: packet.pointee.timeStamp == 0 ? mach_absolute_time() : packet.pointee.timeStamp)
      }
    }
  }

  private func handle(_ status: UInt8, at t: UInt64) {
    switch status {
    case 0xF8:                                          // 24 на долю: на поток страницы и плашки — только раз в долю, иначе главный поток захлёбывается
      if let p = ticks.last, Midi.seconds(t &- p) > 0.5 { ticks = [] }   // часы прерывались (Ableton на стопе молчит) — темп заново
      ticks.append(t); if ticks.count > 97 { ticks.removeFirst(ticks.count - 97) }
      let n = ticks.count - 1, b = n >= 24 ? 60 * Double(n) / 24 / Midi.seconds(ticks[n] - ticks[0]) : 0
      total += 1
      if count % 24 == 0 {
        emit(run ? "{t:'beat',n:\(count / 24),bpm:\(b),ago:%AGO%}" : "{t:'tempo',bpm:\(b)}", at: t)
        let k = total; DispatchQueue.main.async { self.clocks = k; if b > 0 { self.bpm = b } }
      }
      count += 1
    case 0xFA, 0xFB:
      run = true; if status == 0xFA { count = 0 }
      emit("{t:'start',ago:%AGO%}", at: t)
      DispatchQueue.main.async { self.running = true; self.last = status == 0xFA ? "start" : "continue" }
    case 0xFC:
      run = false
      emit("{t:'stop',ago:%AGO%}", at: t)
      DispatchQueue.main.async { self.running = false; self.last = "stop" }
    default: break
    }
  }

  private func emit(_ js: String, at t: UInt64) {        // ago — сколько секунд назад было событие, считается на главном потоке перед отправкой
    DispatchQueue.main.async {
      let now = mach_absolute_time()
      let ago = now >= t ? Midi.seconds(now - t) : -Midi.seconds(t - now)
      self.send?("window.t2dMidi && t2dMidi(" + js.replacingOccurrences(of: "%AGO%", with: String(ago)) + ")")
    }
  }

  private static let tb: mach_timebase_info_data_t = { var t = mach_timebase_info_data_t(); mach_timebase_info(&t); return t }()
  static func seconds(_ ticks: UInt64) -> Double { Double(ticks) * Double(tb.numer) / Double(tb.denom) / 1e9 }
}
