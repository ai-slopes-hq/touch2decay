// CoreMIDI-вход: байты реального времени (Clock, Start, Continue, Stop) из любых источников — USB, Bluetooth, сеть — в кольцо ядра.
// Bluetooth-прибор, спаренный в системе, — обычный источник; своего окна спаривания нет. Разбор часов — в ядре.
import CoreMIDI
import Foundation
import T2DCore

// Статусы ≥ 0xF8 из слов UMP типа 1 (системные сообщения). Прочие типы и статусы < 0xF8 (в т. ч. 0xF2 SPP) — мимо.
func umpRealtime(_ words: UnsafeBufferPointer<UInt32>) -> [UInt8] {
  var out: [UInt8] = []
  for w in words where w >> 28 == 0x1 {
    let status = UInt8((w >> 16) & 0xFF)
    if status >= 0xF8 { out.append(status) }
  }
  return out
}

final class Midi {
  private let feed: (Int, UInt8, UInt64) -> Void
  private var client = MIDIClientRef(), port = MIDIPortRef()
  private var connected: [MIDIEndpointRef] = []
  private var enabled = false

  init(feed: @escaping (Int, UInt8, UInt64) -> Void = { src, status, mach in _ = t2d_app_midi(Int32(src), Int32(status), mach) }) {
    self.feed = feed
  }

  var on: Bool {
    get { enabled }
    set {
      if newValue == enabled { return }
      enabled = newValue
      if newValue { start() } else { stop() }
    }
  }

  private func start() {
    let net = MIDINetworkSession.default()              // сетевой MIDI: Mac → «Настройка Audio-MIDI» → Сеть
    net.isEnabled = true
    net.connectionPolicy = .anyone
    if client == 0 {                                    // клиент создаём один раз и держим: освобождение CoreMIDI-клиента ненадёжно
      MIDIClientCreateWithBlock("t2d" as CFString, &client) { [weak self] n in
        let id = n.pointee.messageID
        guard id == .msgSetupChanged || id == .msgObjectAdded || id == .msgObjectRemoved else { return }
        DispatchQueue.main.async { self?.connectAll() }  // уведомления приходят на произвольном потоке
      }
      MIDIInputPortCreateWithProtocol(client, "in" as CFString, ._1_0, &port) { [weak self] list, refCon in
        self?.receive(list, src: max(0, Int(bitPattern: refCon) - 1))
      }
    }
    connectAll()
  }

  private func stop() {
    disconnectAll()
    MIDINetworkSession.default().isEnabled = false
  }

  private func disconnectAll() {
    for src in connected { MIDIPortDisconnectSource(port, src) }
    connected = []
  }

  // Сначала отключаем прежние подключения (Rytm пропадает с USB и возвращается — без двойных), затем подключаем текущие.
  private func connectAll() {
    guard enabled, client != 0 else { return }
    disconnectAll()
    for i in 0..<MIDIGetNumberOfSources() {
      let src = MIDIGetSource(i)
      if MIDIPortConnectSource(port, src, UnsafeMutableRawPointer(bitPattern: i % 8 + 1)) == noErr { connected.append(src) }
    }
  }

  private static let wordsOffset = MemoryLayout<MIDIEventPacket>.offset(of: \MIDIEventPacket.words)!

  private func receive(_ list: UnsafePointer<MIDIEventList>, src: Int) {
    for packet in list.unsafeSequence() {
      let n = Int(packet.pointee.wordCount)
      let mach = packet.pointee.timeStamp == 0 ? mach_absolute_time() : packet.pointee.timeStamp
      // Только wordCount слов на месте: копия кортежа words (64 слова) читала бы за концом короткого пакета в списке.
      let base = (UnsafeRawPointer(packet) + Self.wordsOffset).assumingMemoryBound(to: UInt32.self)
      for status in umpRealtime(UnsafeBufferPointer(start: base, count: min(n, 64))) { feed(src, status, mach) }
    }
  }
}
