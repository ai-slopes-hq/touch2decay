// Goetia — модель в ядре, см. model.hpp.
#include "model.hpp"

#include <algorithm>
#include <cmath>
#include "../../sdk/json.hpp"
#include "goetia.hpp"

namespace goetia {

const char* const FX_NAMES[NFX] = {"legio", "echo", "spread", "hall"};
const double FX_DEF[NFX] = {0.35, 0.2, 0.6, 0.4};
// узлы по кругу от верха по часовой: | VIII, & V, ^ X, + VI, * XI, − IV, % IX, >> VII (NODES в model.js)
const int NODE_OP[8] = {OR, AND, XOR, ADD, MUL, SUB, MOD, SHR};
const int NODE_SH[8] = {8, 5, 10, 6, 11, 4, 9, 7};
static const char* const KEY_NAMES[NKEY] = {"semi", "tone", "rel", "legio", "lvl"};

void Model::reset(uint32_t seed) {
  rng_ = sdk::Rng(seed);
  n_ = 0; bornSeq_ = 0;
  for (int k = 0; k < NFX; k++) fx_[k] = FX_DEF[k];
}

double Model::semi(const Spirit& s) const { return scale_.on ? scale_.snapSemi(s.semi + 24) - 24 : s.semi; }
double Model::rate(const Spirit& s) const { return 128 * 55 * std::pow(2.0, semi(s) / 12); }
int Model::trig(const Spirit& s) {
  int t = 9;
  for (int q = 0; q < s.np; q++) t = std::max(t, NODE_SH[s.path[q]]);
  return t;
}
double Model::fc(const Spirit& s) { return 250 * std::pow(12000.0 / 250, s.tone); }

Spirit* Model::find(int born) {
  for (int i = 0; i < n_; i++) if (ss_[i].born == born) return &ss_[i];
  return nullptr;
}

static int clampPath(const int* path, int np, int* out) {   // узлы 0…7, не больше SEAL_MAX
  int n = 0;
  for (int q = 0; q < np && n < SEAL_MAX; q++) out[n++] = path[q] < 0 ? 0 : path[q] > 7 ? 7 : path[q];
  return n;
}

Spirit* Model::summon(const int* path, int np, double semi, double tone, double rel, int legio, double lvl, int slot, int born) {
  bool used[SMAX] = {};
  for (int i = 0; i < n_; i++) used[ss_[i].slot] = true;
  if (slot < 0 || slot >= SMAX || used[slot]) {
    slot = -1;
    for (int k = 0; k < SMAX; k++) if (!used[k]) { slot = k; break; }
  }
  if (slot < 0) {                                       // все треугольники заняты — уходит самый старый
    int old = 0;
    for (int i = 1; i < n_; i++) if (ss_[i].born < ss_[old].born) old = i;
    slot = ss_[old].slot;
    banishAt(old);
  }
  if (born <= 0 || find(born)) born = bornSeq_ + 1;
  if (born > bornSeq_) bornSeq_ = born;
  Spirit& s = ss_[n_++];
  s = Spirit{};
  s.slot = slot; s.born = born;
  s.np = clampPath(path, np, s.path);
  s.semi = semi; s.tone = tone; s.rel = rel; s.legio = legio; s.lvl = lvl;
  emit(Ev::SPIRIT, &s, true, true);
  return &s;
}

void Model::banishAt(int i) {                           // как banish: событие — до того, как дух ушёл из списка
  emit(Ev::SPIRIT, &ss_[i], false);
  for (int j = i; j + 1 < n_; j++) ss_[j] = ss_[j + 1];
  n_--;
}

void Model::banish(int born) {
  for (int i = 0; i < n_; i++) if (ss_[i].born == born) { banishAt(i); return; }
}

void Model::setPath(int born, const int* path, int np) {
  Spirit* s = find(born);
  if (!s) return;
  s->np = clampPath(path, np, s->path);
  emit(Ev::SPIRIT, s);
}

void Model::set(int born, int key, double v) {
  Spirit* s = find(born);
  if (!s) return;
  switch (key) {
    case SEMI: s->semi = v; break;
    case TONE: s->tone = v; break;
    case REL: s->rel = v; break;
    case LEGIO_N: s->legio = static_cast<int>(v); break;
    case LVL: s->lvl = v; break;
    default: return;
  }
  emit(Ev::SPIRIT, s);
}

void Model::setFx(int k, double v) { if (k < 0 || k >= NFX) return; fx_[k] = v; emit(Ev::FX, nullptr); }

void Model::clear() { while (n_) banishAt(0); }

int Model::randPath(int* p) {                           // печать: 3–5 узлов, без повторов
  const int n = 3 + static_cast<int>(std::floor(rng_.next() * 3));
  int len = 0;
  p[len++] = static_cast<int>(std::floor(rng_.next() * 8));
  while (len < n) {
    const int k = static_cast<int>(std::floor(rng_.next() * 8));
    bool dup = false;
    for (int q = 0; q < len; q++) if (p[q] == k) dup = true;
    if (k != p[len - 1] && !dup) p[len++] = k;
  }
  return len;
}

void Model::dice() {                                    // два-три духа: случайные печати, высоты от тоники; половина — удары
  clear();
  static const double SEMIS[6] = {-12, -5, 0, 0, 7, 12};
  const int n = 2 + (rng_.next() < 0.4 ? 1 : 0);
  for (int k = 0; k < n; k++) {
    int p[SEAL_MAX];
    const int np = randPath(p);                         // порядок вызовов rng — как в литерале объекта эталона
    const double semi = SEMIS[static_cast<int>(std::floor(rng_.next() * 6))];
    const double tone = 0.3 + rng_.next() * 0.3;
    const double rel = rng_.next() < 0.5 ? 1 : 0.1 + rng_.next() * 0.55;
    const int legio = rng_.next() < 0.5 ? 1 : 2;
    summon(p, np, semi, tone, rel, legio, 0.7);
  }
}

std::string Model::snapshot() const {
  using sdk::Json;
  Json st = Json::object(), arr = Json::array(), fx = Json::object();
  for (int i = 0; i < n_; i++) {
    const Spirit& s = ss_[i];
    Json o = Json::object(), path = Json::array();
    for (int q = 0; q < s.np; q++) path.push(Json::num(s.path[q]));
    o.set("slot", Json::num(s.slot));
    o.set("path", std::move(path));
    const double v[NKEY] = {s.semi, s.tone, s.rel, static_cast<double>(s.legio), s.lvl};
    for (int k = 0; k < NKEY; k++) o.set(KEY_NAMES[k], Json::num(v[k]));
    arr.push(std::move(o));
  }
  for (int k = 0; k < NFX; k++) fx.set(FX_NAMES[k], Json::num(fx_[k]));
  st.set("s", std::move(arr));
  st.set("fx", std::move(fx));
  return st.dump();
}

void Model::restore(const std::string& js) {
  using sdk::Json;
  bool ok = false;
  const Json st = Json::parse(js, &ok);
  if (!ok || st.type != Json::Obj) return;
  clear();
  const auto num = [](const Json& o, const char* k, double& v) { const Json* x = o.get(k); if (x && x->type == Json::Num) { v = x->n; return true; } return false; };
  if (const Json* arr = st.get("s"); arr && arr->type == Json::Arr) {
    for (const Json& q : arr->a) {
      if (q.type != Json::Obj) continue;
      int p[SEAL_MAX], np = 0;
      if (const Json* path = q.get("path"); path && path->type == Json::Arr)
        for (const Json& k : path->a) if (k.type == Json::Num && np < SEAL_MAX) p[np++] = static_cast<int>(k.n);
      double semi = 0, tone = 0.45, rel = 1, legio = 1, lvl = 0.8, slot = -1, born = 0;
      num(q, "semi", semi); num(q, "tone", tone); num(q, "rel", rel); num(q, "legio", legio); num(q, "lvl", lvl);
      num(q, "born", born);                             // необязательное: фасад в вебе шлёт свои born и slot
      if (q.get("born")) num(q, "slot", slot);          // в снимке slot есть, но эталон его не берёт (первый свободный) — как он
      summon(p, np, semi, tone, rel, static_cast<int>(legio), lvl, static_cast<int>(slot), static_cast<int>(born));
    }
  }
  if (const Json* fx = st.get("fx"); fx && fx->type == Json::Obj)
    for (int k = 0; k < NFX; k++) num(*fx, FX_NAMES[k], fx_[k]);
  emit(Ev::FX, nullptr);
}

}  // namespace goetia
