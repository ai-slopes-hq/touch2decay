// Звук: AVAudioEngine + AVAudioSourceNode, блок рендера вызывает t2d_app_render (ядро). Сессия .playback, буфер ~256 кадров.
// t2d_app_init не потокобезопасен против render: любой повторный init — только при остановленном движке (reset()).
import AVFoundation
import T2DCore

final class Audio {
  private let log: Log
  private let session = AVAudioSession.sharedInstance()
  private var engine: AVAudioEngine?
  private var started = false
  private var coreRate = 0.0                 // частота, с которой инициализировано ядро

  private let seed: UInt32
  init(log: Log, seed: UInt32 = 1) { self.log = log; self.seed = seed }

  var sampleRate: Double { session.sampleRate }
  var outputLatency: Double { session.outputLatency }
  var frames: Int { Int((session.ioBufferDuration * session.sampleRate).rounded()) }

  func start() {
    guard !started else { return }
    started = true
    observe()
    do {
      try session.setCategory(.playback)
      try session.setPreferredIOBufferDuration(256.0 / 48000.0)
      try session.setActive(true)
    } catch { log.add("audio", "session error \(error)") }
    log.add("audio", String(format: "session ioBuffer %.5f s, rate %.0f, outputLatency %.5f s", session.ioBufferDuration, session.sampleRate, session.outputLatency))
    reset("start")
  }

  // Остановить движок, при смене частоты (или первом пуске) переинициализировать ядро, собрать граф и запустить.
  private func reset(_ why: String, reinit: Bool = false) {
    engine?.stop()                           // после stop render-блок не вызывается — init безопасен
    engine = nil
    let sr = session.sampleRate
    if reinit || sr != coreRate {
      t2d_app_init(sr, seed, Audio.ticksPerSec, 1 << 10)
      coreRate = sr
    }
    let e = AVAudioEngine()
    let fmt = AVAudioFormat(standardFormatWithSampleRate: sr, channels: 2)!   // планарный float
    let node = AVAudioSourceNode(format: fmt) { _, ts, frameCount, abl in
      let b = UnsafeMutableAudioBufferListPointer(abl)
      guard b.count >= 2, let l = b[0].mData, let r = b[1].mData else { return noErr }
      t2d_app_render(l.assumingMemoryBound(to: Float.self), r.assumingMemoryBound(to: Float.self), Int32(frameCount), ts.pointee.mHostTime)
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
      if type == .ended { try? self.session.setActive(true); self.reset("interruption ended", reinit: true) }
    }
    nc.addObserver(forName: AVAudioSession.routeChangeNotification, object: nil, queue: .main) { [weak self] n in
      guard let self else { return }
      let raw = n.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt ?? 0
      self.log.add("audio", "route change reason \(raw)")
      self.reset("route change")
    }
    nc.addObserver(forName: AVAudioSession.mediaServicesWereResetNotification, object: nil, queue: .main) { [weak self] _ in
      guard let self else { return }
      self.log.add("audio", "media services reset")
      try? self.session.setCategory(.playback)
      try? self.session.setActive(true)
      self.reset("media services reset", reinit: true)
    }
  }

  private static let ticksPerSec: Double = {
    var tb = mach_timebase_info_data_t(); mach_timebase_info(&tb)
    return 1e9 * Double(tb.denom) / Double(tb.numer)
  }()
}
