// Cymatica — мир SDK (слот 2), этап 1: звук пластины и часы секвенсера (plate.hpp). Модель пока в вебе (worlds/cymatica/model.js) —
// она шлёт сообщения, engine.js переводит их в action (worlds/cymatica/bridge.js — те же коды и раскладка).
// Сухой выход — как у старого worklet (pre-×2.5 остался в engine.js, как у Firmamentum); посыл в пластинчатый ревербер — hall²·1.4·2.5
// (прежний ×1.4 у GainNode и ×2.5 после возврата зала), с плавным ходом (tau 0.05 с, как setTargetAtTime).
#pragma once
#include "../../sdk/smooth.hpp"
#include "../../sdk/world.hpp"
#include "plate.hpp"

namespace cymatica {

// action(kind, i, a, n):
//   PARAMS a = [structure, damping, brightness]
//   F0     a = [hz]
//   STRIKE a = [x, y, hz, vel, hard, rec]       — NaN в hz / vel / hard: по умолчанию (f0, 1, 0.5)
//   SEQ    a = SEQ_N чисел, см. plate.hpp
//   LOCK   a = [off, t0, p]                     — t0 во времени ядра, секунды
//   BOW    i = id, a = [on, x, y, exciter, pressure, amp]   — NaN: как было
//   FX     a = [hall]                           — посыл в зал
enum Act { PARAMS, F0, STRIKE, SEQ, LOCK, BOW, FX };

// зеркало: энергии мод NM, затем (hz, level) каждого из NV голосов
constexpr int MIRROR_N = NM + NV * 2;
// услышанное: записи по 5 — [1, r, m, time, hit] на каждый сыгранный шаг
constexpr int HEARD_REC = 5, HEARD_MAX = HEARD_CAP * HEARD_REC;
constexpr double SEND_K = 1.4 * 2.5, SEND_TAU = 0.05;

class Cymatica : public sdk::World {
 public:
  void prepare(double sr, uint32_t seed) override;
  void action(int kind, int i, const double* a, int n) override;
  void process(const sdk::Out& out, int n) override;
  sdk::Rev rev() const override { return sdk::Rev::plate; }
  int mirror(double* buf, int cap) const override;
  int heard(double* buf, int cap) override;
  std::string snapshot() const override { return "{}"; }   // модель — в вебе, этап 2
  void restore(const std::string&) override {}
  bool sounding() const override { return plate_.sounding(); }
  const Plate& plate() const { return plate_; }

 private:
  Plate plate_;
  sdk::OnePole send_;
  double hall_ = 0.25, sendC_ = 0;
};

}  // namespace cymatica
