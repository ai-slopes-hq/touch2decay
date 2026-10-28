import SwiftUI

@main
struct T2DApp: App {
  // -shot firmamentum: зерно 7 (init ядра — до запуска движка, в Audio.start) и сцена для снимка
  private static let shot = CommandLine.arguments.contains("-shot")
  @State private var audio: Audio
  @State private var world: FirmamentumView
  @State private var host: Host

  init() {
    let a = Audio(log: .shared, seed: T2DApp.shot ? 7 : 1)
    let w = FirmamentumView(core: AppCore(slot: FirmamentumView.slotN), geo: Geo(W: 390, H: 844, topY: 59, safeBot: 34))
    let h = Host(world: w, core: AppHostCore(), store: Store(dir: T2DApp.storeDir(), log: { Log.shared.add("store", $0) }))
    a.onInit = { h.reapply() }
    _audio = State(initialValue: a); _world = State(initialValue: w); _host = State(initialValue: h)
  }

  var body: some Scene {
    WindowGroup {
      StageView(world: world, host: host, audio: audio).ignoresSafeArea().background(Color.black)
        .onAppear { audio.start(); if T2DApp.shot { shotScene() } }
        .onReceive(NotificationCenter.default.publisher(for: UIApplication.didEnterBackgroundNotification)) { _ in host.background() }
    }
  }

  // Application Support/T2D; для -shot — пустая временная папка: снимок не зависит от сохранённой сцены и ничего не затирает
  private static func storeDir() -> URL {
    if shot { return FileManager.default.temporaryDirectory.appendingPathComponent("t2d-shot-\(UUID().uuidString)") }
    return FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("T2D")
  }

  // dice (через мир хоста), fx scintilla/drift/cometa, комета; через 1.8 с — crepitus и fulgur; к 2.5 с кадр готов
  private func shotScene() {
    let core = AppCore(slot: FirmamentumView.slotN)
    host.world.dice()
    core.action(4, 0, [0.6], touchTime: 0); core.action(4, 1, [0.6], touchTime: 0); core.action(4, 2, [1], touchTime: 0)
    core.action(7, 0, [], touchTime: 0)
    DispatchQueue.main.asyncAfter(deadline: .now() + 1.8) {
      core.action(4, 3, [0.8], touchTime: 0); core.action(4, 4, [1], touchTime: 0)
    }
  }
}
