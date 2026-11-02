// Ревербы хоста: Fdn4 (room, hall, cathedral) и Plate (Dattorro). Что это и где ловушки — в reverb.hpp.
//
// Сверка: core/tests/sdk_test.cpp меряет T60, память и тишину после хвоста. Числа звука
// не трогай без замера — хост и все миры слушают эти залы.

#include "reverb.hpp"
#include <cmath>
#include "rng.hpp"

namespace sdk {

namespace {

inline double flush(double x) { return std::fabs(x) < kFlush ? 0.0 : x; }

// Allpass на линии с дробным чтением (длину можно модулировать): w = x + g·d, y = d − g·w.
// То же, что sdk::Allpass, но длина задаётся при каждом вызове, а записываемое проходит flush.
inline double allpass(Delay& line, double len, double g, double x) {
  double delayed = line.read(len);
  double w = flush(x + g * delayed);
  line.write(w);
  return delayed - g * w;
}

// Медленная синусоида без sin() на каждом сэмпле: точка (c, s) на единичной окружности
// поворачивается на заранее посчитанный угол (stepC = cos угла, stepS = sin угла).
inline void rotate(double& c, double& s, double stepC, double stepS) {
  double nextC = c * stepC - s * stepS;
  s = s * stepC + c * stepS;
  c = nextC;
}

// От округлений точка за тысячи поворотов сползает с окружности — раз в блок возвращаем её на место.
inline void backToCircle(double& c, double& s) {
  double r = 1 / std::sqrt(c * c + s * s);
  c *= r;
  s *= r;
}

// ---- Fdn4 ----

// Длины линий hall() из веба (host/audio.js), с — у всех залов умножаются на sizeScale.
const double kLineSec[4] = {0.0297, 0.0371, 0.0411, 0.0437};
const double kWobbleSec = 0.0009;  // длины плавают на ±0.9 мс

//                              sizeScale  t60  t60Fit dampHz dampStepHz predelaySec
const FdnSpec kRoom      = {0.9,       0.8, 1.09,  8000,  500,       0};     // короче и ярче
const FdnSpec kHall      = {2.4,       3.5, 1.10,  6000,  500,       0};     // ровно hall() веба, кроме множителей линий — они из T60
const FdnSpec kCathedral = {2.4 * 1.8, 8,   1.12,  4000,  400,       0.04};  // длиннее, темнее, пауза 40 мс

}  // namespace

int Fdn4::prepare(double sampleRate, const FdnSpec& spec, uint32_t seed, float* mem) {
  const double lenRate = sampleRate > kRevMaxSr ? kRevMaxSr : sampleRate;  // по ней длины переводятся в сэмплы
  int used = 0;

  predelayLen_ = static_cast<int>(std::lround(spec.predelaySec * lenRate));
  if (predelayLen_ > 0) { predelay_ = Delay(mem + used, predelayLen_); used += predelayLen_; }

  wobbleDepth_ = kWobbleSec * lenRate;
  Rng rng(seed);
  for (int i = 0; i < N; i++) {
    double sec = kLineSec[i] * spec.sizeScale;
    lineLen_[i] = sec * lenRate;
    int capacity = static_cast<int>(std::ceil(lineLen_[i] + wobbleDepth_)) + 2;  // +2 — запас дробному чтению
    line_[i] = Delay(mem + used, capacity);
    used += capacity;

    // Звук проходит линию за sec секунд и теряет 60 дБ за t60: за один проход — 60·sec / t60 дБ.
    lineGain_[i] = std::pow(10.0, -3 * sec / (spec.t60 * spec.t60Fit));
    lineDamping_[i] = Biquad();
    lineDamping_[i].set(Biquad::lowpass, spec.dampHz - i * spec.dampStepHz, -3, sampleRate);

    // Плавание: 0.13, 0.20, 0.27, 0.34 Гц — разные, чтобы линии не дышали в такт. Стартовая фаза — из seed.
    double step = 2 * M_PI * (0.13 + 0.07 * i) / sampleRate, phase = 2 * M_PI * rng.next();
    stepCos_[i] = std::cos(step);
    stepSin_[i] = std::sin(step);
    wobbleCos_[i] = std::cos(phase);
    wobbleSin_[i] = std::sin(phase);
  }

  inputHighpass_ = Biquad();
  inputHighpass_.set(Biquad::highpass, 280, -3, sampleRate);
  inputLowpass_ = Biquad();
  inputLowpass_.set(Biquad::lowpass, 7500, -3, sampleRate);
  const double diffuserHz[4] = {430, 1150, 2400, 4300};
  for (int k = 0; k < 4; k++) {
    inputDiffusers_[k] = Biquad();
    inputDiffusers_[k].set(Biquad::allpass, diffuserHz[k], 0.7, sampleRate);
  }
  return used;
}

void Fdn4::process(const float* inL, const float* inR, float* outL, float* outR, int n) {
  for (int t = 0; t < n; t++) {
    double x = 0.5 * (double(inL[t]) + inR[t]);
    if (predelayLen_ > 0) {
      double delayed = predelay_.read(predelayLen_);
      predelay_.write(flush(x));
      x = delayed;
    }
    x = inputLowpass_.step(inputHighpass_.step(x));
    for (int k = 0; k < 4; k++) x = inputDiffusers_[k].step(x);

    // Что пришло из каждой линии — его слышно на выходе; приглушённое и ослабленное — уходит обратно в линии.
    double heard[N], back[N], sum = 0;
    for (int i = 0; i < N; i++) {
      heard[i] = line_[i].read(lineLen_[i] + wobbleDepth_ * wobbleSin_[i]);
      back[i] = lineGain_[i] * lineDamping_[i].step(heard[i]);
      sum += back[i];
      rotate(wobbleCos_[i], wobbleSin_[i], stepCos_[i], stepSin_[i]);
    }
    // Матрица Хаусхолдера I − (2/N)·(все единицы): каждая линия получает своё минус удвоенное среднее всех.
    // Так линии перемешиваются, а громкость не растёт.
    const double mix = -2.0 / N * sum;
    for (int i = 0; i < N; i++) {
      const double input = i % 2 ? -x : x;  // нечётные линии получают вход в противофазе — шире стерео
      line_[i].write(flush(input + back[i] + mix));
    }
    outL[t] = static_cast<float>(heard[0] + heard[2]);  // чётные линии — влево, нечётные — вправо
    outR[t] = static_cast<float>(heard[1] + heard[3]);
  }

  // Раз в блок: синусоиды — обратно на окружность, память фильтров — без денормалов.
  for (int i = 0; i < N; i++) {
    backToCircle(wobbleCos_[i], wobbleSin_[i]);
    lineDamping_[i].flushTiny(kFlush);
  }
  inputHighpass_.flushTiny(kFlush);
  inputLowpass_.flushTiny(kFlush);
  for (int k = 0; k < 4; k++) inputDiffusers_[k].flushTiny(kFlush);
}

// ---- Plate (Dattorro) ----
// Все длины — в сэмплах при 29761 Гц, как в статье; в prepare пересчитываются к sampleRate.
// Имена в комментариях — номера узлов фигуры 1 статьи.

namespace {
const double kPaperRate = 29761;
const int kInputDiffuserLen[4] = {142, 107, 379, 277};
const double kInputDiffusion[4] = {0.75, 0.75, 0.625, 0.625};  // input diffusion 1 и 2
const int kModAllpassLenL = 672, kModAllpassLenR = 908;       // decay diffusion 1, с модуляцией
const int kModExcursion = 16;                                  // размах модуляции
const int kDelay1LenL = 4453, kTankAllpassLenL = 1800, kDelay2LenL = 3720;  // левая ветка
const int kDelay1LenR = 4217, kTankAllpassLenR = 2656, kDelay2LenR = 3163;  // правая
const double kDecayDiffusion1 = 0.70, kDecayDiffusion2 = 0.50;
const double kBandwidth = 0.9995, kDamping = 0.0005;          // однополюсники входа и ветки

// Отводы (таблица 2 статьи). Левый выход берёт из узлов 48_54, 48_54, 55_59, 59_63, 24_30, 31_33, 33_39,
// правый — зеркально. Какой узел — какая линия: 24_30 — delay1L, 31_33 — tankAllpassL, 33_39 — delay2L,
// 48_54 — delay1R, 55_59 — tankAllpassR, 59_63 — delay2R.
const int kTapsL[7] = {266, 2974, 1913, 1996, 1990, 187, 1066};
const int kTapsR[7] = {353, 3627, 1228, 2673, 2111, 335, 121};
}  // namespace

int Plate::prepare(double sampleRate, double t60, uint32_t seed, float* mem) {
  const double lenRate = sampleRate > kRevMaxSr ? kRevMaxSr : sampleRate;
  const double scale = lenRate / kPaperRate;
  int used = 0;
  auto len = [&](int paperLen) {  // длина из статьи → сэмплы сейчас, не меньше 1
    return static_cast<int>(std::lround(paperLen * scale)) > 0 ? static_cast<int>(std::lround(paperLen * scale)) : 1;
  };
  auto take = [&](Delay& line, int capacity) { line = Delay(mem + used, capacity); used += capacity; };

  for (int i = 0; i < 4; i++) { inputDiffuserLen_[i] = len(kInputDiffuserLen[i]); take(inputDiffusers_[i], inputDiffuserLen_[i]); }
  modExcursion_ = kModExcursion * scale;
  modAllpassLenL_ = kModAllpassLenL * scale;
  modAllpassLenR_ = kModAllpassLenR * scale;
  take(modAllpassL_, static_cast<int>(std::ceil(modAllpassLenL_ + modExcursion_)) + 2);
  take(modAllpassR_, static_cast<int>(std::ceil(modAllpassLenR_ + modExcursion_)) + 2);
  delay1LenL_ = len(kDelay1LenL); take(delay1L_, delay1LenL_);
  tankAllpassLenL_ = len(kTankAllpassLenL); take(tankAllpassL_, tankAllpassLenL_);
  delay2LenL_ = len(kDelay2LenL); take(delay2L_, delay2LenL_);
  delay1LenR_ = len(kDelay1LenR); take(delay1R_, delay1LenR_);
  tankAllpassLenR_ = len(kTankAllpassLenR); take(tankAllpassR_, tankAllpassLenR_);
  delay2LenR_ = len(kDelay2LenR); take(delay2R_, delay2LenR_);
  for (int i = 0; i < 7; i++) { tapsL_[i] = len(kTapsL[i]); tapsR_[i] = len(kTapsR[i]); }

  // Полный круг бака (обе ветки) — четыре умножения на decay. Длина круга в секундах от sampleRate
  // не зависит, поэтому считаем её по числам статьи и подбираем decay так, чтобы за t60 набралось −60 дБ.
  double loopSec = (kModAllpassLenL + kDelay1LenL + kTankAllpassLenL + kDelay2LenL
                  + kModAllpassLenR + kDelay1LenR + kTankAllpassLenR + kDelay2LenR) / kPaperRate;
  decay_ = std::pow(10.0, -3 * loopSec / (4 * t60));

  // Однополюсники статьи (y = (1 − p)·x + p·y) заданы для 29761 Гц: пересчитываем полюс p так,
  // чтобы постоянная времени в секундах осталась той же.
  bandwidthPole_ = std::pow(1 - kBandwidth, kPaperRate / sampleRate);
  dampingPole_ = std::pow(kDamping, kPaperRate / sampleRate);
  bandwidthState_ = dampingStateL_ = dampingStateR_ = 0;

  Rng rng(seed);
  double step = 2 * M_PI * 1.0 / sampleRate, phase = 2 * M_PI * rng.next();  // ~1 Гц, фаза из seed
  stepCos_ = std::cos(step);
  stepSin_ = std::sin(step);
  wobbleCos_ = std::cos(phase);
  wobbleSin_ = std::sin(phase);
  return used;
}

void Plate::process(const float* inL, const float* inR, float* outL, float* outR, int n) {
  for (int t = 0; t < n; t++) {
    double x = 0.5 * (double(inL[t]) + inR[t]);
    bandwidthState_ = flush((1 - bandwidthPole_) * x + bandwidthPole_ * bandwidthState_);
    x = bandwidthState_;
    for (int i = 0; i < 4; i++) x = allpass(inputDiffusers_[i], inputDiffuserLen_[i], kInputDiffusion[i], x);

    // Выходы веток с прошлого круга: каждая кормит соседнюю.
    double fromL = delay2L_.read(delay2LenL_), fromR = delay2R_.read(delay2LenR_);

    // Левая ветка: вход + правая ветка → модулированный allpass → задержка 1 → демпфирование → × decay → allpass → задержка 2.
    double a = allpass(modAllpassL_, modAllpassLenL_ + modExcursion_ * wobbleSin_, -kDecayDiffusion1, x + decay_ * fromR);
    double b = delay1L_.read(delay1LenL_);
    delay1L_.write(flush(a));
    dampingStateL_ = flush((1 - dampingPole_) * b + dampingPole_ * dampingStateL_);
    b = allpass(tankAllpassL_, tankAllpassLenL_, kDecayDiffusion2, decay_ * dampingStateL_);
    delay2L_.write(flush(b));

    // Правая — зеркально, вход — левая ветка, модуляция — косинусом.
    double c = allpass(modAllpassR_, modAllpassLenR_ + modExcursion_ * wobbleCos_, -kDecayDiffusion1, x + decay_ * fromL);
    double d = delay1R_.read(delay1LenR_);
    delay1R_.write(flush(c));
    dampingStateR_ = flush((1 - dampingPole_) * d + dampingPole_ * dampingStateR_);
    d = allpass(tankAllpassR_, tankAllpassLenR_, kDecayDiffusion2, decay_ * dampingStateR_);
    delay2R_.write(flush(d));

    rotate(wobbleCos_, wobbleSin_, stepCos_, stepSin_);

    // Выход — сумма семи отводов из обеих веток, знаки — из статьи.
    double yl = delay1R_.read(tapsL_[0]) + delay1R_.read(tapsL_[1]) - tankAllpassR_.read(tapsL_[2]) + delay2R_.read(tapsL_[3])
              - delay1L_.read(tapsL_[4]) - tankAllpassL_.read(tapsL_[5]) - delay2L_.read(tapsL_[6]);
    double yr = delay1L_.read(tapsR_[0]) + delay1L_.read(tapsR_[1]) - tankAllpassL_.read(tapsR_[2]) + delay2L_.read(tapsR_[3])
              - delay1R_.read(tapsR_[4]) - tankAllpassR_.read(tapsR_[5]) - delay2R_.read(tapsR_[6]);
    outL[t] = static_cast<float>(0.6 * yl);  // 0.6 — общий уровень выхода
    outR[t] = static_cast<float>(0.6 * yr);
  }
  backToCircle(wobbleCos_, wobbleSin_);
}

// ---- Reverb ----

void Reverb::prepare(double sampleRate, Rev type, uint32_t seed) {
  type_ = type;
  switch (type) {
    case Rev::plate:     used_ = plate_.prepare(sampleRate, 2, seed, memory_); break;  // хвост пластины — 2 с
    case Rev::room:      used_ = fdn_.prepare(sampleRate, kRoom, seed, memory_); break;
    case Rev::cathedral: used_ = fdn_.prepare(sampleRate, kCathedral, seed, memory_); break;
    default:             used_ = fdn_.prepare(sampleRate, kHall, seed, memory_); break;
  }
}

void Reverb::process(const float* inL, const float* inR, float* outL, float* outR, int n) {
  if (type_ == Rev::plate) plate_.process(inL, inR, outL, outR, n);
  else fdn_.process(inL, inR, outL, outR, n);
}

}  // namespace sdk
