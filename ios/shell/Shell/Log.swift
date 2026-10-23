// ПРОБА: лог оболочки и страницы — в файл Documents/t2d.log (видно в «Файлах») и раз в секунду пачкой на Mac по Wi-Fi
// (ios/shell/logserver.py, порт 8766). Mac не отвечает — строки остаются только в файле.
import Foundation
import UIKit

final class Log {
  static let shared = Log()
  static let mac = URL(string: "http://192.168.0.2:8766/log")!   // ПРОБА: адрес Mac в домашней сети
  private let q = DispatchQueue(label: "log")
  private var buf: [String] = []
  private var file: FileHandle?
  private var timer: DispatchSourceTimer?
  private let t0 = Date()

  private init() {
    let url = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0].appendingPathComponent("t2d.log")
    let size = (try? FileManager.default.attributesOfItem(atPath: url.path))?[.size] as? Int ?? 0, big = size > 5_000_000
    if big || !FileManager.default.fileExists(atPath: url.path) { FileManager.default.createFile(atPath: url.path, contents: nil) }
    file = try? FileHandle(forWritingTo: url); file?.seekToEndOfFile()
    let t = DispatchSource.makeTimerSource(queue: q)
    t.schedule(deadline: .now() + 1, repeating: 1)
    t.setEventHandler { [weak self] in self?.flush() }
    t.resume(); timer = t
    add("shell", "launch")
    for (n, what) in [(UIApplication.didEnterBackgroundNotification, "background"), (UIApplication.willEnterForegroundNotification, "foreground")] {
      NotificationCenter.default.addObserver(forName: n, object: nil, queue: nil) { [weak self] _ in self?.add("shell", what) }
    }
  }

  func add(_ from: String, _ s: String) {               // from — shell / page / midi / clock
    let line = String(format: "%.3f %@ %@", Date().timeIntervalSince(t0), from, s)
    q.async { self.buf.append(line) }
  }

  private func flush() {
    add("shell", "thermal \(ProcessInfo.processInfo.thermalState.rawValue)")
    guard !buf.isEmpty else { return }
    let text = buf.joined(separator: "\n") + "\n"; buf = []
    file?.write(text.data(using: .utf8)!)
    var r = URLRequest(url: Log.mac, timeoutInterval: 0.8); r.httpMethod = "POST"; r.httpBody = text.data(using: .utf8)
    URLSession.shared.dataTask(with: r).resume()
  }
}
