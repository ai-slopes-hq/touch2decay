// Таблицы волн Tenebrae: 9 форм host/waves.js, гармоники как у makeWave/alignWaves (tone.js), обратное ДПФ по октавам (мип).
// Голосовой набор — фазы выровнены по пиле (морф = чистая интерполяция амплитуд); LFO — исходные фазы.
// Таблицы нормированы одним множителем по пику полной таблицы формы (как PeriodicWave без disableNormalization).
#pragma once

namespace tenebrae {

struct Tables {
  static constexpr int FORMS = 9, HARM = 220, N = 2048, LEVELS = 11, SAW = 2;
  float voice[FORMS][LEVELS][N];                        // голос: выровненные фазы, уровень L — гармоники h ≤ 219 >> L
  float lfo[FORMS][N];                                  // LFO: исходные фазы, один уровень (частоты низкие)
  double level[FORMS];                                  // 0.24 / RMS исходного цикла (громкость формы в голосе)
  double re[2][FORMS][HARM], im[2][FORMS][HARM];        // [0] голос (выровнено), [1] LFO
  void build();                                         // один раз в prepare; не в process
  int levelFor(double hz, double sr) const;             // наименьший L: (219 >> L)·hz < sr/2
};

// вес формы i при позиции морфа p (0…1): треугольный, как weight в host/waves.js
double formWeight(int i, double p);

struct Morph {                                          // один генератор (c1, c2 или LFO)
  double ph = 0;
  double voiceStep(const Tables& t, double pos, double hz, double sr);   // Σ w_i^0.85·level_i·voice[i][L], затем фаза += hz/sr
  double lfoStep(const Tables& t, double pos, double hz, double sr);     // Σ w_i·lfo[i]
};

}  // namespace tenebrae
