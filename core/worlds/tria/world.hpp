// Tria corpora — мир SDK: модель (model.hpp) + звук + шина. Звук — порт прежнего worlds/tria/engine.js (эталон tools/ref/tria-engine.js)
// на sdk::Param — тот же таймлайн AudioParam, что был у узлов (первый мир на узлах Web Audio в ядре):
//   дрон пары (после START, до 6 с тишины): три синуса, частота → baseHz (target τ 0.05), громкость amp·0.2·пульс (τ 0.012), пан (τ 0.05),
//     FM по кругу 0→1→2→0 a-rate в частоту, индекс ∝ nexus и близость (τ 0.04); в петле 2→0 — задержка 2 мс + квант (так её рвёт
//     браузер в одном из трёх случаев, см. h2_); начальная частота — hzOf, фазы от 0;
//   колокол (BELL): FM-пара BELL[i] — индекс set → exp, громкость set → lin 3 мс → exp → lin 10 мс; несущая, запущенная внутри
//     кванта, в этом кванте берёт вход FM с начала кванта, а не со своего кадра (так OscillatorNode в Chromium — сверено: без этого
//     фаза несущей к модулятору другая, и в смеси колоколов с дроном октавы расходятся до ±3 дБ); тимпан (THUD): треугольник, частота
//     set 2f → exp f за 60 мс; живых нот не больше 19 (liveNotes > 18 — мимо); ноты — через 5 мс от начала блока;
//   шорох (BURST): шум (Rng) сквозь BP (Q 14), set → lin 4 мс → exp 0.3 с → lin.
// Шина: pre → tanh 1.4 (WaveShaper, 1024 точки) → ×1.6 — сухо; → hall²·1.4 (target τ 0.05) ×1.6 — посыл в hall.
// Модель шагает раз в блок (dt = n/sr); события шага → голоса в начале блока. Ничего не звучит — блок не считается (нули).
#pragma once
#include "../../sdk/biquad.hpp"
#include "../../sdk/osc.hpp"
#include "../../sdk/param.hpp"
#include "../../sdk/rng.hpp"
#include "../../sdk/shaper.hpp"
#include "../../sdk/world.hpp"
#include "model.hpp"

namespace tria {

// action(kind, i, a, n):
//   GRAB i;  DROP i (плашка — тело отпущено без броска);  DRAG i, a = [x, y];  RELEASE i, a = [vx, vy] (бросок) или [] (тап);  ANCHOR i;
//   SET i, a = [key (0 m, 1 semi, 2 fixed, 3 level), v (0…1)];  FX i = key (Fx), a = [v];  LUX;  PLUMB;  DICE a = 3 × [x, y, vx, vy, m, semi];  CLEAR;
//   sdk::ACT_LFO i = -1, a = [key (Fx 0…5), v] — веер FX (прочее игнорируется)
enum Act { GRAB, DROP, DRAG, RELEASE, ANCHOR, SET, FX, LUX, PLUMB, DICE, CLEAR };

// зеркало: fx [NFX], still, lux, cadit, strikes, encounters, затем на тело BODY_M: x, y, vx, vy, m, fixed, semi, level, amp, hz, pairK, trem
constexpr int BODY_M = 12, MIRROR_HEAD = NFX + 5, MIRROR_N = MIRROR_HEAD + NB * BODY_M;
// услышанное (на блок): число вспышек, затем на вспышку — i, вид (0 круг, 1 луч, 2 край, 3 соединение), x, y, q
constexpr int FLASH_M = 5;
constexpr int NOTES = 20, BURSTS = 6;                   // нот живых — до 19 (как liveNotes > 18), шорохов — сколько ни случится за 0.33 с
constexpr double OUT = 1.6, HALL_K = 1.4;

class World : public sdk::World {
 public:
  explicit World(const Scale& scale) : model_(scale) {}
  void prepare(double sr, uint32_t seed) override;
  void action(int kind, int i, const double* a, int n) override;
  void process(const sdk::Out& out, int n) override;
  sdk::Rev rev() const override { return sdk::Rev::hall; }
  int mirror(double* buf, int cap) const override;
  int heard(double* buf, int cap) override;
  std::string snapshot() const override { return model_.snapshot(); }
  void restore(const std::string& js) override;
  bool sounding() const override { return !model_.still(); }
  const Model& model() const { return model_; }

 private:
  struct Note {                                         // колокол или тимпан
    bool on = false, tri = false;
    double t0 = 0, end = 0, f = 0, ratio = 0, gl = 0, gr = 0;
    sdk::Param vca, mg, fr;                             // громкость; колокол — индекс; тимпан — частота
    sdk::Osc car, mod;
  };
  struct Burst {
    bool on = false;
    double t0 = 0, end = 0, gl = 0, gr = 0;
    sdk::Param g;
    sdk::Biquad bp;
  };
  void events();                                        // события модели → голоса (в начале блока)
  void startVoices();
  void bell(int i, double f, double vel, double pan);
  void thud(int i, double vn);
  void burst(double f, double pan, double k);
  void drone();
  void applyFx();

  Model model_;
  double sr_ = 48000, t_ = 0;                           // время мира — сэмплы от prepare
  // дрон
  bool vo_ = false;
  double voStop_ = -1, quiet_ = 0;                      // гаснет в voStop_ (50 мс после решения); quiet_ — секунды тишины
  sdk::Param dFreq_[NB], dVca_[NB], dPan_[NB], dMg_[NB];
  sdk::Osc dOsc_[NB];
  // петля FM: 0 → 1 и 1 → 2 — тот же сэмпл, 2 → 0 — сквозь задержку 2 мс и квант (128 + 0.002·sr сэмплов, дробное — по прямой).
  // У браузера место разрыва петли — случайное на каждый AudioContext (порядок входов pre в хеш-таблице): квант встаёт на 0 → 1,
  // на 1 → 2 или на задержку — примерно поровну (Chromium, 30 контекстов); здесь — третий, «на задержке», как задумано в engine.js
  float h2_[1024] = {};                                 // 128 + 2 мс — до 512 сэмплов (192 кГц)
  int h2At_ = 0;
  double dl_ = 224;
  Note notes_[NOTES];
  Burst bursts_[BURSTS];
  int liveNotes_ = 0;
  double strikes_ = 0, encounters_ = 0;
  sdk::Rng rng_{1};
  sdk::Shaper<1024> shaper_;
  sdk::Param hall_;
  // услышанное: записи по блокам, копятся до heard()
  static constexpr int HMAX = 512;
  double hbuf_[HMAX];
  int hn_ = 0;
  double tmpA_[128], tmpB_[128], tmpC_[128];
  double pre_[2][128];
  double dfq_[NB][128], dvc_[NB][128], dpn_[NB][128], dmg_[NB][128];
};

}  // namespace tria
