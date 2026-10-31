// Inferno — мир SDK (слот 5): модель (model.hpp) + звук (sound.hpp). События модели правят звук, как on(e) в worlds/inferno/engine.js:
// strike → удар, burn → тлеет / гаснет по burning(k), tune → перенастроить круг, color → сменить шум, ice и fx → перенастроить все девять.
// Посыл — дым (уже ×3/(1+fire·1.5), как smRet), ревербер — hall; сухой выход — шина мира без фейдера. Коды action, раскладки зеркала и
// услышанного — здесь; фасад в JS (worlds/inferno/model.js) — те же.
#pragma once
#include "../../sdk/world.hpp"
#include "model.hpp"
#include "sound.hpp"

namespace inferno {

// action(kind, i, a, n):
//   ACT_STRIKE i = круг, a = [vel]   POS i = круг, a = [pos]   HOLD i = круг, a = [±1]   PIN i = круг, a = [pos]
//   CIRC   i = круг, a = [key (Key: pos, width, drive, level, color), v]
//   FX     i = ключ (Fx: structure, fire, smoke, ice, storm), a = [v]
//   CLEAR, DICE
//   sdk::ACT_LFO  i = -1: a = [Fx 0…4, v]; i = круг: a = [Key 0…3, v] (цвет пропускается)
enum Act { ACT_STRIKE, ACT_POS, ACT_HOLD, ACT_PIN, ACT_CIRC, ACT_FX, ACT_CLEAR, ACT_DICE };

// зеркало: time, iceE, stormSemi, stormPh, fx [NFX], затем на круг CIRC_N чисел: pos, sinner, held, color, width, drive, level, lvl
constexpr int MIRROR_HEAD = 4 + NFX, CIRC_N = 8, MIRROR_MAX = MIRROR_HEAD + NC * CIRC_N;
// услышанное с прошлого вызова: n, затем номера кругов с ударом (view: угольки)
constexpr int HEARD_MAX = 1 + 64;
constexpr uint32_t SOUND_SEED = 0x9E3779B9u;            // зерно звука — зерно мира ^ это (у модели — само зерно)

class Inferno : public sdk::World {
 public:
  explicit Inferno(const Scale& scale) : model_(scale) { model_.listen(&Inferno::onEvent, this); }
  void prepare(double sr, uint32_t seed) override;
  void action(int kind, int i, const double* a, int n) override;
  void process(const sdk::Out& out, int n) override;
  sdk::Rev rev() const override { return sdk::Rev::hall; }
  int mirror(double* buf, int cap) const override;
  int heard(double* buf, int cap) override;
  std::string snapshot() const override { return model_.snapshot(); }
  void restore(const std::string& js) override { model_.restore(js); }
  bool sounding() const override { return model_.sounding(); }
  const Model& model() const { return model_; }
  Sound& sound() { return sound_; }

 private:
  static void onEvent(void* self, const Ev& e) { static_cast<Inferno*>(self)->on(e); }
  void on(const Ev& e);
  void retune(int k);
  void applyFx();

  Model model_;
  Sound sound_;
  double sr_ = 48000;
};

}  // namespace inferno
