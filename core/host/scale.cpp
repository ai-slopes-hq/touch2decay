// Лад: шесть ладов по семь ступеней, как SCALES в host/scale.js.
#include "scale.hpp"
#include <cmath>

static const int kSteps[Scale::kScales][7] = {
  {0, 2, 4, 5, 7, 9, 11},                               // major
  {0, 2, 3, 5, 7, 8, 10},                               // minor
  {0, 2, 3, 5, 7, 9, 10},                               // dorian
  {0, 1, 3, 5, 7, 8, 10},                               // phrygian
  {0, 2, 4, 6, 7, 9, 11},                               // lydian
  {0, 2, 4, 5, 7, 9, 10},                               // mixolydian
};

bool Scale::inScale(int n) const {
  const int pc = (((n - root) % 12) + 12) % 12;
  for (int s : kSteps[idx]) if (s == pc) return true;
  return false;
}

double Scale::snapSemi(double s) const {
  if (!on) return s;
  double best = s, bd = 99;
  const int lo = static_cast<int>(std::floor(s)) - 7, hi = static_cast<int>(std::ceil(s)) + 7;
  for (int n = lo; n <= hi; n++) {
    if (n < 0 || !inScale(n)) continue;
    const double d = std::fabs(n - s);
    if (d < bd) { bd = d; best = n; }                   // строго меньше: при равенстве — нижняя нота, как в JS
  }
  return best;
}
