// Сдвиг частоты Tenebrae (Hilbert) — порт shifter() из worlds/tenebrae/engine.js: два каскада по 4 allpass-IIR (Niemitalo).
#pragma once
#include <cmath>

namespace tenebrae {

// Выход — только wet: I·cos + Q·sin, где I — каскад 0 с задержкой на сэмпл, Q — каскад 1; hz > 0 сдвигает вверх.
// Квадратурная фаза своя (как у пары осцилляторов cos/sin в вебе: стартуют с нуля, частота — на лету).
struct Shifter {
  static constexpr int N = 4;
  static constexpr double A[2][N] = {{0.6923878, 0.9360654322959, 0.988229522686, 0.9987488452737},
                                     {0.4021921162426, 0.856171088242, 0.9722909545651, 0.9952884791278}};

  void reset() { for (auto& c : z) for (auto& s : c) s = Sec{}; iDly = 0; ph = 0; }

  double step(double x, double hz, double sr) {
    double c[2] = {x, x};
    for (int k = 0; k < 2; k++)
      for (int j = 0; j < N; j++) {
        const double a2 = A[k][j] * A[k][j];
        Sec& s = z[k][j];                           // b = [a², 0, −1], a = [1, 0, −a²]
        const double y = a2 * c[k] - s.x2 + a2 * s.y2;
        s.x2 = s.x1; s.x1 = c[k]; s.y2 = s.y1; s.y1 = y;
        c[k] = y;
      }
    const double I = iDly; iDly = c[0];             // I-ветка на отсчёт позже — фазы расходятся ровно на 90°
    const double Q = c[1];
    const double w = 6.283185307179586 * ph;
    ph += hz / sr; ph -= std::floor(ph);
    return I * std::cos(w) + Q * std::sin(w);
  }

private:
  struct Sec { double x1 = 0, x2 = 0, y1 = 0, y2 = 0; };
  Sec z[2][N];
  double iDly = 0, ph = 0;
};

}  // namespace tenebrae
