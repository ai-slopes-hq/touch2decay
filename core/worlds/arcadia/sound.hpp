// Arcadia — звук: синтез по рельефу (wave terrain), порт terrain-worklet.js (эталон — tools/ref/terrain-worklet.js, ГСЧ с зерном).
// Пейзаж — поверхность высот z(u, v); голос — сканер, обходящий по ней петлю (круг, восьмёрка, узел 2 : 3) со звуковой частотой f:
// высоты под петлёй — форма волны, sin(1.57·(1 + 3·relief)·z) — складки. Рельеф между узлами — Catmull — Rom 4 × 4, за краем — зеркало,
// над озёрами ветер рябит воду. Центр петли идёт к цели: стоит, кругом, наугад, туда-обратно по пути (river / summit). DC-блок, ровная
// громкость (АРУ до ×4), мягкий срез верха, панорама, tanh(0.7·x). Новая страна — перетекание 0.5 с. Всё молчит — блок не считается.
// Сообщения worklet → методы: voice (как {t:'voice'} — поля, путь, «свежий» голос встаёт сразу в цель), params, land.
#pragma once
#include <cstdint>
#include "../../sdk/rng.hpp"
#include "land.hpp"

namespace arcadia {

class Sound {
 public:
  static constexpr int NV = 4;
  struct Msg {                                          // {t:'voice', i, on, f, hx, hy, r, fig, lvl, mode, sp, pan, route?}
    bool on; double f, hx, hy, r, fig, lvl, mode, sp, pan;
    bool hasRoute; const double* route; int n;          // n < 4 — null
  };
  void prepare(double sr, uint32_t seed);
  void land(const Land& l, bool now);                   // {t:'terrain'}: прежняя — в перетекание, now — сразу
  void params(double relief, double speed, double wind, double spread) { relief_ = relief; speed_ = speed; wind_ = wind; spread_ = spread; }
  void voice(int i, const Msg& m);
  bool process(float* L, float* R, int n);              // false — все голоса молчат (выход — нули)
  void center(int i, double& cx, double& cy, double& rs) const { cx = vo_[i].cx; cy = vo_[i].cy; rs = vo_[i].rs; }
  double gain(int i) const;                             // уровень голоса для картинки (как g в {t:'p'})
  bool idle(int i) const { return !vo_[i].on && vo_[i].g < 1e-5; }

 private:
  static constexpr int RP = 2 + 2 * 90;
  struct V {
    bool on = false;
    double f = 110, ph = 0, g = 0, lvl = 0.8, hx = 0, hy = 0, cx = 0, cy = 0, tx = 0, ty = 0, r = 0.18, rs = 0.18, fig = 0, mode = 0, sp = 0.25, wp = 0;
    float route[RP] = {}, cum[RP / 2] = {};
    int rn = 0;                                         // точек пути; 0 — null
    double rl = 0, pan = 0, dx = 0, dy = 0, env = 0.01, ag = 1, lp = 0, nz = 0, nzT = 0, nzN = 0, seed[4] = {};
  };
  void target(V& o) const;
  double cub(const float* z, double gx, double gy) const;
  double height(double u, double v) const;
  sdk::Rng rng_{1};
  V vo_[NV];
  const float* z_ = nullptr;                            // звучащая страна (у модели)
  const float* lake_ = nullptr;
  float z0_[NG] = {};                                   // прежняя — на время перетекания
  double sr_ = 48000, xf_ = 1, relief_ = 0.3, speed_ = 0.05, wind_ = 0, spread_ = 0.6, t_ = 0;
};

}  // namespace arcadia
