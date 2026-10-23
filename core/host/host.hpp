// Хост SDK: миры по слотам (номер мира), сухой выход каждого отдельно, посыл × фейдер → четыре общих ревербера → возврат.
// Внешние посылы (веб, переходный период): по стереовходу на тип, суммируются с посылами миров; мост пишет их до process,
// хост обнуляет после. Буферы фиксированные, под 128 кадров; в process аллокаций нет. Объект ~1.2 МБ (4 ревербера) —
// на стек не класть. Контракт: prepare до process.
#pragma once
#include <cstdint>
#include "../sdk/world.hpp"
#include "scale.hpp"

class Host {
 public:
  static constexpr int SLOTS = 16;                      // номер мира
  static constexpr int BLOCK = 128;
  static constexpr float RET = 0.9f;                    // усиление суммы возвратов

  void prepare(double sr, uint32_t seed);               // готовит все четыре ревербера (сид — seed + номер типа)
  void add(int slot, sdk::World* w);                    // мир не принадлежит хосту; prepare мира — на вызывающем
  void action(int slot, int kind, int i, const double* a, int n);
  void process(int n);                                  // n ≤ 128
  const float* dry(int slot, int ch) const;             // сухой выход слота (ch 0 — L, 1 — R)
  const float* ret(int ch) const;                       // возврат ревербов
  float* ext(sdk::Rev r, int ch);                       // внешний посыл типа r
  void fader(int slot, double g);                       // посыл мира идёт после фейдера
  void scale(bool on, int idx, int root);
  const Scale& scale() const { return scale_; }

 private:
  sdk::World* w_[SLOTS] = {};
  float gain_[SLOTS] = {};                              // 0 у пустых; add ставит 1
  float dry_[SLOTS][2][BLOCK] = {};
  float sendL_[BLOCK] = {}, sendR_[BLOCK] = {};         // посыл мира перед фейдером
  float rin_[4][2][BLOCK] = {}, rout_[4][2][BLOCK] = {};
  float ext_[4][2][BLOCK] = {};
  float ret_[2][BLOCK] = {};
  Scale scale_;
  sdk::Reverb rev_[4];
};
