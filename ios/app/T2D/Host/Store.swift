import Foundation

// файлы настроек и сцен в Application Support: prefs.json, scene-<слот>.json
struct PrefsFile: Codable, Equatable {
  var v = 1; var vol: Double
  var mix: Mix? = nil; var link: Link? = nil; var audio: AudioPref? = nil   // нет в старом файле — nil
}
struct SceneFile: Codable, Equatable { var v = 1; var w: String; var scl: Scl }

final class Store {
  private let dir: URL
  private let log: (String) -> Void

  init(dir: URL, log: @escaping (String) -> Void) { self.dir = dir; self.log = log }

  func loadPrefs() -> PrefsFile? { load("prefs.json", PrefsFile.self, version: \.v) }
  func savePrefs(_ p: PrefsFile) { save("prefs.json", p) }
  func loadScene(slot: Int) -> SceneFile? {
    let name = "scene-\(slot).json"
    guard let f = load(name, SceneFile.self, version: \.v) else { return nil }
    // лад вне диапазона уронил бы верхнюю строку (индексы Scales) на каждом запуске
    guard (0..<Scales.labels.count).contains(f.scl.idx), (0..<12).contains(f.scl.root) else {
      log("\(name): лад вне диапазона (idx \(f.scl.idx), root \(f.scl.root))"); return nil
    }
    return f
  }
  func saveScene(slot: Int, _ s: SceneFile) { save("scene-\(slot).json", s) }

  // нет файла — nil молча; не JSON, нет полей, чужая версия — nil и одна строка в лог
  private func load<T: Decodable>(_ name: String, _ type: T.Type, version: KeyPath<T, Int>) -> T? {
    let url = dir.appendingPathComponent(name)
    guard FileManager.default.fileExists(atPath: url.path) else { return nil }
    do {
      let v = try JSONDecoder().decode(type, from: Data(contentsOf: url))
      guard v[keyPath: version] == 1 else { log("\(name): версия \(v[keyPath: version]) не поддерживается"); return nil }
      return v
    } catch {
      log("\(name): не прочитан (\(error.localizedDescription))")
      return nil
    }
  }

  private func save<T: Encodable>(_ name: String, _ value: T) {
    do {
      try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
      try JSONEncoder().encode(value).write(to: dir.appendingPathComponent(name), options: .atomic)
    } catch { log("\(name): не записан (\(error.localizedDescription))") }
  }
}
