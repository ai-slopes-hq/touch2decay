// Goetia — ядро звука: bytebeat, порт goetia-worklet.js (теперь эталон — tools/ref/goetia-worklet.js) один в один.
// Звук — формула от счётчика t: acc = (t>>s0) ∘1 (t>>s1) ∘2 … ; выход — (t·acc) & 255, восемь бит, −1…1.
// Целочисленная часть повторяет JS явно: ToInt32, переполнение по кругу (uint32), сдвиг & 31 — иначе UB и расхождение.
#pragma once
#include <cstdint>

namespace goetia {

constexpr int VMAX = 3, LMAX = 4, PMAX = 8;
enum Op { OR, AND, XOR, ADD, MUL, SUB, MOD, SHR };     // коды знаков: | & ^ + * - % >

int32_t toInt32(double x);                              // как `x | 0` в JS: обрезка к нулю, по модулю 2³²

class Goetia {
 public:
  explicit Goetia(double sampleRate);
  void prog(int i, int n, const int* pairs);            // n пар (код знака, сдвиг); неизвестный код — |
  void voice(int i, bool on, double rate, double lp, double lvl, int legio, double pan, double rel, int trig);
  void fx(double spread, double wide);
  void setT(int i, double t);                           // только тесты: t[j] = t + j·1777
  void process(float* L, float* R, int n);              // R == nullptr — моно
  double t0(int i) const { return vo_[i].t[0]; }
  double gv(int i) const { return vo_[i].gv; }

 private:
  struct Voice {
    bool on = false;
    int np = 0, op[PMAX] = {}, sh[PMAX] = {};
    double rate = 8000, rateS = 8000, lp = 0.3, lvl = 0.7, pan = 0, rel = 1;
    int legio = 1, trig = 8;
    double g = 0, gv = 0, dc = 0, dx = 0;
    double t[LMAX] = {}, y[LMAX] = {}, env[LMAX] = {1, 1, 1, 1}, envS[LMAX] = {1, 1, 1, 1};
    bool lb[LMAX] = {};
  };
  double sr_, spread_ = 0.6, wide_ = 0.3;
  Voice vo_[VMAX];
};

}  // namespace goetia
