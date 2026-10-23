// Firmamentum — мир SDK: модель (model.hpp) + звук. Звук пока — тишина (задача 5 SDK A); время модели идёт в process.
// Коды action и раскладка зеркала — здесь; фасад в JS (tools/models/firmamentum-core.mjs, потом worlds/firmamentum/model.js) — те же.
#pragma once
#include "../../sdk/world.hpp"
#include "model.hpp"

namespace firmamentum {

// action(kind, i, a, n):
//   ADD    a = [h, u, slot?, id?]     — slot / id от UI (занят, −1, 0 — ядро выберет само)
//   CLOSE  i = id
//   MOVE   i = id, a = [h, u]
//   SET    i = id, a = [key (Key: cyc, win, mask, lvl, h, u), v]
//   FX     i = key (Fx: scintilla … hall), a = [v]
//   CLEAR, DICE, LAUNCH
enum Act { ADD, CLOSE, MOVE, SET, FX, CLEAR, DICE, LAUNCH };

// зеркало: time, comets, comet [on, a.h, a.u, b.h, b.u, t0, dur] (без кометы — on 0 и нули), fx [NFX], число звёзд,
// затем на звезду STAR_N чисел: slot, id, h, u, cyc, win, mask, lvl, dr, cm, fp, ff
constexpr int MIRROR_HEAD = 2 + 7 + NFX + 1, STAR_N = 12, MIRROR_MAX = MIRROR_HEAD + SMAX * STAR_N;

class Firmamentum : public sdk::World {
 public:
  explicit Firmamentum(const Scale& scale) : model_(scale) {}
  void prepare(double sr, uint32_t seed) override;
  void action(int kind, int i, const double* a, int n) override;
  void process(const sdk::Out& out, int n) override;
  sdk::Rev rev() const override { return sdk::Rev::hall; }
  int mirror(double* buf, int cap) const override;
  int heard(double* buf, int cap) override;
  std::string snapshot() const override { return model_.snapshot(); }
  void restore(const std::string& js) override { model_.restore(js); }
  bool sounding() const override { return model_.count() > 0; }
  const Model& model() const { return model_; }

 private:
  Model model_;
  double sr_ = 48000;
};

}  // namespace firmamentum
