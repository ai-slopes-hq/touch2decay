// Monochordum — мир SDK: модель (model.hpp) + струны (sound.hpp) + шина + автострам. События модели правят звук, как
// worlds/monochord/engine.js до SDK D1: tune → частота hzOf, яркость (s.bright + fx.bright)/2, затухание (s.decay + fx.decay)/2,
// level; fx → дека, хор, связь струн 0.0015·sympathy, посыл, перестройка всех струн. Шина (как цепочка Web Audio прежнего engine.js):
//   струны → сухо + дека (bandpass 190/3, 420/4, 1100/5 · body·2.5) → mix → сухо + хор (две линии 12 / 19 мс, 0.31 / 0.47 Гц,
//   панорама ∓0.7, wet chorus·0.9, глубина 0.001 + 0.004·chorus) → post → ×2.2 сухой выход; post · hall²·1.4 ·2.2 — посыл в hall.
// Ручки шины сглаживаются как setTargetAtTime(·, 0.05). Автострам — sdk::Steps по часам хоста (свой темп или сетка MIDI):
// шаг → autoStep модели → щипки по времени с точностью до сэмпла; удар — «услышано».
#pragma once
#include "../../sdk/biquad.hpp"
#include "../../sdk/chorus.hpp"
#include "../../sdk/smooth.hpp"
#include "../../sdk/world.hpp"
#include "model.hpp"
#include "sound.hpp"

namespace monochord {

// action(kind, i, a, n):
//   PLUCK i, a = [pos, vel];  HARM i, a = [n, vel];  BOW i, a = [amp];  SUS i, a = [on]
//   BRIDGE i, a = [r] (прилипает к ладам);  STRING i, a = [key (Key: pitch, bright, decay, level, r), v]
//   WIND a = [v];  FX i = key (Fx), a = [v];  AUTO a = [on];  AUTOPAR i = key (AutoKey: bpm, div, pattern, strength, swing), a = [v]
//   CLEAR;  DICE (подставки на лады, струны поют сами, ветер — как кубик фасада)
//   ACT_LFO (i = −1), a = [код, v]: FX 0…6 = Fx; ветер 7; strength 8; swing 9; струна i, строка k (pitch, bright, decay, level) — 10 + 4·i + k
enum Act { PLUCK, HARM, BOW, SUS, BRIDGE, STRING, WIND, FX, AUTO, AUTOPAR, CLEAR, DICE };

// зеркало: fx [NFX], wind, lastWind, auto [NAUTO], шаг автострама, затем на струну STR_M: r, sus, bright, decay, level, bow, en, eh, hn
constexpr int STR_M = 9, MIRROR_HEAD = NFX + 2 + NAUTO + 1, MIRROR_N = MIRROR_HEAD + N * STR_M;
constexpr double OUT = 2.2, HALL_K = 1.4;

class World : public sdk::World {
 public:
  explicit World(const Scale& scale) : model_(scale) { model_.listen(&World::onEvent, this); }
  void prepare(double sr, uint32_t seed) override;
  void action(int kind, int i, const double* a, int n) override;
  void process(const sdk::Out& out, int n) override;
  sdk::Rev rev() const override { return sdk::Rev::hall; }
  int mirror(double* buf, int cap) const override;
  int heard(double* buf, int cap) override;             // [ударов автострама с прошлого раза, номер последнего шага]; нет — 0 чисел
  std::string snapshot() const override { return model_.snapshot(); }
  void restore(const std::string& js) override { model_.restore(js); }
  bool sounding() const override { return model_.sounding(); }
  void attach(const sdk::Clock* c) override { clk_ = c; }
  const Model& model() const { return model_; }

 private:
  static void onEvent(void* self, const Ev& e) { static_cast<World*>(self)->on(e); }
  void on(const Ev& e);
  void retune(int i);
  void applyFx();

  Model model_;
  Sound sound_;
  sdk::Biquad body_[3][2];                              // дека: три bandpass на канал
  sdk::Chorus<2, 8192> chorus_;                         // 50 мс при 96 кГц — с запасом
  sdk::OnePole bodyG_, hallG_;
  sdk::Steps steps_;
  const sdk::Clock* clk_ = nullptr;
  double bodyTo_ = 0, hallTo_ = 0, c_ = 0, sr_ = 48000, now_ = 0;
  bool chorusOn_ = false;
  int quiet_ = 0, hits_ = 0;
  long lastStep_ = 0;
  struct Pend { double t; long step; };                // удар поставлен, но ещё не прозвучал: «услышан» — в блоке, где его время
  Pend pend_[16];
  int npend_ = 0;
  float pL_[128], pR_[128], cL_[128], cR_[128];
};

}  // namespace monochord
