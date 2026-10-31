// Arcadia — мир SDK: страна и странники (model.hpp) + синтез по рельефу (sound.hpp) + шина. Действия правят модель и шлют голосу то же,
// что прежний worlds/arcadia/engine.js слал worklet-у (f = hzOf, дом, петля, lvl·0.7, путь, pan = u·0.8; params: relief, скорость
// 0.01·40^pace, wind, spread). Новая страна — по кускам, звучит через LAND_BLOCKS блоков (пути river / summit тогда же пересчитываются).
// Шина (как цепочка Web Audio прежнего engine.js):
//   петли → pre → сухо + фейзер (6 allpass 320·1.7ⁱ, Q 0.6, LFO 0.11 Гц × (150 + 650·phaser), мокрое phaser·0.95) → mix
//   mix → сухо × (1 − 0.3·chorus) + хор (13 / 19 мс, 0.27 / 0.19 Гц, глубины 3.5 / 4.5 мс, ∓0.8, мокрое chorus·0.75) → ×1.5 — сухой выход;
//   mix · hall²·1.4 · 1.5 — посыл в hall. Ручки — сглаживание 0.05 с; фейзер и хор при ≤ 0.01 не кормятся (как отцеплены).
// Всё молчит полсекунды — шина не считается (LFO идут).
#pragma once
#include "../../sdk/chorus.hpp"
#include "../../sdk/phaser.hpp"
#include "../../sdk/smooth.hpp"
#include "../../sdk/world.hpp"
#include "model.hpp"
#include "sound.hpp"

namespace arcadia {

// action(kind, i, a, n):
//   ADD i — слот, a = [u, v, oct, r, fig, mode, sp, lvl] (не хватает — по умолчанию);  DROP i;  MOVE i, a = [u, v];
//   SET i, a = [key (Key), v, route (0/1 — путь пересчитать)];  FX i = key (Fx), a = [v];  LAND a = [seed];  CLEAR
//   ACT_LFO i = -1 — a = [Fx 0…6, v 0…1];  i = слот — a = [Key r 3 / sp 6 / lvl 7, v 0…1]; прочее — пропуск
enum Act { ADD, DROP, MOVE, SET, FX, LAND, CLEAR };

// зеркало: fx [NFX], зерно, страна считается (0/1), затем на слот SLOT_M: есть, u, v, oct, r, fig, mode, sp, lvl, f, cx, cy, rs, уровень
constexpr int SLOT_M = 14, MIRROR_HEAD = NFX + 2, MIRROR_N = MIRROR_HEAD + VMAX * SLOT_M;
constexpr double OUT = 1.5, HALL_K = 1.4;

class World : public sdk::World {
 public:
  explicit World(const Scale& scale) : model_(scale) {}
  void prepare(double sr, uint32_t seed) override;
  void action(int kind, int i, const double* a, int n) override;
  void process(const sdk::Out& out, int n) override;
  sdk::Rev rev() const override { return sdk::Rev::hall; }
  int mirror(double* buf, int cap) const override;
  int heard(double*, int) override { return 0; }      // центры петель и уровни — в зеркале
  std::string snapshot() const override { return model_.snapshot(); }
  void restore(const std::string& js) override;
  bool sounding() const override { return model_.sounding(); }
  const Model& model() const { return model_; }
  const Land& land() const { return model_.cur(); }   // звучащая страна (тесты, картинка в нативе)

 private:
  void sendT(int slot, bool on, bool withRoute);
  void applyFx();
  void addT(int slot, const double* k);
  void dropT(int slot);
  void clear() { while (model_.count()) dropT(model_.order(0)); }

  Model model_;
  Sound sound_;
  sdk::Phaser<6> phaser_;
  sdk::Chorus<2, 4096> chorus_;                         // 19 + 4.5 мс при 96 кГц — с запасом
  sdk::OnePole chDry_, hallG_;
  double chDryTo_ = 1, hallTo_ = 0, c_ = 0, sr_ = 48000, f_[VMAX] = {};
  bool phOn_ = false, chOn_ = false;
  int quiet_ = 0;
  float pL_[128], pR_[128], fL_[128], fR_[128], cL_[128], cR_[128];
};

}  // namespace arcadia
