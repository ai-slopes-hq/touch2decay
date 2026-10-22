// ПРОБА: WKWebView с продовым touch2decay в приложении с фоновым аудиорежимом — звучит ли Web Audio при заблокированном экране.
import AVFoundation
import SwiftUI
import WebKit

@main
struct ShellApp: App {
  init() {
    let s = AVAudioSession.sharedInstance()
    try? s.setCategory(.playback, mode: .default, options: [])
    try? s.setActive(true)
  }
  var body: some Scene {
    WindowGroup { Web().ignoresSafeArea().background(Color.black) }
  }
}

struct Web: UIViewRepresentable {
  func makeUIView(context: Context) -> WKWebView {
    let c = WKWebViewConfiguration()
    c.allowsInlineMediaPlayback = true
    c.mediaTypesRequiringUserActionForPlayback = []
    let w = WKWebView(frame: .zero, configuration: c)
    w.isInspectable = true                              // Safari на Mac → Разработка → iPhone
    w.scrollView.isScrollEnabled = false
    w.isOpaque = false
    w.backgroundColor = .black
    w.load(URLRequest(url: URL(string: "https://touch2decay.vercel.app/")!))
    return w
  }
  func updateUIView(_ w: WKWebView, context: Context) {}
}
