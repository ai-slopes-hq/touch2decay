// AD — перкуссионная огибающая «удар и затухание», как цепочка AudioParam у гула Cymatica,
// зёрен Paradisus, Tria, Natura:
//
//   0 → линейно до peak за A → экспоненциально до floor к A + D → линейно до 0 к A + D + tail
//
// Времена A, D, tail — в секундах. Кадр k после start() звучит значением в момент k/sr
// (первый кадр — момент 0). Огибающая кончилась — active() == false, step() всегда 0.
//
// ЛОВУШКИ:
//   - peak ≠ 0, floor > 0 и того же знака, что peak: экспонента к нулю не доходит (как exponentialRamp
//     в Web Audio), поэтому после неё — линейный хвост tail до нуля.
//   - start() во время звучания начинает с нуля сразу — скачок, щелчок. Нужен мягкий перезапуск —
//     дай старой огибающей дозвучать в другом голосе.
//   - sr ≤ 0 заменяется на 48000.
// Цена — pow на каждом сэмпле спада D: на сотнях голосов заметно.
#pragma once
#include <cmath>

namespace sdk {

class AD {
 public:
  void start(double sr, double peak, double A, double D, double floor, double tail) {
    sampleRate_ = sr > 0 ? sr : 48000; peak_ = peak; attack_ = A; decay_ = D; floor_ = floor; tail_ = tail;
    frame_ = 0; running_ = true;
  }
  bool active() const { return running_; }

  double step() {
    if (!running_) return 0;
    const double t = frame_++ / sampleRate_;
    if (t < attack_) return attack_ > 0 ? peak_ * t / attack_ : peak_;
    if (t < attack_ + decay_) return peak_ * std::pow(floor_ / peak_, (t - attack_) / decay_);
    if (t < attack_ + decay_ + tail_) return floor_ * (1 - (t - attack_ - decay_) / tail_);
    running_ = false;
    return 0;
  }

 private:
  double sampleRate_ = 48000, peak_ = 1, attack_ = 0, decay_ = 0, floor_ = 0, tail_ = 0;
  double frame_ = 0;                                    // номер кадра от start()
  bool running_ = false;
};

}  // namespace sdk
