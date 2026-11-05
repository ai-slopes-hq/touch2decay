// Евклидов ритм: k ударов на n шагов, равномерно (Bjorklund в форме (j·k) mod n < k).
// Шаг 0 бьёт всегда, если k > 0; k = n — все шаги; k = 0 — тишина. Нужно n ≥ 1 и 0 ≤ j < n.
#pragma once

namespace sdk {

inline bool euclid(int j, int k, int n) { return (j * k) % n < k; }

}  // namespace sdk
