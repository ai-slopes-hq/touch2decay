// Панорамы: куда в стерео поставить звук. p от −1 (весь влево) через 0 (центр) до +1 (весь вправо).
//
//   panLin(p, spread)  — линейная, как в worklet-ах: pan = p·spread, левый (1 − pan)/2, правый (1 + pan)/2.
//                        В центре по 0.5: сумма постоянна, но по мощности центр тише краёв на 3 дБ.
//   panEq(p)           — равномощная, как StereoPannerNode для моно-входа: x = (p + 1)/2, левый cos(xπ/2),
//                        правый sin(xπ/2). В центре по 0.707 — громкость при движении не проваливается.
//   PanStereo          — StereoPannerNode для стерео-входа (по спецификации Web Audio): при p < 0 правый
//                        канал частью переезжает влево, при p > 0 — левый вправо; своя сторона остаётся
//                        целиком, p = 0 — вход как есть.
//
// ЛОВУШКИ:
//   - panLin и panEq p не зажимают: |p·spread| > 1 даёт отрицательный гейн у одного канала (фаза перевёрнута).
//   - PanStereo::set зажимает p в [−1, 1] и считает cos/sin — зови при смене панорамы, не каждый сэмпл.
// Цена: panLin — два умножения, panEq — cos и sin на вызов, PanStereo::step — три операции на сэмпл.
#pragma once
#include <cmath>

namespace sdk {

inline void panLin(double p, double spread, double& gl, double& gr) {
  double pan = p * spread;
  gl = (1 - pan) * 0.5;
  gr = (1 + pan) * 0.5;
}

inline void panEq(double p, double& gl, double& gr) {
  const double x = (p + 1) * 0.5;
  gl = std::cos(x * M_PI / 2);
  gr = std::sin(x * M_PI / 2);
}

struct PanStereo {
  double position = 0;
  // p ≤ 0: cosGain — сколько правого уходит влево, sinGain — сколько остаётся справа;
  // p > 0: cosGain — сколько левого остаётся слева, sinGain — сколько уходит вправо.
  double cosGain = 1, sinGain = 0;

  void set(double pan) {
    position = pan < -1 ? -1 : pan > 1 ? 1 : pan;
    const double x = position <= 0 ? position + 1 : position;
    cosGain = std::cos(x * M_PI / 2); sinGain = std::sin(x * M_PI / 2);
  }
  void step(double inL, double inR, double& outL, double& outR) const {
    if (position <= 0) { outL = inL + inR * cosGain; outR = inR * sinGain; }
    else { outL = inL * cosGain; outR = inR + inL * sinGain; }
  }
};

}  // namespace sdk
