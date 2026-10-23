// Goetia — мир SDK: модель (model.hpp) + bytebeat (goetia.hpp, без изменений) + эхо и шина. События модели правят звук, как
// worlds/goetia/engine.js до SDK B (sendSpirit): программа печати, rate, lp = 1 − e^(−2π·fc/sr), lvl·0.3, legio, rel, trig,
// pan = [−0.6, 0, 0.6][slot]; fx → fx(spread, legio), эхо и посыл. Шина (как цепочка Web Audio прежнего engine.js):
//   звук → ×1.6 → сухой выход;  звук · echo·0.8 → TapeEcho (0.375 с, LP 2600, обратная связь echo·0.55) → ×1.6 → сухой выход;
//   звук · hall²·1.5 (сглаженный, 0.05 с) ×1.6 → посыл, ревербер hall. Эхо — стерео: по ленте на канал, как DelayNode со стерео.
// Коды action и раскладка зеркала — здесь; фасад в JS (worlds/goetia/model.js, tools/models/goetia-core.mjs) — те же.
#pragma once
#include "../../sdk/echo.hpp"
#include "../../sdk/smooth.hpp"
#include "../../sdk/world.hpp"
#include "goetia.hpp"
#include "model.hpp"

namespace goetia {

// action(kind, i, a, n):
//   SUMMON  a = [slot, born, semi, tone, rel, legio, lvl, узлы…]   — slot / born от UI (правило — Model::summon)
//   PATH    i = born, a = узлы (печать растёт, пока палец ведёт)
//   BANISH  i = born
//   SET     i = born, a = [key (Key: semi, tone, rel, legio, lvl), v]
//   FX      i = key (Fx: legio, echo, spread, hall), a = [v]
//   CLEAR, DICE
//   SETT    i = slot, a = [t]                                     — только тесты: стартовое t голоса
enum Act { SUMMON, PATH, BANISH, SET, FX, CLEAR, DICE, SETT };

// зеркало: fx [NFX], число духов, затем на духа SPIRIT_N чисел: slot, born, semi, tone, rel, legio, lvl, np, узлы [SEAL_MAX],
// t (счётчик первого легиона — огонёк по печати), gain (громкость голоса с огибающей — мигание узлов)
constexpr int MIRROR_HEAD = NFX + 1, SPIRIT_N = 8 + SEAL_MAX + 2, MIRROR_MAX = MIRROR_HEAD + SMAX * SPIRIT_N;
static_assert(SMAX == VMAX, "дух — голос");
constexpr double OUT = 1.6, HALL_K = 1.5, ECHO_TIME = 0.375, ECHO_LP = 2600;

class World : public sdk::World {
 public:
  explicit World(const Scale& scale) : model_(scale) { model_.listen(&World::onEvent, this); }
  void prepare(double sr, uint32_t seed) override;
  void action(int kind, int i, const double* a, int n) override;
  void process(const sdk::Out& out, int n) override;
  sdk::Rev rev() const override { return sdk::Rev::hall; }
  int mirror(double* buf, int cap) const override;
  int heard(double*, int) override { return 0; }        // услышанного нет: view читает t и уровни из зеркала
  std::string snapshot() const override { return model_.snapshot(); }
  void restore(const std::string& js) override { model_.restore(js); }
  bool sounding() const override { return model_.count() > 0; }
  const Model& model() const { return model_; }

 private:
  static void onEvent(void* self, const Ev& e) { static_cast<World*>(self)->on(e); }
  void on(const Ev& e);
  void applyFx();

  Model model_;
  Goetia sound_{48000};
  sdk::TapeEcho<36864> echo_[2];                        // 0.375 с при 96 кГц
  sdk::OnePole hall_;
  double hallTo_ = 0, c_ = 0, sr_ = 48000;
  float eL_[128], eR_[128];
};

}  // namespace goetia
