// Тесты блоков core/sdk — без библиотек: свои CHECK, код выхода ≠ 0 при провале. Эталонные числа (Rng, Biquad) посчитаны в Node
// независимо: Rng — rnd() из tools/ref/pulsar-worklet.js, Biquad — формулы Web Audio (BiquadFilterNode), sr = 48000.
#include <chrono>
#include <cmath>
#include <complex>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <string>
#include <thread>
#include <vector>
#include "../sdk/biquad.hpp"
#include "../sdk/chorus.hpp"
#include "../sdk/clip.hpp"
#include "../sdk/dc.hpp"
#include "../sdk/echo.hpp"
#include "../sdk/delay.hpp"
#include "../sdk/bpbank.hpp"
#include "../sdk/json.hpp"
#include "../sdk/knee.hpp"
#include "../sdk/noise.hpp"
#include "../sdk/pan.hpp"
#include "../sdk/resonator.hpp"
#include "../sdk/reverb.hpp"
#include "../sdk/rng.hpp"
#include "../sdk/shaper.hpp"
#include "../sdk/smooth.hpp"
#include "../sdk/stepclock.hpp"
#include "../sdk/world.hpp"
#include "../host/host.hpp"
#include "../bridge/t2d.h"
#include "../app/spsc.hpp"
#include "../app/triple.hpp"
#include "../app/t2d_app.h"
#include "../app/engine.hpp"
#include "../host/scale.hpp"
#include "../sdk/ad.hpp"
#include "../sdk/pingpong.hpp"
#include "../sdk/saw.hpp"
#include "../worlds/cymatica/world.hpp"
#include "../worlds/firmamentum/world.hpp"
#include "../worlds/portus/world.hpp"
#include "../worlds/natura/world.hpp"
#include "../worlds/inferno/world.hpp"
#include "../worlds/tenebrae/tone.hpp"
#include "../worlds/tenebrae/waves.hpp"
#include "../worlds/tenebrae/shifter.hpp"
#include "../worlds/tenebrae/voice.hpp"
#include "../worlds/tenebrae/world.hpp"

static int fails = 0, checks = 0;
#define CHECK(c) do { checks++; if (!(c)) { fails++; std::printf("FAIL %s:%d  %s\n", __FILE__, __LINE__, #c); } } while (0)
#define NEAR(a, b, eps) do { double a_ = (a), b_ = (b); checks++; if (!(std::fabs(a_ - b_) <= (eps))) { fails++; std::printf("FAIL %s:%d  %s = %.17g, want %.17g\n", __FILE__, __LINE__, #a, a_, b_); } } while (0)

// Saw: band-limited пила. Периодический сигнал ровно в N сэмплов (m периодов, m нечётное): гармоники — биты j·m, всё остальное — алиасинг.
static void fftInPlace(std::vector<std::complex<double>>& a) {
  const int n = static_cast<int>(a.size());
  for (int i = 1, j = 0; i < n; i++) { int b = n >> 1; for (; j & b; b >>= 1) j ^= b; j ^= b; if (i < j) std::swap(a[i], a[j]); }
  for (int len = 2; len <= n; len <<= 1) {
    const std::complex<double> w(std::cos(-2 * M_PI / len), std::sin(-2 * M_PI / len));
    for (int i = 0; i < n; i += len) { std::complex<double> c(1); for (int k = 0; k < len / 2; k++) { auto u = a[i + k], v = a[i + k + len / 2] * c; a[i + k] = u + v; a[i + k + len / 2] = u - v; c *= w; } }
  }
}
static void saw() {
  const int N = 32768;
  for (int m : {683, 2797, 6001, 9001}) {                // 1.0, 4.1, 8.8, 13.2 кГц при 48 кГц
    sdk::Saw s; s.reset(0);
    const double dt = static_cast<double>(m) / N;
    for (int i = 0; i < 200; i++) s.step(dt);
    std::vector<std::complex<double>> x(N);
    double mn = 9, mx = -9, sum = 0;
    for (int i = 0; i < N; i++) { const double y = s.step(dt); x[i] = y; mn = std::fmin(mn, y); mx = std::fmax(mx, y); sum += y; }
    fftInPlace(x);
    double alias = 0;
    for (int b = 1; b <= N / 2; b++) if (b % m) alias += std::norm(x[b]);
    CHECK(10 * std::log10(alias / std::norm(x[m])) < -85);                 // алиасинг и шум — ниже −85 дБ к основной
    CHECK(std::fabs(sum / N) < 1e-6);                                       // без постоянной составляющей
    CHECK(mx < 1.2 && mn > -1.2);                                           // звон Гиббса у разрыва — до ~12 %
    for (int j = 1; j * m < N / 2; j++) {
      if (j * m > 0.29 * N) break;                                          // до 0.29·fs (13.9 кГц) — ровно, как у sawtooth: 2/(π·j)
      NEAR(20 * std::log10(std::abs(x[j * m]) / (N / 2) / (2 / (M_PI * j))), 0, 0.01);
    }
  }
  sdk::Saw a; a.reset(0.1);                                                 // низкая частота: вдали от разрыва выход = наивная пила, отстающая на latency()
  const double dt = 0.002;
  for (int i = 0; i < 700; i++) {
    const double y = a.step(dt);
    if (i == 120 || i == 300) {                                             // фаза 0.1 + (i − 16)·dt = 0.308 и 0.668 — не у разрыва (0.5 ± 16·dt)
      const double ph = 0.1 + (i - sdk::Saw::latency()) * dt;
      NEAR(y, 2 * (ph - std::floor(ph + 0.5)), 1e-3);
    }
  }
  CHECK(sdk::Saw::latency() == 16);
}

static void pingpongPortus() {                           // HP, насыщение, wow и скольжение времени — то, что берёт Portus; по умолчанию всё выключено
  static sdk::PingPong<4000> pp;
  auto run = [&](bool hp, bool sat, double mod, double sec, double& sumR, double& peakR, int& firstL) {
    static sdk::Shaper<1024> sh; sh.build([](double x) { return std::tanh(1.4 * x) / std::tanh(1.4); });
    pp.prepare(48000, 0.01, 3000, 1, 0.5);
    pp.setHp(hp ? 240 : 0, 0.7); pp.setSat(sat ? &sh : nullptr); pp.setSec(sec);
    double l = 0, r = 0; sumR = 0; peakR = 0; firstL = -1;
    for (int k = 0; k < 4000; k++) { pp.step(k == 0 ? 1 : 0, l, r, mod); sumR += r; peakR = std::fmax(peakR, std::fabs(r)); if (firstL < 0 && std::fabs(l) > 1e-9) firstL = k; }
  };
  double s0, p0, s1, p1, s2, p2, s3, p3; int f0, f1, f2, f3;
  run(false, false, 0, 0.01, s0, p0, f0);
  run(true, false, 0, 0.01, s1, p1, f1);
  run(false, true, 0, 0.01, s2, p2, f2);
  run(false, false, 0.001, 0.01, s3, p3, f3);
  CHECK(f0 == 480 && f1 == 480 && f2 == 480);           // по умолчанию и с HP / sat — время то же
  CHECK(std::fabs(s0) > 0.05);                           // без HP через lowpass проходит постоянная составляющая
  CHECK(std::fabs(s1) < 0.35 * std::fabs(s0));           // HP 240 её срезает
  CHECK(p2 / p0 > 1.3 && p2 / p0 < 1.7);                 // tanh(1.4x)/tanh(1.4) у малых сигналов усиливает ×1.58
  CHECK(f3 == 528);                                      // wow +1 мс — на 48 сэмплов позже
}

// Portus: модель в ядре — кораблики, высота с ладом, буй и время эха, фасадные ключи, снимок
static void portusModel() {
  using namespace portus;
  Scale sc;
  Model m(sc);
  m.place(2, 0, 11); m.place(10, 7, 22);
  CHECK(m.count() == 2 && m.isle(2).on && m.isle(2).sd == 11 && m.isle(10).p == 7);
  m.place(2, 5, 99);                                     // место занято — новая нота, зерно прежнее
  CHECK(m.count() == 2 && m.isle(2).p == 5 && m.isle(2).sd == 11);
  m.move(2, 10); CHECK(m.isle(2).on && m.count() == 2);  // на занятое — остаётся
  m.move(2, 4); CHECK(!m.isle(2).on && m.isle(4).on && m.isle(4).p == 5 && m.isle(4).sd == 11);
  m.setIsle(10, IOCT, -1); m.setIsle(10, ILVL, 0.5);
  CHECK(m.isle(10).oct == -1 && m.isle(10).lvl == 0.5);
  m.sink(4); CHECK(m.count() == 1 && !m.isle(4).on);
  m.setNote(4, 3); CHECK(!m.isle(4).on);                 // утонувшего плашка не трогает
  // высота: A2 = 110 Гц; октавы маяка и кораблика складываются
  m.place(0, 0, 1);
  NEAR(m.hzOf(0), 110, 1e-9);
  m.setNote(0, 7); NEAR(m.hzOf(0), 110 * std::pow(2.0, 7.0 / 12), 1e-9);
  m.setPharos(OCT, -2); NEAR(m.hzOf(0), 110 * std::pow(2.0, 7.0 / 12) / 4, 1e-9);
  m.setPharos(OCT, 0);
  NEAR(m.fcOf(), 90 * std::pow(2.0, 7.2 * 0.42), 1e-9); m.setLuna(CUT, 1); NEAR(m.fcOf(), 90 * std::pow(2.0, 7.2), 1e-9);
  // лад хоста: минор от C (root 3), ступени
  sc.on = true; sc.idx = 1; sc.root = 3;
  m.setNote(0, 1);
  const double a = 1 + 3, snapped = sc.snapSemi(a + 24) - 24;
  NEAR(m.semiOf(0), snapped, 1e-12); CHECK(sc.inScale(static_cast<int>(snapped + 24)));
  sc.on = false;
  // буй: дальше — дольше повторы (fb), поперёк — время; плашка: time / fb двигают буй
  m.setBuoy(0.5, 0.45);
  CHECK(m.echo(TIME) >= 0 && m.echo(TIME) <= 4 && m.echo(TIME) == std::floor(m.echo(TIME)));
  NEAR(m.fbOf(), 0.15 + 0.45 * 0.84, 1e-12);
  m.setBuoy(-9, 2); NEAR(m.buoyD(), 0.95, 1e-12); CHECK(m.echo(TIME) == 0);   // вбок до берега — 1/8, дальше горизонта не уйдёт
  m.setBuoy(9, 0.45); CHECK(m.echo(TIME) == 4);
  m.setEcho(TIME, 2);
  const double l = edge(-1, m.buoyD()), r = edge(1, m.buoyD());
  NEAR(m.buoyU(), l + 0.03 + 0.5 * (r - l - 0.06), 1e-12);
  m.setEcho(FB, 0.5); NEAR(m.buoyD(), 0.03 + 0.5 * 0.92, 1e-12);
  CHECK(edge(-1, 0.3) < 0 && edge(1, 0.3) > 0);
  // снимок → restore в другую модель: то же
  m.setFx(CHANCE, 0.5); m.setPharos(CHORD, 4); m.setBpm(97);
  const std::string js = m.snapshot();
  Model q(sc);
  q.restore(js);
  CHECK(q.snapshot() == js);
  CHECK(q.count() == m.count() && q.bpm() == 97 && q.pharos(CHORD) == 4 && q.fx(CHANCE) == 0.5 && q.isle(10).oct == -1);
  m.reset(); CHECK(m.count() == 0 && m.bpm() == 120 && m.echo(TIME) == 1 && m.pharos(CHORD) == 2);
  q.restore("not json"); CHECK(q.bpm() == 97);           // мусор — модель цела
}

// Portus (слот 13): часы по шагам, свой темп и сетка MIDI, chance, смена зала, kill эха, аудиция
static void portusWorld() {
  using namespace portus;
  static Scale sc;
  static World w(sc);
  w.prepare(48000, 5);
  sdk::Clock clk; clk.sr = 48000; w.attach(&clk);
  float L[128], R[128], sL[128], sR[128];
  const sdk::Out out{L, R, sL, sR};
  const auto act = [&](int kind, int i, std::initializer_list<double> a) { std::vector<double> v(a); w.action(kind, i, v.data(), static_cast<int>(v.size())); };
  act(BPM, 0, {120}); act(FX, SPREAD, {0.6}); act(FX, CHANCE, {1}); act(PHAROS, CHORD, {2}); act(LUNA, CUT, {0.5}); act(FOG, SIZE, {0.7});
  act(PLACE, 0, {6, 1}); act(PLACE, 8, {6, 2});
  CHECK(w.rev() == sdk::Rev::cathedral);                  // size 0.7 ≥ 0.66 — собор; первое действие ставит сразу, без перехода
  CHECK(!w.sounding());
  act(PLAY, 0, {1});
  CHECK(w.sounding());
  std::vector<std::pair<double, int>> hits;             // (время блока, шаг)
  double peak = 0, sendPeak = 0;
  bool finite = true;
  double hb[64];
  auto run = [&](double sec) {
    const int blocks = static_cast<int>(sec * 48000 / 128);
    for (int b = 0; b < blocks; b++) {
      const double t0 = clk.now;
      w.process(out, 128);
      clk.now += 128 / 48000.0;
      const int m = w.heard(hb, 64);
      for (int i = 0; i + 1 < m; i += 2) hits.push_back({t0, static_cast<int>(hb[i + 1])});
      for (int k = 0; k < 128; k++) {
        if (!std::isfinite(L[k]) || !std::isfinite(R[k]) || !std::isfinite(sL[k]) || !std::isfinite(sR[k])) finite = false;
        peak = std::fmax(peak, std::fmax(std::fabs(L[k]), std::fabs(R[k]))); sendPeak = std::fmax(sendPeak, std::fmax(std::fabs(sL[k]), std::fabs(sR[k])));
      }
    }
  };
  run(3.0);
  CHECK(finite);
  CHECK(peak > 0.02 && peak < 3);                        // стабы звучат, не за колено
  CHECK(sendPeak > 1e-3);                                // и туман слышит
  CHECK(hits.size() == 4);                               // шаги 0, 8, 0, 8 за 3 с: на 120 BPM шестнадцатая 0.125 с, восемь шагов — 1 с
  CHECK(hits.size() >= 2 && hits[0].second == 0 && hits[1].second == 8);
  CHECK(hits.size() >= 2 && std::fabs((hits[1].first - hits[0].first) - 1.0) < 0.01);   // 1 с между ударами, до блока
  double mir[MIRROR_N];
  CHECK(w.mirror(mir, MIRROR_N) == MIRROR_N);
  CHECK(mir[1] == 1 && mir[0] >= 0 && mir[0] < 16 && mir[3] == 120);
  CHECK(mir[MIRROR_HEAD + 0] == 1 && mir[MIRROR_HEAD + 1] == 6 && mir[MIRROR_HEAD + 4] == 1);                 // место 0: занято, p 6, зерно 1
  CHECK(mir[MIRROR_HEAD + 8 * MIRROR_ISLE] == 1 && mir[MIRROR_HEAD + 8 * MIRROR_ISLE + 4] == 2 && mir[MIRROR_HEAD + 3 * MIRROR_ISLE] == 0);
  act(FOG, SIZE, {0.2});                                 // туман меньше — комната, переключение через затухание посыла
  run(0.4);
  CHECK(w.rev() == sdk::Rev::room);
  act(FOG, SIZE, {0.5});
  run(0.4);
  CHECK(w.rev() == sdk::Rev::hall);
  const size_t n0 = hits.size();                         // chance 0 — удары пропущены, хвосты дозвучивают без ошибок
  act(FX, CHANCE, {0});
  run(2.2);
  CHECK(hits.size() <= n0 + 1);                          // не больше одного уже стоявшего в очереди
  act(KILL, 0, {});
  run(1.0);
  CHECK(finite);
  act(PLAY, 0, {0});
  CHECK(w.mirror(mir, MIRROR_N) == MIRROR_N && mir[1] == 0 && mir[0] == -1);
  run(6.0);                                              // всё затихло: нет голосов, эхо кончилось
  CHECK(!w.sounding());
  act(AUDITION, 8, {});
  CHECK(w.sounding());
  const size_t n1 = hits.size();
  run(0.3);
  CHECK(hits.size() == n1 + 1 && hits.back().second == 8);   // аудиция тоже «услышана» — кораблик вспыхивает
  act(AUDITION, 5, {});                                  // пустое место — тишина
  const size_t n2 = hits.size();
  run(0.3);
  CHECK(hits.size() == n2 && finite);
  // сцена целиком — снимком; мир отдаёт снимок модели
  const std::string js = w.snapshot();
  w.prepare(48000, 5);
  CHECK(w.model().count() == 0);
  w.restore(js);
  CHECK(w.model().count() == 2 && w.snapshot() == js);
  // сетка MIDI-часов 150 BPM (p = 0.4 с на долю): шаг 0.1 с — восемь шагов за 0.8 с
  w.prepare(48000, 5); clk.now = 0; clk.grid.on = true; clk.grid.t0 = 0.0; clk.grid.p = 0.4;
  w.restore(js); act(FX, CHANCE, {1});
  act(PLAY, 0, {1});
  hits.clear();
  run(2.0);
  CHECK(hits.size() == 3 && std::fabs((hits[1].first - hits[0].first) - 0.8) < 0.01);   // шаги 0, 8, 0 (круг — 1.6 с)
  // лад хоста меняют на ходу — следующий удар уже в новой высоте
  w.prepare(48000, 5); clk.grid.on = false; clk.now = 0;
  act(PLACE, 0, {1, 3});
  sc.on = false; const double hz0 = w.model().hzOf(0);
  sc.on = true; sc.idx = 1; sc.root = 0;
  CHECK(std::fabs(w.model().hzOf(0) - hz0) > 1e-9 || sc.inScale(1));
  sc.on = false;
}


// Chorus mono (Natura): линии берут только левый вход, без панорамы, выход L = R = wet · Σ линий; правый буфер не нужен
static void chorusMono() {
  static sdk::Chorus<2, 4096> ch;
  const sdk::Chorus<2, 4096>::Line lines[2] = {{0.01, 0.3, 0}, {0.02, 0.4, 0}};
  ch.prepare(48000, lines, 0, true);
  ch.set(1, 0);
  static float zero[128], junk[128], oL[128], oR[128], imp[128];
  for (int k = 0; k < 128; k++) junk[k] = 0.7f;           // правый вход игнорируется
  for (int b = 0; b < 200; b++) ch.process(zero, junk, true, oL, oR, 128);   // wet доходит до 1 (τ 0.05 с)
  static float out[2][1024];
  for (int b = 0; b < 8; b++) {
    for (int k = 0; k < 128; k++) imp[k] = (b == 0 && k == 0) ? 1.f : 0.f;
    ch.process(imp, junk, true, oL, oR, 128);
    for (int k = 0; k < 128; k++) { out[0][b * 128 + k] = oL[k]; out[1][b * 128 + k] = oR[k]; }
  }
  bool same = true; for (int k = 0; k < 1024; k++) if (out[0][k] != out[1][k]) same = false;
  CHECK(same);                                             // моно: L = R
  NEAR(out[0][480], 1, 1e-3); NEAR(out[0][960], 1, 1e-3);  // линии 10 и 20 мс
  double rest = 0; for (int k = 0; k < 1024; k++) if (k != 480 && k != 960) rest += std::fabs(out[0][k]);
  CHECK(rest < 1e-3);
}

// TapeEcho.glideTo (Natura, delayTime.setTargetAtTime): время идёт к цели с постоянной τ, не короче блока; тихая ветка доводит его разом
static void tapeGlide() {
  static sdk::TapeEcho<20000> e;
  e.prepare(48000, 0, 2800, 1);
  e.glideTo(0.1, 0.15);
  CHECK(e.timeSec() == 0);                                 // начало — 0 (новый DelayNode)
  static float zero[128], out[128];
  for (int b = 0; b < 3; b++) e.process(zero, out, 128);   // 384 сэмпла = 8 мс: 1 − e^(−0.008/0.15)
  NEAR(e.timeSec(), 0.1 * (1 - std::exp(-384.0 / (0.15 * 48000))), 1e-6);
  for (int b = 0; b < 750; b++) e.process(zero, out, 128); // 2 s ≈ 13 τ
  NEAR(e.timeSec(), 0.1, 1e-5);
  e.glideTo(1e9, 0.15);                                    // не дальше линии
  for (int b = 0; b < 3000; b++) e.process(zero, out, 128);
  CHECK(e.timeSec() * 48000 <= 20000);
  // импульс идёт через ленту: эхо приходит через time (после установки), потом каждое слабее
  e.prepare(48000, 0, 20000, 1);
  e.set(1, 0.5); e.glideTo(0.05, 1e-9);                    // τ → 0: время сразу 0.05 с
  for (int b = 0; b < 100; b++) e.process(zero, out, 128);
  static float imp[128]; imp[0] = 1;
  double first = -1, p1 = 0, p2 = 0;
  for (int b = 0; b < 60; b++) {
    e.process(b == 0 ? imp : zero, out, 128);
    for (int k = 0; k < 128; k++) { const double t = (b * 128 + k) / 48000.0; if (first < 0 && std::fabs(out[k]) > 0.1) first = t; if (t > 0.04 && t < 0.06) p1 = std::fmax(p1, std::fabs(out[k])); if (t > 0.09 && t < 0.11) p2 = std::fmax(p2, std::fabs(out[k])); }
  }
  NEAR(first, 0.05, 0.001);
  CHECK(p1 > 0.1 && p2 > 0.05 && p2 < p1);
}

// Glide (setTargetAtTime по сэмплам): y → to с постоянной τ
static void glideBlock() {
  sdk::Glide g; g.jump(2); g.set(5, 0.05, 48000);
  for (int i = 0; i < 2400; i++) g.step();                 // 50 мс = τ
  NEAR(g.y, 5 + (2 - 5) * std::exp(-1.0), 1e-3);
  g.jump(7); CHECK(g.y == 7 && g.to == 7);
}

// Natura.Wave: пять волн — band-limited; sharp — таблицы без постоянной, пик 1
static void naturaWave() {
  natura::Wave::prepare(48000);
  const int N = 32768;
  for (int type : {natura::SINE, natura::SQUARE, natura::TRIANGLE, natura::SAW, natura::SHARP}) {
    for (int m : {61, 683, 2797}) {                        // 90 Гц, 1.0 кГц, 4.1 кГц
      natura::Wave w; w.set(type);
      const double dt = static_cast<double>(m) / N;
      for (int i = 0; i < 300; i++) w.step(dt);
      std::vector<std::complex<double>> x(N);
      double mn = 9, mx = -9, sum = 0, e2 = 0;
      for (int i = 0; i < N; i++) { const double y = w.step(dt); x[i] = y; mn = std::fmin(mn, y); mx = std::fmax(mx, y); sum += y; e2 += y * y; }
      fftInPlace(x);
      double alias = 0, main = 0;
      for (int b = 1; b <= N / 2; b++) { if (b % m) alias += std::norm(x[b]); else main += std::norm(x[b]); }
      CHECK(10 * std::log10(alias / main) < (type == natura::TRIANGLE ? -40 : -70));   // всё, кроме гармоник, — ниже −70 дБ (треугольник — Osc с PolyBLAMP, его алиасинг у 4 кГц −45 дБ)
      CHECK(std::fabs(sum / N) < 2e-3);                    // без постоянной составляющей
      CHECK(mx < 1.25 && mn > -1.25 && mx > 0.5 && mn < -0.5);
      if (type == natura::SINE) { NEAR(std::sqrt(e2 / N), std::sqrt(0.5), 1e-3); }
      if (type == natura::SQUARE && m < 2000) { NEAR(std::sqrt(e2 / N), 1, 0.05); }
      if (type == natura::TRIANGLE) { NEAR(std::sqrt(e2 / N), std::sqrt(1.0 / 3), 0.02); }
      if (type == natura::SHARP) { CHECK(mn > -1.03 && mn < -0.97 && std::fabs(mx - 0.776) < 0.01); }   // tanh(2.6·tri + 0.35) несимметричен: низ −1 (пик нормирован, как у PeriodicWave), верх 0.776
    }
  }
  natura::Wave a, b; a.set(natura::SAW); b.set(natura::SAW);
  for (int i = 0; i < 50; i++) a.step(0.01);
  a.restart(natura::SAW);                                  // новый генератор — фаза с нуля, даже если волна та же
  for (int i = 0; i < 50; i++) NEAR(a.step(0.01), b.step(0.01), 1e-12);
}

// Natura (слот 4): часы шагов — свой темп и сетка MIDI (как прежний test-follow), chance, послушать, кораблик, дерево, испуг, зеркало
static void naturaWorld() {
  using namespace natura;
  static Scale sc;
  static World w(sc);
  w.prepare(48000, 5);
  sdk::Clock clk; clk.sr = 48000; w.attach(&clk);
  float L[128], R[128], sL[128], sR[128];
  const sdk::Out out{L, R, sL, sR};
  const auto act = [&](int kind, int i, std::initializer_list<double> a) { std::vector<double> v(a); w.action(kind, i, v.data(), static_cast<int>(v.size())); };
  const auto state = [&](double bpm, int len, int pads, double chance, double delay) {   // кувшинка на каждом из первых `pads` мест
    std::vector<double> a = {bpm, static_cast<double>(len)};
    const double fx[9] = {0.4, delay, 0.5, 0.4, 0.62, 0.25, 0.08, 0.45, chance};
    for (double v : fx) a.push_back(v);
    for (int i = 0; i < 16; i++) {
      if (i < pads) { const double p[9] = {1, static_cast<double>(i % 8), 0, 0, -1, -1, -1, -1, -1}; for (double v : p) a.push_back(v); }
      else { const double p[9] = {0, 0, 0, 0, -1, -1, -1, -1, -1}; for (double v : p) a.push_back(v); }
    }
    w.action(STATE, 0, a.data(), static_cast<int>(a.size()));
  };
  std::vector<std::pair<double, int>> hits, notes;       // (время блока, место): шаг сыгран / нота ударила
  double peak = 0, sendPeak = 0, energy = 0;
  bool finite = true;
  double hb[128];
  const auto run = [&](double sec) {
    const int blocks = static_cast<int>(sec * 48000 / 128);
    for (int b = 0; b < blocks; b++) {
      const double t0 = clk.now;
      w.process(out, 128);
      clk.now += 128 / 48000.0;
      const int m = w.heard(hb, 128);
      for (int i = 0; i + 1 < m; i += 2) (hb[i] == 1 ? hits : notes).push_back({t0, static_cast<int>(hb[i + 1])});
      for (int k = 0; k < 128; k++) {
        if (!std::isfinite(L[k]) || !std::isfinite(R[k]) || !std::isfinite(sL[k]) || !std::isfinite(sR[k])) finite = false;
        peak = std::fmax(peak, std::fmax(std::fabs(L[k]), std::fabs(R[k]))); sendPeak = std::fmax(sendPeak, std::fabs(sL[k]));
        energy += static_cast<double>(L[k]) * L[k];
      }
    }
  };
  const double BLK = 128 / 48000.0 + 1e-9;
  state(120, 12, 12, 1, 0);                              // 120 BPM: шаг 0.125 с, кувшинка на каждом месте, эха нет
  CHECK(w.rev() == sdk::Rev::hall && !w.sounding());
  act(PLAY, 0, {1});
  CHECK(w.sounding());
  run(2.0);
  CHECK(finite && peak > 0.02 && peak < 3 && sendPeak > 1e-3);
  CHECK(hits.size() >= 15);                              // свой темп: 16 шагов за 2 с, петля 12
  bool order = true; for (size_t i = 0; i < hits.size(); i++) if (hits[i].second != static_cast<int>(i % 12)) order = false;
  CHECK(order);
  CHECK(hits.size() > 2 && std::fabs((hits[2].first - hits[1].first) - 0.125) < BLK);
  CHECK(notes.size() == hits.size());                    // каждый шаг — и нота ударила (утки)
  double mir[MIRROR_N];
  CHECK(w.mirror(mir, MIRROR_N) == MIRROR_N && mir[1] == 1 && mir[0] >= 0 && mir[2] >= 1 && mir[3] == 0);
  act(PLAY, 0, {0});
  CHECK(w.mirror(mir, MIRROR_N) == MIRROR_N && mir[1] == 0 && mir[0] == -1);
  // сетка MIDI-часов {t0 = 1, p = 0.5}: шаг k — в 1 + 0.125·k (±блок)
  w.prepare(48000, 5); clk.now = 0.9; clk.grid.on = true; clk.grid.t0 = 1; clk.grid.p = 0.5;
  state(96, 12, 12, 1, 0); act(PLAY, 0, {1}); hits.clear(); notes.clear();
  run(2.1);
  CHECK(hits.size() >= 14);
  bool onGrid = true; for (size_t k = 0; k < hits.size(); k++) if (std::fabs(hits[k].first - (1 + 0.125 * k)) > BLK) onGrid = false;
  CHECK(onGrid);
  // первый шаг на 20 мс опоздал — играет сразу
  w.prepare(48000, 5); clk.now = 5; clk.grid.t0 = 4.98; clk.grid.p = 0.5;
  state(96, 12, 12, 1, 0); act(PLAY, 0, {1}); hits.clear(); notes.clear();
  run(0.1);
  CHECK(!hits.empty() && std::fabs(hits[0].first - 5.0) < BLK);
  // сетка ушла назад больше чем на шаг: порядок не нарушен, в прошлое ничего не ставится
  w.prepare(48000, 5); clk.now = 0.9; clk.grid.t0 = 1; clk.grid.p = 0.5;
  state(96, 12, 12, 1, 0); act(PLAY, 0, {1}); hits.clear(); notes.clear();
  run(1.1); clk.grid.t0 = 0.8; run(2.0);
  CHECK(hits.size() > 20);
  bool increasing = true; for (size_t i = 1; i < hits.size(); i++) if (!(hits[i].first > hits[i - 1].first)) increasing = false;
  CHECK(increasing);
  // сетка пропала: идёт дальше своим темпом без паузы и пачки (60 BPM → шаг 0.25 с; сетка p = 0.4 → шаг 0.1 с)
  w.prepare(48000, 5); clk.now = 0.9; clk.grid.on = true; clk.grid.t0 = 1; clk.grid.p = 0.4;
  state(60, 12, 12, 1, 0); act(PLAY, 0, {1}); hits.clear(); notes.clear();
  run(1.1);
  const size_t gridN = hits.size();
  CHECK(gridN >= 10);
  bool g1 = true; for (size_t k = 0; k < gridN; k++) if (std::fabs(hits[k].first - (1 + 0.1 * k)) > BLK) g1 = false;
  CHECK(g1);
  clk.grid.on = false; run(2.5);
  CHECK(hits.size() >= gridN + 8);
  CHECK(hits[gridN].first - hits[gridN - 1].first <= 0.25 + BLK);
  bool own = true; for (size_t i = gridN + 1; i < hits.size(); i++) if (std::fabs(hits[i].first - hits[i - 1].first - 0.25) > BLK) own = false;
  CHECK(own);
  // сетка с p ≤ 0 — не сетка
  w.prepare(48000, 5); clk.now = 1; clk.grid.on = true; clk.grid.t0 = 1; clk.grid.p = 0;
  state(120, 12, 12, 1, 0); act(PLAY, 0, {1}); hits.clear();
  run(1.5);
  CHECK(hits.size() >= 10 && finite);
  // мир запущен через час после MIDI Start: сразу на сетку, без прохода по всем шагам
  w.prepare(48000, 5); clk.now = 3600; clk.grid.on = true; clk.grid.t0 = 0.013; clk.grid.p = 0.5;
  state(120, 12, 12, 1, 0); act(PLAY, 0, {1}); hits.clear();
  run(1.5);
  CHECK(hits.size() >= 8);
  bool late = true; for (auto& h : hits) { const double kk = (h.first - 0.013) / 0.125; if (h.first < 3600 || std::fabs(kk - std::round(kk)) > 0.03) late = false; }
  CHECK(late);
  // chance 0 — молчит; слот уже готов, эха нет
  w.prepare(48000, 5); clk.grid.on = false; clk.now = 0;
  state(120, 12, 12, 0, 0); act(PLAY, 0, {1}); hits.clear(); notes.clear();
  run(1.0);
  CHECK(hits.empty() && notes.empty());
  act(PLAY, 0, {0});
  // послушать: нота ударяет, шаг не сыгран; пустое место молчит
  state(120, 12, 3, 1, 0);
  hits.clear(); notes.clear(); energy = 0;
  act(HEAR, 9, {});
  run(0.2);
  CHECK(energy == 0 && notes.empty());
  act(HEAR, 1, {});
  run(0.3);
  CHECK(energy > 1e-4 && notes.size() == 1 && notes[0].second == 1 && hits.empty());
  // дерево: шелест листвы звучит, пока тормошат, и умолкает
  w.prepare(48000, 5); clk.now = 0;
  state(120, 12, 0, 1, 0);
  energy = 0; act(SHAKE, 0, {0.9}); run(0.5);
  CHECK(energy > 1e-5);
  act(SHAKE, 0, {0.0}); run(0.5); energy = 0; run(0.2);
  CHECK(energy == 0);
  // испуг: огибающая открыта 4 с
  CHECK(!w.model().envOpen());
  act(SCARE, 0, {});
  CHECK(w.model().envOpen());
  run(4.5);
  CHECK(!w.model().envOpen());
  // кораблик, лягушка, лазер звучат; отпущенный кораблик гаснет и снимается
  energy = 0; act(SKIFF, 0, {0.1, 0.5, 1}); run(0.3);
  CHECK(energy > 1e-4 && w.mirror(mir, MIRROR_N) == MIRROR_N && mir[3] == 1);
  act(WAVE, 0, {3}); run(0.1);
  act(SKIFF_OFF, 0, {}); CHECK(w.mirror(mir, MIRROR_N) == MIRROR_N && mir[3] == 0);
  run(3.0); energy = 0; run(0.2);
  CHECK(energy < 1e-9);
  energy = 0; act(CROAK, 0, {5}); run(0.4);
  CHECK(energy > 1e-4);
  run(0.5); energy = 0; act(LASER, 0, {}); run(0.6);
  CHECK(energy > 1e-4 && finite);
  // пул голосов: много «послушать» подряд — не больше 32 нот, всё конечно
  state(120, 16, 16, 1, 0.9);
  for (int r = 0; r < 100; r++) { act(HEAR, r % 16, {}); run(0.01); }
  CHECK(w.mirror(mir, MIRROR_N) == MIRROR_N && mir[2] <= 32 && finite);
  run(8.0);                                              // всё стихло, хвост эха (9 с после последнего звука) кончается
  run(8.0);
  CHECK(!w.sounding());
  // эхо идёт «лентой»: время растёт с нуля до цели (60/120·0.75 = 0.375 с у time 0.5 → 1/4 при 120 BPM = 0.5 с)
  CHECK(w.model().delaySec() > 0.1 && w.model().delaySec() < 4);
}

static void rng() {
  const double w1[5] = {0.62707394058816135, 0.0027357211802154779, 0.52744703995995224, 0.98105096747167408, 0.96837789821438491};
  const double w2[5] = {0.97972826776094735, 0.30675226449966431, 0.48420542152598500, 0.81793441250920296, 0.50942836934700608};
  sdk::Rng a(1), b(12345);
  for (int i = 0; i < 5; i++) { NEAR(a.next(), w1[i], 1e-15); NEAR(b.next(), w2[i], 1e-15); }
}

static void onepole() {
  sdk::OnePole p;
  NEAR(p.step(1, 0.5), 0.5, 1e-15);
  NEAR(p.step(1, 0.5), 0.75, 1e-15);
  NEAR(p.step(0, 0.25), 0.5625, 1e-15);
}

static void dc() {
  sdk::DcBlock d;
  double y = 1;
  for (int i = 0; i < 2000; i++) y = d.step(1.0);
  CHECK(std::fabs(y) < 1e-4);                           // 0.995^2000 ≈ 4.4e-5
  sdk::DcBlock slow; slow.R = 0.9999;
  double ys = 1;
  for (int i = 0; i < 2000; i++) ys = slow.step(1.0);
  CHECK(ys > 0.5);                                      // R влияет
  NEAR(ys, std::pow(0.9999, 1999), 1e-12);
}

static void clip() {
  for (double x : {0.1, 0.5, 2.0}) NEAR(sdk::softclip(-x, 0.7), -sdk::softclip(x, 0.7), 1e-15);
  NEAR(sdk::softclip(1, 0.7), std::tanh(0.7), 1e-15);
  NEAR(sdk::softclip(0, 3), 0, 0);
}

static void pan() {
  double l, r;
  sdk::panLin(0, 1, l, r); NEAR(l, 0.5, 1e-15); NEAR(r, 0.5, 1e-15);
  sdk::panLin(0.5, 1, l, r); NEAR(l, 0.25, 1e-15); NEAR(r, 0.75, 1e-15);
  sdk::panLin(0.5, 0.5, l, r); NEAR(l, 0.375, 1e-15); NEAR(r, 0.625, 1e-15);
  sdk::panLin(-1, 0, l, r); NEAR(l, 0.5, 1e-15); NEAR(r, 0.5, 1e-15);   // spread 0 — центр
}

static void delay() {
  std::vector<float> buf(16);
  sdk::Delay d(buf.data(), 16);
  for (int i = 1; i <= 20; i++) d.write(i);             // последняя — 20
  NEAR(d.read(1), 20, 1e-12);
  NEAR(d.read(3), 18, 1e-12);
  NEAR(d.read(16), 5, 1e-12);
  NEAR(d.read(2.5), 18.5, 1e-12);                       // между 19 и 18
  NEAR(d.read(4.25), 16.75, 1e-12);                     // 17 → 16
  sdk::Delay z(buf.data(), 16);                         // свежая — тишина
  NEAR(z.read(7.5), 0, 0);
  // allpass: импульс → в полосе единичная энергия (|H| = 1)
  std::vector<float> ab(7);
  sdk::Allpass ap(ab.data(), 7, 0.6);
  double e = 0;
  for (int i = 0; i < 400; i++) { double y = ap.step(i == 0 ? 1.0 : 0.0); e += y * y; }
  NEAR(e, 1.0, 1e-6);                                 // буфер float — отсюда не 1e-9
}

struct Ref { sdk::Biquad::Type t; double f, q; double m[5]; };
static void biquad() {
  const double sr = 48000, fr[5] = {100, 1000, 2000, 5000, 20000};
  const Ref refs[4] = {
    {sdk::Biquad::lowpass,  2000,  3, {1.0018542947462494, 1.2039089419372258, 1.4125375446227533, 0.16846814442446120, 0.0012455700598897302}},
    {sdk::Biquad::highpass, 2000, -2, {0.0024728230460111956, 0.25315942162594718, 0.79432823472428160, 1.0205217603644297, 1.0002576065345239}},
    {sdk::Biquad::bandpass, 2000,  4, {0.012458528498118767, 0.16325763404642152, 1.0000000000000027, 0.11338923494051922, 0.0088296890580966698}},
    {sdk::Biquad::allpass,  2000,  2, {1.0000000000000013, 0.99999999999999822, 1.0, 1.0000000000000002, 1.0}},
  };
  for (const Ref& r : refs) {
    sdk::Biquad b; b.set(r.t, r.f, r.q, sr);
    for (int i = 0; i < 5; i++) {
      double w = 2 * M_PI * fr[i] / sr;
      std::complex<double> z1 = std::polar(1.0, -w), z2 = std::polar(1.0, -2 * w);
      double h = std::abs((b.b0 + b.b1 * z1 + b.b2 * z2) / (1.0 + b.a1 * z1 + b.a2 * z2));
      NEAR(h, r.m[i], 1e-9);
    }
  }
  // по времени: синус 1 кГц через lowpass 2 кГц / 3 дБ — установившаяся амплитуда ≈ |H|
  sdk::Biquad b; b.set(sdk::Biquad::lowpass, 2000, 3, sr);
  double peak = 0;
  for (int i = 0; i < 4800; i++) { double y = b.step(std::sin(2 * M_PI * 1000 * i / sr)); if (i > 2400 && std::fabs(y) > peak) peak = std::fabs(y); }
  NEAR(peak, 1.2039089419372258, 2e-3);
}

static void json() {
  const char* snap = "{\"s\":[{\"h\":0.3,\"x\":-1.5e-7,\"on\":true,\"n\":null,\"name\":\"a\\\"b\\\\c\\n\"},{\"h\":0.1}],\"fx\":{\"gate\":0.30000000000000004,\"k\":[1,2,3]}}";
  bool ok = false;
  sdk::Json j = sdk::Json::parse(snap, &ok);
  CHECK(ok);
  CHECK(j.type == sdk::Json::Obj);
  NEAR(j.get("s")->a[0].get("h")->n, 0.3, 0);
  CHECK(j.get("s")->a[0].get("on")->b);
  CHECK(j.get("s")->a[0].get("n")->type == sdk::Json::Null);
  CHECK(j.get("s")->a[0].get("name")->s == "a\"b\\c\n");
  std::string d1 = j.dump();
  sdk::Json j2 = sdk::Json::parse(d1, &ok);
  CHECK(ok);
  CHECK(j2.dump() == d1);                               // туда-обратно без потерь
  // числа — как JSON.stringify в JS (сверено в Node): целые без экспоненты, показатель от −6 до 20 — десятичной записью
  const double nums[] = {90, 100, 1e21, 1e20, 0.000001, 1e-7, -1.5e-7, 123456.789, -0.5, 1.0 / 3, 0.30000000000000004, 2.0 / 3, 7040, 1e-6 * 3};
  const char* want[] = {"90", "100", "1e+21", "100000000000000000000", "0.000001", "1e-7", "-1.5e-7", "123456.789", "-0.5",
                        "0.3333333333333333", "0.30000000000000004", "0.6666666666666666", "7040", "0.000003"};
  for (int i = 0; i < 14; i++) { const std::string got = sdk::Json::num(nums[i]).dump(); if (got != want[i]) std::printf("json num %s, want %s\n", got.c_str(), want[i]); CHECK(got == want[i]); }
  NEAR(j2.get("fx")->get("gate")->n, 0.30000000000000004, 0);
  NEAR(j2.get("s")->a[0].get("x")->n, -1.5e-7, 0);
  // построение и порядок ключей
  sdk::Json o = sdk::Json::object();
  o.set("b", sdk::Json::num(1)); o.set("a", sdk::Json::str("x")); o.set("b", sdk::Json::num(2));
  CHECK(o.dump() == "{\"b\":2,\"a\":\"x\"}");
  sdk::Json::parse("{\"a\":", &ok); CHECK(!ok);
  sdk::Json::parse("[1,2] x", &ok); CHECK(!ok);
}

// Ревербы: T60 по кривой спада энергии (интеграл Шрёдера, наклон от −5 до −35 дБ × 2), тишина без денормалов, шум без разноса.
static sdk::Reverb rv;                                  // ~300 КБ линий внутри — не на стеке
static const char* revName(sdk::Rev t) {
  switch (t) { case sdk::Rev::room: return "room"; case sdk::Rev::plate: return "plate"; case sdk::Rev::hall: return "hall"; default: return "cathedral"; }
}
static double t60(sdk::Rev t, double sr, double secs) {
  rv.prepare(sr, t, 1);
  const int B = 128, N = static_cast<int>(secs * sr / B) * B;
  std::vector<float> zl(B, 0), zr(B, 0), ol(B), orr(B);
  std::vector<double> e(N);
  for (int k = 0; k < N; k += B) {
    zl[0] = zr[0] = (k == 0) ? 1.f : 0.f;
    rv.process(zl.data(), zr.data(), ol.data(), orr.data(), B);
    for (int i = 0; i < B; i++) e[k + i] = double(ol[i]) * ol[i] + double(orr[i]) * orr[i];
  }
  for (int i = N - 2; i >= 0; i--) e[i] += e[i + 1];   // интеграл Шрёдера
  int i5 = -1, i35 = -1;
  for (int i = 0; i < N; i++) {
    double db = 10 * std::log10(e[i] / e[0] + 1e-300);
    if (i5 < 0 && db <= -5) i5 = i;
    if (i35 < 0 && db <= -35) { i35 = i; break; }
  }
  if (i5 < 0 || i35 < 0) return -1;
  return 2.0 * (i35 - i5) / sr;
}

static void reverb() {
  const sdk::Rev types[4] = {sdk::Rev::room, sdk::Rev::plate, sdk::Rev::hall, sdk::Rev::cathedral};
  const double want[4] = {0.8, 2, 3.5, 8}, tol[4] = {0.15, 0.15, 0.10, 0.15};
  for (int k = 0; k < 4; k++) {
    for (double sr : {48000.0, 44100.0}) {
      double t = t60(types[k], sr, want[k] * 2.5);
      std::printf("reverb %-9s sr %5.0f  T60 %.3f s (want %.1f ± %.0f %%)\n", revName(types[k]), sr, t, want[k], tol[k] * 100);
      CHECK(std::fabs(t - want[k]) <= want[k] * tol[k]);
    }
  }
  for (int k = 0; k < 4; k++) {
    sdk::Rev t = types[k];
    // память: самый большой случай — 96 кГц, всё в статическом буфере
    rv.prepare(96000, t, 3);
    CHECK(rv.used() > 0 && rv.used() <= sdk::kRevMem);
    const double sr = 48000;
    const int B = 128;
    std::vector<float> il(B), ir(B), ol(B), orr(B), zl(B, 0), zr(B, 0);
    // 10 с белого шума: выход конечен, пик < 4
    rv.prepare(sr, t, 7);
    sdk::Rng rn(99);
    double peak = 0; bool fin = true;
    const int NB = static_cast<int>(10 * sr / B);
    double tSig = 0;
    for (int b = 0; b < NB; b++) {
      for (int i = 0; i < B; i++) { il[i] = float(rn.next() * 2 - 1); ir[i] = float(rn.next() * 2 - 1); }
      auto t0 = std::chrono::steady_clock::now();
      rv.process(il.data(), ir.data(), ol.data(), orr.data(), B);
      tSig += std::chrono::duration<double>(std::chrono::steady_clock::now() - t0).count();
      for (int i = 0; i < B; i++) {
        fin = fin && std::isfinite(ol[i]) && std::isfinite(orr[i]);
        peak = std::fmax(peak, std::fmax(std::fabs(ol[i]), std::fabs(orr[i])));
      }
    }
    std::printf("reverb %-9s noise peak %.3f\n", revName(t), peak);
    CHECK(fin);
    CHECK(peak < 4);
    // затем 30 с тишины: хвост уходит ровно в 0 (или < 1e-30), без NaN/inf; тишина не дороже сигнала × 1.5
    double last = 0; bool fin2 = true;
    const int NS = static_cast<int>(30 * sr / B);
    double tSil = 0;
    for (int b = 0; b < NS; b++) {
      auto s0 = std::chrono::steady_clock::now();
      rv.process(zl.data(), zr.data(), ol.data(), orr.data(), B);
      if (b < NB) tSil += std::chrono::duration<double>(std::chrono::steady_clock::now() - s0).count();   // первые 10 с — как сигнал
      for (int i = 0; i < B; i++) fin2 = fin2 && std::isfinite(ol[i]) && std::isfinite(orr[i]);
      if (b == NS - 1) for (int i = 0; i < B; i++) last = std::fmax(last, std::fmax(std::fabs(ol[i]), std::fabs(orr[i])));
    }
    std::printf("reverb %-9s after 30 s silence max %.3g; process signal %.1f ms, silence %.1f ms\n", revName(t), last, tSig * 1e3, tSil * 1e3);
    CHECK(fin2);
    CHECK(last == 0 || last < 1e-30);
    CHECK(tSil <= tSig * 1.5);
  }
}

// ---- хост: тестовый мир отдаёт 1.0 в сухой и посыл (по умолчанию 0.5) в ревербер rev ----
struct TestWorld : sdk::World {
  sdk::Rev r = sdk::Rev::plate;
  float send = 0.5f;
  int acts = 0, lastKind = -1;
  void prepare(double, uint32_t) override {}
  void action(int kind, int, const double*, int) override { acts++; lastKind = kind; }
  void process(const sdk::Out& o, int n) override {
    for (int i = 0; i < n; i++) { o.L[i] = 1.f; o.R[i] = 1.f; o.sL[i] = send; o.sR[i] = send; }
  }
  sdk::Rev rev() const override { return r; }
  int mirror(double*, int) const override { return 0; }
  int heard(double*, int) override { return 0; }
  std::string snapshot() const override { return "{}"; }
  void restore(const std::string&) override {}
  bool sounding() const override { return true; }
};

static Host H;                                          // ~1.2 МБ — не на стек
static TestWorld TW;

static double hostBlocks(int blocks, double* tailMax) {   // гонит блоки, → сумма |ret|; tailMax — максимум на последнем блоке
  double sum = 0, mx = 0;
  for (int b = 0; b < blocks; b++) {
    H.process(128);
    mx = 0;
    for (int c = 0; c < 2; c++) for (int i = 0; i < 128; i++) { double v = std::fabs(H.ret(c)[i]); sum += v; mx = std::fmax(mx, v); }
  }
  if (tailMax) *tailMax = mx;
  return sum;
}

// Громкость мастера: по умолчанию 1.0, к цели — однополюсно с τ = 30 мс, без скачков
static void hostVolSmooth() {
  const double sr = 48000;
  H.prepare(sr, 7);
  float l = 0, r = 0;
  CHECK(H.volNow() == 1.0);
  H.vol(0.5);
  double prev = H.volNow(), maxStep = 0, at1 = 0, atTau = 0;
  const int tau = static_cast<int>(0.03 * sr), total = static_cast<int>(0.3 * sr);
  for (int i = 1; i <= total; i++) {
    l = r = 0; H.masterRun(&l, &r, 1);
    const double v = H.volNow();
    maxStep = std::max(maxStep, std::fabs(v - prev)); prev = v;
    if (i == 1) at1 = v;
    if (i == tau) atTau = v;
  }
  CHECK(std::fabs(at1 - 1) < 0.01);
  CHECK(std::fabs(atTau - (0.5 + 0.5 / std::exp(1.0))) < 0.01);
  CHECK(std::fabs(prev - 0.5) < 1e-3);
  CHECK(maxStep <= 0.5 / (0.03 * sr) * 1.01);
}

static void host() {
  const double sr = 48000;
  const uint32_t seed = 7;
  H.prepare(sr, seed);
  H.add(3, &TW);
  H.fader(3, 1.0);
  // сухой — ровно 1.0, остальные слоты тихие
  H.process(128);
  bool dryOk = true, otherOk = true;
  for (int c = 0; c < 2; c++) for (int i = 0; i < 128; i++) { dryOk = dryOk && H.dry(3, c)[i] == 1.f; otherOk = otherOk && H.dry(4, c)[i] == 0.f; }
  CHECK(dryOk); CHECK(otherOk);
  // action доходит до мира; пустой слот — игнор
  double a[1] = {1};
  H.action(3, 9, 2, a, 1); H.action(5, 9, 2, a, 1);
  CHECK(TW.acts == 1 && TW.lastKind == 9);
  // посыл идёт только в plate: возврат = 0.9 × чистый plate с тем же сидом (seed + 1)
  H.prepare(sr, seed);
  static sdk::Reverb ref;
  ref.prepare(sr, sdk::Rev::plate, seed + 1);
  float in[128], zl[128], zr[128];
  for (int i = 0; i < 128; i++) in[i] = 0.5f;
  double maxDiff = 0, peak = 0;
  for (int b = 0; b < 40; b++) {
    H.process(128);
    ref.process(in, in, zl, zr, 128);
    for (int i = 0; i < 128; i++) {
      maxDiff = std::fmax(maxDiff, std::fabs(H.ret(0)[i] - 0.9f * zl[i]));
      maxDiff = std::fmax(maxDiff, std::fabs(H.ret(1)[i] - 0.9f * zr[i]));
      peak = std::fmax(peak, std::fabs(H.ret(0)[i]));
    }
  }
  CHECK(peak > 1e-3);                                   // возврат не нулевой
  CHECK(maxDiff < 1e-6);                                // и это именно plate, другие типы не получили посыла
  // фейдер 0: посыл не идёт, хвост затухает, сухой не трогается хостом
  H.prepare(sr, seed);
  H.fader(3, 0.0);
  double tail;
  double sum0 = hostBlocks(40, &tail);
  CHECK(sum0 == 0 && tail == 0);
  CHECK(H.dry(3, 0)[0] == 1.f);
  // фейдер 0.5 — вдвое меньше посыла, ревербер линеен: возврат вдвое меньше
  H.prepare(sr, seed); H.fader(3, 1.0);
  double s1 = hostBlocks(40, nullptr);
  H.prepare(sr, seed); H.fader(3, 0.5);
  double s2 = hostBlocks(40, nullptr);
  NEAR(s2 / s1, 0.5, 1e-4);
  // ext(hall) → ненулевой возврат; ext после process обнулён; посыл мира не нужен
  H.prepare(sr, seed); H.fader(3, 0.0);
  double hp = 0;
  for (int b = 0; b < 100; b++) {                       // 0.27 с: дольше предзадержки зала
    for (int c = 0; c < 2; c++) for (int i = 0; i < 128; i++) H.ext(sdk::Rev::hall, c)[i] = 0.25f;
    H.process(128);
    for (int c = 0; c < 2; c++) for (int i = 0; i < 128; i++) hp = std::fmax(hp, std::fabs(H.ret(c)[i]));
  }
  std::printf("host ext(hall) peak %.3g\n", hp);
  CHECK(hp > 1e-4);
  bool zeroed = true;
  for (int r = 0; r < 4; r++) for (int c = 0; c < 2; c++) for (int i = 0; i < 128; i++) zeroed = zeroed && H.ext(static_cast<sdk::Rev>(r), c)[i] == 0.f;
  CHECK(zeroed);
  // после прекращения ext хвост затухает (не бесконечный) и конечен
  double t2; hostBlocks(2000, &t2);
  CHECK(t2 < hp);                                       // хвост ниже пика
  // NaN/inf во внешнем посыле не отравляют ревербер: после него возврат конечен и снова работает
  H.prepare(sr, seed); H.fader(3, 0.0);
  for (int i = 0; i < 128; i++) { H.ext(sdk::Rev::room, 0)[i] = NAN; H.ext(sdk::Rev::room, 1)[i] = INFINITY; H.ext(sdk::Rev::hall, 0)[i] = -INFINITY; }
  H.process(128);
  bool fin = true;
  for (int b = 0; b < 100; b++) {
    for (int c = 0; c < 2; c++) for (int i = 0; i < 128; i++) H.ext(sdk::Rev::room, c)[i] = 0.25f;
    H.process(128);
    for (int c = 0; c < 2; c++) for (int i = 0; i < 128; i++) fin = fin && std::isfinite(H.ret(c)[i]);
  }
  CHECK(fin);
  double rp = 0;
  for (int c = 0; c < 2; c++) for (int i = 0; i < 128; i++) rp = std::fmax(rp, std::fabs(H.ret(c)[i]));
  CHECK(rp > 1e-4);
  // NaN из самого мира (посыл) — тоже
  H.prepare(sr, seed); H.fader(3, 1.0);
  TW.send = NAN; hostBlocks(2, nullptr);
  TW.send = 0.5f;
  fin = true;
  for (int b = 0; b < 100; b++) { H.process(128); for (int c = 0; c < 2; c++) for (int i = 0; i < 128; i++) fin = fin && std::isfinite(H.ret(c)[i]); }
  CHECK(fin);
  // лад хоста
  H.scale(true, 1, 14);
  CHECK(H.scale().on && H.scale().idx == 1 && H.scale().root == 2);
  H.scale(false, 99, -1);
  CHECK(!H.scale().on && H.scale().idx == 5 && H.scale().root == 11);
}

static void scaleTable() {                              // для tools/test-scale.mjs: те же числа считает host/scale.js
  Scale sc;
  for (int idx = 0; idx < Scale::kScales; idx++) for (int root = 0; root < 12; root++) for (int on = 0; on < 2; on++) {
    sc.idx = idx; sc.root = root; sc.on = on != 0;
    std::printf("%d %d %d", idx, root, on);
    for (int k = 0; -3 + k * 0.13 <= 90; k++) std::printf(" %.17g", sc.snapSemi(-3 + k * 0.13));
    std::printf("\n");
  }
}

static void scaleBasics() {
  Scale sc; sc.on = true; sc.idx = 0; sc.root = 0;       // major от A
  CHECK(sc.inScale(0) && sc.inScale(2) && !sc.inScale(1) && sc.inScale(12) && sc.inScale(-5));
  NEAR(sc.snapSemi(1.0), 0.0, 0);                        // равноудалены 0 и 2 — нижняя, как в JS
  NEAR(sc.snapSemi(3.4), 4, 0);
  sc.on = false; NEAR(sc.snapSemi(1.3), 1.3, 0);
}

// Firmamentum (мир SDK) нативно: модель в хосте, действия, зеркало, снимок → restore
static Host fhost;
static void firm() {
  using namespace firmamentum;
  fhost.prepare(48000, 7);
  static Firmamentum w(fhost.scale());
  w.prepare(48000, 7);
  fhost.add(10, &w);
  const double a[] = {0.5, 0.2};
  fhost.action(10, ADD, 0, a, 2);
  fhost.action(10, DICE, 0, nullptr, 0);
  CHECK(w.model().count() >= 3 && w.model().count() <= 4);
  for (int k = 0; k < 100; k++) fhost.process(128);
  double m[MIRROR_MAX];
  const int n = w.mirror(m, MIRROR_MAX);
  CHECK(n == MIRROR_HEAD + w.model().count() * STAR_N);
  CHECK(std::fabs(m[0] - 12800 / 48000.0) < 1e-12);
  float dp = 0;
  for (int k = 0; k < 128; k++) dp = std::fmax(dp, std::fabs(fhost.dry(10, 0)[k]) + std::fabs(fhost.dry(10, 1)[k]));
  CHECK(dp > 0);                                        // кубик звучит
  const std::string js = w.snapshot();
  static Firmamentum w2(fhost.scale());
  w2.prepare(48000, 3);
  w2.restore(js);
  CHECK(w2.snapshot() == js);
  CHECK(w.sounding());
  w.action(CLEAR, 0, nullptr, 0);
  CHECK(!w.sounding());
}

// Firmamentum: посыл мира (sL, sR) = сухой × fx.hall²·1.5·2.5 по каждому сэмплу (×2.5 — прежний после возврата зала); сценарий tone (звезда-тон), потом hall 0.9
static void firmSend() {
  using namespace firmamentum;
  static Scale sc;
  static Firmamentum w(sc);
  w.prepare(48000, 12345);
  const double a[] = {0.85, 0.3};
  w.action(ADD, 0, a, 2);
  static float L[128], R[128], sL[128], sR[128];
  const sdk::Out out{L, R, sL, sR};
  double peak = 0, err = 0;
  for (int pass = 0; pass < 2; pass++) {
    const double hall = pass ? 0.9 : FX_DEF[HALL], g = hall * hall * 1.5 * 2.5;
    if (pass) { const double v[] = {0.9}; w.action(FX, HALL, v, 1); }
    for (int b = 0; b < 375; b++) {
      w.process(out, 128);
      for (int k = 0; k < 128; k++) {
        peak = std::fmax(peak, std::fabs(L[k]));
        err = std::fmax(err, std::fmax(std::fabs(sL[k] - L[k] * g), std::fabs(sR[k] - R[k] * g)));
      }
    }
  }
  CHECK(peak > 1e-3);                                   // звучит
  CHECK(err <= 1e-6);
  CHECK(w.rev() == sdk::Rev::hall);
}

// Firmamentum: id звезды (world.hpp, ADD) — id от UI берётся, если он не живой (даже меньше виденных); живой или 0 — свой,
// выше всех виденных; кубик и restore без id — тоже свои, выше всех виденных
static void firmIds() {
  using namespace firmamentum;
  static Scale sc;
  static Model m(sc);
  m.reset(5);
  m.dice();                                             // свои: 1…n
  const int n = m.count();
  CHECK(m.star(n - 1).id == n);
  CHECK(m.add(0.5, 0, -1, 2) == nullptr || m.star(m.count() - 1).id == n + 1);   // 2 живой — своё
  m.close(1);
  Star* s = m.add(0.5, 0, -1, 1);                       // 1 не живой (закрыт) — берётся, хоть и меньше виденных
  CHECK(s && s->id == 1);
  m.clear();
  s = m.add(0.5, 0, -1, 50);
  CHECK(s && s->id == 50);
  m.dice();                                             // свои — выше 50
  for (int i = 0; i < m.count(); i++) CHECK(m.star(i).id > 50);
}

static sdk::TapeEcho<48000> tape;                       // ~190 КБ — не на стеке
static void echo() {                                    // импульс → повторы через time, каждый слабее и мягче; тишина — ровный 0
  const double sr = 48000;
  const int D = 18000, N = 128;
  tape.prepare(sr, 0.375, 2600);
  tape.set(0.8, 0.5);
  float in[N] = {}, out[N];
  for (int b = 0; b < 400; b++) tape.process(in, out, N);   // ~1 с: ручки дошли до цели
  NEAR(tape.send(), 0.8, 1e-6); NEAR(tape.fb(), 0.5, 1e-6);
  std::vector<float> y;
  for (int b = 0; b < 600; b++) {
    for (float& v : in) v = 0;
    if (b == 0) in[0] = 1;
    tape.process(in, out, N);
    y.insert(y.end(), out, out + N);
  }
  double before = 0, peak[3] = {};
  int at[3] = {};
  for (int k = 0; k < D; k++) before = std::fmax(before, std::fabs(y[k]));
  CHECK(before == 0);                                   // до первого повтора — тишина
  for (int r = 0; r < 3; r++)
    for (int k = (r + 1) * D; k < (r + 1) * D + 200; k++) if (std::fabs(y[k]) > peak[r]) { peak[r] = std::fabs(y[k]); at[r] = k - (r + 1) * D; }
  CHECK(peak[0] > 0.05 && peak[1] > 0 && peak[2] > 0);
  CHECK(peak[1] < peak[0] * 0.6 && peak[2] < peak[1] * 0.6);   // каждый повтор × fb и через LP
  CHECK(at[0] < 20 && at[1] < 40);                      // пик — сразу за временем задержки
  double rest = 0;
  for (int b = 0; b < 9000; b++) { for (float& v : in) v = 0; tape.process(in, out, N); for (float v : out) rest = std::fmax(rest, std::fabs(v)); }
  bool zero = true;
  for (int b = 0; b < 2000; b++) { tape.process(in, out, N); for (float v : out) if (v != 0 || !std::isfinite(v)) zero = false; }
  CHECK(zero);                                          // хвост погас в ровный 0
  tape.set(0, 0);
  CHECK(std::isfinite(rest));
}

// Knee: числа посчитаны в Node по формулам старого кода — outKnee пластины (прямая до 0.8) и knee() мастера хоста (k 2.6/tanh 2.6, kn 0.6, top 0.98)
static void knee() {
  const sdk::Knee o;                                    // умолчания — outKnee Cymatica
  NEAR(o(0.5), 0.5, 0); NEAR(o(-0.5), -0.5, 0); NEAR(o(0.8), 0.80000000000000004, 0);
  NEAR(o(1.0), 0.99593492992296739, 1e-15); NEAR(o(2.0), 1.5241186029158933, 1e-15); NEAR(o(-3.0), -1.5934877796545663, 1e-15);
  NEAR(o(0), 0, 0);
  const sdk::Knee m{2.6 / std::tanh(2.6), 0.6, 0.98 - 0.6};
  NEAR(m(0.1), 0.26288452617325375, 1e-15); NEAR(m(0.3), 0.77454389743456264, 1e-15);
  NEAR(m(-0.25), -0.65678292690523377, 1e-15); NEAR(m(0.9), 0.97993014290861091, 1e-15);
  CHECK(m(5) <= 0.98 && m(5) > 0.97);                   // потолок не пробивается
}

// Resonator: коэффициенты и импульсная характеристика — из старого resCoefs (T60) и из HO (tau), 440 Гц, 48 кГц
static void resonator() {
  const sdk::ResCoef a = sdk::ResCoef::t60(440, 1.5, 48000), b = sdk::ResCoef::tau(440, 0.3, 48000);
  NEAR(a.b1, 1.9964920785017966, 1e-15); NEAR(a.b2, -0.9998081363171082, 1e-15);
  NEAR(b.b1, 1.9965449794568386, 1e-15); NEAR(b.b2, -0.9998611207557264, 1e-15);
  const double want[6] = {0.057564026959567284, 0.11492612383143994, 0.17189611332903365, 0.22828515490460163, 0.28390637069893720, 0.33857546486259060};
  const double g = std::sin(2 * 3.141592653589793 * 440 / 48000);
  sdk::Resonator r;
  for (int i = 0; i < 6; i++) NEAR(r.step(a, g, i == 0 ? 1 : 0), want[i], 1e-15);
  r.reset();
  NEAR(r.y1, 0, 0); NEAR(r.y2, 0, 0);
  double y = 0;                                         // T60: через 1.5 с огибающая −60 дБ
  sdk::Resonator q;
  double peak1 = 0, peak2 = 0;
  for (int i = 0; i < 72000; i++) { y = q.step(a, g, i == 0 ? 1 : 0); if (i > 100 && i < 4000) peak1 = std::fmax(peak1, std::fabs(y)); if (i > 68000) peak2 = std::fmax(peak2, std::fabs(y)); }
  CHECK(peak2 < peak1 * 2e-3 && peak2 > peak1 * 8e-4);
}

// StepClock: stepSamples / nextTickFrame — как в старом plate-worklet.js (Math.round: половина вверх); ход часов по темпу и по сетке
static void stepclock() {
  CHECK(sdk::stepSamples(120, 48000) == 6000); CHECK(sdk::stepSamples(97.3, 48000) == 7400);
  CHECK(sdk::stepSamples(60, 44100) == 11025); CHECK(sdk::stepSamples(133.7, 48000) == 5385);
  CHECK(sdk::nextTickFrame(0, 0, 0.5, 48000) == 6000); CHECK(sdk::nextTickFrame(0.1, 0.013, 0.5, 48000) == 1824);
  CHECK(sdk::nextTickFrame(0.2, 0.9, 0.4, 48000) == 4800); CHECK(sdk::nextTickFrame(1.234, 0.37, 0.48, 44100) == 4234);
  CHECK(sdk::nextTickFrame(5, 0.1, 0.5, 48000) == 4800);
  CHECK(sdk::jsRound(2.5) == 3 && sdk::jsRound(-2.5) == -2 && sdk::jsRound(0.49999) == 0);
  const auto ticks = [](sdk::StepClock& c, int blocks) {         // сэмплы (от старта часов), на которых был шаг
    std::vector<long> at;
    for (int b = 0; b < blocks; b++) {
      c.begin();
      for (int k = 0; k < 128; k++, c.advance()) if (c.due()) { at.push_back(static_cast<long>(c.t())); c.rearm(k); }
    }
    return at;
  };
  sdk::StepClock c;
  c.prepare(48000);
  CHECK(!c.playing());
  CHECK(ticks(c, 10).empty());                          // стоят — не тикают
  const long t0 = static_cast<long>(c.t());
  CHECK(c.set(true, 120));                              // пуск: первый шаг сразу
  CHECK(!c.set(true, 120));                             // тот же вызов — не пуск
  std::vector<long> a = ticks(c, 190);                  // ~24320 сэмплов: 0, 6000, 12000, 18000, 24000
  CHECK(a.size() == 5);
  if (a.size() == 5) for (int i = 0; i < 5; i++) CHECK(a[i] == t0 + 6000 * i);
  c.set(true, 60);                                      // темп вдвое ниже на ходу: шаг от последнего тика, не от нуля
  std::vector<long> b2 = ticks(c, 190);
  CHECK(!b2.empty() && b2[0] > a.back() && b2[0] - a.back() <= 12000 + 128);
  // сетка MIDI-часов: пуск при сетке — на узле (t0 = 0.013 с — сэмпл 624), дальше через p/4 = 6000 (за 12800 сэмплов — три шага)
  sdk::StepClock d;
  d.prepare(48000);
  d.lock(false, 0.013, 0.5);
  CHECK(d.locked());
  CHECK(d.set(true, 120));
  std::vector<long> g = ticks(d, 100);
  CHECK(g.size() == 3);
  if (g.size() == 3) { CHECK(g[0] == 624); CHECK(g[1] == 6624); CHECK(g[2] == 12624); }
  d.lock(true, 0, 0);                                   // сетку сняли — снова по темпу
  CHECK(!d.locked());
}

// Cymatica (слот 2): удар звучит, выход не выше колена 1.6, посыл в plate = L·hall²·1.4·2.5 с tau 0.05 с, часы дают шаги
static void cymWorld() {
  using namespace cymatica;
  static Scale sc;
  static Cymatica w(sc);
  w.prepare(48000, 7);
  CHECK(w.rev() == sdk::Rev::plate);
  CHECK(!w.sounding());
  float L[128], R[128], sL[128], sR[128];
  const sdk::Out out{L, R, sL, sR};
  const double fx[1] = {1.0};
  w.action(FX, 0, fx, 1);
  const double hit[6] = {0.3, 0.1, 220, 1, 0.5, 0};
  w.action(STRIKE, 0, hit, 6);
  CHECK(w.sounding());
  sdk::OnePole e;
  const double target = 1.0 * SEND_K, c = 1 - std::exp(-1 / (SEND_TAU * 48000));
  double peak = 0, err = 0;
  for (int b = 0; b < 100; b++) {
    w.process(out, 128);
    for (int k = 0; k < 128; k++) {
      peak = std::fmax(peak, std::fmax(std::fabs(L[k]), std::fabs(R[k])));
      const double g = e.step(target, c);
      err = std::fmax(err, std::fmax(std::fabs(sL[k] - L[k] * g), std::fabs(sR[k] - R[k] * g)));
    }
  }
  CHECK(peak > 1e-3 && peak < 1.6);
  CHECK(err <= 1e-6);
  double m[256];
  CHECK(w.mirror(m, 256) == MIRROR_N);
  double e0 = 0;
  for (int k = 0; k < NM; k++) e0 += m[k];
  CHECK(e0 > 0);                                        // энергия мод есть
  CHECK(m[NM] > 0 && m[NM + 1] > 0);                    // голос: hz и уровень
  double hb[HEARD_MAX];
  CHECK(w.heard(hb, HEARD_MAX) == 0);                   // часы стоят — шагов нет
  // узор: 4 удара в ритме из 4 на 120 BPM, одно место мелодии
  double sq[SEQ_N];
  for (double& x : sq) x = 0;
  sq[0] = 120; sq[1] = 1; sq[2] = 1; sq[3] = 4; sq[4] = 1;
  for (int i = 0; i < 4; i++) { sq[5 + 3 * i] = 1; sq[6 + 3 * i] = 1; sq[7 + 3 * i] = 1; }
  sq[5 + 3 * SLOTS] = 1; sq[6 + 3 * SLOTS] = 12; sq[7 + 3 * SLOTS] = 0.3; sq[8 + 3 * SLOTS] = 0.2;
  w.action(SEQ, 0, sq, SEQ_N);
  int steps = 0;
  for (int b = 0; b < 375; b++) {                       // 1 с: шестнадцатые по 0.125 с — шаги на 0, 0.125, … 0.875
    w.process(out, 128);
    const int n = w.heard(hb, HEARD_MAX);
    CHECK(n % HEARD_REC == 0);
    for (int i = 0; i < n; i += HEARD_REC) if (hb[i] == 1) { CHECK(hb[i + 4] == 1); steps++; }   // тип 2 — резонатор отзывается
  }
  CHECK(steps == 8);
  CHECK(w.sounding());
}

// Модель Cymatica без пластины: кубик с зерном — один узор, снимок → restore → тот же снимок, смена лада шлёт узор заново, удар по ноте основного тона — отзыв
namespace {
struct MockSink : cymatica::Sink {
  int seqs = 0, strikes = 0;
  std::vector<int> answers;
  double lastF0 = 0;
  void seq(const double*) override { seqs++; }
  void f0(double hz) override { lastF0 = hz; }
  void params(double, double, double) override {}
  void hall(double) override {}
  void strike(double, double, double, bool) override { strikes++; }
  void answer(int semi) override { answers.push_back(semi); }
  int bowOn = 0, bowOff = 0;
  void bow(int, bool on, double, double, double, double, double) override { (on ? bowOn : bowOff)++; }
};
}  // namespace
static void cymModel() {
  using namespace cymatica;
  Scale sc;
  MockSink a, b;
  Model ma(sc), mb(sc);
  ma.bind(&a); mb.bind(&b);
  ma.reset(1); mb.reset(2);
  ma.dice(42); mb.dice(42);                             // зерно кубика — своё, не от reset
  CHECK(ma.snapshot() == mb.snapshot());
  CHECK(ma.playing() && a.seqs > 0);
  const std::string s0 = ma.snapshot();
  Model mc(sc);
  MockSink c;
  mc.bind(&c);
  mc.reset(3);
  mc.restore(s0);
  CHECK(mc.snapshot() == s0);
  mc.dice(43);
  CHECK(mc.snapshot() != s0);
  ma.clear();
  bool any = false;                                     // clear: узор прочь, ход и длины остаются
  for (int i = 0; i < SLOTS; i++) any = any || ma.rhythm(i).on || ma.melody(i).on;
  CHECK(!any && ma.playing());
  // смена лада: узор с местами мелодии уходит пластине заново
  MockSink d;
  Scale sc2;
  Model md(sc2);
  md.bind(&d);
  md.reset(5);
  md.dice(7);
  const int before = d.seqs;
  sc2.on = true; sc2.idx = 1; sc2.root = 3;
  md.tick(0.01);
  CHECK(d.seqs > before);
  // время ядра: тик без игры ничего не шлёт
  const int s1 = d.seqs;
  md.tick(0.01);
  CHECK(d.seqs == s1);
}

// PingPong: импульс на входе — левая линия отвечает через d сэмплов, правая — через 2d (через lowpass), выход затухает с fb; AD — вершина, экспонента, хвост, конец
static void pingpongAd() {
  static sdk::PingPong<4000> pp;
  pp.prepare(48000, 0.01, 3000, 1, 0.5);                // 480 сэмплов
  double l = 0, r = 0, firstL = -1, firstR = -1, peakL = 0, peakR = 0;
  for (int k = 0; k < 4000; k++) {
    pp.step(k == 0 ? 1 : 0, l, r);
    if (firstL < 0 && std::fabs(l) > 1e-9) firstL = k;
    if (firstR < 0 && std::fabs(r) > 1e-9) firstR = k;
    peakL = std::fmax(peakL, std::fabs(l)); peakR = std::fmax(peakR, std::fabs(r));
  }
  CHECK(firstL == 480);
  CHECK(firstR >= 960 && firstR <= 962);               // lowpass в петле чуть сдвигает фронт
  CHECK(peakL > 0.99 && peakL < 1.01);                 // первый возврат — сам импульс
  CHECK(peakR < 0.6 && peakR > 0.1);                   // второй — через lowpass и fb 0.5
  pp.prepare(48000, 0.0, 3000, 1, 0.5);
  CHECK(std::fabs(pp.sec() - 128.0 / 48000) < 1e-12);           // не короче блока Web Audio
  pp.prepare(48000, 99, 3000, 1, 0.5);
  CHECK(pp.sec() <= 4000.0 / 48000 + 1e-12);                       // не длиннее линии

  sdk::AD ad;
  CHECK(!ad.active());
  ad.start(1000, 0.05, 0.15, 1.45, 0.0001, 0.02);
  double v = 0, at15 = 0, at80 = 0, last = 1;
  int n = 0;
  while (ad.active() && n < 5000) { v = ad.step(); if (n == 150) at15 = v; if (n == 875) at80 = v; last = v; n++; }
  CHECK(std::fabs(at15 - 0.05) < 1e-12);               // вершина в конце атаки
  CHECK(std::fabs(at80 - 0.05 * std::pow(0.0001 / 0.05, 725.0 / 1450)) < 1e-12);   // экспонента: середина — среднее геометрическое
  CHECK(n >= 1620 && n <= 1622 && last == 0);          // 1.62 с и тишина
  CHECK(ad.step() == 0);
}

static void naturaModel() {
  using namespace natura;
  static Scale sc;
  static World w(sc);
  w.prepare(48000, 5);
  sdk::Clock clk; clk.sr = 48000; w.attach(&clk);
  float L[128], R[128], sL[128], sR[128];
  const sdk::Out out{L, R, sL, sR};
  const auto act = [&](int kind, int i, std::initializer_list<double> a) { std::vector<double> v(a); w.action(kind, i, v.data(), static_cast<int>(v.size())); };
  double m[MIRROR_N];
  const auto mir = [&]() { return w.mirror(m, MIRROR_N) == MIRROR_N; };
  const auto P = [&](int i, int k) { return m[MIRROR_HEAD + i * MIRROR_PAD + k]; };   // k: 0 занято, 1 note, 2 wave, 3 glide, 4 chance, 5–8 cutoff res att rel
  act(CLEAR, 0, {});
  CHECK(mir());
  bool empty = true; for (int i = 0; i < 16; i++) if (P(i, 0) != 0) empty = false;
  CHECK(empty);
  act(PLANT, 3, {5, 2}); act(PLANT, 3, {9, 4}); act(PLANT, 7, {0, 1});    // на занятое место — нет
  CHECK(mir() && P(3, 0) == 1 && P(3, 1) == 5 && P(3, 2) == 2 && P(7, 1) == 0 && P(7, 2) == 1 && P(3, 4) < 0 && P(3, 5) < 0);
  act(MOVE, 3, {7}); CHECK(mir() && P(3, 0) == 1);                           // занято — остаётся
  act(MOVE, 3, {4}); CHECK(mir() && P(3, 0) == 0 && P(4, 0) == 1 && P(4, 1) == 5);
  act(NOTE, 4, {11}); act(PWAVE, 4, {3}); act(PGLIDE, 4, {1}); act(PCHANCE, 4, {0.4}); act(PLOCK, 4, {0, 0.3}); act(PLOCK, 4, {3, 0.9});
  CHECK(mir() && P(4, 1) == 11 && P(4, 2) == 3 && P(4, 3) == 1 && P(4, 4) == 0.4 && P(4, 5) == 0.3 && P(4, 6) < 0 && P(4, 8) == 0.9);
  act(PUNLOCK, 4, {0, 4}); act(PUNLOCK, 4, {4, 4});                         // cutoff — снова общий; ключ 4 — шанс снова 1
  CHECK(mir() && P(4, 5) < 0 && P(4, 8) == 0.9 && P(4, 4) == 1);
  act(LEN, 0, {5}); act(SETBPM, 0, {111}); act(SETFX, 1, {0.77}); act(SETFX, 8, {0.5});
  CHECK(mir() && m[5] == 5 && m[4] == 111 && m[7 + 1] == 0.77 && m[7 + 8] == 0.5);
  act(REMOVE, 7, {}); CHECK(mir() && P(7, 0) == 0);
  // снимок → restore в другой мир: сцена та же
  const std::string js = w.snapshot();
  static World w2(sc); w2.prepare(48000, 6); w2.restore(js);
  double m2[MIRROR_N]; CHECK(w2.mirror(m2, MIRROR_N) == MIRROR_N);
  bool same = true; for (int i = 4; i < MIRROR_N; i++) if (i != 6 && m2[i] != m[i]) same = false;
  CHECK(same);
  CHECK(w2.snapshot() == js);
  // CLEAR после правок — пусто, bpm и fx остаются
  act(CLEAR, 0, {}); CHECK(mir() && P(4, 0) == 0 && m[4] == 111);
  // дерево: SHAKEBY копится до 1 и затихает τ 1.4 с (эталон — exp(−t/1.4) на блок)
  act(SHAKEBY, 0, {0.7}); act(SHAKEBY, 0, {0.7});
  CHECK(mir() && m[6] == 1);
  const int blocks = static_cast<int>(1.4 * 48000 / 128);
  for (int b = 0; b < blocks; b++) { w.process(out, 128); clk.now += 128 / 48000.0; }
  CHECK(mir()); NEAR(m[6], std::exp(-1.0), 0.01);
  for (int b = 0; b < 48000 * 25 / 128; b++) { w.process(out, 128); clk.now += 128 / 48000.0; }
  CHECK(mir() && m[6] == 0);
  CHECK(!w.sounding());
}

// ---------- Inferno и его блоки SDK ----------
static double goertzel(const std::vector<float>& x, double hz, double sr) {   // амплитуда синусоиды на частоте hz
  const double w = 2 * M_PI * hz / sr, c = 2 * std::cos(w);
  double s1 = 0, s2 = 0;
  for (float v : x) { const double s0 = v + c * s1 - s2; s2 = s1; s1 = s0; }
  return std::sqrt(s1 * s1 + s2 * s2 - c * s1 * s2) * 2 / x.size();
}

static void shaper() {
  sdk::TanhShaper s; s.set(1);
  NEAR(s.shape(1), 1, 1e-12); NEAR(s.shape(-1), -1, 1e-12); NEAR(s.shape(5), 1, 1e-12); NEAR(s.shape(0), 0, 1e-15);
  s.set(3);
  NEAR(s.shape(0.5), std::tanh(1.5) / std::tanh(3), 1e-12);
  NEAR(s.shape(-0.5), -s.shape(0.5), 1e-15);
  NEAR(s.step(0.5), s.shape(0.5), 1e-15);               // без os — без задержки
  sdk::TanhShaper o; o.os = 2; o.set(3);
  double y = 0;
  for (int i = 0; i < 300; i++) y = o.step(0.5);        // постоянная на входе — на выходе та же кривая
  NEAR(y, o.shape(0.5), 2e-3);
  sdk::TanhShaper a, b; b.os = 2; a.set(0.2); b.set(0.2);   // слабый перегруз ≈ линейный: 1 кГц проходит с тем же усилением
  std::vector<float> ya, yb;
  for (int i = 0; i < 4800; i++) { const double x = 0.3 * std::sin(2 * M_PI * 1000 * i / 48000.0); ya.push_back(a.step(x)); yb.push_back(b.step(x)); }
  const std::vector<float> ta(ya.end() - 2400, ya.end()), tb(yb.end() - 2400, yb.end());
  NEAR(goertzel(tb, 1000, 48000) / goertzel(ta, 1000, 48000), 1, 0.01);
}

// asym(2.4, 0.35) 4×, синус 1 кГц · 0.8 при 48 кГц — Chromium (tools/shaper-os4-ref.py)
static const float kShaperOs4Ref[4800] = {
  0.0f, 5.06317915e-16f, -4.63781667e-15f, 1.31375962e-14f, -2.52973911e-14f, 3.62599694e-14f, -4.81737791e-14f, 4.37081537e-14f,
  -1.88557632e-14f, -2.76894291e-14f, 9.75424575e-14f, -1.93658254e-13f, 3.21523027e-13f, -4.66555993e-13f, 6.26914211e-13f, -7.99688928e-13f,
  9.91085469e-13f, -1.19835728e-12f, 1.42264672e-12f, -1.66711718e-12f, 1.93914459e-12f, -2.2381437e-12f, 2.57783573e-12f, -2.96594563e-12f,
  3.42072854e-12f, -3.94638228e-12f, 4.55756786e-12f, -5.26624837e-12f, 6.07040416e-12f, -6.98783436e-12f, 8.0294894e-12f, -9.20326315e-12f,
  1.05086001e-11f, -1.19498508e-11f, 1.34980438e-11f, -1.52924808e-11f, 1.73217621e-11f, -1.96619318e-11f, 2.23084363e-11f, -2.5358049e-11f,
  2.88044883e-11f, -3.28142548e-11f, 3.74262149e-11f, -4.2790077e-11f, 4.89243368e-11f, -5.59329458e-11f, 6.38600284e-11f, -7.29105595e-11f,
  8.31673133e-11f, -9.48024159e-11f, 1.07842082e-10f, -1.22490129e-10f, 1.38855205e-10f, -1.57185473e-10f, 1.77645496e-10f, -2.0051677e-10f,
  2.25967883e-10f, -2.5422664e-10f, 2.85316604e-10f, -3.19067744e-10f, 3.54403562e-10f, -3.87941568e-10f, 4.07853307e-10f, -3.62018387e-10f,
  1.81972115e-09f, -2.32673725e-09f, 1.97015915e-09f, 2.14733564e-10f, -5.63234881e-09f, -2.40467557e-08f, -1.38056766e-08f, 1.80036885e-09f,
  -4.65299665e-09f, 8.00170952e-09f, 3.89916044e-10f, 8.87141205e-09f, 1.07533769e-08f, -1.59056013e-09f, 1.09779181e-08f, 3.99448363e-10f,
  6.19604146e-09f, -5.78332182e-09f, 4.23897806e-09f, 3.54531737e-10f, 2.18850911e-08f, -1.3518207e-08f, 2.61504169e-08f, 1.9466917e-09f,
  2.11767706e-08f, -2.01298693e-08f, 8.76462813e-09f, -5.14410665e-08f, 3.1070158e-08f, -5.64485383e-08f, 3.40141852e-08f, -7.11260455e-08f,
  3.23039018e-08f, -2.30991191e-07f, 3.84000032e-09f, -2.0764125e-07f, 7.73840867e-08f, -2.86376007e-07f, 1.41725224e-07f, -3.81956568e-07f,
  1.76336243e-07f, -4.49542881e-07f, 2.98946105e-07f, -5.87536078e-07f, 4.84809505e-07f, -8.23879759e-07f, 6.43179874e-07f, -9.95543132e-07f,
  8.97698897e-07f, -1.34220022e-06f, 1.29113664e-06f, -1.67727262e-06f, 1.72324803e-06f, -2.19117192e-06f, 2.30835485e-06f, -2.80137033e-06f,
  3.04238756e-06f, -3.64750645e-06f, 3.97934036e-06f, -4.69521183e-06f, 5.18314573e-06f, -6.00444037e-06f, 6.74711691e-06f, -7.82679308e-06f,
  8.74007856e-06f, -1.01419409e-05f, 1.16264173e-05f, -1.3252904e-05f, 1.51067215e-05f, -1.69541981e-05f, 1.92570515e-05f, -2.15548171e-05f,
  2.42607857e-05f, -2.68358199e-05f, 3.00605298e-05f, -3.31749798e-05f, 3.69147347e-05f, -4.05594983e-05f, 4.47992861e-05f, -4.90414423e-05f,
  5.38525201e-05f, -5.87523282e-05f, 6.41612642e-05f, -6.98464064e-05f, 7.5866621e-05f, -8.23291266e-05f, 8.89821895e-05f, -9.6310112e-05f,
  0.000103648403f, -0.0001118336f, 0.00011984622f, -0.000128906162f, 0.000137654832f, -0.000147633837f, 0.000157096278f, -0.000167942373f,
  0.000178170885f, -0.000189722487f, 0.000200897834f, -0.00021327773f, 0.00022529086f, -0.000238540262f, 0.000251411664f, -0.000265379407f,
  0.000279231899f, -0.00029405189f, 0.000308853865f, -0.000324553956f, 0.000340421306f, -0.000357176817f, 0.00037424406f, -0.000392243033f,
  0.000410795823f, -0.000430588028f, 0.000450967113f, -0.000473015243f, 0.000496026827f, -0.000521443435f, 0.000548383046f, -0.000579315994f,
  0.000612435397f, -0.000652810733f, 0.000697016367f, -0.000756013556f, 0.000823399052f, -0.000927960034f, 0.00105880201f, -0.00134351768f,
  0.00162066252f, 0.152904332f, 0.271680743f, 0.351189017f, 0.405207932f, 0.438662499f, 0.460244119f, 0.473643064f,
  0.482048362f, 0.487453222f, 0.490478992f, 0.492364705f, 0.492701888f, 0.492373526f, 0.490458846f, 0.487490356f,
  0.481984973f, 0.473748475f, 0.460073411f, 0.438936114f, 0.404781491f, 0.351851046f, 0.270712644f, 0.154336244f,
  -4.97811488e-05f, -0.182013869f, -0.36986208f, -0.539421558f, -0.675278783f, -0.775364816f, -0.844531f, -0.891077399f,
  -0.921390593f, -0.940988839f, -0.952848434f, -0.959366679f, -0.961335599f, -0.959358931f, -0.952863812f, -0.940964937f,
  -0.921423435f, -0.89103508f, -0.844581664f, -0.775307775f, -0.675334692f, -0.539377987f, -0.369876444f, -0.18204096f,
  2.23197494e-05f, 0.154229611f, 0.270840645f, 0.351714998f, 0.404918432f, 0.43880266f, 0.460202873f, 0.473623544f,
  0.482106417f, 0.487372041f, 0.49057427f, 0.492261261f, 0.492810041f, 0.492262781f, 0.490571231f, 0.487376571f,
  0.482100278f, 0.473631233f, 0.460193157f, 0.438813955f, 0.404904723f, 0.351730704f, 0.270822465f, 0.154249191f,
  1.35870505e-06f, -0.182021052f, -0.369895071f, -0.539361954f, -0.675349951f, -0.77529335f, -0.844597101f, -0.89101851f,
  -0.921441972f, -0.940943837f, -0.952887595f, -0.959332168f, -0.961366177f, -0.959332108f, -0.952887714f, -0.940943718f,
  -0.92144233f, -0.891018033f, -0.844597578f, -0.775292397f, -0.675350726f, -0.539360881f, -0.369896114f, -0.182019711f,
  -6.85467967e-08f, 0.154250979f, 0.270820558f, 0.35173291f, 0.404902339f, 0.438816845f, 0.460190177f, 0.473634779f,
  0.482096285f, 0.487381041f, 0.490566134f, 0.492268443f, 0.492803633f, 0.492268473f, 0.490566164f, 0.487381041f,
  0.482096285f, 0.473634779f, 0.460189998f, 0.438816786f, 0.40490225f, 0.35173288f, 0.270820469f, 0.15425086f,
  -1.90375431e-07f, -0.182019711f, -0.369896352f, -0.53936094f, -0.675350785f, -0.775292575f, -0.844597697f, -0.891017914f,
  -0.921442509f, -0.94094348f, -0.952888012f, -0.95933181f, -0.961366415f, -0.95933187f, -0.952887893f, -0.94094348f,
  -0.921442509f, -0.891017914f, -0.844597638f, -0.775292337f, -0.675350785f, -0.539360762f, -0.369896203f, -0.182019711f,
  -6.80811354e-08f, 0.154251024f, 0.270820498f, 0.35173291f, 0.404902309f, 0.438816845f, 0.460190117f, 0.473634779f,
  0.482096285f, 0.487380981f, 0.490566134f, 0.492268473f, 0.492803663f, 0.492268443f, 0.490566194f, 0.487381041f,
  0.482096255f, 0.473634779f, 0.460189998f, 0.438816726f, 0.40490222f, 0.35173285f, 0.270820469f, 0.15425086f,
  -2.95323844e-07f, -0.182019681f, -0.369896352f, -0.539360881f, -0.675350904f, -0.775292516f, -0.844597697f, -0.891018033f,
  -0.921442449f, -0.94094336f, -0.952888012f, -0.95933187f, -0.961366415f, -0.95933193f, -0.952888012f, -0.94094348f,
  -0.921442509f, -0.891017795f, -0.844597697f, -0.775292397f, -0.675350785f, -0.539360821f, -0.369896114f, -0.182019562f,
  -1.3141107e-07f, 0.154251099f, 0.270820498f, 0.351732939f, 0.404902279f, 0.438816875f, 0.460190177f, 0.473634839f,
  0.482096314f, 0.487381101f, 0.490566164f, 0.492268503f, 0.492803693f, 0.492268503f, 0.490566283f, 0.487381101f,
  0.482096285f, 0.473634779f, 0.460190058f, 0.438816756f, 0.404902279f, 0.351732939f, 0.270820528f, 0.154250935f,
  -2.65521521e-07f, -0.182019711f, -0.369896322f, -0.53936094f, -0.675350904f, -0.775292516f, -0.844597816f, -0.891018033f,
  -0.921442568f, -0.940943539f, -0.952888072f, -0.95933187f, -0.961366415f, -0.959331989f, -0.952888131f, -0.940943599f,
  -0.921442568f, -0.891017914f, -0.844597697f, -0.775292397f, -0.675350785f, -0.539360762f, -0.369896233f, -0.182019651f,
  -9.41581675e-08f, 0.154251069f, 0.270820588f, 0.351732969f, 0.404902339f, 0.438816875f, 0.460190207f, 0.473634839f,
  0.482096374f, 0.48738116f, 0.490566224f, 0.492268562f, 0.492803693f, 0.492268533f, 0.490566224f, 0.487381101f,
  0.482096255f, 0.47363472f, 0.460190088f, 0.438816786f, 0.40490222f, 0.35173291f, 0.270820439f, 0.15425086f,
  -2.5434565e-07f, -0.18201983f, -0.369896352f, -0.539360881f, -0.675350904f, -0.775292516f, -0.844597816f, -0.891017973f,
  -0.921442509f, -0.94094342f, -0.952888012f, -0.95933181f, -0.961366475f, -0.95933193f, -0.952888072f, -0.94094348f,
  -0.921442509f, -0.891017795f, -0.844597697f, -0.775292337f, -0.675350845f, -0.539360762f, -0.369896054f, -0.182019681f,
  -2.13367457e-07f, 0.154251039f, 0.270820558f, 0.35173291f, 0.40490222f, 0.438816816f, 0.460190147f, 0.47363475f,
  0.482096285f, 0.487381071f, 0.490566224f, 0.492268473f, 0.492803633f, 0.492268473f, 0.490566254f, 0.487381071f,
  0.482096255f, 0.473634779f, 0.460190088f, 0.438816786f, 0.40490225f, 0.35173285f, 0.270820439f, 0.154250816f,
  -2.99049134e-07f, -0.182019845f, -0.369896352f, -0.539360881f, -0.675350785f, -0.775292516f, -0.844597816f, -0.891017973f,
  -0.921442509f, -0.94094348f, -0.952888131f, -0.95933187f, -0.961366415f, -0.95933193f, -0.952888012f, -0.94094348f,
  -0.921442509f, -0.891017914f, -0.844597757f, -0.775292397f, -0.675350785f, -0.539360821f, -0.369896233f, -0.182019651f,
  -1.8915307e-07f, 0.154251054f, 0.270820618f, 0.351732969f, 0.404902279f, 0.438816875f, 0.460190177f, 0.473634839f,
  0.482096314f, 0.487381041f, 0.490566194f, 0.492268503f, 0.492803633f, 0.492268533f, 0.490566254f, 0.487381041f,
  0.482096374f, 0.473634839f, 0.460190058f, 0.438816845f, 0.404902339f, 0.351732939f, 0.270820498f, 0.15425086f,
  -1.63076038e-07f, -0.182019815f, -0.369896322f, -0.53936094f, -0.675350845f, -0.775292635f, -0.844597816f, -0.891018033f,
  -0.921442568f, -0.94094348f, -0.952888131f, -0.95933187f, -0.961366415f, -0.959331989f, -0.952888012f, -0.940943599f,
  -0.921442568f, -0.891017973f, -0.844597757f, -0.775292397f, -0.675350845f, -0.539360762f, -0.369896203f, -0.182019725f,
  -1.83565135e-07f, 0.154251114f, 0.270820528f, 0.351732969f, 0.404902309f, 0.438816875f, 0.460190237f, 0.473634809f,
  0.482096255f, 0.487381041f, 0.490566194f, 0.492268503f, 0.492803603f, 0.492268503f, 0.490566164f, 0.487381011f,
  0.482096314f, 0.47363472f, 0.460189998f, 0.438816726f, 0.404902339f, 0.35173285f, 0.270820439f, 0.154250905f,
  -2.5434565e-07f, -0.182019815f, -0.369896293f, -0.539361f, -0.675350845f, -0.775292635f, -0.844597816f, -0.891017973f,
  -0.921442509f, -0.94094336f, -0.952888012f, -0.95933181f, -0.961366534f, -0.95933187f, -0.952887893f, -0.94094348f,
  -0.921442509f, -0.891017795f, -0.844597697f, -0.775292337f, -0.675350785f, -0.539360642f, -0.369896114f, -0.182019591f,
  -1.03471393e-07f, 0.154251128f, 0.270820558f, 0.35173291f, 0.404902279f, 0.438816875f, 0.460190088f, 0.473634779f,
  0.482096255f, 0.487381041f, 0.490566105f, 0.492268503f, 0.492803574f, 0.492268384f, 0.490566194f, 0.487381011f,
  0.482096255f, 0.47363472f, 0.460189998f, 0.438816696f, 0.404902279f, 0.35173285f, 0.270820498f, 0.15425089f,
  -2.05916876e-07f, -0.1820198f, -0.369896263f, -0.539361f, -0.675350845f, -0.775292635f, -0.844597816f, -0.891017914f,
  -0.921442509f, -0.94094336f, -0.952888012f, -0.95933187f, -0.961366475f, -0.95933187f, -0.952888012f, -0.940943599f,
  -0.921442509f, -0.891017854f, -0.844597638f, -0.775292277f, -0.675350785f, -0.539360642f, -0.369896173f, -0.182019591f,
  -4.94546839e-08f, 0.154251114f, 0.270820558f, 0.351732969f, 0.404902279f, 0.438816905f, 0.460190117f, 0.473634839f,
  0.482096314f, 0.487381101f, 0.490566164f, 0.492268503f, 0.492803633f, 0.492268503f, 0.490566164f, 0.487381071f,
  0.482096255f, 0.47363466f, 0.460189968f, 0.438816726f, 0.404902279f, 0.35173285f, 0.270820439f, 0.15425083f,
  -3.62379069e-07f, -0.182019785f, -0.369896412f, -0.539361119f, -0.675351024f, -0.775292635f, -0.844597816f, -0.891018033f,
  -0.921442568f, -0.94094342f, -0.952887952f, -0.95933181f, -0.961366296f, -0.95933193f, -0.952888012f, -0.94094348f,
  -0.921442449f, -0.891017914f, -0.844597697f, -0.775292337f, -0.675350726f, -0.539360762f, -0.369896203f, -0.182019576f,
  3.99522833e-08f, 0.154251069f, 0.270820558f, 0.351732939f, 0.404902339f, 0.438816875f, 0.460190177f, 0.473634779f,
  0.482096255f, 0.487381011f, 0.490566134f, 0.492268503f, 0.492803633f, 0.492268503f, 0.490566194f, 0.487381041f,
  0.482096285f, 0.47363469f, 0.460189998f, 0.438816726f, 0.404902279f, 0.35173285f, 0.270820498f, 0.15425086f,
  -2.95323844e-07f, -0.182019681f, -0.369896322f, -0.53936094f, -0.675350845f, -0.775292516f, -0.844597757f, -0.891017973f,
  -0.921442509f, -0.94094342f, -0.952888012f, -0.95933193f, -0.961366415f, -0.95933193f, -0.952888012f, -0.94094348f,
  -0.921442509f, -0.891017854f, -0.844597697f, -0.775292516f, -0.675350785f, -0.539360881f, -0.369896173f, -0.182019562f,
  -1.3141107e-07f, 0.154251099f, 0.270820498f, 0.351732939f, 0.404902279f, 0.438816845f, 0.460190177f, 0.473634839f,
  0.482096314f, 0.48738116f, 0.490566224f, 0.492268622f, 0.492803663f, 0.492268533f, 0.490566254f, 0.487381071f,
  0.482096314f, 0.473634779f, 0.460190028f, 0.438816786f, 0.404902309f, 0.35173291f, 0.270820469f, 0.15425092f,
  -2.39444489e-07f, -0.18201974f, -0.369896293f, -0.539360881f, -0.675350904f, -0.775292516f, -0.844597816f, -0.891018033f,
  -0.921442568f, -0.940943539f, -0.952888072f, -0.959331989f, -0.961366415f, -0.959331989f, -0.952888012f, -0.940943599f,
  -0.921442509f, -0.891017973f, -0.844597697f, -0.775292456f, -0.675350785f, -0.539360821f, -0.369896263f, -0.182019651f,
  -1.202352e-07f, 0.154251054f, 0.270820558f, 0.351732939f, 0.404902339f, 0.438816845f, 0.460190266f, 0.473634869f,
  0.482096344f, 0.48738116f, 0.490566254f, 0.492268622f, 0.492803752f, 0.492268562f, 0.490566254f, 0.487381101f,
  0.482096285f, 0.47363469f, 0.460190088f, 0.438816786f, 0.40490222f, 0.35173288f, 0.270820439f, 0.15425086f,
  -2.5434565e-07f, -0.18201983f, -0.369896352f, -0.539360881f, -0.675350904f, -0.775292516f, -0.844597816f, -0.891017973f,
  -0.921442509f, -0.94094342f, -0.952888012f, -0.95933181f, -0.961366475f, -0.95933193f, -0.952888072f, -0.94094348f,
  -0.921442509f, -0.891017795f, -0.844597697f, -0.775292337f, -0.675350845f, -0.539360762f, -0.369896054f, -0.182019681f,
  -2.13367457e-07f, 0.154251039f, 0.270820558f, 0.35173291f, 0.40490222f, 0.438816816f, 0.460190147f, 0.47363475f,
  0.482096285f, 0.487381071f, 0.490566224f, 0.492268473f, 0.492803633f, 0.492268473f, 0.490566254f, 0.487381071f,
  0.482096255f, 0.473634779f, 0.460190088f, 0.438816786f, 0.40490225f, 0.35173285f, 0.270820439f, 0.154250816f,
  -2.99049134e-07f, -0.182019845f, -0.369896352f, -0.539360881f, -0.675350785f, -0.775292516f, -0.844597816f, -0.891017973f,
  -0.921442509f, -0.94094348f, -0.952888131f, -0.95933187f, -0.961366415f, -0.95933193f, -0.952888012f, -0.94094348f,
  -0.921442509f, -0.891017914f, -0.844597757f, -0.775292397f, -0.675350785f, -0.539360821f, -0.369896233f, -0.182019651f,
  -1.8915307e-07f, 0.154251054f, 0.270820618f, 0.351732969f, 0.404902279f, 0.438816875f, 0.460190177f, 0.473634839f,
  0.482096314f, 0.487381041f, 0.490566194f, 0.492268503f, 0.492803633f, 0.492268533f, 0.490566254f, 0.487381041f,
  0.482096374f, 0.473634839f, 0.460190058f, 0.438816845f, 0.404902339f, 0.351732939f, 0.270820498f, 0.15425086f,
  -1.63076038e-07f, -0.182019815f, -0.369896322f, -0.53936094f, -0.675350845f, -0.775292635f, -0.844597816f, -0.891018033f,
  -0.921442568f, -0.94094348f, -0.952888131f, -0.95933187f, -0.961366415f, -0.959331989f, -0.952888012f, -0.940943599f,
  -0.921442568f, -0.891017973f, -0.844597757f, -0.775292397f, -0.675350845f, -0.539360762f, -0.369896203f, -0.182019725f,
  -1.83565135e-07f, 0.154251114f, 0.270820528f, 0.351732969f, 0.404902309f, 0.438816875f, 0.460190237f, 0.473634809f,
  0.482096255f, 0.487381041f, 0.490566194f, 0.492268503f, 0.492803603f, 0.492268503f, 0.490566164f, 0.487381011f,
  0.482096314f, 0.47363472f, 0.460189998f, 0.438816726f, 0.404902339f, 0.35173285f, 0.270820439f, 0.154250905f,
  -2.5434565e-07f, -0.182019815f, -0.369896293f, -0.539361f, -0.675350845f, -0.775292635f, -0.844597816f, -0.891017973f,
  -0.921442509f, -0.94094336f, -0.952888012f, -0.95933181f, -0.961366534f, -0.95933187f, -0.952887893f, -0.94094348f,
  -0.921442509f, -0.891017795f, -0.844597697f, -0.775292337f, -0.675350785f, -0.539360642f, -0.369896114f, -0.182019591f,
  -1.03471393e-07f, 0.154251128f, 0.270820558f, 0.35173291f, 0.404902279f, 0.438816875f, 0.460190088f, 0.473634779f,
  0.482096255f, 0.487381041f, 0.490566105f, 0.492268503f, 0.492803574f, 0.492268384f, 0.490566194f, 0.487381011f,
  0.482096255f, 0.47363472f, 0.460189998f, 0.438816696f, 0.404902279f, 0.35173285f, 0.270820498f, 0.15425089f,
  -2.05916876e-07f, -0.1820198f, -0.369896263f, -0.539361f, -0.675350845f, -0.775292635f, -0.844597816f, -0.891017914f,
  -0.921442509f, -0.94094336f, -0.952888012f, -0.95933187f, -0.961366475f, -0.95933187f, -0.952888012f, -0.940943599f,
  -0.921442509f, -0.891017854f, -0.844597638f, -0.775292277f, -0.675350785f, -0.539360642f, -0.369896173f, -0.182019591f,
  -4.94546839e-08f, 0.154251114f, 0.270820558f, 0.351732969f, 0.404902279f, 0.438816905f, 0.460190117f, 0.473634839f,
  0.482096314f, 0.487381101f, 0.490566164f, 0.492268503f, 0.492803633f, 0.492268503f, 0.490566164f, 0.487381071f,
  0.482096255f, 0.47363466f, 0.460189968f, 0.438816726f, 0.404902279f, 0.35173285f, 0.270820439f, 0.15425083f,
  -3.62379069e-07f, -0.182019785f, -0.369896412f, -0.539361119f, -0.675351024f, -0.775292635f, -0.844597816f, -0.891018033f,
  -0.921442568f, -0.94094342f, -0.952887952f, -0.95933181f, -0.961366296f, -0.95933193f, -0.952888012f, -0.94094348f,
  -0.921442449f, -0.891017914f, -0.844597697f, -0.775292337f, -0.675350726f, -0.539360762f, -0.369896203f, -0.182019576f,
  3.99522833e-08f, 0.154251069f, 0.270820558f, 0.351732939f, 0.404902339f, 0.438816875f, 0.460190177f, 0.473634779f,
  0.482096255f, 0.487381011f, 0.490566134f, 0.492268503f, 0.492803633f, 0.492268503f, 0.490566194f, 0.487381041f,
  0.482096285f, 0.47363469f, 0.460189998f, 0.438816726f, 0.404902279f, 0.35173285f, 0.270820498f, 0.15425086f,
  -2.95323844e-07f, -0.182019681f, -0.369896322f, -0.53936094f, -0.675350845f, -0.775292516f, -0.844597757f, -0.891017973f,
  -0.921442509f, -0.94094342f, -0.952888012f, -0.95933193f, -0.961366415f, -0.95933193f, -0.952888012f, -0.94094348f,
  -0.921442509f, -0.891017854f, -0.844597697f, -0.775292516f, -0.675350785f, -0.539360881f, -0.369896173f, -0.182019562f,
  -1.3141107e-07f, 0.154251099f, 0.270820498f, 0.351732939f, 0.404902279f, 0.438816845f, 0.460190177f, 0.473634839f,
  0.482096314f, 0.48738116f, 0.490566224f, 0.492268622f, 0.492803663f, 0.492268533f, 0.490566254f, 0.487381071f,
  0.482096314f, 0.473634779f, 0.460190028f, 0.438816786f, 0.404902309f, 0.35173291f, 0.270820469f, 0.15425092f,
  -2.39444489e-07f, -0.18201974f, -0.369896293f, -0.539360881f, -0.675350904f, -0.775292516f, -0.844597816f, -0.891018033f,
  -0.921442568f, -0.940943539f, -0.952888072f, -0.959331989f, -0.961366415f, -0.959331989f, -0.952888012f, -0.940943599f,
  -0.921442509f, -0.891017973f, -0.844597697f, -0.775292456f, -0.675350785f, -0.539360821f, -0.369896263f, -0.182019651f,
  -1.202352e-07f, 0.154251054f, 0.270820558f, 0.351732939f, 0.404902339f, 0.438816845f, 0.460190266f, 0.473634869f,
  0.482096344f, 0.48738116f, 0.490566254f, 0.492268622f, 0.492803752f, 0.492268562f, 0.490566254f, 0.487381101f,
  0.482096285f, 0.47363469f, 0.460190088f, 0.438816786f, 0.40490222f, 0.35173288f, 0.270820439f, 0.15425086f,
  -2.5434565e-07f, -0.18201983f, -0.369896352f, -0.539360881f, -0.675350904f, -0.775292516f, -0.844597816f, -0.891017973f,
  -0.921442509f, -0.94094342f, -0.952888012f, -0.95933181f, -0.961366475f, -0.95933193f, -0.952888072f, -0.94094348f,
  -0.921442509f, -0.891017795f, -0.844597697f, -0.775292337f, -0.675350845f, -0.539360762f, -0.369896054f, -0.182019681f,
  -2.13367457e-07f, 0.154251039f, 0.270820558f, 0.35173291f, 0.40490222f, 0.438816816f, 0.460190147f, 0.47363475f,
  0.482096285f, 0.487381071f, 0.490566224f, 0.492268473f, 0.492803633f, 0.492268473f, 0.490566254f, 0.487381071f,
  0.482096255f, 0.473634779f, 0.460190088f, 0.438816786f, 0.40490225f, 0.35173285f, 0.270820439f, 0.154250816f,
  -2.99049134e-07f, -0.182019845f, -0.369896352f, -0.539360881f, -0.675350785f, -0.775292516f, -0.844597816f, -0.891017973f,
  -0.921442509f, -0.94094348f, -0.952888131f, -0.95933187f, -0.961366415f, -0.95933193f, -0.952888012f, -0.94094348f,
  -0.921442509f, -0.891017914f, -0.844597757f, -0.775292397f, -0.675350785f, -0.539360821f, -0.369896233f, -0.182019651f,
  -1.8915307e-07f, 0.154251054f, 0.270820618f, 0.351732969f, 0.404902279f, 0.438816875f, 0.460190177f, 0.473634839f,
  0.482096314f, 0.487381041f, 0.490566194f, 0.492268503f, 0.492803633f, 0.492268533f, 0.490566254f, 0.487381041f,
  0.482096374f, 0.473634839f, 0.460190058f, 0.438816845f, 0.404902339f, 0.351732939f, 0.270820498f, 0.15425086f,
  -1.63076038e-07f, -0.182019815f, -0.369896322f, -0.53936094f, -0.675350845f, -0.775292635f, -0.844597816f, -0.891018033f,
  -0.921442568f, -0.94094348f, -0.952888131f, -0.95933187f, -0.961366415f, -0.959331989f, -0.952888012f, -0.940943599f,
  -0.921442568f, -0.891017973f, -0.844597757f, -0.775292397f, -0.675350845f, -0.539360762f, -0.369896203f, -0.182019725f,
  -1.83565135e-07f, 0.154251114f, 0.270820528f, 0.351732969f, 0.404902309f, 0.438816875f, 0.460190237f, 0.473634809f,
  0.482096255f, 0.487381041f, 0.490566194f, 0.492268503f, 0.492803603f, 0.492268503f, 0.490566164f, 0.487381011f,
  0.482096314f, 0.47363472f, 0.460189998f, 0.438816726f, 0.404902339f, 0.35173285f, 0.270820439f, 0.154250905f,
  -2.5434565e-07f, -0.182019815f, -0.369896293f, -0.539361f, -0.675350845f, -0.775292635f, -0.844597816f, -0.891017973f,
  -0.921442509f, -0.94094336f, -0.952888012f, -0.95933181f, -0.961366534f, -0.95933187f, -0.952887893f, -0.94094348f,
  -0.921442509f, -0.891017795f, -0.844597697f, -0.775292337f, -0.675350785f, -0.539360642f, -0.369896114f, -0.182019591f,
  -1.03471393e-07f, 0.154251128f, 0.270820558f, 0.35173291f, 0.404902279f, 0.438816875f, 0.460190088f, 0.473634779f,
  0.482096255f, 0.487381041f, 0.490566105f, 0.492268503f, 0.492803574f, 0.492268384f, 0.490566194f, 0.487381011f,
  0.482096255f, 0.47363472f, 0.460189998f, 0.438816696f, 0.404902279f, 0.35173285f, 0.270820498f, 0.15425089f,
  -2.05916876e-07f, -0.1820198f, -0.369896263f, -0.539361f, -0.675350845f, -0.775292635f, -0.844597816f, -0.891017914f,
  -0.921442509f, -0.94094336f, -0.952888012f, -0.95933187f, -0.961366475f, -0.95933187f, -0.952888012f, -0.940943599f,
  -0.921442509f, -0.891017854f, -0.844597638f, -0.775292277f, -0.675350785f, -0.539360642f, -0.369896173f, -0.182019591f,
  -4.94546839e-08f, 0.154251114f, 0.270820558f, 0.351732969f, 0.404902279f, 0.438816905f, 0.460190117f, 0.473634839f,
  0.482096314f, 0.487381101f, 0.490566164f, 0.492268503f, 0.492803633f, 0.492268503f, 0.490566164f, 0.487381071f,
  0.482096255f, 0.47363466f, 0.460189968f, 0.438816726f, 0.404902279f, 0.35173285f, 0.270820439f, 0.15425083f,
  -3.62379069e-07f, -0.182019785f, -0.369896412f, -0.539361119f, -0.675351024f, -0.775292635f, -0.844597816f, -0.891018033f,
  -0.921442568f, -0.94094342f, -0.952887952f, -0.95933181f, -0.961366296f, -0.95933193f, -0.952888012f, -0.94094348f,
  -0.921442449f, -0.891017914f, -0.844597697f, -0.775292337f, -0.675350726f, -0.539360762f, -0.369896203f, -0.182019576f,
  3.99522833e-08f, 0.154251069f, 0.270820558f, 0.351732939f, 0.404902339f, 0.438816875f, 0.460190177f, 0.473634779f,
  0.482096255f, 0.487381011f, 0.490566134f, 0.492268503f, 0.492803633f, 0.492268503f, 0.490566194f, 0.487381041f,
  0.482096285f, 0.47363469f, 0.460189998f, 0.438816726f, 0.404902279f, 0.35173285f, 0.270820498f, 0.15425086f,
  -2.95323844e-07f, -0.182019681f, -0.369896322f, -0.53936094f, -0.675350845f, -0.775292516f, -0.844597757f, -0.891017973f,
  -0.921442509f, -0.94094342f, -0.952888012f, -0.95933193f, -0.961366415f, -0.95933193f, -0.952888012f, -0.94094348f,
  -0.921442509f, -0.891017854f, -0.844597697f, -0.775292516f, -0.675350785f, -0.539360881f, -0.369896173f, -0.182019562f,
  -1.3141107e-07f, 0.154251099f, 0.270820498f, 0.351732939f, 0.404902279f, 0.438816845f, 0.460190177f, 0.473634839f,
  0.482096314f, 0.48738116f, 0.490566224f, 0.492268622f, 0.492803663f, 0.492268533f, 0.490566254f, 0.487381071f,
  0.482096314f, 0.473634779f, 0.460190028f, 0.438816786f, 0.404902309f, 0.35173291f, 0.270820469f, 0.15425092f,
  -2.39444489e-07f, -0.18201974f, -0.369896293f, -0.539360881f, -0.675350904f, -0.775292516f, -0.844597816f, -0.891018033f,
  -0.921442568f, -0.940943539f, -0.952888072f, -0.959331989f, -0.961366415f, -0.959331989f, -0.952888012f, -0.940943599f,
  -0.921442509f, -0.891017973f, -0.844597697f, -0.775292456f, -0.675350785f, -0.539360821f, -0.369896263f, -0.182019651f,
  -1.202352e-07f, 0.154251054f, 0.270820558f, 0.351732939f, 0.404902339f, 0.438816845f, 0.460190266f, 0.473634869f,
  0.482096344f, 0.48738116f, 0.490566254f, 0.492268622f, 0.492803752f, 0.492268562f, 0.490566254f, 0.487381101f,
  0.482096285f, 0.47363469f, 0.460190088f, 0.438816786f, 0.40490222f, 0.35173288f, 0.270820439f, 0.15425086f,
  -2.5434565e-07f, -0.18201983f, -0.369896352f, -0.539360881f, -0.675350904f, -0.775292516f, -0.844597816f, -0.891017973f,
  -0.921442509f, -0.94094342f, -0.952888012f, -0.95933181f, -0.961366475f, -0.95933193f, -0.952888072f, -0.94094348f,
  -0.921442509f, -0.891017795f, -0.844597697f, -0.775292337f, -0.675350845f, -0.539360762f, -0.369896054f, -0.182019681f,
  -2.13367457e-07f, 0.154251039f, 0.270820558f, 0.35173291f, 0.40490222f, 0.438816816f, 0.460190147f, 0.47363475f,
  0.482096285f, 0.487381071f, 0.490566224f, 0.492268473f, 0.492803633f, 0.492268473f, 0.490566254f, 0.487381071f,
  0.482096255f, 0.473634779f, 0.460190088f, 0.438816786f, 0.40490225f, 0.35173285f, 0.270820439f, 0.154250816f,
  -2.99049134e-07f, -0.182019845f, -0.369896352f, -0.539360881f, -0.675350785f, -0.775292516f, -0.844597816f, -0.891017973f,
  -0.921442509f, -0.94094348f, -0.952888131f, -0.95933187f, -0.961366415f, -0.95933193f, -0.952888012f, -0.94094348f,
  -0.921442509f, -0.891017914f, -0.844597757f, -0.775292397f, -0.675350785f, -0.539360821f, -0.369896233f, -0.182019651f,
  -1.8915307e-07f, 0.154251054f, 0.270820618f, 0.351732969f, 0.404902279f, 0.438816875f, 0.460190177f, 0.473634839f,
  0.482096314f, 0.487381041f, 0.490566194f, 0.492268503f, 0.492803633f, 0.492268533f, 0.490566254f, 0.487381041f,
  0.482096374f, 0.473634839f, 0.460190058f, 0.438816845f, 0.404902339f, 0.351732939f, 0.270820498f, 0.15425086f,
  -1.63076038e-07f, -0.182019815f, -0.369896322f, -0.53936094f, -0.675350845f, -0.775292635f, -0.844597816f, -0.891018033f,
  -0.921442568f, -0.94094348f, -0.952888131f, -0.95933187f, -0.961366415f, -0.959331989f, -0.952888012f, -0.940943599f,
  -0.921442568f, -0.891017973f, -0.844597757f, -0.775292397f, -0.675350845f, -0.539360762f, -0.369896203f, -0.182019725f,
  -1.83565135e-07f, 0.154251114f, 0.270820528f, 0.351732969f, 0.404902309f, 0.438816875f, 0.460190237f, 0.473634809f,
  0.482096255f, 0.487381041f, 0.490566194f, 0.492268503f, 0.492803603f, 0.492268503f, 0.490566164f, 0.487381011f,
  0.482096314f, 0.47363472f, 0.460189998f, 0.438816726f, 0.404902339f, 0.35173285f, 0.270820439f, 0.154250905f,
  -2.5434565e-07f, -0.182019815f, -0.369896293f, -0.539361f, -0.675350845f, -0.775292635f, -0.844597816f, -0.891017973f,
  -0.921442509f, -0.94094336f, -0.952888012f, -0.95933181f, -0.961366534f, -0.95933187f, -0.952887893f, -0.94094348f,
  -0.921442509f, -0.891017795f, -0.844597697f, -0.775292337f, -0.675350785f, -0.539360642f, -0.369896114f, -0.182019591f,
  -1.03471393e-07f, 0.154251128f, 0.270820558f, 0.35173291f, 0.404902279f, 0.438816875f, 0.460190088f, 0.473634779f,
  0.482096255f, 0.487381041f, 0.490566105f, 0.492268503f, 0.492803574f, 0.492268384f, 0.490566194f, 0.487381011f,
  0.482096255f, 0.47363472f, 0.460189998f, 0.438816696f, 0.404902279f, 0.35173285f, 0.270820498f, 0.15425089f,
  -2.05916876e-07f, -0.1820198f, -0.369896263f, -0.539361f, -0.675350845f, -0.775292635f, -0.844597816f, -0.891017914f,
  -0.921442509f, -0.94094336f, -0.952888012f, -0.95933187f, -0.961366475f, -0.95933187f, -0.952888012f, -0.940943599f,
  -0.921442509f, -0.891017854f, -0.844597638f, -0.775292277f, -0.675350785f, -0.539360642f, -0.369896173f, -0.182019591f,
  -4.94546839e-08f, 0.154251114f, 0.270820558f, 0.351732969f, 0.404902279f, 0.438816905f, 0.460190117f, 0.473634839f,
  0.482096314f, 0.487381101f, 0.490566164f, 0.492268503f, 0.492803633f, 0.492268503f, 0.490566164f, 0.487381071f,
  0.482096255f, 0.47363466f, 0.460189968f, 0.438816726f, 0.404902279f, 0.35173285f, 0.270820439f, 0.15425083f,
  -3.62379069e-07f, -0.182019785f, -0.369896412f, -0.539361119f, -0.675351024f, -0.775292635f, -0.844597816f, -0.891018033f,
  -0.921442568f, -0.94094342f, -0.952887952f, -0.95933181f, -0.961366296f, -0.95933193f, -0.952888012f, -0.94094348f,
  -0.921442449f, -0.891017914f, -0.844597697f, -0.775292337f, -0.675350726f, -0.539360762f, -0.369896203f, -0.182019576f,
  3.99522833e-08f, 0.154251069f, 0.270820558f, 0.351732939f, 0.404902339f, 0.438816875f, 0.460190177f, 0.473634779f,
  0.482096255f, 0.487381011f, 0.490566134f, 0.492268503f, 0.492803633f, 0.492268503f, 0.490566194f, 0.487381041f,
  0.482096285f, 0.47363469f, 0.460189998f, 0.438816726f, 0.404902279f, 0.35173285f, 0.270820498f, 0.15425086f,
  -2.95323844e-07f, -0.182019681f, -0.369896322f, -0.53936094f, -0.675350845f, -0.775292516f, -0.844597757f, -0.891017973f,
  -0.921442509f, -0.94094342f, -0.952888012f, -0.95933193f, -0.961366415f, -0.95933193f, -0.952888012f, -0.94094348f,
  -0.921442509f, -0.891017854f, -0.844597697f, -0.775292516f, -0.675350785f, -0.539360881f, -0.369896173f, -0.182019562f,
  -1.3141107e-07f, 0.154251099f, 0.270820498f, 0.351732939f, 0.404902279f, 0.438816845f, 0.460190177f, 0.473634839f,
  0.482096314f, 0.48738116f, 0.490566224f, 0.492268622f, 0.492803663f, 0.492268533f, 0.490566254f, 0.487381071f,
  0.482096314f, 0.473634779f, 0.460190028f, 0.438816786f, 0.404902309f, 0.35173291f, 0.270820469f, 0.15425092f,
  -2.39444489e-07f, -0.18201974f, -0.369896293f, -0.539360881f, -0.675350904f, -0.775292516f, -0.844597816f, -0.891018033f,
  -0.921442568f, -0.940943539f, -0.952888072f, -0.959331989f, -0.961366415f, -0.959331989f, -0.952888012f, -0.940943599f,
  -0.921442509f, -0.891017973f, -0.844597697f, -0.775292456f, -0.675350785f, -0.539360821f, -0.369896263f, -0.182019651f,
  -1.202352e-07f, 0.154251054f, 0.270820558f, 0.351732939f, 0.404902339f, 0.438816845f, 0.460190266f, 0.473634869f,
  0.482096344f, 0.48738116f, 0.490566254f, 0.492268622f, 0.492803752f, 0.492268562f, 0.490566254f, 0.487381101f,
  0.482096285f, 0.47363469f, 0.460190088f, 0.438816786f, 0.40490222f, 0.35173288f, 0.270820439f, 0.15425086f,
  -2.5434565e-07f, -0.18201983f, -0.369896352f, -0.539360881f, -0.675350904f, -0.775292516f, -0.844597816f, -0.891017973f,
  -0.921442509f, -0.94094342f, -0.952888012f, -0.95933181f, -0.961366475f, -0.95933193f, -0.952888072f, -0.94094348f,
  -0.921442509f, -0.891017795f, -0.844597697f, -0.775292337f, -0.675350845f, -0.539360762f, -0.369896054f, -0.182019681f,
  -2.13367457e-07f, 0.154251039f, 0.270820558f, 0.35173291f, 0.40490222f, 0.438816816f, 0.460190147f, 0.47363475f,
  0.482096285f, 0.487381071f, 0.490566224f, 0.492268473f, 0.492803633f, 0.492268473f, 0.490566254f, 0.487381071f,
  0.482096255f, 0.473634779f, 0.460190088f, 0.438816786f, 0.40490225f, 0.35173285f, 0.270820439f, 0.154250816f,
  -2.99049134e-07f, -0.182019845f, -0.369896352f, -0.539360881f, -0.675350785f, -0.775292516f, -0.844597816f, -0.891017973f,
  -0.921442509f, -0.94094348f, -0.952888131f, -0.95933187f, -0.961366415f, -0.95933193f, -0.952888012f, -0.94094348f,
  -0.921442509f, -0.891017914f, -0.844597757f, -0.775292397f, -0.675350785f, -0.539360821f, -0.369896233f, -0.182019651f,
  -1.8915307e-07f, 0.154251054f, 0.270820618f, 0.351732969f, 0.404902279f, 0.438816875f, 0.460190177f, 0.473634839f,
  0.482096314f, 0.487381041f, 0.490566194f, 0.492268503f, 0.492803633f, 0.492268533f, 0.490566254f, 0.487381041f,
  0.482096374f, 0.473634839f, 0.460190058f, 0.438816845f, 0.404902339f, 0.351732939f, 0.270820498f, 0.15425086f,
  -1.63076038e-07f, -0.182019815f, -0.369896322f, -0.53936094f, -0.675350845f, -0.775292635f, -0.844597816f, -0.891018033f,
  -0.921442568f, -0.94094348f, -0.952888131f, -0.95933187f, -0.961366415f, -0.959331989f, -0.952888012f, -0.940943599f,
  -0.921442568f, -0.891017973f, -0.844597757f, -0.775292397f, -0.675350845f, -0.539360762f, -0.369896203f, -0.182019725f,
  -1.83565135e-07f, 0.154251114f, 0.270820528f, 0.351732969f, 0.404902309f, 0.438816875f, 0.460190237f, 0.473634809f,
  0.482096255f, 0.487381041f, 0.490566194f, 0.492268503f, 0.492803603f, 0.492268503f, 0.490566164f, 0.487381011f,
  0.482096314f, 0.47363472f, 0.460189998f, 0.438816726f, 0.404902339f, 0.35173285f, 0.270820439f, 0.154250905f,
  -2.5434565e-07f, -0.182019815f, -0.369896293f, -0.539361f, -0.675350845f, -0.775292635f, -0.844597816f, -0.891017973f,
  -0.921442509f, -0.94094336f, -0.952888012f, -0.95933181f, -0.961366534f, -0.95933187f, -0.952887893f, -0.94094348f,
  -0.921442509f, -0.891017795f, -0.844597697f, -0.775292337f, -0.675350785f, -0.539360642f, -0.369896114f, -0.182019591f,
  -1.03471393e-07f, 0.154251128f, 0.270820558f, 0.35173291f, 0.404902279f, 0.438816875f, 0.460190088f, 0.473634779f,
  0.482096255f, 0.487381041f, 0.490566105f, 0.492268503f, 0.492803574f, 0.492268384f, 0.490566194f, 0.487381011f,
  0.482096255f, 0.47363472f, 0.460189998f, 0.438816696f, 0.404902279f, 0.35173285f, 0.270820498f, 0.15425089f,
  -2.05916876e-07f, -0.1820198f, -0.369896263f, -0.539361f, -0.675350845f, -0.775292635f, -0.844597816f, -0.891017914f,
  -0.921442509f, -0.94094336f, -0.952888012f, -0.95933187f, -0.961366475f, -0.95933187f, -0.952888012f, -0.940943599f,
  -0.921442509f, -0.891017854f, -0.844597638f, -0.775292277f, -0.675350785f, -0.539360642f, -0.369896173f, -0.182019591f,
  -4.94546839e-08f, 0.154251114f, 0.270820558f, 0.351732969f, 0.404902279f, 0.438816905f, 0.460190117f, 0.473634839f,
  0.482096314f, 0.487381101f, 0.490566164f, 0.492268503f, 0.492803633f, 0.492268503f, 0.490566164f, 0.487381071f,
  0.482096255f, 0.47363466f, 0.460189968f, 0.438816726f, 0.404902279f, 0.35173285f, 0.270820439f, 0.15425083f,
  -3.62379069e-07f, -0.182019785f, -0.369896412f, -0.539361119f, -0.675351024f, -0.775292635f, -0.844597816f, -0.891018033f,
  -0.921442568f, -0.94094342f, -0.952887952f, -0.95933181f, -0.961366296f, -0.95933193f, -0.952888012f, -0.94094348f,
  -0.921442449f, -0.891017914f, -0.844597697f, -0.775292337f, -0.675350726f, -0.539360762f, -0.369896203f, -0.182019576f,
  3.99522833e-08f, 0.154251069f, 0.270820558f, 0.351732939f, 0.404902339f, 0.438816875f, 0.460190177f, 0.473634779f,
  0.482096255f, 0.487381011f, 0.490566134f, 0.492268503f, 0.492803633f, 0.492268503f, 0.490566194f, 0.487381041f,
  0.482096285f, 0.47363469f, 0.460189998f, 0.438816726f, 0.404902279f, 0.35173285f, 0.270820498f, 0.15425086f,
  -2.95323844e-07f, -0.182019681f, -0.369896322f, -0.53936094f, -0.675350845f, -0.775292516f, -0.844597757f, -0.891017973f,
  -0.921442509f, -0.94094342f, -0.952888012f, -0.95933193f, -0.961366415f, -0.95933193f, -0.952888012f, -0.94094348f,
  -0.921442509f, -0.891017854f, -0.844597697f, -0.775292516f, -0.675350785f, -0.539360881f, -0.369896173f, -0.182019562f,
  -1.3141107e-07f, 0.154251099f, 0.270820498f, 0.351732939f, 0.404902279f, 0.438816845f, 0.460190177f, 0.473634839f,
  0.482096314f, 0.48738116f, 0.490566224f, 0.492268622f, 0.492803663f, 0.492268533f, 0.490566254f, 0.487381071f,
  0.482096314f, 0.473634779f, 0.460190028f, 0.438816786f, 0.404902309f, 0.35173291f, 0.270820469f, 0.15425092f,
  -2.39444489e-07f, -0.18201974f, -0.369896293f, -0.539360881f, -0.675350904f, -0.775292516f, -0.844597816f, -0.891018033f,
  -0.921442568f, -0.940943539f, -0.952888072f, -0.959331989f, -0.961366415f, -0.959331989f, -0.952888012f, -0.940943599f,
  -0.921442509f, -0.891017973f, -0.844597697f, -0.775292456f, -0.675350785f, -0.539360821f, -0.369896263f, -0.182019651f,
  -1.202352e-07f, 0.154251054f, 0.270820558f, 0.351732939f, 0.404902339f, 0.438816845f, 0.460190266f, 0.473634869f,
  0.482096344f, 0.48738116f, 0.490566254f, 0.492268622f, 0.492803752f, 0.492268562f, 0.490566254f, 0.487381101f,
  0.482096285f, 0.47363469f, 0.460190088f, 0.438816786f, 0.40490222f, 0.35173288f, 0.270820439f, 0.15425086f,
  -2.5434565e-07f, -0.18201983f, -0.369896352f, -0.539360881f, -0.675350904f, -0.775292516f, -0.844597816f, -0.891017973f,
  -0.921442509f, -0.94094342f, -0.952888012f, -0.95933181f, -0.961366475f, -0.95933193f, -0.952888072f, -0.94094348f,
  -0.921442509f, -0.891017795f, -0.844597697f, -0.775292337f, -0.675350845f, -0.539360762f, -0.369896054f, -0.182019681f,
  -2.13367457e-07f, 0.154251039f, 0.270820558f, 0.35173291f, 0.40490222f, 0.438816816f, 0.460190147f, 0.47363475f,
  0.482096285f, 0.487381071f, 0.490566224f, 0.492268473f, 0.492803633f, 0.492268473f, 0.490566254f, 0.487381071f,
  0.482096255f, 0.473634779f, 0.460190088f, 0.438816786f, 0.40490225f, 0.35173285f, 0.270820439f, 0.154250816f,
  -2.99049134e-07f, -0.182019845f, -0.369896352f, -0.539360881f, -0.675350785f, -0.775292516f, -0.844597816f, -0.891017973f,
  -0.921442509f, -0.94094348f, -0.952888131f, -0.95933187f, -0.961366415f, -0.95933193f, -0.952888012f, -0.94094348f,
  -0.921442509f, -0.891017914f, -0.844597757f, -0.775292397f, -0.675350785f, -0.539360821f, -0.369896233f, -0.182019651f,
  -1.8915307e-07f, 0.154251054f, 0.270820618f, 0.351732969f, 0.404902279f, 0.438816875f, 0.460190177f, 0.473634839f,
  0.482096314f, 0.487381041f, 0.490566194f, 0.492268503f, 0.492803633f, 0.492268533f, 0.490566254f, 0.487381041f,
  0.482096374f, 0.473634839f, 0.460190058f, 0.438816845f, 0.404902339f, 0.351732939f, 0.270820498f, 0.15425086f,
  -1.63076038e-07f, -0.182019815f, -0.369896322f, -0.53936094f, -0.675350845f, -0.775292635f, -0.844597816f, -0.891018033f,
  -0.921442568f, -0.94094348f, -0.952888131f, -0.95933187f, -0.961366415f, -0.959331989f, -0.952888012f, -0.940943599f,
  -0.921442568f, -0.891017973f, -0.844597757f, -0.775292397f, -0.675350845f, -0.539360762f, -0.369896203f, -0.182019725f,
  -1.83565135e-07f, 0.154251114f, 0.270820528f, 0.351732969f, 0.404902309f, 0.438816875f, 0.460190237f, 0.473634809f,
  0.482096255f, 0.487381041f, 0.490566194f, 0.492268503f, 0.492803603f, 0.492268503f, 0.490566164f, 0.487381011f,
  0.482096314f, 0.47363472f, 0.460189998f, 0.438816726f, 0.404902339f, 0.35173285f, 0.270820439f, 0.154250905f,
  -2.5434565e-07f, -0.182019815f, -0.369896293f, -0.539361f, -0.675350845f, -0.775292635f, -0.844597816f, -0.891017973f,
  -0.921442509f, -0.94094336f, -0.952888012f, -0.95933181f, -0.961366534f, -0.95933187f, -0.952887893f, -0.94094348f,
  -0.921442509f, -0.891017795f, -0.844597697f, -0.775292337f, -0.675350785f, -0.539360642f, -0.369896114f, -0.182019591f,
  -1.03471393e-07f, 0.154251128f, 0.270820558f, 0.35173291f, 0.404902279f, 0.438816875f, 0.460190088f, 0.473634779f,
  0.482096255f, 0.487381041f, 0.490566105f, 0.492268503f, 0.492803574f, 0.492268384f, 0.490566194f, 0.487381011f,
  0.482096255f, 0.47363472f, 0.460189998f, 0.438816696f, 0.404902279f, 0.35173285f, 0.270820498f, 0.15425089f,
  -2.05916876e-07f, -0.1820198f, -0.369896263f, -0.539361f, -0.675350845f, -0.775292635f, -0.844597816f, -0.891017914f,
  -0.921442509f, -0.94094336f, -0.952888012f, -0.95933187f, -0.961366475f, -0.95933187f, -0.952888012f, -0.940943599f,
  -0.921442509f, -0.891017854f, -0.844597638f, -0.775292277f, -0.675350785f, -0.539360642f, -0.369896173f, -0.182019591f,
  -4.94546839e-08f, 0.154251114f, 0.270820558f, 0.351732969f, 0.404902279f, 0.438816905f, 0.460190117f, 0.473634839f,
  0.482096314f, 0.487381101f, 0.490566164f, 0.492268503f, 0.492803633f, 0.492268503f, 0.490566164f, 0.487381071f,
  0.482096255f, 0.47363466f, 0.460189968f, 0.438816726f, 0.404902279f, 0.35173285f, 0.270820439f, 0.15425083f,
  -3.62379069e-07f, -0.182019785f, -0.369896412f, -0.539361119f, -0.675351024f, -0.775292635f, -0.844597816f, -0.891018033f,
  -0.921442568f, -0.94094342f, -0.952887952f, -0.95933181f, -0.961366296f, -0.95933193f, -0.952888012f, -0.94094348f,
  -0.921442449f, -0.891017914f, -0.844597697f, -0.775292337f, -0.675350726f, -0.539360762f, -0.369896203f, -0.182019576f,
  3.99522833e-08f, 0.154251069f, 0.270820558f, 0.351732939f, 0.404902339f, 0.438816875f, 0.460190177f, 0.473634779f,
  0.482096255f, 0.487381011f, 0.490566134f, 0.492268503f, 0.492803633f, 0.492268503f, 0.490566194f, 0.487381041f,
  0.482096285f, 0.47363469f, 0.460189998f, 0.438816726f, 0.404902279f, 0.35173285f, 0.270820498f, 0.15425086f,
  -2.95323844e-07f, -0.182019681f, -0.369896322f, -0.53936094f, -0.675350845f, -0.775292516f, -0.844597757f, -0.891017973f,
  -0.921442509f, -0.94094342f, -0.952888012f, -0.95933193f, -0.961366415f, -0.95933193f, -0.952888012f, -0.94094348f,
  -0.921442509f, -0.891017854f, -0.844597697f, -0.775292516f, -0.675350785f, -0.539360881f, -0.369896173f, -0.182019562f,
  -1.3141107e-07f, 0.154251099f, 0.270820498f, 0.351732939f, 0.404902279f, 0.438816845f, 0.460190177f, 0.473634839f,
  0.482096314f, 0.48738116f, 0.490566224f, 0.492268622f, 0.492803663f, 0.492268533f, 0.490566254f, 0.487381071f,
  0.482096314f, 0.473634779f, 0.460190028f, 0.438816786f, 0.404902309f, 0.35173291f, 0.270820469f, 0.15425092f,
  -2.39444489e-07f, -0.18201974f, -0.369896293f, -0.539360881f, -0.675350904f, -0.775292516f, -0.844597816f, -0.891018033f,
  -0.921442568f, -0.940943539f, -0.952888072f, -0.959331989f, -0.961366415f, -0.959331989f, -0.952888012f, -0.940943599f,
  -0.921442509f, -0.891017973f, -0.844597697f, -0.775292456f, -0.675350785f, -0.539360821f, -0.369896263f, -0.182019651f,
  -1.202352e-07f, 0.154251054f, 0.270820558f, 0.351732939f, 0.404902339f, 0.438816845f, 0.460190266f, 0.473634869f,
  0.482096344f, 0.48738116f, 0.490566254f, 0.492268622f, 0.492803752f, 0.492268562f, 0.490566254f, 0.487381101f,
  0.482096285f, 0.47363469f, 0.460190088f, 0.438816786f, 0.40490222f, 0.35173288f, 0.270820439f, 0.15425086f,
  -2.5434565e-07f, -0.18201983f, -0.369896352f, -0.539360881f, -0.675350904f, -0.775292516f, -0.844597816f, -0.891017973f,
  -0.921442509f, -0.94094342f, -0.952888012f, -0.95933181f, -0.961366475f, -0.95933193f, -0.952888072f, -0.94094348f,
  -0.921442509f, -0.891017795f, -0.844597697f, -0.775292337f, -0.675350845f, -0.539360762f, -0.369896054f, -0.182019681f,
  -2.13367457e-07f, 0.154251039f, 0.270820558f, 0.35173291f, 0.40490222f, 0.438816816f, 0.460190147f, 0.47363475f,
  0.482096285f, 0.487381071f, 0.490566224f, 0.492268473f, 0.492803633f, 0.492268473f, 0.490566254f, 0.487381071f,
  0.482096255f, 0.473634779f, 0.460190088f, 0.438816786f, 0.40490225f, 0.35173285f, 0.270820439f, 0.154250816f,
  -2.99049134e-07f, -0.182019845f, -0.369896352f, -0.539360881f, -0.675350785f, -0.775292516f, -0.844597816f, -0.891017973f,
  -0.921442509f, -0.94094348f, -0.952888131f, -0.95933187f, -0.961366415f, -0.95933193f, -0.952888012f, -0.94094348f,
  -0.921442509f, -0.891017914f, -0.844597757f, -0.775292397f, -0.675350785f, -0.539360821f, -0.369896233f, -0.182019651f,
  -1.8915307e-07f, 0.154251054f, 0.270820618f, 0.351732969f, 0.404902279f, 0.438816875f, 0.460190177f, 0.473634839f,
  0.482096314f, 0.487381041f, 0.490566194f, 0.492268503f, 0.492803633f, 0.492268533f, 0.490566254f, 0.487381041f,
  0.482096374f, 0.473634839f, 0.460190058f, 0.438816845f, 0.404902339f, 0.351732939f, 0.270820498f, 0.15425086f,
  -1.63076038e-07f, -0.182019815f, -0.369896322f, -0.53936094f, -0.675350845f, -0.775292635f, -0.844597816f, -0.891018033f,
  -0.921442568f, -0.94094348f, -0.952888131f, -0.95933187f, -0.961366415f, -0.959331989f, -0.952888012f, -0.940943599f,
  -0.921442568f, -0.891017973f, -0.844597757f, -0.775292397f, -0.675350845f, -0.539360762f, -0.369896203f, -0.182019725f,
  -1.83565135e-07f, 0.154251114f, 0.270820528f, 0.351732969f, 0.404902309f, 0.438816875f, 0.460190237f, 0.473634809f,
  0.482096255f, 0.487381041f, 0.490566194f, 0.492268503f, 0.492803603f, 0.492268503f, 0.490566164f, 0.487381011f,
  0.482096314f, 0.47363472f, 0.460189998f, 0.438816726f, 0.404902339f, 0.35173285f, 0.270820439f, 0.154250905f,
  -2.5434565e-07f, -0.182019815f, -0.369896293f, -0.539361f, -0.675350845f, -0.775292635f, -0.844597816f, -0.891017973f,
  -0.921442509f, -0.94094336f, -0.952888012f, -0.95933181f, -0.961366534f, -0.95933187f, -0.952887893f, -0.94094348f,
  -0.921442509f, -0.891017795f, -0.844597697f, -0.775292337f, -0.675350785f, -0.539360642f, -0.369896114f, -0.182019591f,
  -1.03471393e-07f, 0.154251128f, 0.270820558f, 0.35173291f, 0.404902279f, 0.438816875f, 0.460190088f, 0.473634779f,
  0.482096255f, 0.487381041f, 0.490566105f, 0.492268503f, 0.492803574f, 0.492268384f, 0.490566194f, 0.487381011f,
  0.482096255f, 0.47363472f, 0.460189998f, 0.438816696f, 0.404902279f, 0.35173285f, 0.270820498f, 0.15425089f,
  -2.05916876e-07f, -0.1820198f, -0.369896263f, -0.539361f, -0.675350845f, -0.775292635f, -0.844597816f, -0.891017914f,
  -0.921442509f, -0.94094336f, -0.952888012f, -0.95933187f, -0.961366475f, -0.95933187f, -0.952888012f, -0.940943599f,
  -0.921442509f, -0.891017854f, -0.844597638f, -0.775292277f, -0.675350785f, -0.539360642f, -0.369896173f, -0.182019591f,
  -4.94546839e-08f, 0.154251114f, 0.270820558f, 0.351732969f, 0.404902279f, 0.438816905f, 0.460190117f, 0.473634839f,
  0.482096314f, 0.487381101f, 0.490566164f, 0.492268503f, 0.492803633f, 0.492268503f, 0.490566164f, 0.487381071f,
  0.482096255f, 0.47363466f, 0.460189968f, 0.438816726f, 0.404902279f, 0.35173285f, 0.270820439f, 0.15425083f,
  -3.62379069e-07f, -0.182019785f, -0.369896412f, -0.539361119f, -0.675351024f, -0.775292635f, -0.844597816f, -0.891018033f,
  -0.921442568f, -0.94094342f, -0.952887952f, -0.95933181f, -0.961366296f, -0.95933193f, -0.952888012f, -0.94094348f,
  -0.921442449f, -0.891017914f, -0.844597697f, -0.775292337f, -0.675350726f, -0.539360762f, -0.369896203f, -0.182019576f,
  3.99522833e-08f, 0.154251069f, 0.270820558f, 0.351732939f, 0.404902339f, 0.438816875f, 0.460190177f, 0.473634779f,
  0.482096255f, 0.487381011f, 0.490566134f, 0.492268503f, 0.492803633f, 0.492268503f, 0.490566194f, 0.487381041f,
  0.482096285f, 0.47363469f, 0.460189998f, 0.438816726f, 0.404902279f, 0.35173285f, 0.270820498f, 0.15425086f,
  -2.95323844e-07f, -0.182019681f, -0.369896322f, -0.53936094f, -0.675350845f, -0.775292516f, -0.844597757f, -0.891017973f,
  -0.921442509f, -0.94094342f, -0.952888012f, -0.95933193f, -0.961366415f, -0.95933193f, -0.952888012f, -0.94094348f,
  -0.921442509f, -0.891017854f, -0.844597697f, -0.775292516f, -0.675350785f, -0.539360881f, -0.369896173f, -0.182019562f,
  -1.3141107e-07f, 0.154251099f, 0.270820498f, 0.351732939f, 0.404902279f, 0.438816845f, 0.460190177f, 0.473634839f,
  0.482096314f, 0.48738116f, 0.490566224f, 0.492268622f, 0.492803663f, 0.492268533f, 0.490566254f, 0.487381071f,
  0.482096314f, 0.473634779f, 0.460190028f, 0.438816786f, 0.404902309f, 0.35173291f, 0.270820469f, 0.15425092f,
  -2.39444489e-07f, -0.18201974f, -0.369896293f, -0.539360881f, -0.675350904f, -0.775292516f, -0.844597816f, -0.891018033f,
  -0.921442568f, -0.940943539f, -0.952888072f, -0.959331989f, -0.961366415f, -0.959331989f, -0.952888012f, -0.940943599f,
  -0.921442509f, -0.891017973f, -0.844597697f, -0.775292456f, -0.675350785f, -0.539360821f, -0.369896263f, -0.182019651f,
  -1.202352e-07f, 0.154251054f, 0.270820558f, 0.351732939f, 0.404902339f, 0.438816845f, 0.460190266f, 0.473634869f,
  0.482096344f, 0.48738116f, 0.490566254f, 0.492268622f, 0.492803752f, 0.492268562f, 0.490566254f, 0.487381101f,
  0.482096285f, 0.47363469f, 0.460190088f, 0.438816786f, 0.40490222f, 0.35173288f, 0.270820439f, 0.15425086f,
  -2.5434565e-07f, -0.18201983f, -0.369896352f, -0.539360881f, -0.675350904f, -0.775292516f, -0.844597816f, -0.891017973f,
  -0.921442509f, -0.94094342f, -0.952888012f, -0.95933181f, -0.961366475f, -0.95933193f, -0.952888072f, -0.94094348f,
  -0.921442509f, -0.891017795f, -0.844597697f, -0.775292337f, -0.675350845f, -0.539360762f, -0.369896054f, -0.182019681f,
  -2.13367457e-07f, 0.154251039f, 0.270820558f, 0.35173291f, 0.40490222f, 0.438816816f, 0.460190147f, 0.47363475f,
  0.482096285f, 0.487381071f, 0.490566224f, 0.492268473f, 0.492803633f, 0.492268473f, 0.490566254f, 0.487381071f,
  0.482096255f, 0.473634779f, 0.460190088f, 0.438816786f, 0.40490225f, 0.35173285f, 0.270820439f, 0.154250816f,
  -2.99049134e-07f, -0.182019845f, -0.369896352f, -0.539360881f, -0.675350785f, -0.775292516f, -0.844597816f, -0.891017973f,
  -0.921442509f, -0.94094348f, -0.952888131f, -0.95933187f, -0.961366415f, -0.95933193f, -0.952888012f, -0.94094348f,
  -0.921442509f, -0.891017914f, -0.844597757f, -0.775292397f, -0.675350785f, -0.539360821f, -0.369896233f, -0.182019651f,
  -1.8915307e-07f, 0.154251054f, 0.270820618f, 0.351732969f, 0.404902279f, 0.438816875f, 0.460190177f, 0.473634839f,
  0.482096314f, 0.487381041f, 0.490566194f, 0.492268503f, 0.492803633f, 0.492268533f, 0.490566254f, 0.487381041f,
  0.482096374f, 0.473634839f, 0.460190058f, 0.438816845f, 0.404902339f, 0.351732939f, 0.270820498f, 0.15425086f,
  -1.63076038e-07f, -0.182019815f, -0.369896322f, -0.53936094f, -0.675350845f, -0.775292635f, -0.844597816f, -0.891018033f,
  -0.921442568f, -0.94094348f, -0.952888131f, -0.95933187f, -0.961366415f, -0.959331989f, -0.952888012f, -0.940943599f,
  -0.921442568f, -0.891017973f, -0.844597757f, -0.775292397f, -0.675350845f, -0.539360762f, -0.369896203f, -0.182019725f,
  -1.83565135e-07f, 0.154251114f, 0.270820528f, 0.351732969f, 0.404902309f, 0.438816875f, 0.460190237f, 0.473634809f,
  0.482096255f, 0.487381041f, 0.490566194f, 0.492268503f, 0.492803603f, 0.492268503f, 0.490566164f, 0.487381011f,
  0.482096314f, 0.47363472f, 0.460189998f, 0.438816726f, 0.404902339f, 0.35173285f, 0.270820439f, 0.154250905f,
  -2.5434565e-07f, -0.182019815f, -0.369896293f, -0.539361f, -0.675350845f, -0.775292635f, -0.844597816f, -0.891017973f,
  -0.921442509f, -0.94094336f, -0.952888012f, -0.95933181f, -0.961366534f, -0.95933187f, -0.952887893f, -0.94094348f,
  -0.921442509f, -0.891017795f, -0.844597697f, -0.775292337f, -0.675350785f, -0.539360642f, -0.369896114f, -0.182019591f,
  -1.03471393e-07f, 0.154251128f, 0.270820558f, 0.35173291f, 0.404902279f, 0.438816875f, 0.460190088f, 0.473634779f,
  0.482096255f, 0.487381041f, 0.490566105f, 0.492268503f, 0.492803574f, 0.492268384f, 0.490566194f, 0.487381011f,
  0.482096255f, 0.47363472f, 0.460189998f, 0.438816696f, 0.404902279f, 0.35173285f, 0.270820498f, 0.15425089f,
  -2.05916876e-07f, -0.1820198f, -0.369896263f, -0.539361f, -0.675350845f, -0.775292635f, -0.844597816f, -0.891017914f,
  -0.921442509f, -0.94094336f, -0.952888012f, -0.95933187f, -0.961366475f, -0.95933187f, -0.952888012f, -0.940943599f,
  -0.921442509f, -0.891017854f, -0.844597638f, -0.775292277f, -0.675350785f, -0.539360642f, -0.369896173f, -0.182019591f,
  -4.94546839e-08f, 0.154251114f, 0.270820558f, 0.351732969f, 0.404902279f, 0.438816905f, 0.460190117f, 0.473634839f,
  0.482096314f, 0.487381101f, 0.490566164f, 0.492268503f, 0.492803633f, 0.492268503f, 0.490566164f, 0.487381071f,
  0.482096255f, 0.47363466f, 0.460189968f, 0.438816726f, 0.404902279f, 0.35173285f, 0.270820439f, 0.15425083f,
  -3.62379069e-07f, -0.182019785f, -0.369896412f, -0.539361119f, -0.675351024f, -0.775292635f, -0.844597816f, -0.891018033f,
  -0.921442568f, -0.94094342f, -0.952887952f, -0.95933181f, -0.961366296f, -0.95933193f, -0.952888012f, -0.94094348f,
  -0.921442449f, -0.891017914f, -0.844597697f, -0.775292337f, -0.675350726f, -0.539360762f, -0.369896203f, -0.182019576f,
  3.99522833e-08f, 0.154251069f, 0.270820558f, 0.351732939f, 0.404902339f, 0.438816875f, 0.460190177f, 0.473634779f,
  0.482096255f, 0.487381011f, 0.490566134f, 0.492268503f, 0.492803633f, 0.492268503f, 0.490566194f, 0.487381041f,
  0.482096285f, 0.47363469f, 0.460189998f, 0.438816726f, 0.404902279f, 0.35173285f, 0.270820498f, 0.15425086f,
  -2.95323844e-07f, -0.182019681f, -0.369896322f, -0.53936094f, -0.675350845f, -0.775292516f, -0.844597757f, -0.891017973f,
  -0.921442509f, -0.94094342f, -0.952888012f, -0.95933193f, -0.961366415f, -0.95933193f, -0.952888012f, -0.94094348f,
  -0.921442509f, -0.891017854f, -0.844597697f, -0.775292516f, -0.675350785f, -0.539360881f, -0.369896173f, -0.182019562f,
  -1.3141107e-07f, 0.154251099f, 0.270820498f, 0.351732939f, 0.404902279f, 0.438816845f, 0.460190177f, 0.473634839f,
  0.482096314f, 0.48738116f, 0.490566224f, 0.492268622f, 0.492803663f, 0.492268533f, 0.490566254f, 0.487381071f,
  0.482096314f, 0.473634779f, 0.460190028f, 0.438816786f, 0.404902309f, 0.35173291f, 0.270820469f, 0.15425092f,
  -2.39444489e-07f, -0.18201974f, -0.369896293f, -0.539360881f, -0.675350904f, -0.775292516f, -0.844597816f, -0.891018033f,
  -0.921442568f, -0.940943539f, -0.952888072f, -0.959331989f, -0.961366415f, -0.959331989f, -0.952888012f, -0.940943599f,
  -0.921442509f, -0.891017973f, -0.844597697f, -0.775292456f, -0.675350785f, -0.539360821f, -0.369896263f, -0.182019651f,
  -1.202352e-07f, 0.154251054f, 0.270820558f, 0.351732939f, 0.404902339f, 0.438816845f, 0.460190266f, 0.473634869f,
  0.482096344f, 0.48738116f, 0.490566254f, 0.492268622f, 0.492803752f, 0.492268562f, 0.490566254f, 0.487381101f,
  0.482096285f, 0.47363469f, 0.460190088f, 0.438816786f, 0.40490222f, 0.35173288f, 0.270820439f, 0.15425086f,
  -2.5434565e-07f, -0.18201983f, -0.369896352f, -0.539360881f, -0.675350904f, -0.775292516f, -0.844597816f, -0.891017973f,
  -0.921442509f, -0.94094342f, -0.952888012f, -0.95933181f, -0.961366475f, -0.95933193f, -0.952888072f, -0.94094348f,
  -0.921442509f, -0.891017795f, -0.844597697f, -0.775292337f, -0.675350845f, -0.539360762f, -0.369896054f, -0.182019681f,
  -2.13367457e-07f, 0.154251039f, 0.270820558f, 0.35173291f, 0.40490222f, 0.438816816f, 0.460190147f, 0.47363475f,
  0.482096285f, 0.487381071f, 0.490566224f, 0.492268473f, 0.492803633f, 0.492268473f, 0.490566254f, 0.487381071f,
  0.482096255f, 0.473634779f, 0.460190088f, 0.438816786f, 0.40490225f, 0.35173285f, 0.270820439f, 0.154250816f,
  -2.99049134e-07f, -0.182019845f, -0.369896352f, -0.539360881f, -0.675350785f, -0.775292516f, -0.844597816f, -0.891017973f,
  -0.921442509f, -0.94094348f, -0.952888131f, -0.95933187f, -0.961366415f, -0.95933193f, -0.952888012f, -0.94094348f,
  -0.921442509f, -0.891017914f, -0.844597757f, -0.775292397f, -0.675350785f, -0.539360821f, -0.369896233f, -0.182019651f,
  -1.8915307e-07f, 0.154251054f, 0.270820618f, 0.351732969f, 0.404902279f, 0.438816875f, 0.460190177f, 0.473634839f,
  0.482096314f, 0.487381041f, 0.490566194f, 0.492268503f, 0.492803633f, 0.492268533f, 0.490566254f, 0.487381041f,
  0.482096374f, 0.473634839f, 0.460190058f, 0.438816845f, 0.404902339f, 0.351732939f, 0.270820498f, 0.15425086f,
  -1.63076038e-07f, -0.182019815f, -0.369896322f, -0.53936094f, -0.675350845f, -0.775292635f, -0.844597816f, -0.891018033f,
  -0.921442568f, -0.94094348f, -0.952888131f, -0.95933187f, -0.961366415f, -0.959331989f, -0.952888012f, -0.940943599f,
  -0.921442568f, -0.891017973f, -0.844597757f, -0.775292397f, -0.675350845f, -0.539360762f, -0.369896203f, -0.182019725f,
  -1.83565135e-07f, 0.154251114f, 0.270820528f, 0.351732969f, 0.404902309f, 0.438816875f, 0.460190237f, 0.473634809f,
  0.482096255f, 0.487381041f, 0.490566194f, 0.492268503f, 0.492803603f, 0.492268503f, 0.490566164f, 0.487381011f,
  0.482096314f, 0.47363472f, 0.460189998f, 0.438816726f, 0.404902339f, 0.35173285f, 0.270820439f, 0.154250905f,
  -2.5434565e-07f, -0.182019815f, -0.369896293f, -0.539361f, -0.675350845f, -0.775292635f, -0.844597816f, -0.891017973f,
  -0.921442509f, -0.94094336f, -0.952888012f, -0.95933181f, -0.961366534f, -0.95933187f, -0.952887893f, -0.94094348f,
  -0.921442509f, -0.891017795f, -0.844597697f, -0.775292337f, -0.675350785f, -0.539360642f, -0.369896114f, -0.182019591f,
  -1.03471393e-07f, 0.154251128f, 0.270820558f, 0.35173291f, 0.404902279f, 0.438816875f, 0.460190088f, 0.473634779f,
  0.482096255f, 0.487381041f, 0.490566105f, 0.492268503f, 0.492803574f, 0.492268384f, 0.490566194f, 0.487381011f,
  0.482096255f, 0.47363472f, 0.460189998f, 0.438816696f, 0.404902279f, 0.35173285f, 0.270820498f, 0.15425089f,
  -2.05916876e-07f, -0.1820198f, -0.369896263f, -0.539361f, -0.675350845f, -0.775292635f, -0.844597816f, -0.891017914f,
  -0.921442509f, -0.94094336f, -0.952888012f, -0.95933187f, -0.961366475f, -0.95933187f, -0.952888012f, -0.940943599f,
  -0.921442509f, -0.891017854f, -0.844597638f, -0.775292277f, -0.675350785f, -0.539360642f, -0.369896173f, -0.182019591f,
  -4.94546839e-08f, 0.154251114f, 0.270820558f, 0.351732969f, 0.404902279f, 0.438816905f, 0.460190117f, 0.473634839f,
  0.482096314f, 0.487381101f, 0.490566164f, 0.492268503f, 0.492803633f, 0.492268503f, 0.490566164f, 0.487381071f,
  0.482096255f, 0.47363466f, 0.460189968f, 0.438816726f, 0.404902279f, 0.35173285f, 0.270820439f, 0.15425083f,
  -3.62379069e-07f, -0.182019785f, -0.369896412f, -0.539361119f, -0.675351024f, -0.775292635f, -0.844597816f, -0.891018033f,
  -0.921442568f, -0.94094342f, -0.952887952f, -0.95933181f, -0.961366296f, -0.95933193f, -0.952888012f, -0.94094348f,
  -0.921442449f, -0.891017914f, -0.844597697f, -0.775292337f, -0.675350726f, -0.539360762f, -0.369896203f, -0.182019576f,
  3.99522833e-08f, 0.154251069f, 0.270820558f, 0.351732939f, 0.404902339f, 0.438816875f, 0.460190177f, 0.473634779f,
  0.482096255f, 0.487381011f, 0.490566134f, 0.492268503f, 0.492803633f, 0.492268503f, 0.490566194f, 0.487381041f,
  0.482096285f, 0.47363469f, 0.460189998f, 0.438816726f, 0.404902279f, 0.35173285f, 0.270820498f, 0.15425086f,
  -2.95323844e-07f, -0.182019681f, -0.369896322f, -0.53936094f, -0.675350845f, -0.775292516f, -0.844597757f, -0.891017973f,
  -0.921442509f, -0.94094342f, -0.952888012f, -0.95933193f, -0.961366415f, -0.95933193f, -0.952888012f, -0.94094348f,
  -0.921442509f, -0.891017854f, -0.844597697f, -0.775292516f, -0.675350785f, -0.539360881f, -0.369896173f, -0.182019562f,
  -1.3141107e-07f, 0.154251099f, 0.270820498f, 0.351732939f, 0.404902279f, 0.438816845f, 0.460190177f, 0.473634839f,
  0.482096314f, 0.48738116f, 0.490566224f, 0.492268622f, 0.492803663f, 0.492268533f, 0.490566254f, 0.487381071f,
  0.482096314f, 0.473634779f, 0.460190028f, 0.438816786f, 0.404902309f, 0.35173291f, 0.270820469f, 0.15425092f,
  -2.39444489e-07f, -0.18201974f, -0.369896293f, -0.539360881f, -0.675350904f, -0.775292516f, -0.844597816f, -0.891018033f,
  -0.921442568f, -0.940943539f, -0.952888072f, -0.959331989f, -0.961366415f, -0.959331989f, -0.952888012f, -0.940943599f,
  -0.921442509f, -0.891017973f, -0.844597697f, -0.775292456f, -0.675350785f, -0.539360821f, -0.369896263f, -0.182019651f,
  -1.202352e-07f, 0.154251054f, 0.270820558f, 0.351732939f, 0.404902339f, 0.438816845f, 0.460190266f, 0.473634869f,
  0.482096344f, 0.48738116f, 0.490566254f, 0.492268622f, 0.492803752f, 0.492268562f, 0.490566254f, 0.487381101f,
  0.482096285f, 0.47363469f, 0.460190088f, 0.438816786f, 0.40490222f, 0.35173288f, 0.270820439f, 0.15425086f,
  -2.5434565e-07f, -0.18201983f, -0.369896352f, -0.539360881f, -0.675350904f, -0.775292516f, -0.844597816f, -0.891017973f,
  -0.921442509f, -0.94094342f, -0.952888012f, -0.95933181f, -0.961366475f, -0.95933193f, -0.952888072f, -0.94094348f,
  -0.921442509f, -0.891017795f, -0.844597697f, -0.775292337f, -0.675350845f, -0.539360762f, -0.369896054f, -0.182019681f,
  -2.13367457e-07f, 0.154251039f, 0.270820558f, 0.35173291f, 0.40490222f, 0.438816816f, 0.460190147f, 0.47363475f,
  0.482096285f, 0.487381071f, 0.490566224f, 0.492268473f, 0.492803633f, 0.492268473f, 0.490566254f, 0.487381071f,
  0.482096255f, 0.473634779f, 0.460190088f, 0.438816786f, 0.40490225f, 0.35173285f, 0.270820439f, 0.154250816f,
  -2.99049134e-07f, -0.182019845f, -0.369896352f, -0.539360881f, -0.675350785f, -0.775292516f, -0.844597816f, -0.891017973f,
  -0.921442509f, -0.94094348f, -0.952888131f, -0.95933187f, -0.961366415f, -0.95933193f, -0.952888012f, -0.94094348f,
  -0.921442509f, -0.891017914f, -0.844597757f, -0.775292397f, -0.675350785f, -0.539360821f, -0.369896233f, -0.182019651f,
  -1.8915307e-07f, 0.154251054f, 0.270820618f, 0.351732969f, 0.404902279f, 0.438816875f, 0.460190177f, 0.473634839f,
  0.482096314f, 0.487381041f, 0.490566194f, 0.492268503f, 0.492803633f, 0.492268533f, 0.490566254f, 0.487381041f,
  0.482096374f, 0.473634839f, 0.460190058f, 0.438816845f, 0.404902339f, 0.351732939f, 0.270820498f, 0.15425086f,
  -1.63076038e-07f, -0.182019815f, -0.369896322f, -0.53936094f, -0.675350845f, -0.775292635f, -0.844597816f, -0.891018033f,
  -0.921442568f, -0.94094348f, -0.952888131f, -0.95933187f, -0.961366415f, -0.959331989f, -0.952888012f, -0.940943599f,
  -0.921442568f, -0.891017973f, -0.844597757f, -0.775292397f, -0.675350845f, -0.539360762f, -0.369896203f, -0.182019725f,
  -1.83565135e-07f, 0.154251114f, 0.270820528f, 0.351732969f, 0.404902309f, 0.438816875f, 0.460190237f, 0.473634809f,
  0.482096255f, 0.487381041f, 0.490566194f, 0.492268503f, 0.492803603f, 0.492268503f, 0.490566164f, 0.487381011f,
  0.482096314f, 0.47363472f, 0.460189998f, 0.438816726f, 0.404902339f, 0.35173285f, 0.270820439f, 0.154250905f,
  -2.5434565e-07f, -0.182019815f, -0.369896293f, -0.539361f, -0.675350845f, -0.775292635f, -0.844597816f, -0.891017973f,
  -0.921442509f, -0.94094336f, -0.952888012f, -0.95933181f, -0.961366534f, -0.95933187f, -0.952887893f, -0.94094348f,
  -0.921442509f, -0.891017795f, -0.844597697f, -0.775292337f, -0.675350785f, -0.539360642f, -0.369896114f, -0.182019591f,
  -1.03471393e-07f, 0.154251128f, 0.270820558f, 0.35173291f, 0.404902279f, 0.438816875f, 0.460190088f, 0.473634779f,
  0.482096255f, 0.487381041f, 0.490566105f, 0.492268503f, 0.492803574f, 0.492268384f, 0.490566194f, 0.487381011f,
  0.482096255f, 0.47363472f, 0.460189998f, 0.438816696f, 0.404902279f, 0.35173285f, 0.270820498f, 0.15425089f,
  -2.05916876e-07f, -0.1820198f, -0.369896263f, -0.539361f, -0.675350845f, -0.775292635f, -0.844597816f, -0.891017914f,
  -0.921442509f, -0.94094336f, -0.952888012f, -0.95933187f, -0.961366475f, -0.95933187f, -0.952888012f, -0.940943599f,
  -0.921442509f, -0.891017854f, -0.844597638f, -0.775292277f, -0.675350785f, -0.539360642f, -0.369896173f, -0.182019591f,
  -4.94546839e-08f, 0.154251114f, 0.270820558f, 0.351732969f, 0.404902279f, 0.438816905f, 0.460190117f, 0.473634839f,
  0.482096314f, 0.487381101f, 0.490566164f, 0.492268503f, 0.492803633f, 0.492268503f, 0.490566164f, 0.487381071f,
  0.482096255f, 0.47363466f, 0.460189968f, 0.438816726f, 0.404902279f, 0.35173285f, 0.270820439f, 0.15425083f,
  -3.62379069e-07f, -0.182019785f, -0.369896412f, -0.539361119f, -0.675351024f, -0.775292635f, -0.844597816f, -0.891018033f,
  -0.921442568f, -0.94094342f, -0.952887952f, -0.95933181f, -0.961366296f, -0.95933193f, -0.952888012f, -0.94094348f,
  -0.921442449f, -0.891017914f, -0.844597697f, -0.775292337f, -0.675350726f, -0.539360762f, -0.369896203f, -0.182019576f,
  3.99522833e-08f, 0.154251069f, 0.270820558f, 0.351732939f, 0.404902339f, 0.438816875f, 0.460190177f, 0.473634779f,
  0.482096255f, 0.487381011f, 0.490566134f, 0.492268503f, 0.492803633f, 0.492268503f, 0.490566194f, 0.487381041f,
  0.482096285f, 0.47363469f, 0.460189998f, 0.438816726f, 0.404902279f, 0.35173285f, 0.270820498f, 0.15425086f,
  -2.95323844e-07f, -0.182019681f, -0.369896322f, -0.53936094f, -0.675350845f, -0.775292516f, -0.844597757f, -0.891017973f,
  -0.921442509f, -0.94094342f, -0.952888012f, -0.95933193f, -0.961366415f, -0.95933193f, -0.952888012f, -0.94094348f,
  -0.921442509f, -0.891017854f, -0.844597697f, -0.775292516f, -0.675350785f, -0.539360881f, -0.369896173f, -0.182019562f,
  -1.3141107e-07f, 0.154251099f, 0.270820498f, 0.351732939f, 0.404902279f, 0.438816845f, 0.460190177f, 0.473634839f,
  0.482096314f, 0.48738116f, 0.490566224f, 0.492268622f, 0.492803663f, 0.492268533f, 0.490566254f, 0.487381071f,
  0.482096314f, 0.473634779f, 0.460190028f, 0.438816786f, 0.404902309f, 0.35173291f, 0.270820469f, 0.15425092f,
  -2.39444489e-07f, -0.18201974f, -0.369896293f, -0.539360881f, -0.675350904f, -0.775292516f, -0.844597816f, -0.891018033f,
  -0.921442568f, -0.940943539f, -0.952888072f, -0.959331989f, -0.961366415f, -0.959331989f, -0.952888012f, -0.940943599f,
  -0.921442509f, -0.891017973f, -0.844597697f, -0.775292456f, -0.675350785f, -0.539360821f, -0.369896263f, -0.182019651f,
  -1.202352e-07f, 0.154251054f, 0.270820558f, 0.351732939f, 0.404902339f, 0.438816845f, 0.460190266f, 0.473634869f,
  0.482096344f, 0.48738116f, 0.490566254f, 0.492268622f, 0.492803752f, 0.492268562f, 0.490566254f, 0.487381101f,
  0.482096285f, 0.47363469f, 0.460190088f, 0.438816786f, 0.40490222f, 0.35173288f, 0.270820439f, 0.15425086f,
  -2.5434565e-07f, -0.18201983f, -0.369896352f, -0.539360881f, -0.675350904f, -0.775292516f, -0.844597816f, -0.891017973f,
  -0.921442509f, -0.94094342f, -0.952888012f, -0.95933181f, -0.961366475f, -0.95933193f, -0.952888072f, -0.94094348f,
  -0.921442509f, -0.891017795f, -0.844597697f, -0.775292337f, -0.675350845f, -0.539360762f, -0.369896054f, -0.182019681f,
  -2.13367457e-07f, 0.154251039f, 0.270820558f, 0.35173291f, 0.40490222f, 0.438816816f, 0.460190147f, 0.47363475f,
  0.482096285f, 0.487381071f, 0.490566224f, 0.492268473f, 0.492803633f, 0.492268473f, 0.490566254f, 0.487381071f,
  0.482096255f, 0.473634779f, 0.460190088f, 0.438816786f, 0.40490225f, 0.35173285f, 0.270820439f, 0.154250816f,
  -2.99049134e-07f, -0.182019845f, -0.369896352f, -0.539360881f, -0.675350785f, -0.775292516f, -0.844597816f, -0.891017973f,
  -0.921442509f, -0.94094348f, -0.952888131f, -0.95933187f, -0.961366415f, -0.95933193f, -0.952888012f, -0.94094348f,
  -0.921442509f, -0.891017914f, -0.844597757f, -0.775292397f, -0.675350785f, -0.539360821f, -0.369896233f, -0.182019651f,
  -1.8915307e-07f, 0.154251054f, 0.270820618f, 0.351732969f, 0.404902279f, 0.438816875f, 0.460190177f, 0.473634839f,
  0.482096314f, 0.487381041f, 0.490566194f, 0.492268503f, 0.492803633f, 0.492268533f, 0.490566254f, 0.487381041f,
  0.482096374f, 0.473634839f, 0.460190058f, 0.438816845f, 0.404902339f, 0.351732939f, 0.270820498f, 0.15425086f,
  -1.63076038e-07f, -0.182019815f, -0.369896322f, -0.53936094f, -0.675350845f, -0.775292635f, -0.844597816f, -0.891018033f,
  -0.921442568f, -0.94094348f, -0.952888131f, -0.95933187f, -0.961366415f, -0.959331989f, -0.952888012f, -0.940943599f,
  -0.921442568f, -0.891017973f, -0.844597757f, -0.775292397f, -0.675350845f, -0.539360762f, -0.369896203f, -0.182019725f,
  -1.83565135e-07f, 0.154251114f, 0.270820528f, 0.351732969f, 0.404902309f, 0.438816875f, 0.460190237f, 0.473634809f,
  0.482096255f, 0.487381041f, 0.490566194f, 0.492268503f, 0.492803603f, 0.492268503f, 0.490566164f, 0.487381011f,
  0.482096314f, 0.47363472f, 0.460189998f, 0.438816726f, 0.404902339f, 0.35173285f, 0.270820439f, 0.154250905f,
  -2.5434565e-07f, -0.182019815f, -0.369896293f, -0.539361f, -0.675350845f, -0.775292635f, -0.844597816f, -0.891017973f,
  -0.921442509f, -0.94094336f, -0.952888012f, -0.95933181f, -0.961366534f, -0.95933187f, -0.952887893f, -0.94094348f,
  -0.921442509f, -0.891017795f, -0.844597697f, -0.775292337f, -0.675350785f, -0.539360642f, -0.369896114f, -0.182019591f,
  -1.03471393e-07f, 0.154251128f, 0.270820558f, 0.35173291f, 0.404902279f, 0.438816875f, 0.460190088f, 0.473634779f,
  0.482096255f, 0.487381041f, 0.490566105f, 0.492268503f, 0.492803574f, 0.492268384f, 0.490566194f, 0.487381011f,
  0.482096255f, 0.47363472f, 0.460189998f, 0.438816696f, 0.404902279f, 0.35173285f, 0.270820498f, 0.15425089f,
  -2.05916876e-07f, -0.1820198f, -0.369896263f, -0.539361f, -0.675350845f, -0.775292635f, -0.844597816f, -0.891017914f,
  -0.921442509f, -0.94094336f, -0.952888012f, -0.95933187f, -0.961366475f, -0.95933187f, -0.952888012f, -0.940943599f,
  -0.921442509f, -0.891017854f, -0.844597638f, -0.775292277f, -0.675350785f, -0.539360642f, -0.369896173f, -0.182019591f,
  -4.94546839e-08f, 0.154251114f, 0.270820558f, 0.351732969f, 0.404902279f, 0.438816905f, 0.460190117f, 0.473634839f,
  0.482096314f, 0.487381101f, 0.490566164f, 0.492268503f, 0.492803633f, 0.492268503f, 0.490566164f, 0.487381071f,
  0.482096255f, 0.47363466f, 0.460189968f, 0.438816726f, 0.404902279f, 0.35173285f, 0.270820439f, 0.15425083f,
  -3.62379069e-07f, -0.182019785f, -0.369896412f, -0.539361119f, -0.675351024f, -0.775292635f, -0.844597816f, -0.891018033f,
  -0.921442568f, -0.94094342f, -0.952887952f, -0.95933181f, -0.961366296f, -0.95933193f, -0.952888012f, -0.94094348f,
  -0.921442449f, -0.891017914f, -0.844597697f, -0.775292337f, -0.675350726f, -0.539360762f, -0.369896203f, -0.182019576f,
  3.99522833e-08f, 0.154251069f, 0.270820558f, 0.351732939f, 0.404902339f, 0.438816875f, 0.460190177f, 0.473634779f,
  0.482096255f, 0.487381011f, 0.490566134f, 0.492268503f, 0.492803633f, 0.492268503f, 0.490566194f, 0.487381041f,
  0.482096285f, 0.47363469f, 0.460189998f, 0.438816726f, 0.404902279f, 0.35173285f, 0.270820498f, 0.15425086f,
  -2.95323844e-07f, -0.182019681f, -0.369896322f, -0.53936094f, -0.675350845f, -0.775292516f, -0.844597757f, -0.891017973f,
  -0.921442509f, -0.94094342f, -0.952888012f, -0.95933193f, -0.961366415f, -0.95933193f, -0.952888012f, -0.94094348f,
  -0.921442509f, -0.891017854f, -0.844597697f, -0.775292516f, -0.675350785f, -0.539360881f, -0.369896173f, -0.182019562f,
  -1.3141107e-07f, 0.154251099f, 0.270820498f, 0.351732939f, 0.404902279f, 0.438816845f, 0.460190177f, 0.473634839f,
  0.482096314f, 0.48738116f, 0.490566224f, 0.492268622f, 0.492803663f, 0.492268533f, 0.490566254f, 0.487381071f,
  0.482096314f, 0.473634779f, 0.460190028f, 0.438816786f, 0.404902309f, 0.35173291f, 0.270820469f, 0.15425092f,
  -2.39444489e-07f, -0.18201974f, -0.369896293f, -0.539360881f, -0.675350904f, -0.775292516f, -0.844597816f, -0.891018033f,
  -0.921442568f, -0.940943539f, -0.952888072f, -0.959331989f, -0.961366415f, -0.959331989f, -0.952888012f, -0.940943599f,
  -0.921442509f, -0.891017973f, -0.844597697f, -0.775292456f, -0.675350785f, -0.539360821f, -0.369896263f, -0.182019651f,
  -1.202352e-07f, 0.154251054f, 0.270820558f, 0.351732939f, 0.404902339f, 0.438816845f, 0.460190266f, 0.473634869f,
  0.482096344f, 0.48738116f, 0.490566254f, 0.492268622f, 0.492803752f, 0.492268562f, 0.490566254f, 0.487381101f,
  0.482096285f, 0.47363469f, 0.460190088f, 0.438816786f, 0.40490222f, 0.35173288f, 0.270820439f, 0.15425086f,
  -2.5434565e-07f, -0.18201983f, -0.369896352f, -0.539360881f, -0.675350904f, -0.775292516f, -0.844597816f, -0.891017973f,
  -0.921442509f, -0.94094342f, -0.952888012f, -0.95933181f, -0.961366475f, -0.95933193f, -0.952888072f, -0.94094348f,
  -0.921442509f, -0.891017795f, -0.844597697f, -0.775292337f, -0.675350845f, -0.539360762f, -0.369896054f, -0.182019681f,
  -2.13367457e-07f, 0.154251039f, 0.270820558f, 0.35173291f, 0.40490222f, 0.438816816f, 0.460190147f, 0.47363475f,
  0.482096285f, 0.487381071f, 0.490566224f, 0.492268473f, 0.492803633f, 0.492268473f, 0.490566254f, 0.487381071f,
  0.482096255f, 0.473634779f, 0.460190088f, 0.438816786f, 0.40490225f, 0.35173285f, 0.270820439f, 0.154250816f,
  -2.99049134e-07f, -0.182019845f, -0.369896352f, -0.539360881f, -0.675350785f, -0.775292516f, -0.844597816f, -0.891017973f,
  -0.921442509f, -0.94094348f, -0.952888131f, -0.95933187f, -0.961366415f, -0.95933193f, -0.952888012f, -0.94094348f,
  -0.921442509f, -0.891017914f, -0.844597757f, -0.775292397f, -0.675350785f, -0.539360821f, -0.369896233f, -0.182019651f,
  -1.8915307e-07f, 0.154251069f, 0.270820618f, 0.351732969f, 0.404902279f, 0.438816875f, 0.460190177f, 0.473634839f,
  0.482096314f, 0.487381041f, 0.490566194f, 0.492268503f, 0.492803633f, 0.492268533f, 0.490566254f, 0.487381071f,
  0.482096374f, 0.473634839f, 0.460190058f, 0.438816845f, 0.404902339f, 0.351732939f, 0.270820498f, 0.15425086f,
  -1.63076038e-07f, -0.182019815f, -0.369896322f, -0.53936094f, -0.675350845f, -0.775292635f, -0.844597816f, -0.891018033f,
  -0.921442568f, -0.94094348f, -0.952888131f, -0.95933187f, -0.961366415f, -0.959331989f, -0.952888012f, -0.940943599f,
  -0.921442568f, -0.891017973f, -0.844597697f, -0.775292397f, -0.675350845f, -0.539360762f, -0.369896203f, -0.182019711f,
};

// oversample 4× (Shaper<4096>, каскад двух 2×) против WaveShaperNode Chromium: drive Tenebrae asym(2.4, 0.35), синус 1 кГц · 0.8, 48 кГц
static void shaperOs4() {
  static sdk::Shaper<4096> sh;
  const double bias = std::tanh(0.35);
  double peak = 0;
  for (int i = 0; i < 4096; i++) peak = std::fmax(peak, std::fabs(std::tanh(2.4 * (i / 4095.0 * 2 - 1) + 0.35) - bias));
  sh.build([&](double x) { return (std::tanh(2.4 * x + 0.35) - bias) / peak; });
  sh.os = 4;
  double worst = 0;
  for (int i = 0; i < 4800; i++) {
    const double x = static_cast<float>(0.8 * std::sin(2 * M_PI * 1000 * i / 48000.0));
    const double y = sh.run(x);
    if (i >= 200) worst = std::fmax(worst, std::fabs(y - kShaperOs4Ref[i]));
  }
  CHECK(worst <= 1e-6);                                 // измерено 2.8e-7 (Chromium считает во float)
  sh.os = 1; sh.reset();                                // без os run() — та же кривая без задержки
  NEAR(sh.run(0.3), sh.step(0.3), 1e-15);
}

// TanhShaper2, os 2 ступенью Chromium (голос Tenebrae): пачкой stepN — до бита как по одному step; пара L/R — как моно OsChromium
// с той же кривой; задержка 128 (как '2x' WaveShaperNode: 64 апсэмпл + 64 даунсэмпл)
static void shaperChromium2() {
  sdk::TanhShaper2 a[6], b[6];
  sdk::TanhShaper2* pa[6];
  for (int v = 0; v < 6; v++) {
    for (sdk::TanhShaper2* t : {&a[v], &b[v]}) { t->set(1 + v); t->os = 2; t->chromium = true; t->reset(); }
    pa[v] = &a[v];
  }
  sdk::TanhShaper mono; mono.set(1);
  sdk::OsChromium oc;
  bool same = true, pair = true;
  for (int i = 0; i < 2000; i++) {
    double io[12], ref[12];
    for (int v = 0; v < 6; v++) {
      io[2 * v] = ref[2 * v] = 0.7 * std::sin(2 * M_PI * (300 + 50 * v) * i / 48000.0);
      io[2 * v + 1] = ref[2 * v + 1] = 0.5 * std::sin(2 * M_PI * (410 + 30 * v) * i / 48000.0);
    }
    const double m = oc.step(io[0], [&](double u) { return mono.shape(u); });
    sdk::TanhShaper2::stepN(pa, io, 6);
    for (int v = 0; v < 6; v++) b[v].step(ref[2 * v], ref[2 * v + 1]);
    for (int k = 0; k < 12; k++) same = same && io[k] == ref[k];
    pair = pair && io[0] == m;
  }
  CHECK(same);
  CHECK(pair);
  sdk::TanhShaper2 d; d.set(0.01); d.os = 2; d.chromium = true; d.reset();   // почти линейная кривая: импульс → пик на задержке ступени
  int at = -1; double pk = 0;
  for (int i = 0; i < 400; i++) { double l = i == 0 ? 0.5 : 0, r = 0; d.step(l, r); if (std::fabs(l) > pk) { pk = std::fabs(l); at = i; } }
  CHECK(at == 128);
}

static void bpbank() {
  const double sr = 48000;
  sdk::BpBank<3> b;
  b.target(0, 440, 20, 1); b.target(1, 880, 20, 0.5); b.target(2, 1320, 20, 0.25);
  b.snap(); b.update(sr);
  std::vector<float> in(9600), out(9600);
  for (int i = 0; i < 9600; i++) { in[i] = std::sin(2 * M_PI * 880 * i / sr); out[i] = b.step(in[i]); }
  const std::vector<float> t(out.end() - 4800, out.end());
  NEAR(goertzel(t, 880, sr), 0.5, 0.02);                // полоса 880 Гц, вес 0.5: пик BP — 0 дБ
  sdk::BpBank<3> c; c.target(0, 440, 20, 1); c.target(1, 880, 20, 0); c.target(2, 1320, 20, 0); c.snap(); c.update(sr);
  std::vector<float> o2(9600);
  for (int i = 0; i < 9600; i++) o2[i] = c.step(in[i]);
  const std::vector<float> t2(o2.end() - 4800, o2.end());
  CHECK(goertzel(t2, 880, sr) < 0.15);                  // мимо полосы — сильно тише
  c.target(0, 1000, 20, 1);                             // glide тянет частоту к цели, snap — сразу
  c.glide(0.5, 0.5, 0.5); NEAR(c.b[0].hz, 720, 1e-9);
}

static void noise() {
  const double sr = 48000;
  for (int col = 0; col < sdk::Noise::NCOLORS; col++) {
    sdk::Rng r(7), r2(7);
    sdk::Noise n, m; n.set(col); m.set(col);
    double sum = 0, sq = 0, pk = 0; int quiet = 0;
    for (int i = 0; i < 96000; i++) {
      const double x = n.next(r, sr);
      CHECK(std::isfinite(x) && x == m.next(r2, sr));   // конечный и повторяется от одного зерна
      sum += x; sq += x * x; if (std::fabs(x) > pk) pk = std::fabs(x); if (std::fabs(x) < 1e-3) quiet++;
    }
    const double rms = std::sqrt(sq / 96000);
    CHECK(rms > 0.01 && pk < 2.5);
    if (col == sdk::Noise::white) { NEAR(rms, 0.5 / std::sqrt(3.0), 0.005); NEAR(sum / 96000, 0, 0.005); }
    if (col == sdk::Noise::crackle) CHECK(quiet > 20000 && quiet < 96000);   // редкие импульсы, между ними — тишина
    if (col == sdk::Noise::grain) CHECK(quiet > 30000);   // всплески, между ними — почти тихо
  }
}

static void infernoModel() {
  using namespace inferno;
  static Scale sc;
  static Model m(sc);
  sc.on = false; m.reset(3);
  NEAR(m.semiOf(8, 0), 0, 1e-12); NEAR(m.semiOf(0, 1), 60, 1e-9); NEAR(m.semiOf(4, 0.5), 4 * SPAN + 0.5 * SPAN, 1e-9);
  m.setPos(8, 0); NEAR(m.hzOf(8), 55, 1e-9);
  double r[3];
  m.ratios(3, r); NEAR(r[1], 2, 1e-12); NEAR(r[2], 3, 1e-12);
  m.setFx(STRUCTURE, 0.9); m.ratios(3, r); NEAR(r[1], 2.76, 1e-12); NEAR(r[2], 5.4, 1e-12);
  m.setFx(STRUCTURE, 0.5); m.ratios(3, r); NEAR(r[1], std::pow(2.0, 3 / 12.0), 1e-12);    // без лада — терция и квинта
  sc.on = true; sc.idx = 0; sc.root = 0;                // мажор от A: нота A (0), вверх по ладу — 2, 4, 5, 7
  m.setPos(8, 0); m.ratios(8, r);
  NEAR(12 * std::log2(r[1]), 4, 1e-9); NEAR(12 * std::log2(r[2]), 7, 1e-9);
  for (int k = 0; k < NC; k++) for (double p : {0.0, 0.13, 0.5, 0.77, 1.0}) CHECK(sc.inScale(static_cast<int>(m.semiOf(k, p))));
  sc.on = false;
  // иней: τ 6 с вверх, 3 с вниз; сдвиг > 0.02 — событие
  int ices = 0;
  m.listen([](void* c, const Ev& e) { if (e.t == Ev::ICE) ++*static_cast<int*>(c); }, &ices);
  m.reset(3); m.setFx(ICE, 1);
  for (int i = 0; i < 360; i++) m.tick(1.0 / 60);
  NEAR(m.iceE(), 1 - std::exp(-1.0), 0.01);
  CHECK(ices > 10 && ices < 40);
  const double top = m.iceE();
  m.setFx(ICE, 0);
  for (int i = 0; i < 180; i++) m.tick(1.0 / 60);
  NEAR(m.iceE(), top * std::exp(-1.0), 0.01);
  NEAR(m.Qof(m.circ(0)), (4 + 0.5 * 60) * (1 + m.iceE() * 8), 1e-9);
  // грешники: не больше четырёх; ещё раз — отпустить
  m.listen(nullptr, nullptr);
  m.reset(3);
  for (int k = 0; k < 6; k++) m.pin(k, 0.25);
  int n = 0; for (int k = 0; k < NC; k++) n += m.circ(k).sinner;
  CHECK(n == PIN_MAX && !m.circ(5).sinner && m.circ(5).pos == 0.5 && m.circ(0).pos == 0.25);
  CHECK(m.sounding() && m.burning(2));
  CHECK(!m.pin(2, 0.9) && m.circ(2).pos == 0.25);
  m.clear(); CHECK(!m.sounding());
  m.hold(3, 1); CHECK(m.burning(3)); m.hold(3, -1); CHECK(!m.sounding());
  // удар: lvl 1, спад τ 0.4
  m.strike(4, 0.8); NEAR(m.circ(4).lvl, 1, 1e-12);
  for (int i = 0; i < 24; i++) m.tick(1.0 / 60);
  NEAR(m.circ(4).lvl, std::exp(-1.0), 0.01);
  // буря: размах ≤ storm·7.8, затухает при storm = 0
  m.reset(3); m.pin(1, 0.5);
  double mx = 0;
  for (int i = 0; i < 600; i++) { m.tick(1.0 / 60); mx = std::fmax(mx, std::fabs(m.stormSemi())); }
  CHECK(mx > 1 && mx <= 0.6 * 7.8 + 1e-9);
  m.setFx(STORM, 0);
  for (int i = 0; i < 60; i++) m.tick(1.0 / 60);
  CHECK(std::fabs(m.stormSemi()) < 0.01);
  // снимок → restore → тот же снимок; кубик с зерном повторяется, 2–3 грешника
  Model a(sc), b(sc);
  a.reset(11); a.dice(); a.setCirc(3, WIDTH, 0.2); a.setFx(SMOKE, 0.8);
  const std::string js = a.snapshot();
  b.reset(1); b.restore(js);
  CHECK(b.snapshot() == js);
  Model c(sc), d(sc);
  c.reset(42); d.reset(42); c.dice(); d.dice();
  CHECK(c.snapshot() == d.snapshot());
  for (uint32_t sd = 1; sd < 30; sd++) {
    Model q(sc); q.reset(sd); q.pin(0, 0.1); q.dice();
    int ns = 0; for (int k = 0; k < NC; k++) ns += q.circ(k).sinner;
    const double st = q.fx(STRUCTURE);
    CHECK(ns >= 2 && ns <= 3 && (st == 0.15 || st == 0.5 || st == 0.85));
  }
}

static void infernoSound() {
  using namespace inferno;
  const double sr = 48000;
  static Scale sc;
  static Inferno w(sc);
  w.prepare(sr, 5);
  static float L[128], R[128], sL[128], sR[128];
  const sdk::Out out{L, R, sL, sR};
  const auto run = [&](double secs, std::vector<float>* rec, std::vector<float>* send = nullptr, double* pk = nullptr) {
    for (int b = 0; b < static_cast<int>(secs * sr / 128); b++) {
      w.process(out, 128);
      for (int i = 0; i < 128; i++) {
        CHECK(std::isfinite(L[i]) && std::isfinite(sL[i]) && L[i] == R[i]);
        if (rec) rec->push_back(L[i]);
        if (send) send->push_back(sL[i]);
        if (pk) *pk = std::fmax(*pk, std::fabs(L[i]));
      }
    }
  };
  std::vector<float> z; double pk = 0;
  run(0.2, &z, nullptr, &pk);
  CHECK(pk == 0);                                       // молчит
  // удар по кругу 8 (A, 55 Гц; structure 0 — гармоники 1·2·3): энергия у f0 и 2·f0, мимо — тише
  w.action(ACT_FX, STORM, (const double[]){0}, 1);
  const double f0 = w.model().hzOf(8);
  w.action(ACT_STRIKE, 8, (const double[]){1}, 1);
  std::vector<float> y, s;
  run(1.0, &y, &s);
  double peak = 0; for (float v : y) peak = std::fmax(peak, std::fabs(v));
  CHECK(peak > 1e-3 && peak < 3);
  const std::vector<float> tail(y.begin() + 2400, y.end());
  CHECK(goertzel(tail, f0, sr) > 3 * goertzel(tail, f0 * 1.4, sr));
  CHECK(goertzel(tail, 2 * f0, sr) > 3 * goertzel(tail, f0 * 1.7, sr));
  double sp = 0; for (float v : s) sp = std::fmax(sp, std::fabs(v));
  CHECK(sp > 1e-4);                                     // дым идёт в зал (smoke 0.35 по умолчанию)
  std::vector<double> h(70);
  CHECK(w.heard(h.data(), 70) == 2 && h[0] == 1 && h[1] == 8);
  CHECK(w.heard(h.data(), 70) == 1);                    // очищено
  run(8.0, nullptr);                                    // звон угасает, круг отпускается
  pk = 0; run(0.5, nullptr, nullptr, &pk);
  CHECK(pk < 1e-4);
  // тление: держим круг — шум идёт, пока держат; отпустили — затихает
  w.action(ACT_HOLD, 4, (const double[]){1}, 1);
  CHECK(w.sounding());
  std::vector<float> sm; run(1.5, &sm);
  double rms = 0; for (size_t i = sm.size() / 2; i < sm.size(); i++) rms += sm[i] * sm[i];
  CHECK(std::sqrt(rms / (sm.size() / 2)) > 1e-3);
  w.action(ACT_HOLD, 4, (const double[]){-1}, 1);
  run(6.0, nullptr); pk = 0; run(0.5, nullptr, nullptr, &pk);
  CHECK(pk < 1e-4 && !w.sounding());
  // smoke = 0 — посыл пуст; fire выше — сухого громче не становится бесконечно (перегруз сжимает)
  w.action(ACT_FX, SMOKE, (const double[]){0}, 1);
  w.action(ACT_STRIKE, 5, (const double[]){1}, 1);
  std::vector<float> d2, s2; run(2.0, &d2, &s2);
  double sp2 = 0; for (size_t i = 72000; i < s2.size(); i++) sp2 = std::fmax(sp2, std::fabs(s2[i]));
  CHECK(sp2 < 1e-6);
  // детерминизм: два мира, одно зерно и одни действия — те же сэмплы
  static Inferno w2(sc);
  w.prepare(sr, 9); w2.prepare(sr, 9);
  w.action(ACT_DICE, 0, nullptr, 0); w2.action(ACT_DICE, 0, nullptr, 0);
  w.action(ACT_STRIKE, 2, (const double[]){0.7}, 1); w2.action(ACT_STRIKE, 2, (const double[]){0.7}, 1);
  static float L2[128], R2[128], sL2[128], sR2[128];
  const sdk::Out out2{L2, R2, sL2, sR2};
  bool same = true;
  for (int b = 0; b < 200; b++) { w.process(out, 128); w2.process(out2, 128); for (int i = 0; i < 128; i++) if (L[i] != L2[i] || sL[i] != sL2[i]) same = false; }
  CHECK(same);
  CHECK(w.rev() == sdk::Rev::hall);
  // снимок мира ядра: restore в другом мире повторяет снимок
  const std::string js = w.snapshot();
  w2.restore(js);
  CHECK(w2.snapshot() == js);
  // зеркало: размер и поля
  std::vector<double> m(MIRROR_MAX);
  CHECK(w.mirror(m.data(), MIRROR_MAX) == MIRROR_MAX);
  CHECK(m[4 + FIRE] == w.model().fx(FIRE) && m[MIRROR_HEAD + 2 * CIRC_N + 3] == w.model().circ(2).color);
}

// Tenebrae: формулы звука и таблицы волн сверены с JS (tools/tenebrae-ref-nums.mjs)
static const double REF_LEVEL[] = {0.44281316711356045, 0.34339584540229368, 0.51703902671340940, 0.31600616540941445, 0.36929103567360561, 0.48500624427132627, 0.30357865537616441, 0.33941111313738709, 0.46040448690660135};
static const double REF_VOICE_RE[] = {-0.16754252944997300, -0.0044386131539819601, -0.0070286429397470387, -0.00082619253324567137, -0.0000096297884397152717, -0.0000023095882603365267, -0.21447624632004600, -0.016233358623737745, -0.0082719317587444455, -0.000032453534054673439, -0.0000019492675108667165, -4.6929175695144655e-7, -0.11190665233704740, -0.030186947013608582, -0.014389485343228424, -0.0039552983466326829, -0.0016409717572497405, -0.0015971268660620970, -0.21250907171613337, -0.038935047851490136, -0.012893317273626104, -0.0048335227847541408, -0.0000054016203784958625, -7.2475087778606387e-16, -0.15521841563116792, -0.040540181026463437, -0.039005730598414022, -0.00014932077488002127, -1.4351822313315185e-17, -4.1095078868748658e-16, -0.042619629177348531, -0.040642579483078069, -0.031152407579676033, -0.0011127258221325890, -0.0046092938430379437, -0.0039210144675583727, -0.23960924763990404, -3.8017094769491688e-18, -0.0051738570193986307, -0.0082703732638126585, -1.8663520025313159e-17, -9.5005478047297443e-16, -0.024332284058457092, -1.0459674911200065e-17, -4.4964174694133961e-18, -3.2492640602474691e-17, -0.000052170382206130775, -5.7375520266432461e-16, -0.019751516503592921, -0.014194189090597260, -0.012480245914800623, -0.0089826842163526453, -0.0010000786445681735, -0.00025218483975584269};
static const double REF_VOICE_IM[] = {-0.74121177914873249, -0.037735783972493969, -0.084143678005609637, -0.015488712980393655, -0.000060510349697895615, -0.0000029171251185454941, -0.94884755913567054, -0.13801124200784073, -0.099027759463510182, -0.00060840960665375465, -0.000012248541022026758, -5.9273888581765613e-7, -0.49507745376429219, -0.25664054779649426, -0.17226429508035701, -0.074150368561370875, -0.010311314261696075, -0.0020172508574384288, -0.94014473608024052, -0.33101432896094163, -0.15435285963398293, -0.090614528798928951, -0.000033941964570067766, -9.1539649148093911e-16, -0.68668963268206140, -0.34466069926548965, -0.46695865247134427, -0.0027993313072449525, -9.0182021382646332e-17, -5.1905133428054138e-16, -0.18855016259399576, -0.34553126083593427, -0.37294228415849973, -0.020860380832998203, -0.028963251274794342, -0.0049524367567698787, -1.0600365013391597, -3.2321016175882743e-17, -0.061939034721119265, -0.15504550400702485, -1.1727527872447928e-16, -1.1999665532193681e-15, -0.10764655169603701, -8.8925080690454977e-17, -5.3829040252645923e-17, -6.0914274096588422e-16, -0.00032782112410137062, -7.2468142583318603e-16, -0.087381136816876565, -0.12067482220363954, -0.14940775946197135, -0.16839926775182748, -0.0062841576309860146, -0.00031852202541978098};
static const double REF_LFO_RE[] = {1.0080369698683977e-16, -0.037995929765560869, -1.0869126779167182e-17, -9.3376912105314069e-18, -0.000061271814449674088, -0.0000037207280053147351, 7.6978354246470815e-17, 0.13896267431491691, 3.1767123653825280e-17, -1.1709383462843448e-17, 0.000012402677170562525, 7.5602522438271327e-7, -0.11190665233704732, -0.030186947013608530, -0.014389485343228417, -0.0039552983466326786, -0.0016409717572497403, -0.0015971268660620965, 4.1633363423443370e-17, -0.33329630050251130, 1.8041124150158794e-16, 7.5026790335996907e-17, 0.000034369091660809391, 5.8866756955100463e-16, 2.6020852139652106e-18, 0.34703674718368765, -2.1250362580715887e-17, -4.2067044292437572e-17, 1.8648277366750676e-17, -1.4056681166274565e-16, -0.19287927997338628, -0.34570959677192242, 0.29552498079206518, -0.010547458960645651, 0.00086654451211059646, -0.0050178898526272364, 0.0033341929320050909, -2.2009304101455740e-17, 0.00057205706799501744, 0.0033341929320051299, 7.3400487077268650e-17, 6.8215290187356725e-16, -3.5073940279906068e-17, 6.7437375128598376e-17, -4.6702008579813103e-17, 1.1113072267976420e-18, 7.1204977677985504e-17, 1.7478016646824135e-16, -0.036426045319056639, -0.019027722169915169, -0.14987253571654616, -0.16398819099385703, 0.0063304018809027893, 0.00038969715774743609};
static const double REF_LFO_IM[] = {0.75991144268482003, -4.2798033725918033e-17, -0.084436724059417254, -0.015510732538826327, -6.6898662174144641e-17, -6.6674367849711702e-16, 0.97278556255387383, -1.0663721289458014e-16, 0.099372642107293074, -0.00060927455333471315, -1.0369038527108243e-16, -7.9705122710271858e-16, -0.49507745376429213, -0.25664054779649426, -0.17226429508035701, -0.074150368561370888, -0.010311314261696077, -0.0020172508574384292, 0.96386318030156015, 4.0771083883138493e-17, 0.15489042225879049, -0.090743351117107532, 3.7947076036992655e-19, -1.0083080204115191e-15, 0.70401378408669979, 5.4684447074737630e-17, 0.46858492307944538, 0.0028033109819519675, -8.9392469121429841e-17, -6.4694343632210050e-16, 0.012852235695979633, 0.039096626218941243, -0.22961142292843126, 0.018031770759591392, -0.029314921366888819, -0.0038368953219377823, 1.0867745207187274, -2.3972726473191208e-17, 0.062152116370660752, 0.15523012125295566, -9.3349807051001932e-17, -1.3701062853699320e-15, 0.11036231304004558, -5.8900553569695910e-17, 2.7142323761816800e-17, 6.1000771762412948e-16, 0.00033194643873164239, 9.0763984869624004e-16, -0.081845761637457035, -0.12000763936868424, 0.0040814413425633465, -0.039330334471558391, -0.00064560549305555650, -0.00011484598087773724};
static const double REF_FREQ_OFF[] = {55.000000000000000, 100.70006228228955, 195.55990961719434, 675.21779755467355, 1760.0000000000000};
static const double REF_FREQ_MINOR[] = {55.000000000000000, 97.998858995437303, 195.99771799087463, 659.25511382573995, 1760.0000000000000};
static const double REF_BEAT[] = {0.0000000000000000, 0.050000000000000003, 3.5000000000000000, 24.000000000000000};
static const double REF_CUTOFF[] = {20.000000000000000, 20.000000000000000, 23.784142300054420, 40.000000000000000, 67.271713220297158, 113.13708498984761, 190.27313840043536, 319.99999999999994, 538.17370576237727, 52.566160314511421, 88.405391544249454, 148.67955367732083, 250.04820741756265, 420.52928251609137, 707.24313235399575, 1189.4364294185666, 2000.3856593405010, 3364.2342601287314, 535.70661660383314, 900.94754705971854, 1515.2071253082895, 2548.2644800772528, 4285.6529328306651, 7207.5803764777493, 12121.657002466314, 20000.000000000000, 20000.000000000000, 3784.0338686417153, 6363.9610306789273, 10702.864035024490, 18000.000000000000, 20000.000000000000, 20000.000000000000, 20000.000000000000, 20000.000000000000, 20000.000000000000};
static const double REF_SHIFT[] = {-1500.0000000000000, -305.77603031000615, -61.868405471579507, -12.052850798224817, -1.8785502241534122, 0.0000000000000000, 1.8785502241534122, 12.052850798224801, 61.868405471579543, 305.77603031000615, 1500.0000000000000};

static void tenebraeTone() {
  static const double X[5] = {0, 0.3, 0.5, 0.8, 1};
  Scale off, minor; minor.on = true; minor.idx = 1; minor.root = 0;   // минор от A
  for (int i = 0; i < 5; i++) { NEAR(tenebrae::freqOf(X[i], off), REF_FREQ_OFF[i], 1e-9); NEAR(tenebrae::freqOf(X[i], minor), REF_FREQ_MINOR[i], 1e-9); }
  static const double B[4] = {0, 0.05, 3.5, 24};
  for (int i = 0; i < 4; i++) NEAR(tenebrae::beatHz(B[i]), REF_BEAT[i], 1e-9);
  static const double CUT[4] = {0, 0.3, 0.68, 1}, Y[3] = {0, 0.5, 1}, FM[3] = {0, 0.5, 1};
  int n = 0;
  for (double c : CUT) for (double y : Y) for (double fm : FM) NEAR(tenebrae::cutoffOf(c, y, fm), REF_CUTOFF[n++], 1e-9);
  for (int i = 0; i <= 10; i++) NEAR(tenebrae::shiftHz(i / 10.0), REF_SHIFT[i], 1e-9);
}

static tenebrae::Tables& tenebraeTables() { static tenebrae::Tables T; static bool done = false; if (!done) { T.build(); done = true; } return T; }

static void tenebraeWaves() {
  using tenebrae::Tables;
  const Tables& T = tenebraeTables();
  static const int H[6] = {1, 2, 3, 7, 50, 218};
  for (int f = 0; f < Tables::FORMS; f++) {
    NEAR(T.level[f], REF_LEVEL[f], 1e-9);
    for (int j = 0; j < 6; j++) {
      NEAR(T.re[0][f][H[j]], REF_VOICE_RE[f * 6 + j], 1e-9); NEAR(T.im[0][f][H[j]], REF_VOICE_IM[f * 6 + j], 1e-9);
      NEAR(T.re[1][f][H[j]], REF_LFO_RE[f * 6 + j], 1e-9); NEAR(T.im[1][f][H[j]], REF_LFO_IM[f * 6 + j], 1e-9);
    }
    double pv = 0, pl = 0;
    for (int k = 0; k < Tables::N; k++) { pv = std::fmax(pv, std::fabs(T.voice[f][0][k])); pl = std::fmax(pl, std::fabs(T.lfo[f][k])); }
    NEAR(pv, 1.0, 1e-6); NEAR(pl, 1.0, 1e-6);
  }
}

static void tenebraeWavesNyquist() {
  using tenebrae::Tables;
  const Tables& T = tenebraeTables();
  const double sr = 48000;
  CHECK(T.levelFor(27.5, sr) == 0 && T.levelFor(4000, sr) == 6);
  for (double hz : {27.5, 4000.0}) {
    const int L = T.levelFor(hz, sr), lim = static_cast<int>(sr / 2 / hz);
    for (int f = 0; f < Tables::FORMS; f++) {
      std::vector<std::complex<double>> x(Tables::N);
      for (int k = 0; k < Tables::N; k++) x[k] = T.voice[f][L][k];
      fftInPlace(x);
      double above = 0;
      for (int h = lim + 1; h <= Tables::N / 2; h++) above += std::norm(x[h]) / (double(Tables::N) * Tables::N);
      CHECK(above < 1e-12);
    }
  }
  // один период на 4000 Гц: конечный, |y| ≤ Σ level
  double sum = 0;
  for (int f = 0; f < Tables::FORMS; f++) sum += T.level[f];
  for (double pos : {0.0, 0.3, 0.5, 1.0}) {
    tenebrae::Morph m;
    for (int k = 0; k < 12; k++) { const double y = m.voiceStep(T, pos, 4000, sr); CHECK(std::isfinite(y) && std::fabs(y) <= sum); }
  }
}

static void tenebraeMorph() {
  using tenebrae::Tables;
  const Tables& T = tenebraeTables();
  const double sr = 48000, hz = sr / Tables::N;          // ровно один сэмпл таблицы на шаг, уровень 0
  tenebrae::Morph a, b, c;
  const double w = std::pow(0.5, 0.85);
  for (int k = 0; k < 64; k++) {
    NEAR(a.voiceStep(T, 0.0, hz, sr), T.level[0] * T.voice[0][0][k], 1e-6);
    NEAR(b.voiceStep(T, 0.0625, hz, sr), w * (T.level[0] * T.voice[0][0][k] + T.level[1] * T.voice[1][0][k]), 1e-6);
    NEAR(c.lfoStep(T, 0.0625, hz, sr), 0.5 * (T.lfo[0][k] + T.lfo[1][k]), 1e-6);
  }
}

// Tenebrae: сдвиг частоты — синус 1000 Гц уходит на 1000 ± hz, зеркальной боковой нет (≥ 40 dB), при hz = 0 громкость та же
static void tenebraeShifter() {
  const double sr = 48000, PI = 3.14159265358979323846;
  auto run = [&](double hz, double* mag) {          // амплитуды бинов 1 Гц второй половины (1 с = 48000 точек, шаг ДПФ 1 Гц)
    tenebrae::Shifter sh; sh.reset();
    std::vector<double> y(48000);
    for (int n = 0; n < 48000; n++) y[n] = sh.step(std::sin(2 * PI * 1000 * n / sr), hz, sr);
    double rms = 0;
    for (int n = 24000; n < 48000; n++) rms += y[n] * y[n];
    for (int k = 0; k < 3; k++) {
      const double f = k == 0 ? 1000 + hz : k == 1 ? 1000 - hz : 1000;
      double re = 0, im = 0;
      for (int n = 24000; n < 48000; n++) { re += y[n] * std::cos(2 * PI * f * n / sr); im += y[n] * std::sin(2 * PI * f * n / sr); }
      mag[k] = std::sqrt(re * re + im * im);
    }
    return std::sqrt(rms / 24000);
  };
  double m[3];
  run(300, m);   CHECK(m[0] > 1000); CHECK(20 * std::log10(m[1] / m[0]) <= -40);
  run(-300, m);  CHECK(m[0] > 1000); CHECK(20 * std::log10(m[1] / m[0]) <= -40);   // пик на 700, зеркало на 1300
  const double r = run(0, m);
  NEAR(20 * std::log10(r / (1 / std::sqrt(2.0))), 0, 0.1);
}

// Tenebrae: голос. a — 11 чисел VOICE: x, y, cut, res, wave, beat, fm, shift, amp, holeT, snap
static double tenebraeRun(tenebrae::Voice& v, int n, double* peak = nullptr, bool* finite = nullptr) {   // n сэмплов, Σ квадратов L+R
  static sdk::Rng rng(0x54454eu);                        // общий шум мира (bp и hiss)
  tenebrae::ModIn in{0, 0, 0, 0, 0};
  double e = 0;
  for (int k = 0; k < n; k++) {
    double L, R;
    in.noise = rng.next() * 2 - 1;
    v.prestep(); v.step(in, L, R);
    e += L * L + R * R;
    if (peak) *peak = std::fmax(*peak, std::fmax(std::fabs(L), std::fabs(R)));
    if (finite && !(std::isfinite(L) && std::isfinite(R))) *finite = false;
  }
  return e;
}

static void tenebraeVoiceSilent() {
  const double sr = 48000;
  static tenebrae::Voice v;
  const Scale sc;
  const double a[11] = {0.4, 0.5, 0.6, 0.3, 0.25, 2, 0.2, 0.5, 0.8, 0, 1};
  const double f = tenebrae::freqOf(a[0], sc);
  v.prepare(sr, 7, &tenebraeTables(), 0);
  v.set(a, f, a[6]);
  v.live(true); v.on();
  CHECK(v.isLive());
  CHECK(tenebraeRun(v, 4800) > 1e-3);                      // живой и включённый — звучит
  v.live(false);
  CHECK(!v.isLive());
  const double e0 = v.env(), f0 = v.freq();
  CHECK(e0 > 0.3);
  double peak = 0;
  const tenebrae::ModIn in{100, 50, 0.5, 0.5, 0.7};
  for (int k = 0; k < 48000; k++) { double L = 1, R = 1; v.prestep(); v.step(in, L, R); peak = std::fmax(peak, std::fmax(std::fabs(L), std::fabs(R))); CHECK(v.modOut() == 0 || k > 0); }
  CHECK(peak == 0);
  CHECK(v.env() == e0 && v.freq() == f0 && v.modOut() == 0);
}

static void tenebraeVoiceExtremes() {
  const double sr = 48000;
  static tenebrae::Voice v;
  const Scale sc;
  for (double x : {0.0, 1.0})
    for (double hole : {1.0, 0.0}) {
      const double a[11] = {x, 1, 1, 1, 1, 24, 1, 1, 1, hole, 1};
      const double f = tenebrae::freqOf(x, sc);
      v.prepare(sr, 3, &tenebraeTables(), 5);
      v.set(a, f, 1);
      for (int key = 0; key < 8; key++) v.lfo(key, 0.5, 7, 1);
      v.live(true); v.on();
      double peak = 0;
      bool finite = true;
      const double e = tenebraeRun(v, 4 * 48000, &peak, &finite);
      CHECK(finite);
      // hole = 1 — в дыре голос молчит (alive = 0); hole = 0 — всё на максимум (res 44 дБ с LFO, LFO amp ×2, comb, сумма
      // панорамы): один голос до нормировки шины бывает до ~5 — проверка только на разнос
      CHECK(peak < (hole == 1 ? 4 : 8));
      CHECK(v.combDelay() > 0 && v.combDelay() <= 1);
      if (x == 0) NEAR(v.combDelay(), 1 / 55.0, 1e-4);   // 1/f, f = 55 Гц
      else NEAR(v.combDelay(), 16 / 1760.0, 1e-4);         // 1/1760 удвоена до ≥ 6 мс
      if (hole == 0) CHECK(e > 1);                         // без дыры — громко
    }
}

// шум bp/hiss — общий от мира (ModIn.noise): без него у дыры почти тихо, два голоса с одним шумом — когерентны
static void tenebraeVoiceNoise() {
  const double sr = 48000;
  static tenebrae::Voice v[2];
  const Scale sc;
  const double a[11] = {0.5, 0, 0.5, 0, 0.5, 1, 0, 0.5, 1, 0.85, 1};   // y = 0, h = 0.85: тон почти съеден, шум ещё слышен (alive 0.22)
  double e[2] = {0, 0}, cross = 0, en[2] = {0, 0};
  for (int pass = 0; pass < 2; pass++) {
    for (int i = 0; i < 2; i++) { v[i].prepare(sr, 100 + i, &tenebraeTables(), i); v[i].set(a, tenebrae::freqOf(a[0], sc), 0); v[i].live(true); v[i].on(); }
    sdk::Rng rng(9);
    tenebrae::ModIn in{0, 0, 0, 0, 0};
    for (int k = 0; k < 48000; k++) {
      in.noise = pass ? rng.next() * 2 - 1 : 0;
      double L[2], R[2];
      for (int i = 0; i < 2; i++) { v[i].prestep(); v[i].step(in, L[i], R[i]); }
      if (k < 24000) continue;
      e[pass] += L[0] * L[0];
      if (pass) { cross += L[0] * L[1]; en[0] += L[0] * L[0]; en[1] += L[1] * L[1]; }
    }
  }
  CHECK(e[1] > 10 * e[0]);                                 // звук дыры — от общего шума (без него — на 10+ дБ тише)
  CHECK(cross / std::sqrt(en[0] * en[1]) > 0.9);           // голоса с одним шумом коррелированы
}

static void tenebraeVoiceRelive() {
  const double sr = 48000;
  static tenebrae::Voice v;
  const Scale sc;
  const double a[11] = {0.3, 0.6, 0.55, 0.4, 0.4, 1.5, 0.3, 0.5, 0.9, 0, 0};
  v.prepare(sr, 11, &tenebraeTables(), 2);
  v.set(a, tenebrae::freqOf(a[0], sc), a[6]);
  v.live(true); v.on();
  tenebraeRun(v, 48000);
  v.off(0.25);
  tenebraeRun(v, 2 * 48000);
  v.live(false);
  tenebraeRun(v, 48000);
  v.live(true); v.on();
  sdk::Rng rng(5);
  tenebrae::ModIn in{0, 0, 0, 0, 0};
  double y[512];
  for (int k = 0; k < 512; k++) { double L, R; in.noise = rng.next() * 2 - 1; v.prestep(); v.step(in, L, R); y[k] = std::fmax(std::fabs(L), std::fabs(R)); }
  double head = 0, tail = 0;
  for (int k = 0; k < 256; k++) head = std::fmax(head, y[k]);
  for (int k = 256; k < 512; k++) tail = std::fmax(tail, y[k]);
  CHECK(tail > 1e-3);                                      // звук пошёл
  CHECK(head <= tail);                                     // без щелчка выше установившегося
}

// Tenebrae: мир (слот 1). Сцена — действия как от app.js; блоки по 128, как у хоста
static void tenebraeRender(tenebrae::World& w, double sec, double* peak = nullptr, bool* finite = nullptr) {
  static float L[128], R[128], sL[128], sR[128];
  const sdk::Out out{L, R, sL, sR};
  const long blocks = std::lround(sec * 48000 / 128);
  for (long b = 0; b < blocks; b++) {
    w.process(out, 128);
    for (int k = 0; k < 128; k++) {
      const float* ch[4] = {L, R, sL, sR};
      for (const float* c : ch) {
        if (peak) *peak = std::fmax(*peak, std::fabs(c[k]));
        if (finite && !std::isfinite(c[k])) *finite = false;
      }
    }
  }
}
static void tenebraeVoiceOn(tenebrae::World& w, int i, double x, double y = 0.4) {   // как attack, потом sync: live → on → voice
  const double one = 1, a[11] = {x, y, 0.6, 0.2, 0.25, 1.5, 0.1, 0.5, 0.8, 0, 1};
  w.action(tenebrae::LIVE, i, &one, 1);
  w.action(tenebrae::ON, i, nullptr, 0);
  w.action(tenebrae::VOICE, i, a, 11);
}

static void tenebraeWorldBus() {
  static Scale sc;
  static tenebrae::World w(sc);
  w.prepare(48000, 1);
  const double fx[3] = {0.3, 0.3, 0.2};                  // FX по умолчанию app.js: rev, dly, dirt
  w.action(tenebrae::FX, 0, fx, 3);
  for (int i = 0; i < 6; i++) tenebraeVoiceOn(w, i, 0.1 + 0.15 * i);
  double peak = 0;
  tenebraeRender(w, 3, &peak);
  CHECK(peak > 0.01);
  CHECK(w.sounding());
  NEAR(w.busGain(), 1 / std::sqrt(6.0), 0.01 / std::sqrt(6.0));   // 6 голосов с env ≈ 1
  const double zero = 0;
  for (int i = 0; i < 6; i++) w.action(tenebrae::LIVE, i, &zero, 1);
  CHECK(!w.sounding());
  double tail = 0;
  tenebraeRender(w, 3, &tail);                           // эхо (fb 0.46, как в вебе) ещё звучит
  CHECK(tail > 1e-4);
  tenebraeRender(w, 6.5);                                // хвост эха dly 0.3 до −120 дБ — ~8.5 с, затем 0.5 с тишины — блок не считается
  tail = 0;
  tenebraeRender(w, 0.5, &tail);
  CHECK(tail == 0);
}

static void tenebraeTzfmFollows() {
  static Scale sc;
  static tenebrae::World w(sc);
  w.prepare(48000, 1);
  tenebraeVoiceOn(w, 0, 0.3);
  tenebraeVoiceOn(w, 1, 0.5);
  const double link[3] = {0, 1, 0.5};                    // источник 0, tzfm, глубина 0.5
  w.action(tenebrae::LINKS, 1, link, 3);
  tenebraeRender(w, 0.5);
  const double f0 = tenebrae::freqOf(0.3, sc);
  NEAR(w.linkValue(1, 0), 0.5 * 5 * f0, 0.01 * 0.5 * 5 * f0);
  const double a[11] = {0.7, 0.4, 0.6, 0.2, 0.25, 1.5, 0.1, 0.5, 0.8, 0, 0};
  w.action(tenebrae::VOICE, 0, a, 11);                   // источник сменил высоту — глубина в Гц у приёмника идёт за ней (τ 0.08)
  const double f1 = tenebrae::freqOf(0.7, sc), want = 0.5 * 5 * f1;
  tenebraeRender(w, 0.2);
  CHECK(std::fabs(w.linkValue(1, 0) - want) < 0.1 * std::fabs(want - 0.5 * 5 * f0));   // 2.5 τ: дошла на 92 %
  tenebraeRender(w, 0.3);
  NEAR(w.linkValue(1, 0), want, 0.01 * want);
}

static void tenebraeLinksClear() {
  static Scale sc;
  static tenebrae::World w(sc);
  w.prepare(48000, 1);
  tenebraeVoiceOn(w, 0, 0.3);
  tenebraeVoiceOn(w, 1, 0.5);
  const double link[3] = {0, 3, 0.8};                    // rm 0.8: база vca 1 − 0.8
  w.action(tenebrae::LINKS, 1, link, 3);
  tenebraeRender(w, 0.5);
  CHECK(w.voice(1).vcaBase() < 0.3);
  CHECK(w.links(1) == 1);
  w.action(tenebrae::LINKS, 1, nullptr, 0);              // пустой список — связи сняты, база vca назад к 1 (τ 0.08)
  CHECK(w.links(1) == 0);
  tenebraeRender(w, 0.6);
  NEAR(w.voice(1).vcaBase(), 1, 1e-3);
}

static void tenebraeMirror() {
  static Scale sc;
  static tenebrae::World w(sc);
  w.prepare(48000, 1);
  static double m[1024];
  CHECK(w.mirror(m, 1024) == tenebrae::MIRROR_HEAD);     // ни одного живого — только заголовок (ворклет не гонит 781 число)
  CHECK(m[0] == 6);
  tenebraeVoiceOn(w, 0, 0.4);
  tenebraeRender(w, 1);
  CHECK(w.mirror(m, 1024) == tenebrae::MIRROR_N);
  CHECK(tenebrae::MIRROR_N == 781);
  CHECK(w.mirror(m, 780) == 0);                          // не влезло — ничего
  w.mirror(m, 1024);
  CHECK(m[0] == 6);
  const double* v0 = m + tenebrae::MIRROR_HEAD;
  CHECK(v0[0] == 1);
  CHECK(v0[1] > 0.9);                                    // env после 1 с (τ 0.12)
  bool any = false;
  for (int j = 0; j < 128; j++) if (v0[2 + j] != 0) any = true;
  CHECK(any);
  const double* v1 = m + tenebrae::MIRROR_HEAD + tenebrae::MIRROR_V;
  CHECK(v1[0] == 0);
  bool none = true;
  for (int j = 0; j < 128; j++) if (v1[2 + j] != 0) none = false;
  CHECK(none);
  double h[4];
  CHECK(w.heard(h, 4) == 0);
  CHECK(w.snapshot().empty());
  const double zero = 0, one = 1;
  w.action(tenebrae::LIVE, 0, &zero, 1);                 // отцепили — снова заголовок; подключили — снова весь контур
  CHECK(w.mirror(m, 1024) == tenebrae::MIRROR_HEAD);
  w.action(tenebrae::LIVE, 0, &one, 1);
  tenebraeRender(w, 0.1);
  CHECK(w.mirror(m, 1024) == tenebrae::MIRROR_N);
  any = false;
  for (int j = 0; j < 128; j++) if (v0[2 + j] != 0) any = true;
  CHECK(v0[0] == 1 && any);
}

static void tenebraeCycleSafe() {
  static Scale sc;
  static tenebrae::World w(sc);
  w.prepare(48000, 1);
  tenebraeVoiceOn(w, 0, 0.3);
  tenebraeVoiceOn(w, 1, 0.6);
  const double to1[6] = {0, 1, 1, 0, 0, 1}, to0[6] = {1, 1, 1, 1, 0, 1};   // 0 → 1 и 1 → 0: tzfm 1 и fm 1
  w.action(tenebrae::LINKS, 1, to1, 6);
  w.action(tenebrae::LINKS, 0, to0, 6);
  double peak = 0;
  bool finite = true;
  tenebraeRender(w, 4, &peak, &finite);
  CHECK(finite);
  CHECK(peak < 4);
  CHECK(peak > 1e-3);
}

static void tenebraeStrikeClear() {
  static Scale sc;
  static tenebrae::World w(sc);
  w.prepare(48000, 1);
  const double p = 1;
  w.action(tenebrae::STRIKE, 0, &p, 1);                  // удар без голосов — в шину, слышен
  double peak = 0;
  bool finite = true;
  tenebraeRender(w, 0.2, &peak, &finite);
  CHECK(finite && peak > 0.01 && peak < 2);
  peak = 0;
  tenebraeRender(w, 1.5);
  tenebraeRender(w, 0.2, &peak);
  CHECK(peak == 0);                                      // отзвучал, эха нет — блок не считается
  tenebraeVoiceOn(w, 0, 0.3);
  tenebraeVoiceOn(w, 1, 0.5);
  const double link[3] = {0, 0, 0.4};
  w.action(tenebrae::LINKS, 1, link, 3);
  tenebraeRender(w, 0.5);
  CHECK(w.sounding());
  w.action(tenebrae::CLEAR, 0, nullptr, 0);              // корзина: связи сняты, звучащие гаснут τ 0.25
  CHECK(w.links(1) == 0);
  tenebraeRender(w, 2);
  CHECK(!w.sounding());
}

// лад сменился после VOICE (кадр app.js шлёт голоса раньше лада; хост натива — сам): ядро перестраивает живые голоса
// и глубины tzfm в Гц без нового VOICE; крайние x = 0 и x = 1 с ладом — нота лада в пределах поля
static void tenebraeScaleRetune() {
  static Scale sc;
  static tenebrae::World w(sc);
  w.prepare(48000, 1);
  tenebraeVoiceOn(w, 0, 0.6);
  tenebraeVoiceOn(w, 1, 0.3);
  const double link[3] = {0, 1, 0.5};                    // 0 → 1, tzfm 0.5
  w.action(tenebrae::LINKS, 1, link, 3);
  tenebraeRender(w, 0.5);
  const double f0 = tenebrae::freqOf(0.6, sc);
  NEAR(w.voice(0).freq(), f0, 1e-9);
  sc.on = true; sc.idx = 0; sc.root = 1;                 // мажор от B♭ — 0.6 не на ноте (как в замере ревью: 150.4 → 155.4 Гц)
  const double f1 = tenebrae::freqOf(0.6, sc);
  CHECK(std::fabs(f1 - f0) > 1);
  tenebraeRender(w, 128 / 48000.0);                      // один блок — без нового VOICE
  NEAR(w.voice(0).freq(), f1, 1e-9);
  NEAR(w.voice(1).freq(), tenebrae::freqOf(0.3, sc), 1e-9);
  tenebraeRender(w, 0.5);
  NEAR(w.linkValue(1, 0), 0.5 * 5 * f1, 0.01 * 0.5 * 5 * f1);
  sc.on = false;                                         // лад снят — назад к полю
  tenebraeRender(w, 128 / 48000.0);
  NEAR(w.voice(0).freq(), f0, 1e-9);
  // край поля с ладом: все лады и тоники — нота лада, 0…60 полутонов, не дальше тона от поля
  for (int idx = 0; idx < Scale::kScales; idx++) for (int root = 0; root < 12; root++) {
    Scale q; q.on = true; q.idx = idx; q.root = root;
    for (double x : {0.0, 1.0}) {
      const double s = tenebrae::semiOf(tenebrae::quantX(x, q)), n = std::round(s);
      NEAR(s, n, 1e-9);
      CHECK(n >= 0 && n <= tenebrae::SEMIS && q.inScale(static_cast<int>(n)));
      CHECK(std::fabs(n - tenebrae::semiOf(x)) <= 2);
      const double f = tenebrae::freqOf(x, q);
      CHECK(std::isfinite(f) && f >= tenebrae::F_LO - 1e-9 && f <= tenebrae::F_LO * 32 + 1e-9);
    }
  }
  sc.on = true; sc.idx = 1; sc.root = 3;                 // и в мире: x = 0 и x = 1 с ладом — частота по ладу, звук конечный
  static tenebrae::World e(sc);
  e.prepare(48000, 2);
  tenebraeVoiceOn(e, 0, 0);
  tenebraeVoiceOn(e, 1, 1);
  double peak = 0;
  bool finite = true;
  tenebraeRender(e, 1, &peak, &finite);
  NEAR(e.voice(0).freq(), tenebrae::freqOf(0, sc), 1e-9);
  NEAR(e.voice(1).freq(), tenebrae::freqOf(1, sc), 1e-9);
  CHECK(finite && peak > 1e-3 && peak < 4);
  sc.on = false;
  // лад, потом VOICE со snap в том же блоке (кадр app.js: лад — до голосов) — как будто лад был с самого начала, до бита
  static Scale sa, sb;
  sa.on = true; sa.idx = 0; sa.root = 1;
  static tenebrae::World wa(sa), wb(sb);
  wa.prepare(48000, 4); wb.prepare(48000, 4);
  sb.on = true; sb.idx = 0; sb.root = 1;
  tenebraeVoiceOn(wa, 0, 0.6); tenebraeVoiceOn(wb, 0, 0.6);
  static float aL[128], aR[128], aS[128], aT[128], bL[128], bR[128], bS[128], bT[128];
  bool same = true;
  for (int b = 0; b < 100; b++) {
    wa.process(sdk::Out{aL, aR, aS, aT}, 128); wb.process(sdk::Out{bL, bR, bS, bT}, 128);
    for (int k = 0; k < 128; k++) same = same && aL[k] == bL[k] && aR[k] == bR[k];
  }
  CHECK(same);
}

// Общий мост (api.cpp) нативно, без wasm: звезда Firmamentum в слоте 10 — зеркало, счётчик звёзд и звук в dry
static void bridgeNative() {
  t2d_init(48000, 1);
  t2d_args()[0] = 0.3; t2d_args()[1] = 0.1;
  t2d_action(10, 0, 0, t2d_args(), 2);
  for (int b = 0; b < 40; b++) t2d_process(128);
  CHECK(t2d_mirror(10) > 17);
  CHECK(t2d_mbuf()[16] == 1);                                             // одна звезда
  const float* d = t2d_dry(10, 0);
  bool sound = false;
  for (int k = 0; k < 128; k++) sound = sound || d[k] != 0.f;
  CHECK(sound);
}

// Веб не меняется: FNV-1a по байтам dry(10) и ret за 200 блоков сцены «3 звезды, seed 1» (константа снята до правки host.cpp)
static void mixWebUntouched() {
  t2d_init(48000, 1);
  const double pts[3][2] = {{0.3, 0.1}, {0.6, 0.5}, {0.8, 0.2}};
  for (const auto& p : pts) { t2d_args()[0] = p[0]; t2d_args()[1] = p[1]; t2d_action(10, 0, 0, t2d_args(), 2); }
  uint64_t h = 1469598103934665603ull;
  const auto eat = [&h](const float* x) {
    const unsigned char* b = reinterpret_cast<const unsigned char*>(x);
    for (size_t i = 0; i < 128 * sizeof(float); i++) { h ^= b[i]; h *= 1099511628211ull; }
  };
  for (int b = 0; b < 200; b++) {
    t2d_process(128);
    eat(t2d_dry(10, 0)); eat(t2d_dry(10, 1)); eat(t2d_ret(0)); eat(t2d_ret(1));
  }
  CHECK(h == 8071415700913142258ull);
}

// Микс: t2d_sum == Σ dry·фейдер·trim + ret; фейдер — только на сухой части (на посыле он уже учтён в ret блока)
static void mixSum() {
  t2d_init(48000, 1);
  t2d_args()[0] = 0.3; t2d_args()[1] = 0.1;
  t2d_action(10, 0, 0, t2d_args(), 2);
  for (int b = 0; b < 40; b++) t2d_process(128);                          // звезда звучит не с первого блока
  float L[128], R[128];
  const auto expect = [](int ch, int i, double fader10) {
    double v = t2d_ret(ch)[i];
    for (int s = 0; s < 16; s++) v += t2d_dry(s, ch)[i] * (s == 10 ? fader10 * 2.5 : s == 2 ? 2.5 : 1.0);
    return v;
  };
  t2d_sum(L, R, 128);
  double peak = 0, err = 0;
  for (int i = 0; i < 128; i++) { peak = std::fmax(peak, std::fabs(L[i])); err = std::fmax(err, std::fabs(L[i] - expect(0, i, 1))); err = std::fmax(err, std::fabs(R[i] - expect(1, i, 1))); }
  CHECK(peak > 1e-4);                                                     // звук есть
  CHECK(err < 1e-6);
  t2d_fader(10, 0.5);
  t2d_sum(L, R, 128);                                                     // тот же блок: ret не менялся, dry звезды вдвое тише
  err = 0;
  for (int i = 0; i < 128; i++) { err = std::fmax(err, std::fabs(L[i] - expect(0, i, 0.5))); err = std::fmax(err, std::fabs(R[i] - expect(1, i, 0.5))); }
  CHECK(err < 1e-6);
}

// Мастер ядра по цепочке веба: HP 30 → LPF → компрессор → ×0.8·volGain → ×0.5 → knee 4× → ceil
static double masterSine(double hz, double amp, double sec = 1.5) {
  const double sr = 48000;
  t2d_init(sr, 1);
  float L[128], R[128];
  double ph = 0, pk = 0;
  const int blocks = static_cast<int>(sec * sr / 128);
  for (int b = 0; b < blocks; b++) {
    for (int i = 0; i < 128; i++) { L[i] = R[i] = static_cast<float>(amp * std::sin(ph)); ph += 2 * M_PI * hz / sr; }
    t2d_master_run(L, R, 128);
    if (b >= blocks - static_cast<int>(0.3 * sr / 128)) for (int i = 0; i < 128; i++) { pk = std::fmax(pk, std::fabs(L[i])); }
  }
  return pk;
}
static void mixMaster() {
  const double k = 2.6 / std::tanh(2.6), makeup = t2d_master_makeup();
  const double lin = 0.8 * 1.0 * 0.5 * k * makeup;                        // volGain по умолчанию 1 (0 дБ)
  const double y1k = masterSine(1000, 0.01);
  NEAR(y1k / (0.01 * lin), 1.0, 0.01);                                    // малый сигнал: линейная ветка колена, компрессор молчит
  const double y10 = masterSine(10, 0.01);
  CHECK(y10 < 0.01 * lin * std::pow(10.0, -10.0 / 20));                   // 10 Гц ослаблен > 10 дБ
  CHECK(masterSine(1000, 4) <= 0.98);                                     // потолок knee
  t2d_master_ceil(-6);
  float L[128], R[128];
  double pk = 0; double ph = 0;
  for (int b = 0; b < 400; b++) {
    for (int i = 0; i < 128; i++) { L[i] = R[i] = static_cast<float>(4 * std::sin(ph)); ph += 2 * M_PI * 1000 / 48000; }
    t2d_master_run(L, R, 128);
    if (b >= 300) for (int i = 0; i < 128; i++) pk = std::fmax(pk, std::fabs(L[i]));
  }
  CHECK(pk <= 0.98 * std::pow(10.0, -6.0 / 20) * 1.0001);
}

// ===== core/app: кольца, чанкинг render, мост, heard, статистика =====
// Spsc: два потока, 1e6 элементов по порядку, ёмкость 256, производитель повторяет push при полном кольце
static void appSpscThreads() {
  static Spsc<uint32_t, 256> q;
  const uint32_t N = 1000000;
  std::thread prod([&] { for (uint32_t i = 0; i < N; i++) while (!q.push(i)) std::this_thread::yield(); });
  uint32_t want = 0; bool order = true;
  while (want < N) {
    uint32_t v;
    if (q.pop(v)) { if (v != want) { order = false; break; } want++; } else std::this_thread::yield();
  }
  if (!order) { uint32_t v; while (q.pop(v)) {} }                         // разгрести, чтобы производитель вышел (не гарантия, но не вешаем при провале)
  prod.join();
  CHECK(order);
  CHECK(want == N);
  uint32_t v;
  CHECK(!q.pop(v));
  Spsc<int, 4> s;                                                         // ёмкость ровно N
  int k = 0; while (s.push(k)) k++;
  CHECK(k == 4);
}

// Triple: читатель видит номера по возрастанию, внутри снимка все поля равны (без разрывов); последний снимок доходит
static void appTripleThreads() {
  struct Snap { uint64_t seq; uint64_t f[32]; };
  static Triple<Snap> t;
  const uint64_t N = 200000;
  std::thread wr([&] {
    for (uint64_t i = 1; i <= N; i++) { Snap& w = t.write(); w.seq = i; for (auto& x : w.f) x = i; t.publish(); }
  });
  uint64_t last = 0, reads = 0; bool mono = true, whole = true;
  Snap s;
  while (last < N) {
    if (!t.read(s)) { std::this_thread::yield(); continue; }
    reads++;
    if (s.seq <= last) mono = false;
    for (auto x : s.f) if (x != s.seq) whole = false;
    last = s.seq;
  }
  wr.join();
  CHECK(mono);
  CHECK(whole);
  CHECK(reads >= 1);
  CHECK(!t.read(s));                                                      // нового нет
}

static void appScene(double sr) {
  t2d_app_init(sr, 7, 1e9, 1u << 10);
  const double pts[3][2] = {{0.3, 0.1}, {0.6, 0.5}, {0.8, 0.2}};
  for (const auto& p : pts) t2d_app_action(10, 0, 0, p, 2, 0);
}

// Один и тот же звук при любой нарезке буфера: 128·k и вперемешку {100, 333, 470, 1024}
static void appChunking() {
  const int total = 128 * 40;                                             // 5120 сэмплов
  std::vector<float> aL(total), aR(total), bL(total + 1024), bR(total + 1024);
  appScene(48000);
  for (int o = 0; o < total; o += 128 * 4) t2d_app_render(aL.data() + o, aR.data() + o, 128 * 4, 0);
  appScene(48000);
  const int sizes[4] = {100, 333, 470, 1024};
  int o = 0, k = 0;
  while (o < total) { const int n = sizes[k++ % 4]; t2d_app_render(bL.data() + o, bR.data() + o, n, 0); o += n; }
  bool same = true, sound = false;
  for (int i = 0; i < total; i++) {
    same = same && std::memcmp(&aL[i], &bL[i], 4) == 0 && std::memcmp(&aR[i], &bR[i], 4) == 0;
    sound = sound || aL[i] != 0.f;
  }
  CHECK(same);
  CHECK(sound);
}

// Те же действия через кольцо и напрямую в начале 128-блока → зеркало Firmamentum равно до бита
static void appVsBridge() {
  const double a1[2] = {0.3, 0.1}, a2[2] = {0.6, 0.5};
  t2d_app_init(48000, 3, 1e9, 1u << 10);
  t2d_app_action(10, 0, 0, a1, 2, 0);
  t2d_app_action(10, 0, 0, a2, 2, 0);
  float L[512], R[512];
  t2d_app_render(L, R, 512, 0);
  double m1[1024]; const int n1 = t2d_app_mirror(10, m1, 1024);
  t2d_init(48000, 3);
  t2d_action(10, 0, 0, a1, 2);
  t2d_action(10, 0, 0, a2, 2);
  for (int b = 0; b < 4; b++) { t2d_time(b * 128.0 / 48000); t2d_process(128); }
  const int n2 = t2d_mirror(10);
  CHECK(n1 > 17);
  CHECK(n1 == n2);
  CHECK(n1 == n2 && std::memcmp(m1, t2d_mbuf(), static_cast<size_t>(n1) * sizeof(double)) == 0);
}

// Heard копится без чтения: те же записи, что отдаёт мост по блокам; при > 64 растёт heard_lost
static void appHeardAccumulates() {
  const double a[2] = {0.3, 0.1};
  t2d_app_init(48000, 5, 1e9, 1u << 10);
  t2d_app_action(10, 0, 0, a, 2, 0);
  float L[256], R[256];
  for (int r = 0; r < 10; r++) t2d_app_render(L, R, 256, 0);
  t2d_init(48000, 5);
  t2d_action(10, 0, 0, a, 2);
  std::vector<double> want; int recs = 0;
  for (int b = 0; b < 20; b++) {
    t2d_time(b * 128.0 / 48000); t2d_process(128);
    const int len = t2d_heard(10); bool any = false;
    for (int k = 0; k < len; k++) any = any || t2d_mbuf()[k] != 0;
    if (any) { recs++; want.insert(want.end(), t2d_mbuf(), t2d_mbuf() + len); }
  }
  CHECK(recs > 0);
  std::vector<double> got(4096);
  const int len = t2d_app_heard(10, got.data(), 4096);
  CHECK(len == static_cast<int>(want.size()));
  CHECK(len == static_cast<int>(want.size()) && std::memcmp(got.data(), want.data(), want.size() * sizeof(double)) == 0);
  CHECK(t2d_app_heard(10, got.data(), 4096) == 0);                        // забрали всё
  t2d_app_stats_t st; t2d_app_stats(&st);
  CHECK(st.heard_lost == 0);
  // много блоков без чтения: записей больше 64 → потеря
  t2d_app_init(48000, 5, 1e9, 1u << 10);
  for (int k = 0; k < 6; k++) { const double p[2] = {0.1 + 0.15 * k, 0.1 + 0.12 * k}; t2d_app_action(10, 0, 0, p, 2, 0); }
  for (int r = 0; r < 1500; r++) t2d_app_render(L, R, 256, 0);
  t2d_app_stats(&st);
  CHECK(st.heard_lost > 0);
}

// 300 действий без render при ёмкости 256 → 44 отброшено
static void appOverflow() {
  t2d_app_init(48000, 1, 1e9, 1u << 10);
  const double a[2] = {0.3, 0.1};
  int ok = 0;
  for (int i = 0; i < 300; i++) ok += t2d_app_action(10, 0, 0, a, 2, 0);
  t2d_app_stats_t st; t2d_app_stats(&st);
  CHECK(ok == 256);
  CHECK(st.dropped == 44);
}

// Задержка = (host − касание)/ticks + смещение куска в выходе; остаток прошлого куска сдвигает блок
static void appLatency() {
  t2d_app_init(48000, 1, 1e9, 1u << 10);
  const double a[2] = {0.3, 0.1};
  const uint64_t host = 5000000000ull;
  float L[256], R[256];
  t2d_app_action(10, 0, 0, a, 2, host - 2000000);                         // 0.002 с
  t2d_app_render(L, R, 128, host);
  t2d_app_stats_t st; t2d_app_stats(&st);
  CHECK(st.lat_n == 1);
  NEAR(st.lat_avg, 0.002, 1e-8);
  NEAR(st.lat_max, 0.002, 1e-8);
  CHECK(st.frames == 128);
  t2d_app_stats(&st);                                                     // окно снято
  CHECK(st.lat_n == 0 && st.lat_avg == 0);
  t2d_app_render(L, R, 100, host);                                        // остаток 28 сэмплов
  t2d_app_action(10, 0, 0, a, 2, host - 2000000);
  t2d_app_action(10, 0, 0, a, 2, 0);                                      // без метки — не считается
  t2d_app_render(L, R, 256, host);
  t2d_app_stats(&st);
  CHECK(st.lat_n == 1);
  NEAR(st.lat_avg, 0.002 + 28.0 / 48000, 1e-8);
  CHECK(st.load_avg > 0 && st.load_max >= st.load_avg);
}

// Повторный init с другой частотой — полный сброс: зеркало пусто, кадры, статистика; звук после новой звезды есть
static void appReinitRate() {
  appScene(48000);
  float L[128], R[128];
  t2d_app_render(L, R, 128, 0);
  double m[1024];
  CHECK(t2d_app_mirror(10, m, 1024) > 17);
  t2d_app_init(44100, 7, 1e9, 1u << 10);
  CHECK(t2d_app_mirror(10, m, 1024) == 0);
  t2d_app_stats_t st; t2d_app_stats(&st);
  CHECK(st.frames == 0 && st.dropped == 0 && st.heard_lost == 0 && st.lat_n == 0);
  CHECK(t2d_app_heard(10, m, 1024) == 0);
  const double a[2] = {0.3, 0.1};
  t2d_app_action(10, 0, 0, a, 2, 0);
  bool sound = false;
  for (int r = 0; r < 40; r++) { t2d_app_render(L, R, 128, 0); for (int i = 0; i < 128; i++) sound = sound || L[i] != 0.f; }
  CHECK(sound);
  CHECK(t2d_app_mirror(10, m, 1024) > 17);
  CHECK(m[16] == 1);
}

// Снимок и restore хоста через кольцо
static std::string appSnapStr(int slot, int id, int* gotId = nullptr, int* gotSlot = nullptr) {
  float L[128], R[128];
  const double a[1] = {static_cast<double>(id)};
  t2d_app_action(T2D_HOST, T2D_H_SNAP, slot, a, 1, 0);
  t2d_app_render(L, R, 128, 0);
  static char buf[1 << 16];
  int i = -1, sl = -1;
  const int n = t2d_app_snap_take(&i, &sl, buf, sizeof buf);
  if (gotId) *gotId = i;
  if (gotSlot) *gotSlot = sl;
  return std::string(buf, static_cast<size_t>(n));
}

// ADD → restore(пустая сцена) → ADD: порядок в кольце общий — в зеркале одна звезда, вторая
static void appHostOrder() {
  t2d_app_init(48000, 7, 1e9, 1u << 10);
  t2d_app_action(10, 5, 0, nullptr, 0, 0);                                // CLEAR
  const std::string E = appSnapStr(10, 1);
  CHECK(!E.empty());
  t2d_app_init(48000, 7, 1e9, 1u << 10);
  const double a1[2] = {0.3, 0.1}, a2[2] = {0.6, 0.5};
  t2d_app_action(10, 0, 0, a1, 2, 0);
  CHECK(t2d_app_restore(10, E.data(), static_cast<int>(E.size()), 0) == 1);
  t2d_app_action(10, 0, 0, a2, 2, 0);
  float L[128], R[128];
  t2d_app_render(L, R, 128, 0);
  double m[1024];
  CHECK(t2d_app_mirror(10, m, 1024) > 17);
  CHECK(m[16] == 1);
  NEAR(m[19], 0.6, 1e-9);
}

// DICE → SNAP(id 7) → строка с id и слотом; clear → restore → SNAP(id 8) даёт ту же строку
static void appSnapRoundtrip() {
  t2d_app_init(48000, 9, 1e9, 1u << 10);
  t2d_app_action(10, 6, 0, nullptr, 0, 0);                                // DICE
  int id = 0, slot = 0;
  const std::string S = appSnapStr(10, 7, &id, &slot);
  CHECK(id == 7 && slot == 10);
  CHECK(!S.empty());
  t2d_app_action(10, 5, 0, nullptr, 0, 0);
  t2d_app_restore(10, S.data(), static_cast<int>(S.size()), 0);
  CHECK(appSnapStr(10, 8, &id, &slot) == S);
  CHECK(id == 8);
  t2d_app_stats_t st; t2d_app_stats(&st);
  CHECK(st.snap_n == 2 && st.snap_avg > 0 && st.snap_max >= st.snap_avg && st.snap_lost == 0);
}

static void appRestoreGarbage() {
  t2d_app_init(48000, 7, 1e9, 1u << 10);
  const double a1[2] = {0.3, 0.1};
  t2d_app_action(10, 0, 0, a1, 2, 0);
  float L[128], R[128];
  t2d_app_render(L, R, 128, 0);
  double m[1024];
  t2d_app_mirror(10, m, 1024);
  const double before = m[16];
  const char g[] = "{garbage";
  t2d_app_restore(10, g, 8, 0);
  t2d_app_render(L, R, 128, 0);
  CHECK(t2d_app_mirror(10, m, 1024) > 17);
  CHECK(m[16] == before && before == 1);
}

static void appStrOverflow() {
  t2d_app_init(48000, 7, 1e9, 1u << 10);
  const char s[] = "{}";
  CHECK(t2d_app_restore(10, s, 2, 0) == 1);
  CHECK(t2d_app_restore(10, s, 2, 0) == 1);
  CHECK(t2d_app_restore(10, s, 2, 0) == 0);                               // кольцо строк: ровно 2
  t2d_app_init(48000, 7, 1e9, 1u << 10);
  float L[128], R[128];
  const double a[1] = {1};
  for (int k = 0; k < 3; k++) t2d_app_action(T2D_HOST, T2D_H_SNAP, 10, a, 1, 0);
  t2d_app_render(L, R, 128, 0);
  t2d_app_stats_t st; t2d_app_stats(&st);
  CHECK(st.snap_lost == 1 && st.snap_n == 3);
  static char buf[1 << 16];
  int id, sl;
  CHECK(t2d_app_snap_take(&id, &sl, buf, 8) == 0);                        // не влез в cap — потерян
  t2d_app_stats(&st);
  CHECK(st.snap_lost == 2);
  CHECK(t2d_app_snap_take(&id, &sl, buf, sizeof buf) > 0);                // следующий цел
}

// VOL a=[0.5] → через 0.3 с выход вдвое тише (громкость после компрессора — линейна); SCALE как прямой t2d_scale
static void appHostVolScale() {
  const double a1[2] = {0.3, 0.1}, a2[2] = {0.6, 0.5};
  const int N = 128 * 150;
  auto run = [&](double vol, bool viaRing, bool scale, std::vector<float>& out) {
    t2d_app_init(48000, 11, 1e9, 1u << 10);
    if (scale && !viaRing) t2d_scale(1, 2, 5);
    if (vol != 1) { const double v[1] = {vol}; t2d_app_action(T2D_HOST, T2D_H_VOL, 0, v, 1, 0); }
    if (scale && viaRing) { const double sc[3] = {1, 2, 5}; t2d_app_action(T2D_HOST, T2D_H_SCALE, 0, sc, 3, 0); }
    t2d_app_action(10, 0, 0, a1, 2, 0);
    t2d_app_action(10, 0, 0, a2, 2, 0);
    std::vector<float> R(N);
    out.assign(N, 0.f);
    t2d_app_render(out.data(), R.data(), N, 0);
  };
  std::vector<float> full, half;
  run(1, true, false, full); run(0.5, true, false, half);
  double e1 = 0, e2 = 0;
  for (int i = N - 128 * 8; i < N; i++) { e1 += full[i] * full[i]; e2 += half[i] * half[i]; }
  CHECK(e1 > 0);
  NEAR(std::sqrt(e2 / e1), 0.5, 0.005);
  // SCALE: сцена, чувствительная к ладу (Tenebrae, голос x = 0.6 — не на ноте мажора от B♭): после блока включаем лад
  auto tun = [&](int mode, std::vector<float>& out) {       // 0 — без лада, 1 — кольцо (1, 2, 5), 2 — прямой t2d_scale, 3 — кольцо с idx и root наоборот
    t2d_app_init(48000, 11, 1e9, 1u << 1);
    t2d_scale(0, 0, 0);                                     // init лад не сбрасывает
    const double one = 1, v[11] = {0.6, 0.4, 0.6, 0.2, 0.25, 1.5, 0.1, 0.5, 0.8, 0, 1};
    t2d_app_action(1, tenebrae::LIVE, 0, &one, 1, 0);
    t2d_app_action(1, tenebrae::ON, 0, nullptr, 0, 0);
    t2d_app_action(1, tenebrae::VOICE, 0, v, 11, 0);
    std::vector<float> R(128 * 40);
    out.assign(128 * 40, 0.f);
    t2d_app_render(out.data(), R.data(), 128, 0);
    if (mode == 2) t2d_scale(1, 2, 5);
    if (mode == 1 || mode == 3) {
      const double sc[3] = {1, mode == 1 ? 2.0 : 5.0, mode == 1 ? 5.0 : 2.0};
      t2d_app_action(T2D_HOST, T2D_H_SCALE, 0, sc, 3, 0);
    }
    t2d_app_render(out.data() + 128, R.data(), 128 * 39, 0);
  };
  std::vector<float> t0, t1, t2, t3;
  tun(0, t0); tun(1, t1); tun(2, t2); tun(3, t3);
  CHECK(t1 == t2);
  CHECK(t1 != t0);
  CHECK(t1 != t3);
}

static void appStrCap() { CHECK(t2d_str_cap() == Engine::STR); }

// LFO: числа сверены с host/waves.js (classic, треугольные веса) и host/sl.js (random, номер периода от u) в Node
static void lfoForms() {
  sdk::WaveMorph cl(sdk::WaveMorph::CLASSIC), rn(sdk::WaveMorph::RANDOM);
  NEAR(cl.sample(0, 0.1, 0), 0.357168044369, 1e-6);
  NEAR(cl.sample(0.5, 0.2, 0), 0.144467083112, 1e-6);
  NEAR(cl.sample(1, 0.3, 0), -0.675098147014, 1e-6);
  NEAR(cl.sample(0.25, 0.7, 0), 0.352753503187, 1e-6);
  NEAR(rn.sample(0.1, 0.3, 7), -0.4, 1e-9);
  NEAR(rn.sample(0.4, 0.7, 7), -0.4, 1e-9);
  NEAR(rn.sample(0.6, 1.7, 7), -0.341778066893, 1e-9);
  NEAR(rn.sample(0.9, 2.2, 7), 0.161732331765, 1e-9);
  CHECK(rn.sample(0.6, 0.2, 7) != rn.sample(0.6, 1.2, 7));
  CHECK(rn.sample(0.6, 1.2, 7) != rn.sample(0.6, 2.2, 7));
}

// random-формы по хешу периода: эталон — Node по host/sl.js (RND_SHAPES), seed 3
static void lfoRandom() {
  Host h;
  h.prepare(48000, 7);
  NEAR(h.lfoSample(1, 0.6, 0.2, 3), 0.116445177162, 1e-9);        // steps: один шаг на период floor(u)
  NEAR(h.lfoSample(1, 0.6, 1.2, 3), -0.252532571321, 1e-9);
  NEAR(h.lfoSample(1, 0.6, 2.2, 3), -0.093040967578, 1e-9);
  NEAR(h.lfoSample(1, 0.9, 0.5, 3), -0.068043697080, 1e-9);       // smooth
  NEAR(h.lfoSample(1, 0.9, 1.5, 3), -0.172786769450, 1e-9);
  CHECK(std::fabs(h.lfoSample(1, 0.9, 1 - 1e-9, 3) - h.lfoSample(1, 0.9, 1 + 1e-9, 3)) < 1e-6);   // непрерывна на границе периода
  NEAR(h.lfoSample(1, 0.1, 1.25, 3), -0.5, 0.01);                 // ramp up / down — от frac(u)
  NEAR(h.lfoSample(1, 0.3, 1.25, 3), 0.5, 0.01);
}

// Host без мира в слоте: только таблица
static void hostLfo() {
  Host h;
  h.prepare(48000, 7);
  double b[64 * 10];
  CHECK(h.lfoAdd(10, 4, 4, 0.5, 1));
  CHECK(h.lfoState(b, 640) == 10);
  CHECK(b[0] == 10 && b[1] == 4 && b[2] == 4 && b[8] == 1 && b[7] == 0);
  NEAR(b[3], 0.5, 1e-12); NEAR(b[4], 0.6, 1e-12); NEAR(b[5], 0.4, 1e-12); NEAR(b[6], 0.3, 1e-12);
  CHECK(b[9] >= 0 && b[9] <= 999);
  const double seed = b[9];
  h.lfoSpec(10, 4, 4, 0.1, 2, 0.5);
  CHECK(h.lfoAdd(10, 4, 4, 0.9, 0));                              // та же тройка — ничего, спека не сброшена
  CHECK(h.lfoState(b, 640) == 10);
  NEAR(b[3], 0.5, 1e-12); NEAR(b[4], 0.1, 1e-12); NEAR(b[5], 2, 1e-12); NEAR(b[6], 0.5, 1e-12); CHECK(b[9] == seed);
  h.lfoSpec(10, 4, 4, NAN, 3, NAN);                               // NaN — не менять
  h.lfoState(b, 640);
  NEAR(b[4], 0.1, 1e-12); NEAR(b[5], 3, 1e-12); NEAR(b[6], 0.5, 1e-12);
  h.lfoSpec(10, 4, 4, 0.1, 2, 0.5);
  h.lfoTick(0.25);
  h.lfoState(b, 640);
  NEAR(b[7], 0.5, 1e-12);                                         // rate 2 · 0.25 с
  h.lfoBase(10, 4, 4, 0.7);
  h.lfoState(b, 640);
  NEAR(b[3], 0.7, 1e-12);
  h.lfoSpec(10, 5, 4, 1, 1, 1); h.lfoBase(10, 5, 4, 0.1);         // нет тройки — ничего
  CHECK(h.lfoState(b, 640) == 10);
  CHECK(h.lfoState(b, 5) == 0);                                   // не влезает в cap
  // drop: по объекту, по слоту (obj ≥ 0), FX (obj −1) живёт
  CHECK(h.lfoAdd(10, 5, 0, 0.5, 0)); CHECK(h.lfoAdd(10, -1, 12, 0.5, 0)); CHECK(h.lfoAdd(11, 4, 4, 0.5, 0));
  h.lfoDrop(10, 4);
  CHECK(h.lfoState(b, 640) == 30);                                // осталось: (10,5,0), (10,−1,12), (11,4,4)
  h.lfoDrop(10, Host::LFO_OBJS);
  const int n = h.lfoState(b, 640);
  CHECK(n == 20 && b[0] == 10 && b[1] == -1 && b[10] == 11);
  h.lfoDrop(10, -1);                                              // FX DROP-ом не гасится
  CHECK(h.lfoState(b, 640) == 20);
  h.lfoOff(10, -1, 12);
  CHECK(h.lfoState(b, 640) == 10);
  h.lfoOff(11, 4, 4);
  // переполнение
  h.prepare(48000, 7);
  for (int i = 0; i < Host::LFO_MAX; i++) CHECK(h.lfoAdd(10, i, 0, 0.5, 1));
  CHECK(!h.lfoAdd(10, 64, 0, 0.5, 1));
  CHECK(h.lfoLost() == 1);
  CHECK(h.lfoState(b, 640) == 640);
  h.lfoOff(10, 3, 0);
  CHECK(h.lfoAdd(10, 64, 0, 0.5, 1));                             // ячейка освободилась
  // prepare чистит таблицу, зерно пересеяно — повторяемость
  h.prepare(48000, 7);
  CHECK(h.lfoState(b, 640) == 0 && h.lfoLost() == 0);
  CHECK(h.lfoAdd(10, 4, 4, 0.5, 1));
  h.lfoState(b, 640);
  CHECK(b[9] == seed);
}

// ---- LFO через движок: Firmamentum в слоте 10, действия UI → кольцо → ядро ----
// зеркало Firmamentum: звезда с m[17] (slot, id, h, u, …), h — m[19], u — m[20]; fx — m[9..15]
static void lfoStart() {
  t2d_app_init(48000, 7, 1e9, 1u << 10);
  const double s[4] = {0.3, 0.1, -1, 1};
  t2d_app_action(10, 0, 0, s, 4, 0);
}
static void lfoBlocks(int n, double* hOut = nullptr, double* uOut = nullptr) {   // n блоков по 128; hOut / uOut — после последнего
  float L[128], R[128];
  double m[1024];
  for (int k = 0; k < n; k++) {
    t2d_app_render(L, R, 128, 0);
    if (hOut || uOut) { t2d_app_mirror(10, m, 1024); if (hOut) *hOut = m[19]; if (uOut) *uOut = m[20]; }
  }
}
static void lfoAct(int kind, int slot, std::initializer_list<double> a) {
  std::vector<double> v(a);
  t2d_app_action(T2D_HOST, kind, slot, v.data(), static_cast<int>(v.size()), 0);
}
static double lfoRms(bool lfo) {                                  // RMS 0.5 с звука Firmamentum с LFO на h и без
  lfoStart();
  if (lfo) { lfoAct(T2D_H_LFO_ADD, 10, {1, 4, 0.3, 0}); lfoAct(T2D_H_LFO_SPEC, 10, {1, 4, NAN, 3, 0.8}); }
  float L[128], R[128];
  double e = 0;
  for (int k = 0; k < 188; k++) { t2d_app_render(L, R, 128, 0); for (int i = 0; i < 128; i++) e += double(L[i]) * L[i] + double(R[i]) * R[i]; }
  return std::sqrt(e / (188 * 256));
}

static void lfoApply() {
  lfoStart();
  double h = 0;
  lfoBlocks(2, &h);
  NEAR(h, 0.3, 1e-9);
  lfoAct(T2D_H_LFO_ADD, 10, {1, 4, 0.3, 1});
  lfoAct(T2D_H_LFO_SPEC, 10, {1, 4, NAN, 1, 0.5});
  lfoBlocks(94, &h);                                              // ≈ 0.25 с
  CHECK(h != 0.3);
  CHECK(h >= 0.05 - 1e-9 && h <= 0.55 + 1e-9);
}

static void lfoUnits() {
  lfoStart();
  lfoAct(T2D_H_LFO_ADD, 10, {1, 5, 0.55, 0});
  lfoAct(T2D_H_LFO_SPEC, 10, {1, 5, NAN, 5, 1});
  double u = 0, lo = 9, hi = -9;
  for (int k = 0; k < 375; k++) {                                 // 1 с
    lfoBlocks(1, nullptr, &u);
    CHECK(u >= -1 - 1e-9 && u <= 1 + 1e-9);
    lo = std::fmin(lo, u); hi = std::fmax(hi, u);
  }
  CHECK(lo < 0 && hi > 0.3);
}

static void lfoOff() {
  lfoStart();
  double h = 0, b[640];
  lfoAct(T2D_H_LFO_ADD, 10, {1, 4, 0.3, 1});
  lfoAct(T2D_H_LFO_SPEC, 10, {1, 4, NAN, 1, 0.5});
  lfoBlocks(60, &h);
  CHECK(t2d_app_lfo(b, 640) == 10);
  lfoAct(T2D_H_LFO_OFF, 10, {1, 4});
  lfoBlocks(1, &h);
  NEAR(h, 0.3, 1e-9);                                             // миру ушёл base
  CHECK(t2d_app_lfo(b, 640) == 0);
}

// DROP / restore в том же кольце: порядок — как у касаний
static void lfoOrder() {
  lfoStart();
  lfoBlocks(2);
  lfoAct(T2D_H_SNAP, 10, {5});
  lfoBlocks(1);
  static char scene[1 << 16];
  int id = 0, slot = 0;
  const int len = t2d_app_snap_take(&id, &slot, scene, sizeof scene);
  CHECK(len > 0);
  lfoAct(T2D_H_LFO_ADD, 10, {1, 4, 0.3, 1});
  lfoAct(T2D_H_LFO_ADD, 10, {-1, 12, 0.5, 0});
  lfoAct(T2D_H_LFO_SPEC, 10, {1, 4, NAN, 1, 0.5});
  t2d_app_restore(10, scene, len, 0);
  double h = 0, b[640];
  lfoBlocks(1, &h);
  CHECK(t2d_app_lfo(b, 640) == 10);
  CHECK(b[1] == -1 && b[2] == 12);                                // остался LFO hall
  NEAR(h, 0.3, 1e-9);                                             // h — из сцены
  lfoBlocks(40, &h);
  NEAR(h, 0.3, 1e-9);                                             // и не модулируется
}

static void lfoDeadObj() {
  const double a = lfoRms(true);
  lfoStart();
  lfoAct(T2D_H_LFO_ADD, 10, {1, 4, 0.3, 1});
  t2d_app_action(10, 1, 1, nullptr, 0, 0);                        // CLOSE звезды 1
  double m[1024];
  lfoBlocks(100);
  t2d_app_mirror(10, m, 1024);
  CHECK(m[16] == 0);                                              // звёзд нет
  CHECK(lfoRms(true) == a);                                       // детерминированно
}

static void lfoSpecNan() {
  lfoStart();
  lfoAct(T2D_H_LFO_ADD, 10, {1, 4, 0.5, 1});
  lfoAct(T2D_H_LFO_SPEC, 10, {1, 4, NAN, 2, 0.4});
  lfoBlocks(1);
  double b[640];
  CHECK(t2d_app_lfo(b, 640) == 10);
  NEAR(b[4], 0.6, 1e-12); NEAR(b[5], 2, 1e-12); NEAR(b[6], 0.4, 1e-12);
}

// чужие миры ACT_LFO не знают: не падают и не звучат иначе
static void lfoForeign() {
  for (int slot : {1, 2}) {
    auto run = [&](bool send) {
      t2d_app_init(48000, 7, 1e9, 0);
      const double a[2] = {0, 0.5};
      if (send) t2d_app_action(slot, sdk::ACT_LFO, 0, a, 2, 0);
      float L[128], R[128];
      double e = 0;
      for (int k = 0; k < 50; k++) { t2d_app_render(L, R, 128, 0); for (int i = 0; i < 128; i++) e += double(L[i]) * L[i] + double(R[i]) * R[i]; }
      return e;
    };
    CHECK(run(true) == run(false));
  }
}

static void appLfo() {
  lfoStart();
  lfoAct(T2D_H_LFO_ADD, 10, {1, 4, 0.3, 1});
  lfoAct(T2D_H_LFO_ADD, 10, {-1, 12, 0.5, 0});
  lfoAct(T2D_H_LFO_SPEC, 10, {-1, 12, 0.2, 1.5, 0.6});
  lfoBlocks(1);
  double b[640];
  CHECK(t2d_app_lfo(b, 640) == 20);
  CHECK(b[0] == 10 && b[1] == 1 && b[2] == 4 && b[8] == 1);
  NEAR(b[3], 0.3, 1e-12);
  CHECK(b[10] == 10 && b[11] == -1 && b[12] == 12 && b[18] == 0);
  NEAR(b[13], 0.5, 1e-12); NEAR(b[14], 0.2, 1e-12); NEAR(b[15], 1.5, 1e-12); NEAR(b[16], 0.6, 1e-12);
  CHECK(b[17] > 0);                                               // u двинулась за блок
  CHECK(t2d_app_lfo(b, 19) == 0);                                 // не влезает
  lfoStart();
  for (int j = 0; j < 65; j++) lfoAct(T2D_H_LFO_ADD, 10, {double(j), 0, 0.5, 0});
  lfoBlocks(1);
  t2d_app_stats_t st;
  t2d_app_stats(&st);
  CHECK(st.lfo_lost == 1);
  CHECK(t2d_app_lfo(b, 640) == 640);
  NEAR(t2d_app_lfo_sample(1, 0.6, 1.2, 3), -0.252532571321, 1e-9);
}

// уровни слотов для карты: RMS сухого выхода (до фейдера), индекс = слот
// звезда Firmamentum звучит импульсами (между ними тишина) — берём максимум уровня за 0.5 с, а не последний отсчёт
static float levelPeak10(float* L, float* R, float* peakOut = nullptr) {
  float lv[16], top = 0;
  for (int k = 0; k < 188; k++) {
    t2d_app_render(L, R, 128, 0);
    if (peakOut) for (int i = 0; i < 128; i++) *peakOut = std::max(*peakOut, std::max(std::fabs(L[i]), std::fabs(R[i])));
    t2d_app_levels(lv, 16);
    top = std::max(top, lv[10]);
  }
  return top;
}

static void appLevels() {
  t2d_app_init(48000, 7, 1e9, 1u << 10);
  float L[128], R[128], lv[16];
  for (int k = 0; k < 20; k++) t2d_app_render(L, R, 128, 0);
  CHECK(t2d_app_levels(lv, 16) == 1);
  for (int s = 0; s < 16; s++) CHECK(lv[s] < 1e-6f);
  const double star[4] = {0.3, 0.1, -1, 1};
  t2d_app_action(10, 0, 0, star, 4, 0);
  CHECK(levelPeak10(L, R) > 0.0025f);
  t2d_app_levels(lv, 16);
  CHECK(lv[2] < 1e-6f);
  float five[5] = {0, 0, 0, 0, -7};
  t2d_app_render(L, R, 128, 0);
  CHECK(t2d_app_levels(five, 4) == 1);
  CHECK(five[4] == -7.f);                                         // n = 4 — пятое не тронуто
  CHECK(t2d_app_levels(lv, 16) == 0);                             // без нового render — тот же снимок
}

// фейдер слота в 0 с самого начала: в выходе слот молчит (посыл в ревербер тоже после фейдера), а уровень для карты есть
static void appLevelsPreFader() {
  t2d_app_init(48000, 7, 1e9, 1u << 10);
  t2d_fader(10, 0);
  const double star[4] = {0.3, 0.1, -1, 1};
  t2d_app_action(10, 0, 0, star, 4, 0);
  float L[128], R[128], peak = 0;
  CHECK(levelPeak10(L, R, &peak) > 0.0025f);
  CHECK(peak == 0.f);
}

// фейдер и мастер через кольцо хоста: тот же сглаженный путь, что у VOL
static void hostStar(bool act = true) {
  t2d_app_init(48000, 7, 1e9, 1u << 10);
  const double star[4] = {0.3, 0.1, -1, 1};
  if (act) t2d_app_action(10, 0, 0, star, 4, 0);
}

// сухая часть последнего блока после фейдера (Σ dry·g·trim): хвост ревербера (hall — секунды) в выходе остаётся и от выключенного слота
static float dryAfterFader() {
  float a[128], b[128], m = 0;
  t2d_sum(a, b, 128);
  for (int i = 0; i < 128; i++) m = std::max({m, std::fabs(a[i] - t2d_ret(0)[i]), std::fabs(b[i] - t2d_ret(1)[i])});
  return m;
}

static void appHostFader() {
  hostStar();
  const double g0[1] = {0};
  t2d_app_action(T2D_HOST, T2D_H_FADER, 10, g0, 1, 0);
  float L[128], R[128], peak = 0;
  for (int k = 0; k < 120; k++) t2d_app_render(L, R, 128, 0);   // 0.32 с — сглаживание дошло
  CHECK(levelPeak10(L, R, &peak) > 0.0025f);                    // слот звучит до фейдера
  float p2 = 0;
  for (int k = 0; k < 188; k++) { t2d_app_render(L, R, 128, 0); p2 = std::max(p2, dryAfterFader()); }
  CHECK(p2 < 1e-4f);
}

// сухой выход после фейдера (левый канал последнего блока) и сырой уровень слота 10 до фейдера
static void dryBlock(float* d, float* raw) {
  float a[128], b[128];
  t2d_sum(a, b, 128);
  float m = 0;
  for (int i = 0; i < 128; i++) { d[i] = a[i] - t2d_ret(0)[i]; m = std::max(m, std::fabs(t2d_dry(10, 0)[i])); }
  *raw = m;
}

static void appHostFaderSmooth() {
  hostStar();
  const double g1[1] = {1}, g0[1] = {0};
  t2d_app_action(T2D_HOST, T2D_H_FADER, 10, g1, 1, 0);
  float L[128], R[128], d[128], raw = 0;
  float before = 0, prev = 0, ampBefore = 0, r0 = 0;
  for (int k = 0; k < 188; k++) {                               // 0.5 с до действия: максимум разницы соседних сэмплов сухого
    t2d_app_render(L, R, 128, 0);
    dryBlock(d, &raw);
    float m = 0;
    for (int i = 0; i < 128; i++) { before = std::max(before, std::fabs(d[i] - prev)); prev = d[i]; m = std::max(m, std::fabs(d[i])); }
    ampBefore = std::max(ampBefore, m);
    if (raw > 1e-3f) r0 = m / raw;                              // сухое / сырое = trim при фейдере 1
  }
  CHECK(ampBefore > 0.0025f && r0 > 0);
  t2d_app_action(T2D_HOST, T2D_H_FADER, 10, g0, 1, 0);
  float after = 0;
  int judged = 0;
  for (int k = 0; k < 120; k++) {                               // 0.32 с перехода
    t2d_app_render(L, R, 128, 0);
    dryBlock(d, &raw);
    float m = 0;
    for (int i = 0; i < 128; i++) { m = std::max(m, std::fabs(d[i])); after = std::max(after, std::fabs(d[i] - prev)); prev = d[i]; }
    if (raw > 1e-3f && k < 40) {                                // звезда импульсная: берём блоки, где есть что слышать; фейдер = (1−k)^(блок+1)
      const float want = static_cast<float>(std::pow(std::exp(-128.0 / (0.03 * 48000)), k + 1));
      const float ratio = m / raw / r0;
      CHECK(std::fabs(ratio - want) < 0.03f * want + 1e-4f);
      judged++;
    }
  }
  CHECK(judged >= 2);                                           // кривая проверена не на одном блоке
  CHECK(after <= before * 1.5f);                                // ступени блока не рвут сухое
  float tail = 0;
  for (int k = 0; k < 188; k++) { t2d_app_render(L, R, 128, 0); tail = std::max(tail, dryAfterFader()); }
  CHECK(tail < 1e-4f);
}

static float masterPeak(double ceilDb) {
  hostStar();
  const double m[4] = {22000, -10, 2.5, ceilDb};
  t2d_app_action(T2D_HOST, T2D_H_MASTER, 0, m, 4, 0);
  float L[128], R[128], peak = 0;
  for (int k = 0; k < 120; k++) t2d_app_render(L, R, 128, 0);   // сглаживание дошло
  levelPeak10(L, R, &peak);
  return peak;
}

static void appHostMaster() {
  const float lo = masterPeak(-12), hi = masterPeak(0);
  CHECK(hi > 0.0025f);
  CHECK(lo * 2 < hi);
}

int main(int argc, char** argv) {
  if (argc > 1 && std::string(argv[1]) == "--scale") { scaleTable(); return 0; }
  rng(); onepole(); dc(); clip(); pan(); delay(); echo(); biquad(); json(); reverb(); scaleBasics(); host(); hostVolSmooth(); firm(); firmSend(); firmIds(); knee(); resonator(); stepclock(); cymWorld(); cymModel(); pingpongAd(); pingpongPortus(); saw(); portusModel(); portusWorld(); chorusMono(); tapeGlide(); glideBlock(); naturaWave(); naturaWorld(); naturaModel();
  tenebraeTone(); tenebraeWaves(); tenebraeWavesNyquist(); tenebraeMorph(); tenebraeShifter();
  tenebraeVoiceSilent(); tenebraeVoiceExtremes(); tenebraeVoiceNoise(); tenebraeVoiceRelive();
  tenebraeWorldBus(); tenebraeTzfmFollows(); tenebraeLinksClear(); tenebraeMirror(); tenebraeCycleSafe(); tenebraeStrikeClear(); tenebraeScaleRetune();
  shaper(); shaperOs4(); shaperChromium2(); bpbank(); noise(); infernoModel(); infernoSound(); bridgeNative(); mixWebUntouched(); mixSum(); mixMaster();
  appSpscThreads(); appTripleThreads(); appChunking(); appVsBridge(); appHeardAccumulates(); appOverflow(); appLatency(); appReinitRate();
  appHostOrder(); appSnapRoundtrip(); appRestoreGarbage(); appStrOverflow(); appHostVolScale(); appStrCap();
  lfoForms(); lfoRandom(); hostLfo(); lfoApply(); lfoUnits(); lfoOff(); lfoOrder(); lfoDeadObj(); lfoSpecNan(); lfoForeign(); appLfo(); appLevels(); appLevelsPreFader(); appHostFader(); appHostFaderSmooth(); appHostMaster();
  std::printf("sdk-test: %d checks, %d failed\n", checks, fails);
  return fails ? 1 : 0;
}
