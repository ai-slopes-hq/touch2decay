// Firmamentum — мир SDK: модель (model.hpp) + звук (sound.hpp). События модели правят голоса, как sendStar в worlds/firmamentum/engine.js:
// звезда целиком (lvl·0.55, pan = u·0.8), одна частота (fp / ff), fx → jit, spread, crep, fulg. В process — блок звука, потом шаг модели.
// Посыл — сухой × fx.hall²·1.5·2.5, ревербер — hall (×2.5 — см. process в world.cpp). Коды action и раскладки зеркала и услышанного — здесь; фасад в JS
// (tools/models/firmamentum-core.mjs, потом worlds/firmamentum/model.js) — те же.
#pragma once
#include "../../sdk/world.hpp"
#include "model.hpp"
#include "sound.hpp"

namespace firmamentum {

// action(kind, i, a, n):
//   ADD    a = [h, u, slot?, id?]     — slot / id от UI (слот занят или −1 — первый свободный).
//          id от UI ядро берёт как есть, если он > 0 и такой звезды сейчас нет (даже если он меньше уже виденных); 0 или живой id —
//          ядро выдаёт своё: на 1 больше всех виденных (своих и от UI), так что своё никогда не совпадает с живым. Свои id ядро
//          выдаёт и в dice, и в restore без id. Фасад в вебе (worlds/firmamentum/model.js) сам выбирает id всем звёздам (add, restore
//          и кубик — со slot и id), поэтому его звёзды и звёзды ядра совпадают по id, даже пока зеркало не догнало (асинхронный порт).
//   CLOSE  i = id
//   MOVE   i = id, a = [h, u]
//   SET    i = id, a = [key (Key: cyc, win, mask, lvl, h, u), v]
//   FX     i = key (Fx: scintilla … hall), a = [v]
//   CLEAR, DICE, LAUNCH
enum Act { ADD, CLOSE, MOVE, SET, FX, CLEAR, DICE, LAUNCH };

// зеркало: time, comets, comet [on, a.h, a.u, b.h, b.u, t0, dur] (без кометы — on 0 и нули), fx [NFX], число звёзд,
// затем на звезду STAR_N чисел: slot, id, h, u, cyc, win, mask, lvl, dr, cm, fp, ff, gain (громкость голоса — сияние звезды во view),
// count (сколько пульсаретов прозвучало)
constexpr int MIRROR_HEAD = 2 + 7 + NFX + 1, STAR_N = 14, MIRROR_MAX = MIRROR_HEAD + SMAX * STAR_N;

// услышанное с прошлого вызова (как {pulsed, dust, bolts} у engine.js): np, слоты звёзд с новым пульсаретом (по порядку звёзд),
// nd, пары (pan, a) щелчков треска, nb, слоты вспышек
constexpr int HEARD_MAX = 1 + SMAX + 1 + Sound::CKMAX * 2 + 1 + Sound::FLMAX;
static_assert(SMAX == Sound::VMAX, "звезда — голос");
constexpr uint32_t SOUND_SEED = 0x9E3779B9u;            // зерно звука — зерно мира ^ это (у модели — само зерно)

class Firmamentum : public sdk::World {
 public:
  explicit Firmamentum(const Scale& scale) : model_(scale) { model_.listen(&Firmamentum::onEvent, this); }
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
  static void onEvent(void* self, const Ev& e) { static_cast<Firmamentum*>(self)->on(e); }
  void on(const Ev& e);                                 // событие модели → голоса
  void applyFx();

  Model model_;
  Sound sound_;
  double sr_ = 48000;
  double counts_[SMAX] = {};                            // счётчики пульсаретов на прошлом heard
};

}  // namespace firmamentum
