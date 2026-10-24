#!/usr/bin/env bash
# Сборка t2d.wasm без emscripten — на Linux через wasi-sdk (https://github.com/WebAssembly/wasi-sdk, проверено на 25.0): запасной путь,
# когда em++ нет под рукой (облачная сессия). Основной — core/build.sh на Mac. Результат тот же по звуку (wasm, -ffp-contract=off),
# но без wasm-opt: файл крупнее (~2 МБ), три импорта wasi_snapshot_preview1 (fd_write, fd_seek, fd_close) закрывают заглушки в JS.
# WASI_SDK — папка wasi-sdk (по умолчанию /opt/wasi-sdk). Запуск из любой папки: WASI_SDK=… core/build-wasi.sh
set -euo pipefail
cd "$(dirname "$0")/.."
SDK="${WASI_SDK:-/opt/wasi-sdk}"
EXPORTS=""
for f in t2d_init t2d_args t2d_action t2d_process t2d_dry t2d_ret t2d_ext t2d_mbuf t2d_mirror t2d_heard t2d_str_buf t2d_str_cap t2d_snapshot t2d_restore t2d_fader t2d_scale; do EXPORTS="$EXPORTS -Wl,--export=$f"; done
"$SDK/bin/clang++" --target=wasm32-wasip1 -mexec-model=reactor -O3 -std=c++17 -ffp-contract=off -fno-exceptions -Wall $EXPORTS \
  -Wl,--no-entry -Wl,--initial-memory=4194304 -Wl,--max-memory=4194304 -Wl,-z,stack-size=65536 \
  -o t2d.wasm core/bridge/wasm.cpp core/bridge/wasi.cpp core/sdk/reverb.cpp core/host/host.cpp core/host/scale.cpp \
  core/worlds/firmamentum/model.cpp core/worlds/firmamentum/world.cpp core/worlds/firmamentum/sound.cpp \
  core/worlds/cymatica/plate.cpp core/worlds/cymatica/world.cpp
echo "t2d.wasm ($(wc -c < t2d.wasm | tr -d ' ') bytes, wasi-sdk)"
