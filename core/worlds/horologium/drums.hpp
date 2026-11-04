// Horologium — голоса ударных: восемь инструментов на FM и шуме (kick, tom, snare, clap, rim, hat, bell, open hat).
// Кольцо играет голосом вместо резонатора; голос моно, панораму и нормировку по киту (KIT) делает Sound.
// Спад — T60 (время падения на −60 дБ): множитель на сэмпл 10^(−3/(T60·sr)). Длительности рецептов — T60 при materia 0.5.
// materia (0…1): кожа (kick, tom, snare, clap) — длительность × (0.7 + 0.6·mat); металл (rim, hat, bell, open hat) —
// × (0.6 + 1.4·mat); FM-индекс — × (0.5 + mat); центр шумового фильтра — × (0.8 + 0.4·mat) · tint.
// Ловушки:
//   - hit() перезапускает голос и считает коэффициенты Biquad (cos, sin, pow) — только там; step() фильтры не перенастраивает;
//   - hz у нетональных (clap, hat, open hat) не используется; у остальных — в пределах pitchRange;
//   - active() ложь, когда огибающая ниже 1e-4 (−80 дБ): step() после этого возвращает 0 и ничего не считает;
//   - шум — из rng хозяина (rng.next()·2 − 1), своего генератора у голоса нет — бит в бит повторяемо от зерна.
#pragma once
#include "../../sdk/biquad.hpp"
#include "../../sdk/rng.hpp"

namespace horologium {

enum Inst { KICK, TOM, SNARE, CLAP, RIM, HAT, BELL, OHAT, NINST };

struct Range { double lo, hi; };

// Диапазон высоты тональных инструментов (Гц); у шумовых и металлических без высоты — {0, 0}.
Range pitchRange(int inst);
inline bool tonal(int inst) { return pitchRange(inst).hi > 0; }

// Выравнивание голосов (GAIN в drums.cpp, по inst: kick 1.05, tom 1.18, snare 1.48, clap 2.8, rim 1.16, hat 3.4, bell 0.99, open hat 2.6).
// Замер: amp 1, tint 1, mat 0.35, тональные hz = pitchRange(inst).lo·1.2, первые 200 мс, 48 кГц; с GAIN пик каждого голоса ≈ 1.0 (0.994…1.011).
// Нормировка кита: во столько раз Sound умножает сумму голосов. Наибольшее значение, при котором horoKitPeak проходит (пик до tanh ≤ 0.81).
// Громкость сцены «IV, V, VI, 100 BPM» (horoTickRms): RMS ≈ 0.0063, это около −19 дБ к прежнему резонаторному миру (0.0582).
// RMS коротких ударных не равен громкости долгих резонаторов при потолке пика на 8 колец; громкость подбирается на слух.
constexpr double KIT = 0.15;

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
  double amp_ = 0, mat_ = 0.5, idx_ = 1, hz_ = 0;
  double e1_ = 0, e2_ = 0, g1_ = 1, g2_ = 1;     // огибающие и множители спада на сэмпл
  double p_ = 0, gp_ = 1;                        // питч-огибающая (kick, tom)
  double ph_[4] = {0, 0, 0, 0}, fr_[4] = {0, 0, 0, 0};
  long t_ = 0;                                   // счётчик сэмплов от удара (clap)
  double burst_ = 0, gb_ = 1;                    // clap: огибающая пачки
  long tailAt_ = 0, gap_ = 0;
  sdk::Biquad f_;
};

}  // namespace horologium
