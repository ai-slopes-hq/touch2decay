// Лад — порт host/scale.js (SCALES, inScale, snapSemi) один в один. Миры читают лад у хоста через const Scale&.
#pragma once

struct Scale {
  static constexpr int kScales = 6;                     // major, minor, dorian, phrygian, lydian, mixolydian
  bool on = false;
  int idx = 0, root = 0;                                // ступень от тоники — полутоны от A; root 0..11
  bool inScale(int n) const;                            // нота n (полутоны от 55 Гц) в ладу
  double snapSemi(double s) const;                      // ближайшая нота лада; без лада — как есть
};
