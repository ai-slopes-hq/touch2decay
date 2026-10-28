import UIKit

// rgb 0...255 без альфы — как строки '237,237,237' в вебе
typealias RGB = (r: CGFloat, g: CGFloat, b: CGFloat)

// тема мира (как theme в host/draw.js): ink — линии и подписи, paper — подложки под кнопками и панелями, bg — фон
struct Theme {
  var ink: RGB, paper: RGB
  var bg: UIColor
  static let base = Theme(ink: (237, 237, 237), paper: (0, 0, 0), bg: .black)   // INK0, PAPER0, BG0
}
