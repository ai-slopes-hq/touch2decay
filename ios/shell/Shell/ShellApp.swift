// ПРОБА: WKWebView с продовым touch2decay в приложении с фоновым аудиорежимом — звучит ли Web Audio при заблокированном экране.
import AVFoundation
import SwiftUI
import WebKit

@main
struct ShellApp: App {
  @StateObject var midi = Midi()
  init() {
    _ = Log.shared
    let s = AVAudioSession.sharedInstance()
    try? s.setCategory(.playback, mode: .default, options: [])
    try? s.setActive(true)
    let nc = NotificationCenter.default                  // ПРОБА: что iOS делает со звуком — в лог
    nc.addObserver(forName: AVAudioSession.interruptionNotification, object: nil, queue: nil) { n in
      let u = n.userInfo ?? [:]
      Log.shared.add("audio", "interruption type \(u[AVAudioSessionInterruptionTypeKey] ?? "?") reason \(u[AVAudioSessionInterruptionReasonKey] ?? "-") options \(u[AVAudioSessionInterruptionOptionKey] ?? "-")")
    }
    nc.addObserver(forName: AVAudioSession.routeChangeNotification, object: nil, queue: nil) { n in
      let r = n.userInfo?[AVAudioSessionRouteChangeReasonKey] ?? "?"
      let outs = AVAudioSession.sharedInstance().currentRoute.outputs.map { "\($0.portType.rawValue):\($0.portName)" }.joined(separator: ", ")
      Log.shared.add("audio", "route reason \(r) → \(outs)")
    }
    nc.addObserver(forName: AVAudioSession.mediaServicesWereResetNotification, object: nil, queue: nil) { _ in Log.shared.add("audio", "media services reset") }
    Log.shared.add("audio", "route " + s.currentRoute.outputs.map { "\($0.portType.rawValue):\($0.portName)" }.joined(separator: ", "))
  }
  var body: some Scene {
    WindowGroup {
      ZStack(alignment: .bottom) {
        Web(midi: midi).ignoresSafeArea().background(Color.black)
        MidiBadge(midi: midi)
      }
    }
  }
}

struct Web: UIViewRepresentable {
  let midi: Midi
  static let url = "https://touch2decay-git-native-iamthen0ises-projects.vercel.app/"   // ПРОБА: превью ветки native (https — метроном и Wake Lock); вход в Vercel — один раз внутри
  func makeUIView(context: Context) -> WKWebView {
    let c = WKWebViewConfiguration()
    c.allowsInlineMediaPlayback = true
    c.mediaTypesRequiringUserActionForPlayback = []
    let bridge = ClockBridge(midi: midi)
    c.userContentController.add(bridge, name: "t2dClock")   // страница → часы наружу (lead)
    c.userContentController.add(bridge, name: "t2dLog")     // страница → лог (Log.swift)
    let w = WKWebView(frame: .zero, configuration: c)
    w.isInspectable = true                              // Safari на Mac → Разработка → iPhone
    w.scrollView.isScrollEnabled = false
    w.isOpaque = false
    w.backgroundColor = .black
    w.load(URLRequest(url: URL(string: Web.url)!))
    midi.send = { [weak w] js in w?.evaluateJavaScript(js, completionHandler: nil) }
    return w
  }
  func updateUIView(_ w: WKWebView, context: Context) {}
}

final class ClockBridge: NSObject, WKScriptMessageHandler {   // ПРОБА: { t, step, bpm, at } от Portus
  let midi: Midi
  init(midi: Midi) { self.midi = midi }
  func userContentController(_ c: WKUserContentController, didReceive m: WKScriptMessage) {
    if m.name == "t2dLog" { Log.shared.add("page", m.body as? String ?? "?"); return }
    guard let d = m.body as? [String: Any], let t = d["t"] as? String else { return }
    let n = { (k: String) in (d[k] as? NSNumber)?.doubleValue ?? 0 }
    midi.clockOut(t, step: Int(n("step")), bpm: n("bpm") > 0 ? n("bpm") : 120, at: n("at"))
  }
}

struct MidiBadge: View {                                 // ПРОБА: что пришло по MIDI; тап по follow / lead — кто ведёт
  @ObservedObject var midi: Midi
  var body: some View {
    HStack(spacing: 8) {
      VStack(alignment: .leading, spacing: 2) {
        Text("MIDI: " + (midi.sources.isEmpty ? "no sources" : midi.sources.joined(separator: ", ")))
        Text(midi.lead ? "lead · " + midi.outInfo : String(format: "clock %d · %.1f BPM · %@ · %@", midi.clocks, midi.bpm, midi.running ? "running" : "stopped", midi.last))
      }
      .allowsHitTesting(false)
      Button(midi.lead ? "lead" : "follow") { midi.lead.toggle() }
        .padding(.horizontal, 8).padding(.vertical, 4)
        .overlay(RoundedRectangle(cornerRadius: 4).stroke(Color.white.opacity(0.6), lineWidth: 0.5))
    }
    .font(.caption2).foregroundColor(.white).padding(6)
    .background(Color.black.opacity(0.6)).cornerRadius(6).padding(.bottom, 2)
  }
}
