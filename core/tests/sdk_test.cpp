// Тесты блоков core/sdk — без библиотек: свои CHECK, код выхода ≠ 0 при провале. Эталонные числа (Rng, Biquad) посчитаны в Node
// независимо: Rng — rnd() из tools/ref/pulsar-worklet.js, Biquad — формулы Web Audio (BiquadFilterNode), sr = 48000.
#include <chrono>
#include <cmath>
#include <complex>
#include <cstdio>
#include <string>
#include <vector>
#include "../sdk/biquad.hpp"
#include "../sdk/clip.hpp"
#include "../sdk/dc.hpp"
#include "../sdk/echo.hpp"
#include "../sdk/delay.hpp"
#include "../sdk/json.hpp"
#include "../sdk/knee.hpp"
#include "../sdk/pan.hpp"
#include "../sdk/resonator.hpp"
#include "../sdk/reverb.hpp"
#include "../sdk/rng.hpp"
#include "../sdk/smooth.hpp"
#include "../sdk/stepclock.hpp"
#include "../sdk/world.hpp"
#include "../host/host.hpp"
#include "../host/scale.hpp"
#include "../worlds/cymatica/world.hpp"
#include "../worlds/firmamentum/world.hpp"

static int fails = 0, checks = 0;
#define CHECK(c) do { checks++; if (!(c)) { fails++; std::printf("FAIL %s:%d  %s\n", __FILE__, __LINE__, #c); } } while (0)
#define NEAR(a, b, eps) do { double a_ = (a), b_ = (b); checks++; if (!(std::fabs(a_ - b_) <= (eps))) { fails++; std::printf("FAIL %s:%d  %s = %.17g, want %.17g\n", __FILE__, __LINE__, #a, a_, b_); } } while (0)

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

int main(int argc, char** argv) {
  if (argc > 1 && std::string(argv[1]) == "--scale") { scaleTable(); return 0; }
  rng(); onepole(); dc(); clip(); pan(); delay(); echo(); biquad(); json(); reverb(); scaleBasics(); host(); firm(); firmSend(); firmIds(); knee(); resonator(); stepclock(); cymWorld(); cymModel();
  std::printf("sdk-test: %d checks, %d failed\n", checks, fails);
  return fails ? 1 : 0;
}
