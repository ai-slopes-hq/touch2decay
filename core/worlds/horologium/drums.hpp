// Horologium — glitch-ударные: восемь голосов на синусах, импульсах и шуме (kick, blip, click, static, ultra, zap, bit, stutter).
// Кольцо играет голосом вместо резонатора; голос моно, панораму и нормировку по киту (KIT) делает Sound.
// Спад — T60 (время падения на −60 дБ): множитель на сэмпл 10^(−3/(T60·sr)). Длительности рецептов — при len = 1.
// materia (0…1): corium — сухо и коротко, metallum — длиннее и звонче: длительность × len = 0.6 + 1.4·mat
// (у click — ещё и дольше звенит резонатор); tint — яркость шума и высота нетональных (zap, bit, stutter).
// Ловушки:
//   - hit() перезапускает голос и считает коэффициенты (exp, pow, Biquad) — только там; step() их не пересчитывает;
//   - hz у нетональных (static, zap, bit, stutter) не используется; у остальных — в пределах pitchRange;
//   - active() ложь, когда голос доиграл (огибающая ниже 1e-4, у stutter — после последнего грана): step() возвращает 0;
//   - шум — из rng хозяина (rng.next()·2 − 1), своего генератора у голоса нет — бит в бит повторяемо от зерна;
//     случайное на удар (частота выборки static) берётся на первом step(), у hit() rng нет.
#pragma once
#include "../../sdk/biquad.hpp"
#include "../../sdk/rng.hpp"

namespace horologium {

enum Inst { KICK, BLIP, CLICK, STATIC, ULTRA, ZAP, BIT, STUTTER, NINST };

struct Range { double lo, hi; };

// Диапазон высоты тональных инструментов (Гц, не уже октавы — модель сворачивает по октавам); у нетональных — {0, 0}.
Range pitchRange(int inst);
inline bool tonal(int inst) { return pitchRange(inst).hi > 0; }

// Выравнивание голосов — GAIN в drums.cpp (по inst). Замер: amp 1, tint 1, mat 0.35, тональные hz = pitchRange(inst).lo·1.2,
// первые 200 мс, 48 кГц; с GAIN пик ≈ 1.0, у blip 0.75, static 0.8, ultra 0.5, bit 0.8 — высокое на слух громче (прикидка, не замер).
// Нормировка кита: во столько раз Sound умножает сумму голосов перед общим tanh(0.9·y). Подобрана наибольшей, при которой
// horoKitPeak проходит (пик после tanh ≤ 0.9, т. е. до tanh y ≤ 1.63 — совпавшие удары мягко сжимает tanh):
// развёртка mat {0, 0.35, 1}, tint {2^−½, 1, 2^½}, hz у lo·1.2 и hi·0.97, три Ft.
// Худшая точка: Ft 1.667, mat 0, tint 1.414, hz у hi·0.97 — сумма голосов 6.31 (KIT не выше 0.258). RMS сцены «IV, V, VI, 100 BPM» (horoTickRms) ≈ 0.0072.
constexpr double KIT = 0.25;

class Drum {
 public:
  void prepare(double sr);
  // hz — высота (тональные), tint — окраска шума/металла (1 — как есть), mat — materia 0…1, amp — громкость удара.
  void hit(int inst, double hz, double tint, double mat, double amp);
  double step(sdk::Rng& rng);      // моно-сэмпл до KIT и панорамы
  bool active() const { return on_; }
  int inst() const { return inst_; }

 private:
  double sr_ = 48000;
  bool on_ = false;
  int inst_ = KICK;
  double amp_ = 0, hz_ = 0, tint_ = 1;
  double e1_ = 0, g1_ = 1, gr_ = 1;              // огибающая, её спад на сэмпл, спад после ворот
  double p_ = 0, gp_ = 1;                        // огибающая высоты (kick, ultra, zap)
  double ph_[2] = {0, 0};
  long t_ = 0, n_ = 0;                           // сэмпл от удара; длина ворот (blip, static) или следующий гран (stutter)
  double y1_ = 0, y2_ = 0, c1_ = 0, c2_ = 0, x0_ = 0;   // click: двухполюсный резонатор
  double held_ = 0; long hold_ = 1, hc_ = 0;     // static, bit: удержание отсчёта шума
  int k_ = 0, reps_ = 0; double gap_ = 0;        // stutter: номер грана, их число, промежуток
  sdk::Biquad f_;
};

}  // namespace horologium
