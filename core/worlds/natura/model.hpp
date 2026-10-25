// Natura — модель (порт worlds/natura/model.js, эталон — tools/ref/natura-model.js): секвенсер-река. Кувшинки на 16 местах (место — шаг,
// нота — ступень лада поперёк, цветок — голос), длина петли, общие fx и свои значения кувшинки (lock). Только данные и алгоритм —
// без звука. Что играет шаг и сколько он длится — stepNote / stepSec; высота — noteHz по ладу хоста (const Scale&).
// Состояние целиком (setState) — для проверок и первой загрузки; действия по одному (plant, remove, move …), снимок и restore — тот же JSON, что у model.js.
#pragma once
#include <cmath>
#include "../../host/scale.hpp"
#include <string>
#include "../../sdk/rng.hpp"

namespace natura {

constexpr int NPAD = 16;
enum Fx { REVERB, DELAY, TIME, CHORUS, CUTOFF, RES, ATT, REL, CHANCE, NFX };   // как fx в model.js: ключи reverb … chance
enum Lock { L_CUTOFF, L_RES, L_ATT, L_REL, NLOCK };                           // свои значения кувшинки: cutoff, res, att, rel
constexpr double GONE_S = 4;                                                   // утки улетели — огибающая открыта 4 с

struct Pad {
  bool on = false;
  int note = 0, wave = 0;                                                      // ступень лада 0…14; цветок 0…4
  bool glide = false;
  double chance = -1;                                                          // −1 — не задан (то же, что 1)
  double lock[NLOCK] = {-1, -1, -1, -1};                                       // −1 — общее значение пейзажа
};

struct Note {                                                                  // голос ноты, как voice(pd) в model.js
  int wave = 0;
  double hz = 110, from = 0, glide = 0, cutoff = 0.5, res = 0.25, att = 0.01, rel = 0.3;
};

class Model {
 public:
  explicit Model(const Scale& scale) : scale_(scale) { reset(); }
  void reset();                                                                // сцена по умолчанию, как у новой model.js
  // состояние целиком (этап 1): [bpm, len, fx×9, 16 × (занято, note, wave, glide, chance, cutoff, res, att, rel)]
  static constexpr int STATE_N = 2 + NFX + NPAD * 9;
  bool setState(const double* a, int n);
  // действия фасада (worlds/natura/model.js) — по одному, как методы прежней JS-модели; нет места / нет кувшинки — молча
  void plant(int i, int note, int wave);                                       // на свободное место
  void remove(int i);
  void move(int i, int j);                                                     // на свободное место j
  void setNote(int i, int n);
  void setLen(int n);
  void setGlide(int i, bool on);
  void setWave(int i, int w);
  void setChance(int i, double v);
  void setLock(int i, int k, double v);
  void unlock(int i, int k);                                                   // k = 0…3 — снова общее значение; 4 — шанс снова 1
  void setFx(int k, double v);
  void setBpm(double b);
  void clear();
  std::string snapshot() const;                                                // {fx, len, at, bpm} — как JSON.stringify модели
  void restore(const std::string& js);

  double fx(int k) const { return fx_[k]; }
  double bpm() const { return bpm_; }
  int len() const { return len_; }
  const Pad& pad(int i) const { return pad_[i]; }
  bool any() const;                                                            // есть кувшинка в пределах длины петли

  bool scaleOn() const { return scale_.on; }
  double stepSec() const { return 60 / bpm_ / 4; }
  double delaySec() const;                                                     // время задержки — доля темпа по fx.time
  double noteHz(int n) const;                                                  // ступень лада от тоники (без лада — ля минор), две октавы с лишним
  double skiffHz(double q) const;                                              // голос кораблика: поперёк реки — высота (с ладом по ступеням)
  double val(const Pad& p, int k) const { const int l = k - CUTOFF; return (l >= 0 && l < NLOCK && p.lock[l] >= 0) ? p.lock[l] : fx_[k]; }
  bool envOpen() const { return hasGone_ && time_ - goneAt_ < GONE_S; }
  Note voice(const Pad& p);                                                    // нота кувшинки; запоминает prevHz (откуда глайд следующей)
  bool stepNote(long step, sdk::Rng& rng, Note& out, int& idx);                // шаг петли: пустое место и «не выпало» — false
  void scare() { goneAt_ = time_; hasGone_ = true; }                           // кораблик в заводи — утки улетают
  void advance(double dt) { time_ += dt; }
  double time() const { return time_; }

 private:
  const Scale& scale_;
  double fx_[NFX], bpm_ = 96, prevHz_ = 0, time_ = 0, goneAt_ = 0;
  int len_ = 12;
  bool hasGone_ = false;
  Pad pad_[NPAD];
};

}  // namespace natura
