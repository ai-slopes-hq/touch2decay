// Arcadia — мир SDK, см. world.hpp.
#include "world.hpp"

#include <cmath>
#include "../../sdk/json.hpp"

namespace arcadia {

static const sdk::Chorus<2, 4096>::Line LINES[2] = {{0.013, 0.27, -0.8, 0.0035}, {0.019, 0.19, 0.8, 0.0045}};

void World::prepare(double sr, uint32_t seed) {
  sr_ = sr > 0 ? sr : 48000;
  model_.reset();                                       // страна SEED0 — сразу
  sound_.prepare(sr_, seed + 1);                        // ГСЧ голосов (фаза блуждания, дрожь петли) — своё
  sound_.land(model_.cur(), true);
  double base[6];
  for (int i = 0; i < 6; i++) base[i] = 320 * std::pow(1.7, i);   // 320 * 1.7 ** i, как в engine.js
  phaser_.prepare(sr_, base, 0.6, 0.11, 0);
  chorus_.prepare(sr_, LINES, 1);
  c_ = 1 - std::exp(-1 / (0.05 * sr_));
  chDry_ = sdk::OnePole(); chDry_.y = 1;                // GainNode-ы до первого setTargetAtTime: сухое 1, посыл 0
  hallG_ = sdk::OnePole();
  for (double& f : f_) f = 0;
  quiet_ = 0;
  applyFx();
}

void World::applyFx() {
  const double ph = model_.fx(PHASER), ch = model_.fx(CHORUS), h = model_.fx(HALL);
  sound_.params(model_.fx(RELIEF), 0.01 * std::pow(40.0, model_.fx(PACE)), model_.fx(WIND), model_.fx(SPREAD));
  phOn_ = ph > 0.01; chOn_ = ch > 0.01;                 // выключенные — отцеплены, не считаются
  phaser_.set(ph * 0.95, 150 + 650 * ph);
  chorus_.set(ch * 0.75, 1);
  chDryTo_ = 1 - ch * 0.3;
  hallTo_ = h * h * HALL_K;
}

void World::sendT(int slot, bool on, bool withRoute) {  // как sendT прежнего engine.js; путь считает модель — по звучащей стране
  if (withRoute) model_.route(slot);
  const Trav& t = model_.t(slot);
  const double* k = t.k;
  Sound::Msg m{on, model_.hzOf(slot), k[U], k[V], k[R], k[FIG], k[LVL] * 0.7, k[MODE], k[SP], k[U] * 0.8, withRoute, t.route, t.n};
  f_[slot] = m.f;
  sound_.voice(slot, m);
  if (on) quiet_ = 0;
}

void World::addT(int slot, const double* k) { if (model_.add(slot, k)) sendT(slot, true, true); }
void World::dropT(int slot) { if (slot < 0 || slot >= VMAX || !model_.t(slot).on) return; sendT(slot, false, false); model_.drop(slot); }

void World::action(int kind, int i, const double* a, int n) {
  const auto arg = [&](int k, double d) { return (a && k < n) ? a[k] : d; };
  const bool live = i >= 0 && i < VMAX && model_.t(i).on;
  switch (kind) {
    case ADD: {
      if (n < 2) break;
      double k[NKEY];
      for (int j = 0; j < NKEY; j++) k[j] = arg(j, KEY_DEF[j]);
      addT(i, k);
      break;
    }
    case DROP: dropT(i); break;
    case MOVE: if (live && n >= 2) { model_.move(i, a[0], a[1]); sendT(i, true, true); } break;
    case SET: if (live && n >= 2) { model_.set(i, static_cast<int>(a[0]), a[1]); sendT(i, true, arg(2, 0) != 0); } break;
    case FX: if (n >= 1) { model_.setFx(i, a[0]); applyFx(); } break;
    case LAND:
      if (n >= 1) {
        model_.newLand(static_cast<uint32_t>(a[0]));
        for (int j = 0; j < model_.count(); j++) sendT(model_.order(j), true, true);   // как newLand модели: голоса заново (путь — пока по звучащей)
      }
      break;
    case CLEAR: clear(); break;
    default: break;
  }
}

void World::restore(const std::string& js) {            // как restore модели: очистить, страна (если другая), странники, fx
  using sdk::Json;
  bool ok = false;
  const Json st = Json::parse(js, &ok);
  if (!ok || st.type != Json::Obj) return;
  clear();
  const Json* sd = st.get("seed");
  if (sd && sd->type == Json::Num && static_cast<uint32_t>(sd->n) != model_.seed()) model_.newLand(static_cast<uint32_t>(sd->n));
  if (const Json* arr = st.get("t"); arr && arr->type == Json::Arr) {
    for (const Json& q : arr->a) {
      if (q.type != Json::Obj) continue;
      const int slot = model_.freeSlot();
      if (slot < 0) break;
      double k[NKEY];
      for (int j = 0; j < NKEY; j++) { const Json* x = q.get(KEY_NAMES[j]); k[j] = x && x->type == Json::Num ? x->n : KEY_DEF[j]; }
      addT(slot, k);
    }
  }
  if (const Json* fx = st.get("fx"); fx && fx->type == Json::Obj)
    for (int k = 0; k < NFX; k++) { const Json* x = fx->get(FX_NAMES[k]); if (x && x->type == Json::Num) model_.setFx(k, x->n); }
  applyFx();
}

void World::process(const sdk::Out& out, int n) {
  if (n <= 0) return;
  if (n > 128) n = 128;
  if (model_.stepLand()) {                              // новая страна готова: перетекание, пути по ней
    sound_.land(model_.cur(), false);
    for (int j = 0; j < model_.count(); j++) sendT(model_.order(j), true, true);
  }
  const bool live = sound_.process(pL_, pR_, n);
  quiet_ = live ? 0 : quiet_ + n;
  if (quiet_ > sr_ / 2) {                               // полсекунды тишины: хвосты фейзера и хора отзвучали — шина не считается
    chDry_.y = chDryTo_; hallG_.y = hallTo_;
    phaser_.process(pL_, pR_, false, fL_, fR_, n);      // спят сами, их LFO идут
    chorus_.process(pL_, pR_, false, cL_, cR_, n);
    for (int k = 0; k < n; k++) {
      const double l = static_cast<double>(fL_[k]) + cL_[k], r = static_cast<double>(fR_[k]) + cR_[k];
      out.L[k] = static_cast<float>(l * OUT); out.R[k] = static_cast<float>(r * OUT);
      out.sL[k] = out.sR[k] = 0;
    }
    return;
  }
  phaser_.process(pL_, pR_, phOn_, fL_, fR_, n);        // pre → сухо + фейзер → mix (на месте в pL_/pR_)
  for (int k = 0; k < n; k++) { pL_[k] = static_cast<float>(static_cast<double>(pL_[k]) + fL_[k]); pR_[k] = static_cast<float>(static_cast<double>(pR_[k]) + fR_[k]); }
  chorus_.process(pL_, pR_, chOn_, cL_, cR_, n);
  for (int k = 0; k < n; k++) {                         // mix → сухо + хор → выход; mix → посыл (прежний out ×1.5 был и за возвратом зала)
    const double d = chDry_.step(chDryTo_, c_), g = hallG_.step(hallTo_, c_) * OUT;
    const double l = pL_[k], r = pR_[k];
    out.L[k] = static_cast<float>((l * d + cL_[k]) * OUT); out.R[k] = static_cast<float>((r * d + cR_[k]) * OUT);
    out.sL[k] = static_cast<float>(l * g); out.sR[k] = static_cast<float>(r * g);
  }
}

int World::mirror(double* buf, int cap) const {
  if (!buf || cap < MIRROR_N) return 0;
  double* p = buf;
  for (int k = 0; k < NFX; k++) *p++ = model_.fx(k);
  *p++ = model_.seed(); *p++ = model_.pending() ? 1 : 0;
  for (int s = 0; s < VMAX; s++) {
    const Trav& t = model_.t(s);
    *p++ = t.on ? 1 : 0;
    for (int k = 0; k < NKEY; k++) *p++ = t.k[k];
    *p++ = f_[s];
    double cx, cy, rs;
    sound_.center(s, cx, cy, rs);
    *p++ = cx; *p++ = cy; *p++ = rs; *p++ = sound_.gain(s);
  }
  return MIRROR_N;
}

}  // namespace arcadia
