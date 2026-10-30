// Хост SDK: миры по слотам (номер мира), сухой выход каждого отдельно, посыл × фейдер → четыре общих ревербера → возврат.
// Внешние посылы (веб, переходный период): по стереовходу на тип, суммируются с посылами миров; мост пишет их до process,
// хост обнуляет после. Буферы фиксированные, под 128 кадров; в process аллокаций нет. Объект ~1.2 МБ (4 ревербера) —
// на стек не класть. Контракт: prepare до process.
//
// Дополнено: микс (sum) и мастер по цепочке веба (masterRun; веб держит свой мастер в JS), LFO строк (tick + хранилище), тик моделей (dt), единый C-ABI мост.
#pragma once
#include <cstdint>
#include <cstring>
#include <vector>
#include "../sdk/world.hpp"
#include "../sdk/lfo.hpp"
#include "../sdk/biquad.hpp"
#include "../sdk/knee.hpp"
#include "../sdk/shaper.hpp"
#include "scale.hpp"
#include "../sdk/rng.hpp"

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

  // Микс для приложения: sum — Σ dry[s]·фейдер·trim(s) + ret (фейдер на сухой части; в ret посыл уже после фейдера, ×RET);
  // masterRun — мастер на месте, цепь host/audio.js: HP 30 Гц → LPF → компрессор (модель Chromium) → ×0.8·vol → ×0.5 →
  // knee(2.6/tanh 2.6, 0.6, 0.98) 4× → ×10^(ceil/20). Веб эти два не зовёт: его мастер — узлы Web Audio. n ≤ 128, без аллокаций.
  void sum(float* L, float* R, int n) const;
  void masterRun(float* L, float* R, int n);
  void masterLpf(double hz);                            // срез LPF; не выше 0.45·sr (на Найквисте бикуад вырождается)
  void masterComp(double thr, double ratio);            // компрессор: порог дБ, отношение (колено 10 дБ, атака .01, релиз .4)
  void vol(double g) { volTarget_ = g; }                // громкость мастера: цель-усиление (1 = 0 дБ, по умолчанию 1), сглаживание ~30 мс
  double volNow() const { return volNow_; }             // текущее сглаженное усиление (для тестов)
  void masterCeil(double db);                           // усиление после knee, дБ (−12…0; по умолчанию 0)
  double masterMakeup() const { return comp_.makeup; }  // авто-подъём компрессора (1/fullRangeGain)^0.6: Chromium даёт его и ниже порога

  // LFO строк: фиксированная таблица на 64, только аудиопоток. Строка — тройка (slot, obj, key): obj ≥ 0 — объект мира (звезда),
  // obj −1 — строка мира (FX). Значения — миру слота как action(ACT_LFO, obj, [key, v], 2); мир без obj / ключа пропускает.
  static constexpr int LFO_MAX = sdk::LFO_MAX, LFO_OBJS = sdk::LFO_OBJS;
  bool lfoAdd(int slot, int obj, int key, double base, int shape);  // тройка есть — ничего (true); нет места — false, lost++
  void lfoSpec(int slot, int obj, int key, double morph, double rate, double depth);   // NaN — не менять
  void lfoBase(int slot, int obj, int key, double base);
  void lfoOff(int slot, int obj, int key);              // строке base, ячейка свободна
  void lfoDrop(int slot, int obj);                      // без base: obj ≥ 0 — его строки, LFO_OBJS — все obj ≥ 0 слота; FX (−1) не трогает
  void lfoTick(double dt);                              // u += dt·rate, значения мирам (раз в блок, после кольца, до process)
  int lfoState(double* buf, int cap) const;             // снимок для UI: по 10 чисел (slot, obj, key, base, morph, rate, depth, u, shape, seed); длина
  unsigned lfoLost() const { return lost_; }
  double lfoSample(int shape, double morph, double u, int seed) const;   // чистая форма по готовым таблицам (shape 0 — classic, 1 — random)

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
  double volTarget_ = 1.0, volNow_ = 1.0;               // усиление громкости: цель и сглаженное (как setTargetAtTime(…, 0.03) веба)
  double volCoef_ = 0;                                  // 1 − exp(−1/(0.03·sr)): шаг однополюсного сглаживания за сэмпл
  struct Comp {                                         // DynamicsCompressor Chromium: связанный детектор max|L|,|R|, задержка 6 мс, авто-подъём
    static constexpr int DLY = 1024;                    // кольцо задержки (6 мс ≤ 1023 кадров до 170 кГц)
    double thr = -10, knee = 10, ratio = 2.5, att = 0.01, rel = 0.4;
    double lin = 0, k = 5, kneeDb = 0, yKneeDb = 0, slope = 0.4, makeup = 1;
    double aAtt = 0, aRel = 0, gDb = 0;                 // коэффициенты одного полюса и текущее усиление, дБ (≤ 0)
    double satRel = 120, det = 1;                       // детектор Chromium: время спада в кадрах (2.5 мс) и текущее затухание (линейное, ≤ 1)
    int dly = 0, pos = 0;
    float buf[2][DLY] = {};
    void set(double thr_, double ratio_, double sr);
    void reset() { gDb = 0; det = 1; pos = 0; std::memset(buf, 0, sizeof buf); }
    void run(double& l, double& r);
   private:
    double kneeCurve(double x, double kk) const;
    double saturate(double x) const;
    double slopeAt(double x, double kk) const;
  };
  sdk::Biquad hp_[2], lpf_[2];
  Comp comp_;
  sdk::Shaper2<4096> knee_;                             // потолок: кривая knee() веба (4096 точек), oversample 4×
  double ceilGain_ = 1.0;                               // 10^(ceil/20)

  sdk::RowLfo* lfoFind(int slot, int obj, int key);
  void lfoSend(const sdk::RowLfo& l, double v);
  // LFO строк: фиксированная таблица (без vector / string — ни аллокаций, ни переезда указателей)
  sdk::RowLfo lfos_[sdk::LFO_MAX];
  sdk::Rng rng_{0x51F0u};                                // зерно случайности записей (0…999), prepare пересевает
  unsigned lost_ = 0;
  sdk::WaveMorph morphClassic_{sdk::WaveMorph::CLASSIC};
  sdk::WaveMorph morphRandom_{sdk::WaveMorph::RANDOM};
};
