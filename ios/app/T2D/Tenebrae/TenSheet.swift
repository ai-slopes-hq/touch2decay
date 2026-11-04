import UIKit

// Плашка планеты Tenebrae — задача 6 заполнит; здесь заглушки, на которые опираются касания
extension TenebraeView {
  func openPlanetSheet(_ i: Int) {                         // удержание: плашка планеты i; планета удерживается (KEEP)
    sheetVoice = i
    send(Act.keep, 0, [Double(i)])
  }
  func sheetDown(_ f: Finger) -> Bool { false }            // палец на плашке планеты — задача 6
}
