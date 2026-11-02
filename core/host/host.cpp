// Host — реализация. Что и в каком порядке — в шапке host.hpp.
#include "host.hpp"
#include <cmath>
#include <cstring>

using sdk::Rev;

static const Rev kTypes[4] = {Rev::room, Rev::plate, Rev::hall, Rev::cathedral};
static int revIndex(Rev r) { return static_cast<int>(r); }   // тип → номер ревербератора 0…3

void Host::prepare(double sr, uint32_t seed) {
  clock_ = sdk::Clock{}; clock_.sr = sr > 0 ? sr : 48000;
  for (auto& p : parsers_) p = sdk::ClockParser();
  follower_ = sdk::Follower(); evCount_ = 0;
  for (int i = 0; i < 4; i++) reverbs_[i].prepare(sr, kTypes[i], seed + static_cast<uint32_t>(i));
  for (int s = 0; s < SLOTS; s++) std::memset(dry_[s], 0, sizeof dry_[s]);
  std::memset(ext_, 0, sizeof ext_);
  std::memset(ret_, 0, sizeof ret_);

  // Мастер (по умолчанию как MIX_DEF веба: LPF 22 кГц, компрессор −10 дБ / колено 10 / 2.5, потолок 0 дБ)
  for (auto& f : hp_) f.set(sdk::Biquad::highpass, 30, 1, clock_.sr);
  masterLpf(22000);                                     // срез прежней сцены не переживает t2d_init
  for (auto& f : lpf_) f.reset();
  for (auto& f : hp_) f.reset();
  comp_.set(-10, 2.5, clock_.sr);
  comp_.reset();
  const sdk::Knee kn{2.6 / std::tanh(2.6), 0.6, 0.98 - 0.6};
  knee_.curve.build([&kn](double x) { return kn(x); });
  knee_.os = 4;
  knee_.reset();
  ceilGain_ = 1.0;
  volTarget_ = volNow_ = 1.0;
  volCoef_ = 1.0 - std::exp(-1.0 / (0.03 * clock_.sr));

  // LFO строк
  for (auto& l : lfos_) l.on = false;
  lost_ = 0;
  rng_ = sdk::Rng(0x51F0u);
  morphClassic_ = sdk::WaveMorph(sdk::WaveMorph::CLASSIC);
  morphRandom_ = sdk::WaveMorph(sdk::WaveMorph::RANDOM);
}

void Host::add(int slot, sdk::World* w) {
  if (slot < 0 || slot >= SLOTS) return;
  worlds_[slot] = w;
  fader_[slot] = w ? 1.f : 0.f;
  if (w) w->attach(&clock_);
}

// сообщение часов → Follower; его события — в очередь для events(), сетка — в часы миров
void Host::follow(const sdk::MidiMsg& m, double at) {
  int ev[2]; double bpm;
  const int k = follower_.message(m, at, clock_.now, ev, &bpm);
  for (int i = 0; i < k; i++) {
    if (evCount_ == EVMAX) {                            // очередь полна — старое уходит
      for (int j = 1; j < EVMAX; j++) { evQueue_[j - 1][0] = evQueue_[j][0]; evQueue_[j - 1][1] = evQueue_[j][1]; }
      evCount_--;
    }
    evQueue_[evCount_][0] = ev[i]; evQueue_[evCount_][1] = bpm; evCount_++;
  }
  clock_.grid = follower_.grid();
}

void Host::midiByte(int src, int status, double at) {
  if (status < 0xF8) return;                            // только системные реального времени
  const sdk::MidiMsg m = parsers_[(src % SRC + SRC) % SRC].byte(status, at);
  if (m.t != sdk::MidiMsg::NONE) follow(m, at);
}

void Host::midiMsg(int kind, double n, double bpm, double at) {
  sdk::MidiMsg m;
  m.t = static_cast<sdk::MidiMsg::Type>(kind < 0 || kind > 4 ? 0 : kind); m.n = n; m.bpm = bpm;
  if (m.t != sdk::MidiMsg::NONE) follow(m, at);
}

int Host::events(double* buf, int cap) {
  int k = 0;
  for (int i = 0; i < evCount_ && k + 2 <= cap; i++) { buf[k++] = evQueue_[i][0]; buf[k++] = evQueue_[i][1]; }
  evCount_ = 0;                                         // не влезшее в cap теряется
  return k;
}

void Host::action(int slot, int kind, int i, const double* a, int n) {
  if (slot >= 0 && slot < SLOTS && worlds_[slot]) worlds_[slot]->action(kind, i, a, n);
}

void Host::fader(int slot, double g) {
  if (slot >= 0 && slot < SLOTS && worlds_[slot]) fader_[slot] = static_cast<float>(g);   // пустому слоту фейдер не ставится
}

void Host::scale(bool on, int idx, int root) {
  scale_.on = on;
  scale_.idx = idx < 0 ? 0 : (idx >= Scale::kScales ? Scale::kScales - 1 : idx);
  scale_.root = ((root % 12) + 12) % 12;
}

float* Host::ext(Rev r, int ch) { return ext_[revIndex(r)][ch & 1]; }

const float* Host::dry(int slot, int ch) const {
  return dry_[(slot < 0 || slot >= SLOTS) ? 0 : slot][ch & 1];
}

const float* Host::ret(int ch) const { return ret_[ch & 1]; }

void Host::process(int n) {
  if (n > BLOCK) n = BLOCK;
  if (n < 0) n = 0;
  follower_.tick(clock_.now);                           // часы пропали (1 с без долей) — сетки нет
  clock_.grid = follower_.grid();
  const size_t bytes = sizeof(float) * static_cast<size_t>(n);
  for (int r = 0; r < 4; r++) for (int c = 0; c < 2; c++) std::memcpy(revIn_[r][c], ext_[r][c], bytes);   // внешние посылы — основа суммы
  for (int s = 0; s < SLOTS; s++) {
    if (!worlds_[s]) { std::memset(dry_[s], 0, sizeof dry_[s]); continue; }
    const sdk::Out out{dry_[s][0], dry_[s][1], sendL_, sendR_};
    worlds_[s]->process(out, n);
    const int r = revIndex(worlds_[s]->rev());
    const float g = fader_[s];                          // посыл после фейдера: заглушил мир — хвост дозвучит
    for (int i = 0; i < n; i++) { revIn_[r][0][i] += sendL_[i] * g; revIn_[r][1][i] += sendR_[i] * g; }
  }
  for (int r = 0; r < 4; r++) {
    for (int c = 0; c < 2; c++)                         // NaN / inf на входе навсегда отравил бы память ревербератора
      for (int i = 0; i < n; i++) if (!std::isfinite(revIn_[r][c][i])) revIn_[r][c][i] = 0.f;
    reverbs_[r].process(revIn_[r][0], revIn_[r][1], revOut_[r][0], revOut_[r][1], n);
  }
  for (int c = 0; c < 2; c++)
    for (int i = 0; i < n; i++) ret_[c][i] = (revOut_[0][c][i] + revOut_[1][c][i] + revOut_[2][c][i] + revOut_[3][c][i]) * RET;

  std::memset(ext_, 0, sizeof ext_);                    // внешние посылы — на один блок
  clock_.now += n / clock_.sr;                          // следующий блок — сразу за этим (веб перед каждым задаёт время сам)
}

void Host::sum(float* L, float* R, int n) const {
  if (n > BLOCK) n = BLOCK;
  if (n < 0) n = 0;
  for (int i = 0; i < n; i++) { L[i] = ret_[0][i]; R[i] = ret_[1][i]; }
  for (int s = 0; s < SLOTS; s++) {
    if (!worlds_[s]) continue;
    const float g = fader_[s] * static_cast<float>(worlds_[s]->trim());
    for (int i = 0; i < n; i++) { L[i] += dry_[s][0][i] * g; R[i] += dry_[s][1][i] * g; }
  }
}

void Host::masterRun(float* L, float* R, int n) {
  if (n > BLOCK) n = BLOCK;
  if (n < 0) n = 0;
  for (int i = 0; i < n; i++) {
    double l = L[i], r = R[i];
    if (!std::isfinite(l)) l = 0;                       // NaN отравил бы память фильтров навсегда
    if (!std::isfinite(r)) r = 0;
    l = lpf_[0].step(hp_[0].step(l));
    r = lpf_[1].step(hp_[1].step(r));
    comp_.run(l, r);
    volNow_ += (volTarget_ - volNow_) * volCoef_;       // громкость шагает к цели каждый сэмпл (без треска)
    const double amp = 0.8 * volNow_ * 0.5;             // masterG веба и limitIn
    l *= amp; r *= amp;
    knee_.run(l, r);
    L[i] = static_cast<float>(l * ceilGain_);
    R[i] = static_cast<float>(r * ceilGain_);
  }
}

void Host::masterLpf(double hz) {
  const double sr = clock_.sr, top = 0.45 * sr;
  const double cutoff = hz > top ? top : (hz < 10 ? 10 : hz);   // 22 кГц на 44.1 кГц — это Найквист
  for (auto& f : lpf_) f.set(sdk::Biquad::lowpass, cutoff, 0.5, sr);
}

void Host::masterComp(double thr, double ratio) { comp_.set(thr, ratio, clock_.sr); }

void Host::masterCeil(double db) {
  const double d = db > 0 ? 0 : (db < -12 ? -12 : db);
  ceilGain_ = std::pow(10.0, d / 20.0);
}

// Статическая кривая DynamicsCompressorKernel (Chromium): до порога прямая, затем экспоненциальное колено k, выше колена — наклон 1/ratio.
double Host::Comp::kneeCurve(double x, double kk) const { return x < thrLin ? x : thrLin + (1 - std::exp(-kk * (x - thrLin))) / kk; }

// выход по входу (линейно): колено, выше конца колена — прямая с наклоном slope в дБ
double Host::Comp::saturate(double x) const {
  if (x < std::pow(10.0, kneeDb / 20)) return kneeCurve(x, k);
  return std::pow(10.0, (yKneeDb + slope * (20 * std::log10(x) - kneeDb)) / 20);
}

// наклон кривой колена в точке x, дБ / дБ (численно, шаг 0.1 %)
double Host::Comp::slopeAt(double x, double kk) const {
  if (x < thrLin) return 1;
  const double x2 = x * 1.001, xDb = 20 * std::log10(x), x2Db = 20 * std::log10(x2);
  const double yDb = 20 * std::log10(kneeCurve(x, kk)), y2Db = 20 * std::log10(kneeCurve(x2, kk));
  return (y2Db - yDb) / (x2Db - xDb);
}

// порог и отношение; пересчитывает колено, авто-подъём и коэффициенты; память (кольцо, детектор) не трогает
void Host::Comp::set(double threshold, double ratioIn, double sr) {
  thr = threshold; ratio = ratioIn < 1 ? 1 : ratioIn;
  thrLin = std::pow(10.0, thr / 20);
  slope = 1.0 / ratio;
  kneeDb = thr + knee;
  const double x = std::pow(10.0, kneeDb / 20);
  double lo = 0.1, hi = 10000;                          // k, при котором наклон кривой в конце колена равен 1/ratio (бисекция, как у Chromium)
  k = 5;
  for (int i = 0; i < 15; i++) {
    if (slopeAt(x, k) < slope) hi = k; else lo = k;
    k = std::sqrt(lo * hi);
  }
  yKneeDb = 20 * std::log10(kneeCurve(x, k));
  makeup = std::pow(1.0 / saturate(1.0), 0.6);          // fullRangeMakeupGain^0.6 — включён всегда, и ниже порога
  attackCoef = 1 - std::exp(-1.0 / (attack * sr));
  releaseCoef = 1 - std::exp(-1.0 / (release * sr));
  detRelease = 0.0025 * sr;
  delay = static_cast<int>(0.006 * sr + 0.5);
  if (delay > LOOK - 1) delay = LOOK - 1;
}

void Host::Comp::run(double& l, double& r) {
  const double x = std::fmax(std::fabs(l), std::fabs(r));   // связанный детектор: одно усиление на оба канала
  double instant = 1;                                   // нужное затухание по кривой сейчас, линейное
  if (x > 1e-4) instant = saturate(x) / x;
  if (instant < detector) detector = instant;           // детектор Chromium: вниз — сразу, вверх — не медленнее 2 дБ за 2.5 мс
  else {
    const double perSample = std::fmax(2.0, -20 * std::log10(instant)) / detRelease;
    detector += (instant - detector) * (std::pow(10.0, perSample / 20) - 1);
    if (detector > 1) detector = 1;
  }
  const double target = detector < 1 ? 20 * std::log10(detector) : 0;   // желаемое усиление, дБ
  if (target < gainDb) gainDb += attackCoef * (target - gainDb);        // сжимаем сильнее — атака
  else if (gainDb < 0) { gainDb += releaseCoef * (target - gainDb); if (gainDb > 0) gainDb = 0; }   // отпускаем — релиз
  look[0][write] = static_cast<float>(l); look[1][write] = static_cast<float>(r);
  const int read = (write - delay + LOOK) % LOOK;      // сигнал идёт с задержкой, детектор — по входу (lookahead 6 мс)
  const double g = (gainDb < -1e-9 ? std::pow(10.0, gainDb / 20) : 1.0) * makeup;
  l = look[0][read] * g; r = look[1][read] * g;
  write = (write + 1) % LOOK;
}

sdk::RowLfo* Host::lfoFind(int slot, int obj, int key) {
  for (auto& l : lfos_) if (l.on && l.slot == slot && l.obj == obj && l.key == key) return &l;
  return nullptr;
}

bool Host::lfoAdd(int slot, int obj, int key, double base, int shape) {
  if (lfoFind(slot, obj, key)) return true;             // тройка уже есть — ничего (rate / depth не сбрасываем)
  for (auto& l : lfos_) {
    if (l.on) continue;
    l.on = true;
    l.slot = slot; l.obj = obj; l.key = key; l.base = base;
    l.shape = shape == 1 ? sdk::WaveMorph::RANDOM : sdk::WaveMorph::CLASSIC;
    l.morph = l.shape == sdk::WaveMorph::RANDOM ? 0.6 : 0.0;   // умолчания — как у host/sl.js
    l.rate = l.shape == sdk::WaveMorph::RANDOM ? 0.4 : 0.8;
    l.depth = 0.3; l.u = 0;
    l.seed = static_cast<int>(rng_.next() * 1000.0);
    return true;
  }
  lost_++;
  return false;
}

void Host::lfoSpec(int slot, int obj, int key, double morph, double rate, double depth) {
  sdk::RowLfo* l = lfoFind(slot, obj, key);
  if (!l) return;
  if (!std::isnan(morph)) l->morph = morph;             // NaN — не менять
  if (!std::isnan(rate)) l->rate = rate;
  if (!std::isnan(depth)) l->depth = depth;
}

void Host::lfoBase(int slot, int obj, int key, double base) {
  if (sdk::RowLfo* l = lfoFind(slot, obj, key)) l->base = base;
}

// значение миру тем же action, что касания; мир без звезды / ключа пропускает сам
void Host::lfoSend(const sdk::RowLfo& l, double v) {
  if (l.slot < 0 || l.slot >= SLOTS || !worlds_[l.slot]) return;
  const double a[2] = {static_cast<double>(l.key), v};
  worlds_[l.slot]->action(sdk::ACT_LFO, l.obj, a, 2);
}

void Host::lfoOff(int slot, int obj, int key) {
  sdk::RowLfo* l = lfoFind(slot, obj, key);
  if (!l) return;
  lfoSend(*l, l->base);                                 // строке — база
  l->on = false;
}

void Host::lfoDrop(int slot, int obj) {                 // без base; obj −1 (FX) не гасим никогда
  for (auto& l : lfos_) {
    if (!l.on || l.slot != slot || l.obj < 0) continue;
    if (obj == LFO_OBJS || l.obj == obj) l.on = false;
  }
}

void Host::lfoTick(double dt) {
  const sdk::WaveMorph* m[2] = {&morphClassic_, &morphRandom_};
  for (auto& l : lfos_) {
    if (!l.on) continue;
    l.u += dt * l.rate;
    lfoSend(l, l.value(*m[l.shape == sdk::WaveMorph::RANDOM ? 1 : 0]));
  }
}

int Host::lfoState(double* buf, int cap) const {
  int n = 0;
  for (const auto& l : lfos_) {
    if (!l.on || n + LFO_REC > cap) continue;
    double* p = buf + n;
    p[0] = l.slot; p[1] = l.obj; p[2] = l.key; p[3] = l.base; p[4] = l.morph;
    p[5] = l.rate; p[6] = l.depth; p[7] = l.u; p[8] = l.shape; p[9] = l.seed;
    n += LFO_REC;
  }
  return n;
}

double Host::lfoSample(int shape, double morph, double u, int seed) const {
  return (shape == 1 ? morphRandom_ : morphClassic_).sample(morph, u, seed);
}

void Host::modelTick(double dt) {
  const double a[1] = {dt};
  for (int s = 0; s < SLOTS; s++) {
    if (worlds_[s]) worlds_[s]->action(-1, 0, a, 1);    // kind −1 — тик модели
  }
}
