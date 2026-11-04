import UIKit

// Касания Tenebrae (порт app.js:393-502): палец, тяга, двойной тап, удержание, щипок, солнце — задача 4.
// Здесь пока заглушки: связка мира (TenebraeView.swift) уже зовёт touchTick / touchReset
extension TenebraeView {
  func down(_ f: Finger) {}
  func move(_ f: Finger) {}
  func up(_ f: Finger) {}
  func cancel(_ f: Finger) {}
  func touchTick(now: Double) {}                           // зовёт tick: удержание, удары солнца
  func touchReset() {}                                     // restored: пальцы, пара, кольца, призрак забыты
}
