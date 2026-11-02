// Host — хост ядра: миры по слотам, общие ревербераторы, мастер, часы, LFO строк. Наружу — C-ABI core/bridge/t2d.h (веб через
// wasm и iOS), реализация моста — core/bridge/api.cpp.
//
//   мир слота s ──process──→ dry[s] (сухое стерео) ─────────────────────────────·фейдер·trim──┐
//              └───────────→ посыл ·фейдер ──→ ревербератор типа rev() ─┐                        ├─ sum ─→ masterRun ─→ выход
//   ext[тип] (внешний посыл) ──────────────────→ (room, plate, hall, cathedral) ─→ Σ ·RET = ret ──┘
//
// Каждый блок (n ≤ 128): time(t) (веб зовёт перед каждым куском, t2d-worklet.js) → lfoTick / modelTick (раз в блок) → запись
// ext → process(n) → чтение dry / ret (веб микширует сам, Web Audio) или sum + masterRun (приложение iOS).
// Мастер (masterRun) — цепь веба host/audio.js: HP 30 Гц → LPF → компрессор (модель DynamicsCompressor Chromium) → ×0.8·vol →
// ×0.5 → knee(2.6/tanh 2.6, 0.6, 0.98), oversample 4× → ×10^(ceil/20). Веб его не зовёт: его мастер — узлы Web Audio.
//
// ЛОВУШКИ:
//   - Объект ~1.2 МБ (4 ревербератора и буферы) — на стек не класть. prepare — до первого process.
//   - add не владеет миром и не готовит его: prepare мира — на вызывающем, удалять мир — тоже ему (сначала add(slot, nullptr)).
//   - Фейдер стоит и на посыле: заглушил мир — новый звук в ревербератор не идёт, хвост дозвучивает.
//   - ext надо писать перед каждым process: после блока хост его обнуляет.
//   - dry / ret годятся до следующего process. NaN и inf на входе ревербераторов и мастера заменяются нулём, иначе отравили
//     бы их память навсегда.
//   - Часы: не задали time — хост ведёт время сам (+n/sr за блок).
// Цена блока — миры + 4 ревербератора (они работают всегда, даже без посыла) + мастер, если зовут; аллокаций нет.
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
  static constexpr int SLOTS = 16;                      // слот = номер мира (Tenebrae — 1, Goetia — 15)
  static constexpr int BLOCK = 128;                     // наибольший блок
  static constexpr float RET = 0.9f;                    // усиление суммы возвратов

  void prepare(double sr, uint32_t seed);               // всё с нуля: ревербераторы (зерно — seed + номер типа), часы, мастер, LFO
  void add(int slot, sdk::World* w);                    // поставить мир в слот (nullptr — убрать); фейдер — 1, часы — миру
  void action(int slot, int kind, int i, const double* a, int n);   // передать миру слота (коды — у мира)
  void process(int n);                                  // блок: миры, посылы, ревербераторы; n ≤ 128
  const float* dry(int slot, int ch) const;             // сухой выход слота (ch 0 — L, 1 — R)
  const float* ret(int ch) const;                       // возврат ревербераторов, уже ×RET
  float* ext(sdk::Rev r, int ch);                       // внешний посыл в ревербератор типа r — писать перед process
  void fader(int slot, double g);                       // фейдер микшера: и сухое (в sum), и посыл
  void scale(bool on, int idx, int root);               // лад: номер лада и тоника (полутоны от A) зажимаются в допустимое
  const Scale& scale() const { return scale_; }

  // Часы: time — время начала следующего блока (секунды контекста; не задали — хост ведёт сам, +n/sr за блок).
  // midiByte — байт MIDI от входа src (у каждого входа свой счёт тиков, до 8 входов); midiMsg — уже разобранное сообщение
  // (оболочка iOS: доля, темп, пуск, стоп). События часов (кого запускать) — в очередь, забирает events(); их немного: раз в долю.
  void time(double t) { clock_.now = t; }
  void midiByte(int src, int status, double at);        // берёт только системные реального времени (≥ 0xF8)
  void midiMsg(int kind, double n, double bpm, double at);   // kind — sdk::MidiMsg::Type
  const sdk::Clock& clock() const { return clock_; }
  int events(double* buf, int cap);                     // по 2 числа: код (sdk::Follower::Ev), bpm; очищает очередь

  // Микс для приложения (веб эти не зовёт). n ≤ 128, без аллокаций.
  void sum(float* L, float* R, int n) const;            // Σ dry[s]·фейдер·trim(s) + ret (в ret фейдер уже стоит на посыле)
  void masterRun(float* L, float* R, int n);            // мастер на месте (цепь — в шапке)
  void masterLpf(double hz);                            // срез LPF, 10 Гц … 0.45·sr (на Найквисте биквад вырождается)
  void masterComp(double thr, double ratio);            // компрессор: порог дБ, отношение ≥ 1 (колено 10 дБ, атака 0.01, релиз 0.4 с)
  void vol(double g) { volTarget_ = g; }                // громкость мастера: усиление (1 = 0 дБ, по умолчанию), к цели за ~30 мс
  double volNow() const { return volNow_; }             // текущее сглаженное усиление (для тестов)
  void masterCeil(double db);                           // усиление после knee, дБ (−12…0, по умолчанию 0)
  double masterMakeup() const { return comp_.makeup; }  // авто-подъём компрессора (1/fullRangeGain)^0.6: Chromium даёт его и ниже порога

  // LFO строк: таблица на 64, только аудиопоток. Строка — тройка (slot, obj, key): obj ≥ 0 — объект мира (звезда),
  // obj −1 — строка мира (FX). Значение — миру слота как action(ACT_LFO, obj, [key, v], 2); мир без obj / ключа пропускает.
  static constexpr int LFO_MAX = sdk::LFO_MAX, LFO_OBJS = sdk::LFO_OBJS, LFO_REC = sdk::LFO_REC;
  bool lfoAdd(int slot, int obj, int key, double base, int shape);  // тройка есть — ничего (true); нет места — false, lost++
  void lfoSpec(int slot, int obj, int key, double morph, double rate, double depth);   // NaN — не менять
  void lfoBase(int slot, int obj, int key, double base);
  void lfoOff(int slot, int obj, int key);              // строке — base, ячейка свободна
  void lfoDrop(int slot, int obj);                      // без base: obj ≥ 0 — его строки, LFO_OBJS — все obj ≥ 0 слота; FX (−1) не трогает
  void lfoTick(double dt);                              // u += dt·rate, значения мирам (раз в блок, после событий, до process)
  int lfoState(double* buf, int cap) const;             // снимок для UI: по 10 чисел (slot, obj, key, base, morph, rate, depth, u, shape, seed); длина
  unsigned lfoLost() const { return lost_; }            // сколько lfoAdd не нашли места
  double lfoSample(int shape, double morph, double u, int seed) const;   // чистая форма по готовым таблицам (shape 0 — classic, 1 — random)

  // Тик моделей: раз в блок, dt — время блока в секундах; каждому миру — action(−1, 0, [dt], 1).
  void modelTick(double dt);

 private:
  sdk::World* worlds_[SLOTS] = {};
  float fader_[SLOTS] = {};                             // 0 у пустых; add ставит 1
  float dry_[SLOTS][2][BLOCK] = {};
  float sendL_[BLOCK] = {}, sendR_[BLOCK] = {};         // посыл мира перед фейдером
  float revIn_[4][2][BLOCK] = {}, revOut_[4][2][BLOCK] = {};   // вход и выход ревербераторов, [тип][канал]
  float ext_[4][2][BLOCK] = {};                         // внешние посылы, [тип][канал]
  float ret_[2][BLOCK] = {};
  Scale scale_;
  sdk::Reverb reverbs_[4];                              // по типам sdk::Rev: room, plate, hall, cathedral
  void follow(const sdk::MidiMsg& m, double at);
  static constexpr int SRC = 8, EVMAX = 32;             // входов MIDI; длина очереди событий
  sdk::Clock clock_;
  sdk::ClockParser parsers_[SRC];                       // по разборщику на вход
  sdk::Follower follower_;
  double evQueue_[EVMAX][2] = {};                       // события часов: код, bpm; полная — старое уходит
  int evCount_ = 0;

  // Мастер
  double volTarget_ = 1.0, volNow_ = 1.0;               // усиление громкости: цель и сглаженное (как setTargetAtTime(…, 0.03) веба)
  double volCoef_ = 0;                                  // 1 − exp(−1/(0.03·sr)): шаг однополюсного сглаживания за сэмпл
  // Компрессор — порт DynamicsCompressorKernel Chromium: связанный детектор max(|L|, |R|), lookahead 6 мс, авто-подъём.
  // Имена — как в Chromium, где они есть (knee, ratio, makeup, kneeDb, yKneeDb).
  struct Comp {
    static constexpr int LOOK = 1024;                   // кольцо задержки (6 мс ≤ 1023 сэмплов до 170 кГц)
    double thr = -10, knee = 10, ratio = 2.5, attack = 0.01, release = 0.4;   // порог дБ, колено дБ, отношение, атака и релиз, с
    double thrLin = 0;                                  // порог, линейно
    double k = 5;                                       // крутизна экспоненциального колена (подбирается в set)
    double kneeDb = 0, yKneeDb = 0;                     // конец колена: вход и выход, дБ
    double slope = 0.4, makeup = 1;                     // 1/ratio выше колена; авто-подъём
    double attackCoef = 0, releaseCoef = 0, gainDb = 0; // коэффициенты одного полюса и текущее усиление, дБ (≤ 0)
    double detRelease = 120, detector = 1;              // детектор: время спада в сэмплах (2.5 мс) и текущее затухание (линейное, ≤ 1)
    int delay = 0, write = 0;                           // задержка, сэмплов; куда пишем в кольцо
    float look[2][LOOK] = {};                           // кольцо задержки сигнала, [канал]
    void set(double threshold, double ratioIn, double sr);
    void reset() { gainDb = 0; detector = 1; write = 0; std::memset(look, 0, sizeof look); }
    void run(double& l, double& r);                     // сэмпл стерео на месте
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
  sdk::Rng rng_{0x51F0u};                                // зерно ступеней новых LFO (0…999), prepare пересевает
  unsigned lost_ = 0;
  sdk::WaveMorph morphClassic_{sdk::WaveMorph::CLASSIC};
  sdk::WaveMorph morphRandom_{sdk::WaveMorph::RANDOM};
};
