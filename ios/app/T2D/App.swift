import SwiftUI

@main
struct T2DApp: App {
  // -shot firmamentum: зерно 7 (init ядра — до запуска движка, в Audio.start) и сцена для снимка
  private static let shot = CommandLine.arguments.contains("-shot")
  @State private var audio = Audio(log: .shared, seed: T2DApp.shot ? 7 : 1)
  var body: some Scene {
    WindowGroup {
      StageView().ignoresSafeArea().background(Color.black)
        .onAppear { audio.start(); if T2DApp.shot { T2DApp.shotScene() } }
    }
  }

  // dice, fx scintilla/drift/cometa, комета; через 1.8 с — crepitus и fulgur; к 2.5 с кадр готов
  private static func shotScene() {
    let core = AppCore(slot: FirmamentumView.slotN)
    core.action(6, 0, [], touchTime: 0)
    core.action(4, 0, [0.6], touchTime: 0); core.action(4, 1, [0.6], touchTime: 0); core.action(4, 2, [1], touchTime: 0)
    core.action(7, 0, [], touchTime: 0)
    DispatchQueue.main.asyncAfter(deadline: .now() + 1.8) {
      core.action(4, 3, [0.8], touchTime: 0); core.action(4, 4, [1], touchTime: 0)
    }
  }
}
