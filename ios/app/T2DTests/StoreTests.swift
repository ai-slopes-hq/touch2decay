import XCTest
@testable import T2D

// файлы настроек и сцен — во временной папке, которой до первой записи нет
final class StoreTests: XCTestCase {
  private var dir: URL!
  private var lines: [String] = []

  override func setUp() {
    dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    lines = []
  }
  override func tearDown() { try? FileManager.default.removeItem(at: dir) }

  private func store() -> Store { Store(dir: dir) { [unowned self] in lines.append($0) } }
  private func put(_ name: String, _ s: String) throws {
    try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    try s.write(to: dir.appendingPathComponent(name), atomically: true, encoding: .utf8)
  }

  func testPrefsRoundtrip() {
    XCTAssertFalse(FileManager.default.fileExists(atPath: dir.path))
    store().savePrefs(PrefsFile(vol: 0.37))
    XCTAssertEqual(store().loadPrefs(), PrefsFile(vol: 0.37))
    XCTAssertTrue(lines.isEmpty)
  }

  func testSceneRoundtrip() {
    let s = SceneFile(w: "{\"a\":\"ё—★\\\\\"}", scl: Scl(on: true, idx: 3, root: 7))
    let st = store()
    st.saveScene(slot: 1, s)
    XCTAssertEqual(st.loadScene(slot: 1), s)
    XCTAssertNil(st.loadScene(slot: 0), "слоты независимы")
    XCTAssertTrue(FileManager.default.fileExists(atPath: dir.appendingPathComponent("scene-1.json").path))
  }

  func testMissingIsNil() {
    let st = store()
    XCTAssertNil(st.loadPrefs()); XCTAssertNil(st.loadScene(slot: 0))
    XCTAssertTrue(lines.isEmpty)
  }

  func testBadSceneIgnored() throws {
    try put("scene-0.json", "не json {")
    XCTAssertNil(store().loadScene(slot: 0)); XCTAssertEqual(lines.count, 1)
    try put("scene-1.json", "{\"v\":1,\"w\":\"x\"}")
    XCTAssertNil(store().loadScene(slot: 1)); XCTAssertEqual(lines.count, 2)
  }

  func testWrongVersionIgnored() throws {
    try put("scene-0.json", "{\"v\":2,\"w\":\"x\",\"scl\":{\"on\":false,\"idx\":0,\"root\":0}}")
    XCTAssertNil(store().loadScene(slot: 0)); XCTAssertEqual(lines.count, 1)
    try put("prefs.json", "{\"v\":2,\"vol\":0.5}")
    XCTAssertNil(store().loadPrefs()); XCTAssertEqual(lines.count, 2)
  }
}
