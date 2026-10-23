// Тесты блоков core/sdk — без библиотек: свои CHECK, код выхода ≠ 0 при провале. Эталонные числа (Rng, Biquad) посчитаны в Node
// независимо: Rng — rnd() из tools/ref/pulsar-worklet.js, Biquad — формулы Web Audio (BiquadFilterNode), sr = 48000.
#include <cmath>
#include <complex>
#include <cstdio>
#include <vector>
#include "../sdk/biquad.hpp"
#include "../sdk/clip.hpp"
#include "../sdk/dc.hpp"
#include "../sdk/delay.hpp"
#include "../sdk/json.hpp"
#include "../sdk/pan.hpp"
#include "../sdk/rng.hpp"
#include "../sdk/smooth.hpp"

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

int main() {
  rng(); onepole(); dc(); clip(); pan(); delay(); biquad(); json();
  std::printf("sdk-test: %d checks, %d failed\n", checks, fails);
  return fails ? 1 : 0;
}
