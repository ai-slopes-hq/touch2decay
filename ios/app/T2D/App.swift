import SwiftUI

@main
struct T2DApp: App {
  // -shot firmamentum: зерно 7 (init ядра — до запуска движка, в Audio.start) и сцена для снимка
  private static let shot = CommandLine.arguments.contains("-shot")
  // имя сцены после -shot: firmamentum (по умолчанию) | topbar | scales | legend
  private static let shotName: String = {
    let a = CommandLine.arguments
    guard let i = a.firstIndex(of: "-shot"), i + 1 < a.count else { return "firmamentum" }
    return a[i + 1]
  }()
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
    if T2DApp.shotName == "undo" { shotUndo(); return }
    let core = AppCore(slot: FirmamentumView.slotN)
    host.world.dice()
    core.action(4, 0, [0.6], touchTime: 0); core.action(4, 1, [0.6], touchTime: 0); core.action(4, 2, [1], touchTime: 0)
    core.action(7, 0, [], touchTime: 0)
    DispatchQueue.main.asyncAfter(deadline: .now() + 1.8) {
      core.action(4, 3, [0.8], touchTime: 0); core.action(4, 4, [1], touchTime: 0)
    }
    // верхняя строка: лад включён (подпись под заголовком); список ладов — зажатая кнопка лада; легенда — тап по заголовку
    let on = Scl(on: true, idx: 2, root: 3)
    switch T2DApp.shotName {
    case "topbar": host.shotState(scl: on)
    case "scales": host.shotState(scl: on, sclOpen: true)
    case "legend": host.shotState(scl: Scl.off, legendOpen: true)
    default: break
    }
  }

  // -shot undo: тап по небу → звезда → кнопка undo → звезды нет; касания идут через Host, число звёзд — в консоль (stdout)
  private func shotUndo() {
    let id = ObjectIdentifier(host)
    func touch(_ x: CGFloat, _ y: CGFloat, at t: Double) {
      let f = Finger(id: id, x: x, y: y, x0: x, y0: y, t0: t, moved: false, touchTime: t)
      host.down(f); host.up(f)
    }
    func report(_ what: String) { print("shot-undo \(what): stars=\(world.mirror.stars.count)"); fflush(stdout) }
    let q = DispatchQueue.main
    q.asyncAfter(deadline: .now() + 1.0) { touch(195, 450, at: 1.0) }
    q.asyncAfter(deadline: .now() + 2.5) { report("after tap"); touch(390 - 66, 79, at: 2.5) }
    q.asyncAfter(deadline: .now() + 4.0) { report("after undo") }
  }
}
