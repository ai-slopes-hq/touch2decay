// Таймлайн AudioParam (Web Audio): set, lin, exp, target, cancel — главный блок совместимости миров, что жили на узлах (Tria — первая).
// Время — в сэмплах мира (double, дробное), значение — на каждый сэмпл (a-rate): fill(out, n, t0) — кадры t0 … t0 + n − 1.
// Σ a-rate входов (FM в частоту) прибавляет вызывающий — Param о них не знает. Без аллокаций: очередь — CAP событий, лишнее не встаёт.
// Семантика — спецификация Web Audio и Chromium (AudioParamTimeline):
//   время события в прошлом — «сейчас» (как clamp к currentTime); событие действует с первого кадра ≥ t;
//   событие в то же время встаёт после стоящих в то же время (замены нет — так Chromium);
//   lin / exp — рампа от предыдущего события (его время и значение; set — его, рампа — её конец); после target, который уже идёт, —
//     от «сейчас» и значения target на этом кадре; target, который ещё не начался, рампа заменяет (от значения перед ним);
//   exp: v0·(v1/v0)^((t − t0)/(t1 − t0)); v0 = 0 или знаки разные — держит v0 до t1 (спецификация; Chromium тут своё — миры так не делают);
//   target: v0 — событие ровно на кадре f — прежняя кривая на f (дошедшая рампа или set — их значение, идущий target — его шаг),
//     между кадрами — последнее посчитанное значение; первый кадр — v1 + (v0 − v1)·e^(−(f − t)/τ),
//     дальше однополюсник на кадр во float (как Chromium: у самой цели шаг меньше полу-ulp и значение замирает), c = 1 − e^(−1/τ),
//     τ — в сэмплах; в начале fill (квант), если событий впереди нет и target «сошёлся» — прошло
//     больше 10 τ или |v − v1| < e^(−10)·|v1| (у нуля — |v| < e^(−10)), — значение встаёт ровно в v1 (HasSetTargetConverged Chromium);
//   cancel(t) — снять события со временем ≥ t, что ещё не начались (у рампы время — её конец; идущий target идёт): значение держится
//     там, где было (так Chromium: снятая рампа не возвращается к своему началу).
#pragma once
#include <cmath>

namespace sdk {

class Param {
 public:
  static constexpr int CAP = 16;
  enum Kind : unsigned char { SET, LIN, EXP, TARGET };

  explicit Param(double v = 0) { reset(v); }
  void reset(double v) { hold_ = v_ = pv_ = v; pt_ = 0; n_ = 0; target_ = false; now_ = 0; }   // значение по умолчанию, событий нет

  void set(double v, double t) { put(SET, v, t, 0); }
  void lin(double v, double t) { put(LIN, v, t, 0); }
  void exp(double v, double t) { put(EXP, v, t, 0); }
  void target(double v, double t, double tau) { put(TARGET, v, t, tau); }   // tau — в сэмплах
  void cancel(double t) {
    t = t < now_ ? now_ : t;
    int k = 0;
    while (k < n_ && ev_[k].t < t) k++;
    if (k == 0 && n_ && (ev_[0].k == LIN || ev_[0].k == EXP)) hold_ = v_;   // идущая рампа снята — значение держится
    n_ = k;
  }

  double value() const { return v_; }                  // последнее значение (кадр now − 1)
  bool idle() const { return n_ == 0 && !target_; }    // держит постоянное (fill — без расчёта)

  void fill(double* out, int n, double t0) {
    if (target_ && !n_ && converged(t0)) { target_ = false; hold_ = tgt_; }
    if (idle()) { for (int k = 0; k < n; k++) out[k] = hold_; v_ = hold_; now_ = t0 + n; return; }
    for (int k = 0; k < n; k++) out[k] = step(t0 + k);
    now_ = t0 + n;
  }
  double step(double f) {                              // значение на кадре f (кадры подряд)
    const Ev* r = nullptr;
    while (n_) {
      const Ev& e = ev_[0];
      if (e.k == LIN || e.k == EXP) {
        if (f < e.t) { r = &e; break; }
        hold_ = pv_ = e.v; pt_ = e.t; target_ = false; pop();   // рампа дошла
        continue;
      }
      if (f < e.t) break;
      pt_ = e.t;
      if (e.k == SET || e.tau <= 0) { hold_ = pv_ = e.v; target_ = false; }
      else { pv_ = f == e.t ? carry() : v_; tgt_ = e.v; c_ = 1 - std::exp(-1 / e.tau); target_ = true; first_ = true; ts_ = e.t; tau_ = e.tau; }
      pop();
    }
    double v;
    if (r) {
      const double x = (f - pt_) / (r->t - pt_);
      if (r->k == LIN) v = pv_ + (r->v - pv_) * x;
      else v = (pv_ == 0 || (pv_ > 0) != (r->v > 0)) ? pv_ : pv_ * std::pow(r->v / pv_, x);
    } else if (target_) {
      if (first_) v = tgt_ + (pv_ - tgt_) * std::exp(-(f - ts_) / tau_);
      else v = v_ + (tgt_ - v_) * c_;
      first_ = false;
    } else {
      v = hold_;
    }
    v_ = v;
    return v;
  }

 private:
  struct Ev { Kind k; double t, v, tau; };
  bool converged(double f) const {
    if (f - ts_ > 10 * tau_) return true;
    if (tgt_ == 0) return std::fabs(v_) < 4.539992976248485e-05;
    return std::fabs(v_ - tgt_) < 4.539992976248485e-05 * std::fabs(tgt_);
  }
  double carry() const { return target_ ? v_ + (tgt_ - v_) * c_ : hold_; }   // прежняя кривая на текущем кадре: идущий target — ещё шаг
  void pop() { for (int k = 1; k < n_; k++) ev_[k - 1] = ev_[k]; n_--; }
  void put(Kind kind, double v, double t, double tau) {
    if (t < now_) t = now_;
    int k = 0;
    while (k < n_ && ev_[k].t <= t) k++;
    if (n_ == CAP) return;
    if (k == 0 && target_ && (kind == LIN || kind == EXP)) { pt_ = now_; pv_ = carry(); }   // рампа после идущего target — от «сейчас»
    for (int j = n_; j > k; j--) ev_[j] = ev_[j - 1];
    ev_[k] = {kind, t, v, tau};
    n_++;
  }

  Ev ev_[CAP];
  int n_ = 0;
  double v_ = 0, hold_ = 0, pv_ = 0, pt_ = 0, now_ = 0;
  bool target_ = false, first_ = false;
  double tgt_ = 0, c_ = 0, ts_ = 0, tau_ = 1;
};

}  // namespace sdk
