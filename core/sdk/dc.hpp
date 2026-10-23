// Общий фильтр постоянной составляющей: y = x − x1 + R·y1 (R по умолчанию 0.995, как в worklet-ах).
#pragma once

namespace sdk {

struct DcBlock {
  double R = 0.995, x1 = 0, y1 = 0;
  double step(double x) {
    double y = x - x1 + R * y1;
    x1 = x; y1 = y;
    return y;
  }
};

}  // namespace sdk
