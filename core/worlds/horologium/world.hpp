// Horologium — мир SDK: модель колец и хода (model.hpp) + колесо и ударные голоса с DJ-фильтром на кольцо (sound.hpp, drums.hpp) + шина.
// Каждый блок модель отдаёт звуку: скорость Fnow, тонику, кольца (в том числе высоту pitch и flt), fx и окраску tint; замок к такту MIDI — по сетке
// хоста, пока колесо идёт (оборот = 4 доли). Шина (как прежний engine.js): выход ×2.4; посыл hall²·1.4 (сглаженный, 0.05 с) ×2.4 в hall.
// Ход колеса — только bpm и пуск / стоп.
#pragma once
#include "../../sdk/smooth.hpp"
#include "../../sdk/world.hpp"
#include "model.hpp"
#include "sound.hpp"

namespace horologium {

// action(kind, i, a, n):
//   RING i, a = [key (RingKey: on, under, phi, lvl, inst, len, flt), v];  FX i = key (Fx), a = [v]
//   RUN a = [on];  BPM a = [bpm];  CLEAR;  DICE;  HELD, STEP, SPEED — выведены из оборота, игнорируются (номера остаются)
//   ACT_LFO (i == -1) a = [key, v]: key 0…4 — Fx, 5…20 — кольцо (key − 5) / 2: нечётный — phi, чётный — lvl; 21…28 — flt кольца key − 21
enum Act { RING, FX, RUN, HELD, STEP, BPM, SPEED, CLEAR, DICE };

// зеркало: fx [NFX], run, bpm, P, F, ударов всего, замок, затем на кольцо RING_M: on, under, phi, lvl, inst, len, flt
constexpr int RING_M = 7, MIRROR_HEAD = NFX + 6, MIRROR_N = MIRROR_HEAD + NR * RING_M;
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
