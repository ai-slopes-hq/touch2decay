// Horologium — мир SDK: модель хода и колец (model.hpp) + колесо и кольца (sound.hpp) + шина. Каждый блок: ход успокаивается (tick),
// колесу — скорость Fnow, тоника, кольца и fx; замок к такту MIDI — по сетке хоста, пока часы идут, u = 0 и маятник не в руке
// (оборот = 4 доли). Шина (как прежний engine.js): выход ×2.4; посыл hall²·1.4 (сглаженный, 0.05 с) ×2.4 в hall.
// Маятник (где груз, бросок, проход через низ) — в фасаде веба: сюда — пуск / стоп и u, «в руке», спуск, шкала tempus.
#pragma once
#include "../../sdk/smooth.hpp"
#include "../../sdk/world.hpp"
#include "model.hpp"
#include "sound.hpp"

namespace horologium {

// action(kind, i, a, n):
//   RING i, a = [key (RingKey: on, under, phi, lvl), v];  FX i = key (Fx), a = [v]
//   RUN a = [on, u?] (u нет — uT);  HELD a = [on];  STEP a = [d];  BPM a = [bpm];  SPEED a = [u, uT, strip];  CLEAR
enum Act { RING, FX, RUN, HELD, STEP, BPM, SPEED, CLEAR };

// зеркало: fx [NFX], run, u, uT, bpm, strip, held, P, F, ударов всего, замок, затем на кольцо RING_M: on, under, phi, lvl
constexpr int RING_M = 4, MIRROR_HEAD = NFX + 10, MIRROR_N = MIRROR_HEAD + NR * RING_M;
constexpr double OUT = 2.4, HALL_K = 1.4;

class World : public sdk::World {
 public:
  explicit World(const Scale& scale) : model_(scale) {}
  void prepare(double sr, uint32_t seed) override;
  void action(int kind, int i, const double* a, int n) override;
  void process(const sdk::Out& out, int n) override;
  sdk::Rev rev() const override { return sdk::Rev::hall; }
  int mirror(double* buf, int cap) const override;
  int heard(double* buf, int cap) override;             // [ударов, P, номера колец…] с прошлого раза; нет ударов — 0 чисел
  std::string snapshot() const override { return model_.snapshot(); }
  void restore(const std::string& js) override { model_.restore(js); }
  bool sounding() const override { return model_.sounding(); }
  void attach(const sdk::Clock* c) override { clk_ = c; }
  const Model& model() const { return model_; }

 private:
  Model model_;
  Sound sound_;
  sdk::OnePole hallG_;
  const sdk::Clock* clk_ = nullptr;
  double hallC_ = 0, sr_ = 48000, now_ = 0;
  bool locked_ = false;
  int hit_[Sound::HMAX] = {}, nh_ = 0;
};

}  // namespace horologium
