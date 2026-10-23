// ПРОБА: ведущий MIDI — часы наружу во все выходы CoreMIDI (USB, сетевая сессия). Страница (Portus) говорит, какой шаг, темп и когда его услышат
// (epoch, мс): на пуске, первом шаге такта, смене темпа, стопе. Тики (24 на долю) расписывает свой поток на 100 мс вперёд с отметками времени CoreMIDI —
// ровно, мимо моста WebView и в фоне.
import CoreMIDI
import Foundation

final class ClockOut {
  private let q = DispatchQueue(label: "clock-out", qos: .userInteractive)
  private var timer: DispatchSourceTimer?
  private var port = MIDIPortRef()
  private var running = false
  private var base = 0                                  // шаг страницы на пуске — тик 0
  private var anchorTick = 0, anchorTime: UInt64 = 0    // тик anchorTick звучит в anchorTime (mach)
  private var period = 60.0 / 120 / 24                  // секунд на тик
  private var next = 0, lastSent: UInt64 = 0            // следующий тик к отправке, время последнего отправленного
  private var msgs = 0, last = "—", sent = 0             // для плашки: сообщений от страницы, последнее, тиков ушло
  var report: ((String) -> Void)?                       // плашке (на главный поток): раз в сообщение и раз в долю

  init(client: MIDIClientRef) {
    MIDIOutputPortCreate(client, "out" as CFString, &port)
    let t = DispatchSource.makeTimerSource(flags: .strict, queue: q)
    t.schedule(deadline: .now(), repeating: .milliseconds(10), leeway: .milliseconds(1))
    t.setEventHandler { [weak self] in self?.fill() }
    t.resume(); timer = t
  }

  // из страницы: t — start / at / stop, step — номер шестнадцатой, at — когда её услышат (epoch, мс)
  func message(_ t: String, step: Int, bpm: Double, at: Double) {
    let when = Midi.mach(epochMs: at)
    q.async { [self] in
      msgs += 1; last = t; show()
      let ahead = Double(Int64(bitPattern: when &- mach_absolute_time())) * Midi.seconds(1) * 1000
      Log.shared.add("clock", String(format: "%@ step %d bpm %.1f ahead %.0f ms running %d next %d", t, step, bpm, ahead, running ? 1 : 0, next))
      switch t {
      case "start": begin(step, bpm, when)
      case "at":
        guard running else { if step % 16 == 0 { begin(step, bpm, when) }; return }   // lead включили посреди игры — пуск с такта
        let expected = Double(anchorTick) + Double(Int64(bitPattern: when &- anchorTime)) * Midi.seconds(1) / period   // этот момент по нашей сетке
        let k = Grid.anchor(expected: expected, phase: (step - base) * 6)
        if abs(Double(k) - expected) > 3 { Log.shared.add("clock", String(format: "re-anchor %.1f → %d", expected, k)) }
        period = 60 / bpm / 24; anchorTick = k; anchorTime = when
      case "stop": halt(when)
      default: break
      }
    }
  }
  func off() { q.async { [self] in if running { halt(mach_absolute_time()) } } }

  private func begin(_ step: Int, _ bpm: Double, _ when: UInt64) {
    running = true; base = step; period = 60 / bpm / 24
    anchorTick = 0; anchorTime = when; next = 0
    lastSent = when &- Midi.ticks(0.001)
    send(0xFA, at: lastSent)                            // Start за миллисекунду до первого тика: первый тик после Start — доля
  }
  private func halt(_ when: UInt64) {
    running = false
    MIDIFlushOutput(0)                                  // тики, расписанные дальше стопа, — не нужны
    send(0xFC, at: max(when, mach_absolute_time()))
  }

  private func time(_ k: Int) -> UInt64 {
    let d = Double(k - anchorTick) * period
    return d >= 0 ? anchorTime &+ Midi.ticks(d) : anchorTime &- Midi.ticks(-d)
  }
  private var lastFill: UInt64 = 0
  private func fill() {
    let now = mach_absolute_time()
    if lastFill > 0, Midi.seconds(now &- lastFill) > 0.04 { Log.shared.add("clock", String(format: "fill late %.0f ms", Midi.seconds(now &- lastFill) * 1000)) }
    lastFill = now
    guard running else { return }
    let horizon = mach_absolute_time() &+ Midi.ticks(0.1)
    while true {
      var t = time(next)
      if t > horizon { break }
      if t <= lastSent { t = lastSent &+ Midi.ticks(0.001) }   // сетку подвинули назад — тики не повторяем и не путаем порядок
      send(0xF8, at: t); lastSent = t; next += 1; sent += 1
      if sent % 24 == 0 { show() }
    }
  }
  private func show() {
    let s = "page \(msgs) · \(last) · ticks \(sent) · outs \(MIDIGetNumberOfDestinations())\(running ? " · running" : "")"
    DispatchQueue.main.async { self.report?(s) }
  }

  private func send(_ status: UInt8, at t: UInt64) {
    var list = MIDIEventList()
    let pkt = MIDIEventListInit(&list, ._1_0)
    var w: UInt32 = 0x1000_0000 | UInt32(status) << 16  // UMP: системное сообщение реального времени, группа 0
    _ = MIDIEventListAdd(&list, MemoryLayout<MIDIEventList>.size, pkt, t, 1, &w)
    for i in 0..<MIDIGetNumberOfDestinations() { MIDISendEventList(port, MIDIGetDestination(i), &list) }
  }
}
