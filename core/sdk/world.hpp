// Интерфейс мира SDK: всё, что хост знает о мире. Мир — модель + звук в одном объекте, без DOM и Web Audio.
// Правила: process пишет out.* целиком (не прибавляет); посыл — уже с ручкой мира, фейдер микшера применяет хост.
// Время модели — в сэмплах process, шаг — раз в блок (n ≤ 128). action и process — в одном потоке.
#pragma once
#include <cstdint>
#include <string>
#include "reverb.hpp"                                   // Rev — одно определение, здесь не повторяем
#include "transport.hpp"

namespace sdk {

// Код LFO строки для всех миров (host): action(ACT_LFO, obj, [key, v], 2), v 0…1; obj −1 — строка мира (FX), obj ≥ 0 — объект.
// Мир, который его не знает, игнорирует. Вне кодов миров (у них свои Act с 0) и не −1 (тик моделей: action(−1, 0, [dt], 1), Host::modelTick).
constexpr int ACT_LFO = -2;

struct Out { float* L; float* R; float* sL; float* sR; };   // сухое стерео и посыл (в ревербер rev())

class World {
 public:
  virtual ~World() = default;
  virtual void prepare(double sr, uint32_t seed) = 0;
  virtual void action(int kind, int i, const double* a, int n) = 0;   // касания и ручки от UI (коды — у мира)
  virtual void process(const Out& out, int n) = 0;                     // n ≤ 128; время модели идёт здесь
  virtual Rev rev() const = 0;                                          // куда идёт посыл
  virtual int mirror(double* buf, int cap) const = 0;                   // зеркало состояния для UI; раскладка — у мира
  virtual int heard(double* buf, int cap) = 0;                          // что услышано (вспышки) с прошлого вызова; очищает
  virtual std::string snapshot() const = 0;                             // JSON — тот же, что был у model.js
  virtual void restore(const std::string& js) = 0;
  virtual bool sounding() const = 0;
  virtual double trim() const { return 1; }                             // множитель сухого выхода в миксе (в вебе — узел перед каналом мира)
  virtual void attach(const Clock*) {}                                  // часы хоста (время блока, сетка MIDI) — мирам с шагами
};

}  // namespace sdk
