import UIKit

// мир на карте Universum: клетка колоды main (host/deck.js), название — то, что рисует лицо карточки (host/map.js emblemFor)
struct WorldInfo {
  let slot: Int
  let title: String
  let roman: String       // номер на карточке (worlds/*/index.js: n)
  let theme: Theme
  let col: Int, row: Int
  let view: Bool          // есть нативный вид (пока только Firmamentum)
}

enum Worlds {
  private static func th(_ ink: RGB, _ paper: RGB, _ bg: RGB) -> Theme {
    Theme(ink: ink, paper: paper, bg: UIColor(red: bg.r / 255, green: bg.g / 255, blue: bg.b / 255, alpha: 1))
  }

  // темы — theme из worlds/<мир>/view.js (Natura — scene.js:5); у Tenebrae, Cymatica и Monochordum своей нет — база (host/draw.js:5)
  static let all: [WorldInfo] = [
    WorldInfo(slot: 1, title: "Tenebrae", roman: "I", theme: .base, col: 2, row: 1, view: false),
    WorldInfo(slot: 2, title: "Cymatica", roman: "II", theme: .base, col: 1, row: 1, view: false),
    WorldInfo(slot: 4, title: "Natura", roman: "IV", theme: th((38, 26, 16), (226, 211, 174), (226, 211, 174)), col: 2, row: 2, view: false),
    WorldInfo(slot: 5, title: "Inferno", roman: "V", theme: th((207, 196, 182), (5, 4, 3), (5, 4, 3)), col: 2, row: 0, view: false),
    WorldInfo(slot: 7, title: "Monochordum", roman: "VII", theme: .base, col: 1, row: 3, view: false),
    WorldInfo(slot: 8, title: "Oceanus", roman: "VIII", theme: th((206, 222, 226), (8, 16, 24), (8, 16, 24)), col: 3, row: 2, view: true),
    WorldInfo(slot: 9, title: "Horologium", roman: "IX", theme: th((214, 180, 110), (12, 10, 7), (12, 10, 7)), col: 0, row: 2, view: false),
    WorldInfo(slot: 10, title: "Firmamentum", roman: "X", theme: th((232, 224, 200), (10, 9, 20), (10, 9, 20)), col: 3, row: 1, view: true),
    WorldInfo(slot: 11, title: "Tria corpora", roman: "XI", theme: th((222, 198, 152), (19, 15, 10), (19, 15, 10)), col: 3, row: 0, view: false),
    WorldInfo(slot: 12, title: "Arcadia", roman: "XII", theme: th((40, 46, 32), (224, 221, 198), (224, 221, 198)), col: 0, row: 3, view: false),
    WorldInfo(slot: 13, title: "Portus", roman: "XIII", theme: th((196, 208, 216), (6, 9, 13), (6, 9, 13)), col: 3, row: 3, view: false),
    WorldInfo(slot: 15, title: "Goetia", roman: "XV", theme: th((226, 214, 190), (12, 8, 7), (12, 8, 7)), col: 2, row: 3, view: false),
  ]
  // рубашки — клетки без открытого мира (III и VI выключены, две свободные)
  static let backs: [(col: Int, row: Int)] = [(0, 0), (0, 1), (1, 0), (1, 2)]

  static func at(col: Int, row: Int) -> WorldInfo? { all.first { $0.col == col && $0.row == row } }
  static func info(_ slot: Int) -> WorldInfo? { all.first { $0.slot == slot } }
}
