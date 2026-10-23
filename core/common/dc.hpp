// Общий фильтр постоянной составляющей: y = x − x1 + 0.995·y1 (как в worklet-ах).
#pragma once

namespace core {

struct DcBlock {
  double x1 = 0, y1 = 0;
  double step(double x) {
    double y = x - x1 + 0.995 * y1;
    x1 = x; y1 = y;
    return y;
  }
};

}  // namespace core
