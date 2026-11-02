// Scale — лад: порт host/scale.js (SCALES, inScale, snapSemi) один в один. Хост держит один на всех, миры читают через
// const Scale& (Host::scale()), меняет — только Host::scale(on, idx, root).
//
// Ноты — целые полутоны от A 55 Гц (n = 0 — A1). Лад — семь ступеней от тоники root (полутоны от A, 0…11).
// ЛОВУШКИ:
//   - inScale не смотрит на on: «лад выключен» проверяет вызывающий (snapSemi — проверяет сам).
//   - snapSemi ищет в ±7 полутонах и не уходит ниже ноты 0; при равном расстоянии — нижняя нота, как в JS.
#pragma once

struct Scale {
  static constexpr int kScales = 6;                     // major, minor, dorian, phrygian, lydian, mixolydian
  bool on = false;
  int idx = 0, root = 0;                                // номер лада 0…5; тоника — полутоны от A, 0…11
  static const int* stepsOf(int idx);                   // семь ступеней лада idx от тоники, в полутонах
  bool inScale(int n) const;                            // нота n (полутоны от 55 Гц) в ладу
  double snapSemi(double s) const;                      // ближайшая нота лада к s (полутоны, дробные); без лада — как есть
};
