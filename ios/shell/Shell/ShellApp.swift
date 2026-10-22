// ПРОБА: WKWebView с продовым touch2decay в приложении с фоновым аудиорежимом — звучит ли Web Audio при заблокированном экране.
import AVFoundation
import SwiftUI
import WebKit

@main
struct ShellApp: App {
  @StateObject var midi = Midi()
  init() {
    let s = AVAudioSession.sharedInstance()
    try? s.setCategory(.playback, mode: .default, options: [])
    try? s.setActive(true)
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
  static let url = "http://192.168.0.2:8765/"           // ПРОБА: страница с Mac по Wi-Fi (python3 -m http.server 8765), без деплоя
  func makeUIView(context: Context) -> WKWebView {
    let c = WKWebViewConfiguration()
    c.allowsInlineMediaPlayback = true
    c.mediaTypesRequiringUserActionForPlayback = []
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

struct MidiBadge: View {                                 // ПРОБА: что пришло по MIDI
  @ObservedObject var midi: Midi
  var body: some View {
    VStack(alignment: .leading, spacing: 2) {
      Text("MIDI: " + (midi.sources.isEmpty ? "no sources" : midi.sources.joined(separator: ", ")))
      Text(String(format: "clock %d · %.1f BPM · %@ · %@", midi.clocks, midi.bpm, midi.running ? "running" : "stopped", midi.last))
    }
    .font(.caption2).foregroundColor(.white).padding(6)
    .background(Color.black.opacity(0.6)).cornerRadius(6).padding(.bottom, 2)
    .allowsHitTesting(false)
  }
}
