// Звук: AVAudioEngine + AVAudioSourceNode, блок рендера вызывает t2d_app_render (ядро). Сессия .playback, буфер ~256 кадров.
// t2d_app_init не потокобезопасен против render: любой повторный init — только при остановленном движке (reset()).
import AVFoundation
import UIKit
import T2DCore

// что делать движку по событию сессии: пересобрать граф и/или переинициализировать ядро (init стирает состояние всех миров —
// только при смене частоты). Чистая функция — решение проверяется тестом без железа.
enum AudioTrigger { case start, user, interruptionEnded, mediaServicesReset, engineConfigChange, becameActive, route(AVAudioSession.RouteChangeReason) }
struct AudioPlan: Equatable {
  var rebuild: Bool, reinit: Bool
  static func make(_ t: AudioTrigger, coreRate: Double, rate: Double, running: Bool) -> AudioPlan {
    let changed = rate != coreRate
    switch t {
    case .start, .user, .interruptionEnded, .mediaServicesReset, .engineConfigChange:   // движок остановлен системой или пропал — граф собираем заново
      return AudioPlan(rebuild: true, reinit: changed)
    case .becameActive:                                      // из фона сессию не активировать ('!int') — без рендера стоят и звук, и картинка
      return AudioPlan(rebuild: !running, reinit: changed && !running)
    case .route(let why):                                    // категория, override, wake и прочее — не смена устройства
      guard why == .newDeviceAvailable || why == .oldDeviceUnavailable else { return AudioPlan(rebuild: false, reinit: false) }
      return AudioPlan(rebuild: changed || !running, reinit: changed)
    }
  }
}

final class Audio {
  private let log: Log
  private let session = AVAudioSession.sharedInstance()
  private var engine: AVAudioEngine?
  private var started = false
  // stable audio: буфер 1024 вместо 256 кадров (USB-интерфейсы). До start() — просто значение; после — новый буфер и перезапуск звука
  var stable = false {
    didSet {
      guard started, stable != oldValue else { return }
      applyBuffer(); handle(.user, "stable \(stable)")
    }
  }
  private func applyBuffer() {
    do { try session.setPreferredIOBufferDuration((stable ? 1024.0 : 256.0) / 48000.0) }
    catch { log.add("audio", "session error \(error)") }
  }
  // restart audio: граф заново, ядро (сцена) не трогаем — init только при смене частоты (reset)
  func restart() { guard started else { return }; handle(.user, "user restart") }
  private var coreRate = 0.0                 // частота, с которой инициализировано ядро

  private let seed: UInt32
  var onInit: (() -> Void)?                // сразу после t2d_app_init, до старта движка: вернуть сцену, лад, громкость (запуск и смена частоты)
  private let watch: UInt32                // маска слотов, чьи зеркала ядро публикует (слоты с нативным видом)
  init(log: Log, seed: UInt32 = 1, watch: UInt32 = 0) { self.log = log; self.seed = seed; self.watch = watch }

  // только -shot: сумма квадратов левого канала и число кадров с последнего takeRms (гонка с render безвредна — замер для консоли)
  var probe = false
  private let acc: UnsafeMutablePointer<Double> = { let p = UnsafeMutablePointer<Double>.allocate(capacity: 2); p.initialize(repeating: 0, count: 2); return p }()
  deinit { engine?.stop(); acc.deallocate() }                  // сначала render, потом буфер
  func takeRms() -> Double {
    let s = acc[0], n = acc[1]; acc[0] = 0; acc[1] = 0
    return n > 0 ? (s / n).squareRoot() : 0
  }

  var sampleRate: Double { session.sampleRate }
  var outputLatency: Double { session.outputLatency }
  var frames: Int { Int((session.ioBufferDuration * session.sampleRate).rounded()) }

  func start() {
    guard !started else { return }
    started = true
    do {
      try session.setCategory(.playback)
      try session.setPreferredIOBufferDuration((stable ? 1024.0 : 256.0) / 48000.0)
      try session.setActive(true)
    } catch { log.add("audio", "session error \(error)") }
    log.add("audio", String(format: "session ioBuffer %.5f s, rate %.0f, outputLatency %.5f s", session.ioBufferDuration, session.sampleRate, session.outputLatency))
    observe()                                  // после setCategory / setActive: их собственные уведомления не должны перезапускать движок
    handle(.start, "start")
  }

  private func handle(_ t: AudioTrigger, _ why: String) {
    let p = AudioPlan.make(t, coreRate: coreRate, rate: session.sampleRate, running: engine?.isRunning ?? false)
    if p.rebuild { reset(why, reinit: p.reinit) }
  }

  // Остановить движок, при смене частоты (или первом пуске) переинициализировать ядро, собрать граф и запустить.
  private func reset(_ why: String, reinit: Bool) {
    engine?.stop()                           // после stop render-блок не вызывается — init безопасен
    engine = nil
    let sr = session.sampleRate
    if reinit || sr != coreRate {
      t2d_app_init(sr, seed, Clock.ticksPerSec, watch)
      coreRate = sr
      onInit?()
    }
    let e = AVAudioEngine()
    let fmt = AVAudioFormat(standardFormatWithSampleRate: sr, channels: 2)!   // планарный float
    let acc = acc, probe = probe
    let node = AVAudioSourceNode(format: fmt) { _, ts, frameCount, abl in
      let b = UnsafeMutableAudioBufferListPointer(abl)
      guard b.count >= 2, let l = b[0].mData, let r = b[1].mData else { return noErr }
      t2d_app_render(l.assumingMemoryBound(to: Float.self), r.assumingMemoryBound(to: Float.self), Int32(frameCount), ts.pointee.mHostTime)
      if probe {
        let p = l.assumingMemoryBound(to: Float.self)
        var s = 0.0
        for i in 0..<Int(frameCount) { s += Double(p[i] * p[i]) }
        acc[0] += s; acc[1] += Double(frameCount)
      }
      return noErr
    }
    e.attach(node)
    e.connect(node, to: e.mainMixerNode, format: fmt)
    do { try e.start(); engine = e } catch { log.add("audio", "engine start error \(error)") }
    log.add("audio", String(format: "engine %@ (%@): rate %.0f, frames %d, outputLatency %.5f s", engine == nil ? "failed" : "running", why, sr, frames, session.outputLatency))
  }

  private func observe() {
    let nc = NotificationCenter.default
    nc.addObserver(forName: AVAudioSession.interruptionNotification, object: nil, queue: .main) { [weak self] n in
      guard let self, let raw = n.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt, let type = AVAudioSession.InterruptionType(rawValue: raw) else { return }
      self.log.add("audio", "interruption \(type == .began ? "began" : "ended")")
      if type == .ended { try? self.session.setActive(true); self.handle(.interruptionEnded, "interruption ended") }
    }
    nc.addObserver(forName: AVAudioSession.routeChangeNotification, object: nil, queue: .main) { [weak self] n in
      guard let self else { return }
      let raw = n.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt ?? 0
      self.log.add("audio", "route change reason \(raw)")
      self.handle(.route(AVAudioSession.RouteChangeReason(rawValue: raw) ?? .unknown), "route change")
    }
    nc.addObserver(forName: AVAudioSession.mediaServicesWereResetNotification, object: nil, queue: .main) { [weak self] _ in
      guard let self else { return }
      self.log.add("audio", "media services reset")
      try? self.session.setCategory(.playback)
      try? self.session.setActive(true)
      self.handle(.mediaServicesReset, "media services reset")
    }
    // смена железа вывода (наушники, частота, каналы): движок сам останавливается, и route change об этом может не сказать.
    // От заменённого движка событие пропускаем — граф уже собран заново.
    nc.addObserver(forName: .AVAudioEngineConfigurationChange, object: nil, queue: .main) { [weak self] n in
      guard let self, let e = n.object as? AVAudioEngine, e === self.engine else { return }
      self.log.add("audio", "engine configuration change")
      self.handle(.engineConfigChange, "engine configuration change")
    }
    // конец прерывания мог прийти в фоне — тогда старт отклонён, и поднять движок можно только здесь
    nc.addObserver(forName: UIApplication.didBecomeActiveNotification, object: nil, queue: .main) { [weak self] _ in
      guard let self, !(self.engine?.isRunning ?? false) else { return }
      do { try self.session.setActive(true) } catch { self.log.add("audio", "session error \(error)") }
      self.handle(.becameActive, "became active")
    }
  }
}
