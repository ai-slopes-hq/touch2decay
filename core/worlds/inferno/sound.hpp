// Inferno — звук в ядре: шум сквозь банк резонаторов (как Rings, накормленный шумом). Порт worlds/inferno/engine.js на блоки SDK.
// Круг — возбуждение (всплеск удара + шум своего цвета, пока тлеет) → BpBank из трёх полос → Shaper (перегруз) → lowpass 9000/(1+0.6k) → уровень.
// Шина: сумма ×0.6 → TanhShaper fire (2×) → сухой ×3/(1+fire·1.5); дым — fire × smoke²·1.4 → lowpass 1400 → ×3/(1+fire·1.5) — посыл в зал.
// Молчащий круг не считается (live); сглаживание параметров — раз в блок, как setTargetAtTime (τ 0.03 частота, 0.05 Q, гейн, уровень).
#pragma once
#include <cstdint>
#include <vector>
#include "../../sdk/biquad.hpp"
#include "../../sdk/bpbank.hpp"
#include "../../sdk/noise.hpp"
#include "../../sdk/rng.hpp"
#include "../../sdk/shaper.hpp"

namespace inferno {

class Sound {
 public:
  static constexpr int NC = 9, NSRC = 3, NBURST = 8, MAXBLOCK = 128;
  static constexpr double WEIGHT[3] = {1, 0.6, 0.4};    // вес полосы (engine.js: [1, 0.6, 0.4][j])
  void prepare(double sr, uint32_t seed);
  // перенастройка круга: частоты трёх полос, Q, уровень, перегруз (drive 0…1); первый раз — сразу, дальше — плавно
  void tune(int k, const double hz[3], double q, double level, double drive);
  void strike(int k, double vel);
  void smoulder(int k, bool on, int color);             // тлеет: шум цвета идёт в резонатор; off — затухает; уже тлеет — без перезапуска
  void recolor(int k, int color);                       // сменился цвет: тлеющий круг перезапускается
  void fx(double fire, double smoke);
  void process(float* L, float* R, float* sL, float* sR, int n);
  bool live() const { return live_ > 0; }
  int strikes() const { return strikes_; }
  int drain(double* buf, int cap);                      // номера кругов с новыми ударами с прошлого вызова; очищает

 private:
  struct Src { bool on = false, hold = false; sdk::Noise n; double g = 0, tg = 0, tau = 0.12, ttl = 0; };
  struct Burst { int pos = -1; double g = 0; };
  struct Voice {
    bool live = false, snapNext = true;
    int quiet = 0;
    sdk::BpBank<3> bank;
    sdk::TanhShaper sh;
    sdk::Biquad lp;
    double level = 0.7, vca = 0.7, drive = 0.15;
    Src src[NSRC];
    Burst burst[NBURST];
  };
  void wake(int k);
  double sr_ = 48000;
  sdk::Rng rng_{1};
  std::vector<float> burst_;                            // всплеск удара: 30 мс шума с экспоненциальным спадом, один на все удары (как engine.js)
  Voice v_[NC];
  sdk::TanhShaper fire_;
  sdk::Biquad smLP_;
  double fx_fire_ = 0.2, fx_smoke_ = 0.35;
  double outG_ = 0, smokeG_ = 0;                        // текущие (сглаженные) усиления шины
  double tOut_ = 1, tSmoke_ = 0;
  bool busInit_ = false;
  int live_ = 0;                                        // живых кругов
  int tail_ = 0;                                        // сэмплов до остановки шины после ухода последнего круга
  int strikes_ = 0;
  int heard_[64], nheard_ = 0;
  double mix_[MAXBLOCK];
};

}  // namespace inferno
