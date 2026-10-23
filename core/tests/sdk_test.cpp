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
#include "../sdk/delay.hpp"
#include "../sdk/json.hpp"
#include "../sdk/pan.hpp"
#include "../sdk/reverb.hpp"
#include "../sdk/rng.hpp"
#include "../sdk/smooth.hpp"
#include "../sdk/world.hpp"
#include "../host/host.hpp"
#include "../host/scale.hpp"

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

int main(int argc, char** argv) {
  if (argc > 1 && std::string(argv[1]) == "--scale") { scaleTable(); return 0; }
  rng(); onepole(); dc(); clip(); pan(); delay(); biquad(); json(); reverb(); scaleBasics(); host();
  std::printf("sdk-test: %d checks, %d failed\n", checks, fails);
  return fails ? 1 : 0;
}
