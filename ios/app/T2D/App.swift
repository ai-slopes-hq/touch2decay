import SwiftUI

@main
struct T2DApp: App {
  @State private var audio = Audio(log: .shared)
  var body: some Scene {
    WindowGroup {
      Color.black.ignoresSafeArea().onAppear { audio.start() }
    }
  }
}
