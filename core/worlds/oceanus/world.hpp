// Oceanus — мир SDK: модель (model.hpp) + сканирующий синтез (ocean.hpp, без изменений) + шина. События модели правят звук, как
// worlds/oceanus/engine.js до SDK B: город целиком (hz, lvl·0.8, path), fx → параметры кольца (sendParams) и посыл в зал,
// палец по воде — push(id, a, d, 0.06) / release, всплеск. Шина: сухой выход — звук ×1.6; посыл — звук × hall²·1.4 (сглаженный,
// как setTargetAtTime 0.05 с) ×1.6 (прежний out после возврата зала), ревербер — hall. Коды action и раскладка зеркала — здесь;
// фасад в JS (worlds/oceanus/model.js, tools/models/oceanus-core.mjs) — те же.
#pragma once
#include "../../sdk/smooth.hpp"
#include "../../sdk/world.hpp"
#include "model.hpp"
#include "ocean.hpp"

namespace oceanus {

// action(kind, i, a, n):
//   ADD     a = [ang, rn, pinned, slot?, id?]   — slot / id от UI (правило — Model::add)
//   DROP    i = id
//   MOVE    i = id, a = [ang, rn]
//   SET     i = id, a = [key (Key: lvl, oct, path, pinned), v]
//   FX      i = key (Fx: tension … hall), a = [v]
//   LUNA    i = key (Luna: orbit, storm, sway, to), a = [v]
//   PUSH    a = [id пальца, a — доля круга, d — куда тянуть]
//   RELEASE a = [id пальца]
//   SPLASH  a = [a, amt]
//   CLEAR, DICE
//   ACT_LFO (sdk) i = -1, a = [4 + Fx, v]       — LFO строки FX; i ≥ 0 и ключ вне [4, 9) — пропуск
//   WAKE                                         — вход в мир: кольцо оживает (как прежний worklet, который заводился при входе)
enum Act { ADD, DROP, MOVE, SET, FX, LUNA, PUSH, RELEASE, SPLASH, CLEAR, DICE, WAKE };

// зеркало: fx [NFX], luna [NLUNA], moon (доля круга), форма кольца [N], число городов,
// затем на город VOICE_N чисел: slot, id, ang, rn, pinned, lvl, oct, path, hz, gain (громкость голоса — свечение города)
constexpr int MIRROR_HEAD = NFX + NLUNA + 1 + N + 1, VOICE_N = 10, MIRROR_MAX = MIRROR_HEAD + VMAX_M * VOICE_N;
static_assert(VMAX_M == VMAX, "город — голос");
constexpr uint32_t SOUND_SEED = 0x85EBCA6Bu;            // зерно звука — зерно мира ^ это (у модели — само зерно)
constexpr double OUT = 1.6, HALL_K = 1.4;

class Oceanus : public sdk::World {
 public:
  explicit Oceanus(const Scale& scale) : model_(scale) { model_.listen(&Oceanus::onEvent, this); }
  void prepare(double sr, uint32_t seed) override;
  void action(int kind, int i, const double* a, int n) override;
  void process(const sdk::Out& out, int n) override;
  sdk::Rev rev() const override { return sdk::Rev::hall; }
  int mirror(double* buf, int cap) const override;
  int heard(double*, int) override { return 0; }        // услышанного нет: view читает форму, луну и уровни из зеркала
  std::string snapshot() const override { return model_.snapshot(); }
  void restore(const std::string& js) override { model_.restore(js); }
  bool sounding() const override { return model_.count() > 0; }
  const Model& model() const { return model_; }
  bool awake() const { return awake_; }

 private:
  static void onEvent(void* self, const Ev& e) { static_cast<Oceanus*>(self)->on(e); }
  void on(const Ev& e);
  void applyFx();

  Model model_;
  Ocean sound_{48000, 1};
  sdk::OnePole hall_;
  double hallTo_ = 0, c_ = 0, sr_ = 48000;
  bool awake_ = false;                                  // кольцо спит до входа в мир или первого города / пальца: тишина, физика стоит (~0.6 % ядра CPU)
};

}  // namespace oceanus
