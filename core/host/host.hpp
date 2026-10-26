// Хост SDK: миры по слотам (номер мира), сухой выход каждого отдельно, посыл × фейдер → четыре общих ревербера → возврат.
// Внешние посылы (веб, переходный период): по стереовходу на тип, суммируются с посылами миров; мост пишет их до process,
// хост обнуляет после. Буферы фиксированные, под 128 кадров; в process аллокаций нет. Объект ~1.2 МБ (4 ревербера) —
// на стек не класть. Контракт: prepare до process.
//
// Дополнено: мастер (LPF, компрессор, потолок knee), LFO строк (tick + хранилище), тик моделей (dt), единый C-ABI мост.
#pragma once
#include <cstdint>
#include <vector>
#include "../sdk/world.hpp"
#include "../sdk/lfo.hpp"
#include "../sdk/biquad.hpp"
#include "../sdk/knee.hpp"
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

  // Часы: время начала следующего блока (секунды контекста; не задали — хост ведёт сам, +n/sr за блок), MIDI-часы, сетка.
  // Байт — от входа src (у каждого входа свой счёт тиков); сообщение — уже разобранное (оболочка iOS: доля, темп, пуск, стоп).
  // События часов для хоста веба (кого запускать) — кольцо, забирает events(); их немного: раз в долю.
  void time(double t) { clk_.now = t; }
  void midiByte(int src, int status, double at);
  void midiMsg(int kind, double n, double bpm, double at);   // kind — sdk::MidiMsg::Type
  const sdk::Clock& clock() const { return clk_; }
  int events(double* buf, int cap);                     // по 2 числа: код (sdk::Follower::Ev), bpm; очищает

  // Мастер: LPF, компрессор (thr, ratio), потолок knee. Применяются к ret_ после суммы ревербов, до выхода.
  void masterLpf(double hz);                            // cutoff LPF
  void masterComp(double thr, double ratio);            // компрессор: порог дБ, отношение
  void masterCeil(double db);                           // потолок knee: db от −12…0
  const float* master(int ch) const;                    // выход мастера (ch 0 — L, 1 — R)

  // LFO строк: add/remove/tick, get возвращает текущее значение строки.
  int addLfo(int world, const char* key, double base, int shape);   // shape 0 — classic, 1 — random; возвращает индекс
  void removeLfo(int idx);
  void lfoSpec(int idx, double m0, double m1, double r0, double r1, double d0, double d1);   // параметры LFO: morph, rate, depth — по два числа (начало, конец)
  double lfoValue(int idx) const;
  void lfoTick(double dt);                              // сдвиг фаз всех LFO

  // Тик моделей: вызывается раз в блок, dt — время блока в секундах. Миры с tick() получают dt.
  void modelTick(double dt);

 private:
  sdk::World* w_[SLOTS] = {};
  float gain_[SLOTS] = {};                              // 0 у пустых; add ставит 1
  float dry_[SLOTS][2][BLOCK] = {};
  float sendL_[BLOCK] = {}, sendR_[BLOCK] = {};         // посыл мира перед фейдером
  float rin_[4][2][BLOCK] = {}, rout_[4][2][BLOCK] = {};
  float ext_[4][2][BLOCK] = {};
  float ret_[2][BLOCK] = {};
  float master_[2][BLOCK] = {};                         // выход мастера (после LPF, компрессора, потолка)
  Scale scale_;
  sdk::Reverb rev_[4];
  void follow(const sdk::MidiMsg& m, double at);
  static constexpr int SRC = 8, EVMAX = 32;
  sdk::Clock clk_;
  sdk::ClockParser parse_[SRC];
  sdk::Follower follow_;
  double ev_[EVMAX][2] = {};
  int nev_ = 0;

  // Мастер
  sdk::Biquad lpf_[2];                                  // LPF стерео
  double compThr_ = -10, compRatio_ = 2.5;              // компрессор
  double compEnv_[2] = {0, 0};                          // огибающая на канал (для peak detector)
  sdk::Knee knee_;                                      // потолок
  double masterGain_ = 1.0;                             // усиление потолка

  // LFO строк
  std::vector<sdk::RowLfo> lfos_;
  sdk::WaveMorph morphClassic_{sdk::WaveMorph::CLASSIC};
  sdk::WaveMorph morphRandom_{sdk::WaveMorph::RANDOM};
};
