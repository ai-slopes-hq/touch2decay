// Ревербы хоста — четыре общих зала, куда миры шлют посыл: room, plate, hall, cathedral.
// У миров своего ревербера нет (раньше в вебе у каждого был свой hall()): мир отдаёт только
// посыл, а хост держит четыре Reverb (core/host/host.hpp) и складывает их выходы в мастер.
//
// Два устройства внутри:
//
//   Fdn4 — room, hall, cathedral. Четыре линии задержки, которые по кругу подмешивают звук
//          друг в друга (матрица Хаусхолдера — она перемешивает, не добавляя громкости).
//          В каждой линии — lowpass (верх гаснет быстрее низа, как в настоящем зале) и
//          множитель меньше 1, подобранный так, чтобы хвост стих на 60 дБ ровно за T60.
//          Длины линий слегка плавают (±0.9 мс), иначе хвост звенит металлом.
//          Hall — те же числа, что hall() в вебе (host/audio.js); room и cathedral — тот же
//          механизм с другими длинами, T60 и яркостью. Настройки трёх залов — kRoom, kHall,
//          kCathedral в reverb.cpp.
//
//   Plate — по статье Dattorro, «Effect Design Part 1» (1997), фигура 1: вход размывается
//          четырьмя allpass, дальше «бак» из двух веток, которые кормят друг друга,
//          а выход собирается из семи отводов внутри бака.
//          Все длины — из статьи (там они в сэмплах при 29761 Гц), здесь пересчитаны к sampleRate.
//
// Вход — моно ((L + R) / 2), выход — стерео. Ревербер возвращает только «мокрый» сигнал.
//
// ЛОВУШКИ:
//   - Память линий — внутри объекта, kRevMem float (~300 КБ на ревербер). Удлинишь линии или
//     поднимешь T60 у cathedral — проверь тест `used() <= kRevMem` в core/tests/sdk_test.cpp.
//   - Выше 96 кГц длины в сэмплах не растут: при 192 кГц зал станет вдвое короче. Пока не нужно.
//   - Связь T60 и множителя линии подобрана замером (поле t60Fit): поменял демпфирование —
//     перемерь, иначе хвост будет короче или длиннее заявленного.
//   - Плавание линий стартует с фазы, взятой из seed: один seed — один и тот же звук до бита.
//   - Всё, что тише kFlush, обнуляется: хвост гаснет в ровный 0, без денормалов.
//
// prepare() стирает память — хвост обрывается. Звать при смене частоты дискретизации или типа,
// не на ходу.

#pragma once

#include <cstdint>
#include "biquad.hpp"
#include "delay.hpp"

namespace sdk {

enum class Rev { room, plate, hall, cathedral };

constexpr int kRevMem = 76000;      // float на ревербер: plate при 96 кГц берёт ~72.8 тыс., cathedral — ~67 тыс.
constexpr double kRevMaxSr = 96000;  // выше этой частоты длины линий считаются как при 96 кГц
constexpr double kFlush = 1e-10;     // −200 дБ: ниже 24 бит и слуха — всё, что тише, становится 0

// Настройки одного зала на Fdn4.
struct FdnSpec {
  double sizeScale;   // во сколько раз линии длиннее, чем у hall() в вебе (больше — просторнее, реже отражения)
  double t60;         // за сколько секунд хвост стихает на 60 дБ
  double t60Fit;      // поправка к t60: демпфирование съедает ~10 % хвоста, множитель линий считается от t60·t60Fit (замерено тестом)
  double dampHz;      // срез lowpass в первой линии, Гц: ниже — темнее хвост
  double dampStepHz;  // на сколько Гц срез ниже в каждой следующей линии
  double predelaySec; // пауза перед реверберацией, с (0 — без неё)
};

class Fdn4 {
 public:
  // Разметить память mem и настроить зал. Возвращает, сколько float из mem заняло.
  int prepare(double sampleRate, const FdnSpec& spec, uint32_t seed, float* mem);
  // inL/inR — посыл (складывается в моно), outL/outR — мокрый выход (пишется, не прибавляется).
  void process(const float* inL, const float* inR, float* outL, float* outR, int n);
  // Множитель обратной связи линии i (для тестов: проверить, что T60 честный).
  double g(int i) const { return lineGain_[i]; }

 private:
  static constexpr int N = 4;  // линий

  Delay predelay_;
  int predelayLen_ = 0;          // сэмплов, 0 — предзадержки нет

  Biquad inputHighpass_, inputLowpass_;  // срезают гул и шипение до того, как звук попадёт в линии
  Biquad inputDiffusers_[4];             // четыре allpass: размывают атаку в облако до входа в линии

  Delay line_[N];
  double lineLen_[N] = {};       // средняя длина линии, сэмплов (дробная)
  double lineGain_[N] = {};      // множитель обратной связи (из T60)
  Biquad lineDamping_[N];        // lowpass внутри линии
  double wobbleDepth_ = 0;       // насколько плавает длина линии, сэмплов

  // Плавание длины линии — медленная синусоида (0.13…0.34 Гц). Считается поворотом точки по кругу:
  // (wobbleCos, wobbleSin) — где точка сейчас, (stepCos, stepSin) — поворот за один сэмпл.
  double wobbleCos_[N] = {}, wobbleSin_[N] = {};
  double stepCos_[N] = {}, stepSin_[N] = {};
};

class Plate {
 public:
  // Разметить память mem и настроить пластину на хвост t60 секунд. Возвращает, сколько float из mem заняло.
  int prepare(double sampleRate, double t60, uint32_t seed, float* mem);
  void process(const float* inL, const float* inR, float* outL, float* outR, int n);
  // Множитель «decay» из статьи — сколько остаётся от звука за один проход ветки бака.
  double decay() const { return decay_; }

 private:
  // Вход: однополюсный lowpass («bandwidth» в статье) и четыре allpass диффузии.
  double bandwidthPole_ = 0, bandwidthState_ = 0;
  Delay inputDiffusers_[4];
  int inputDiffuserLen_[4] = {};

  // Бак: две ветки, L и R. В каждой: модулированный allpass → задержка 1 → демпфирование →
  // × decay → allpass → задержка 2, а выход ветки уходит на вход соседней.
  Delay modAllpassL_, modAllpassR_;
  double modAllpassLenL_ = 0, modAllpassLenR_ = 0;
  double modExcursion_ = 0;      // насколько плавает длина модулированных allpass, сэмплов
  Delay delay1L_, delay1R_, delay2L_, delay2R_;
  int delay1LenL_ = 0, delay1LenR_ = 0, delay2LenL_ = 0, delay2LenR_ = 0;
  Delay tankAllpassL_, tankAllpassR_;
  int tankAllpassLenL_ = 0, tankAllpassLenR_ = 0;
  double dampingPole_ = 0, dampingStateL_ = 0, dampingStateR_ = 0;  // однополюсный lowpass в ветке
  double decay_ = 0.5;

  // Семь отводов на каждый выход, сэмплов (таблица 2 статьи).
  int tapsL_[7] = {}, tapsR_[7] = {};

  // Плавание модулированных allpass, ~1 Гц: левая ветка берёт синус, правая — косинус.
  double wobbleCos_ = 1, wobbleSin_ = 0, stepCos_ = 1, stepSin_ = 0;
};

// То, чем пользуется хост: один из четырёх залов.
class Reverb {
 public:
  void prepare(double sampleRate, Rev type, uint32_t seed);
  void process(const float* inL, const float* inR, float* outL, float* outR, int n);
  Rev type() const { return type_; }
  int used() const { return used_; }  // сколько памяти линий занято (тест: ≤ kRevMem)
  const Fdn4& fdn() const { return fdn_; }
  const Plate& plate() const { return plate_; }

 private:
  Rev type_ = Rev::hall;
  int used_ = 0;
  Fdn4 fdn_;
  Plate plate_;
  float memory_[kRevMem];
};

}  // namespace sdk
