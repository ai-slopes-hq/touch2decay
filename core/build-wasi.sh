#!/usr/bin/env bash
# Сборка t2d.wasm без emscripten — на Linux через wasi-sdk (https://github.com/WebAssembly/wasi-sdk, проверено на 25.0): запасной путь,
# когда em++ нет под рукой (облачная сессия). Основной — core/build.sh на Mac. Результат тот же по звуку (wasm, -ffp-contract=off),
# но без wasm-opt: файл крупнее (~2 МБ), три импорта wasi_snapshot_preview1 (fd_write, fd_seek, fd_close) закрывают заглушки в JS.
# WASI_SDK — папка wasi-sdk (по умолчанию /opt/wasi-sdk). Запуск из любой папки: WASI_SDK=… core/build-wasi.sh
set -euo pipefail
cd "$(dirname "$0")/.."
SDK="${WASI_SDK:-/opt/wasi-sdk}"
EXPORTS=""
for f in t2d_init t2d_args t2d_action t2d_process t2d_dry t2d_ret t2d_ext t2d_mbuf t2d_mirror t2d_heard t2d_str_buf t2d_str_cap t2d_snapshot t2d_restore t2d_fader t2d_scale t2d_time t2d_midi_byte t2d_midi_msg t2d_hmirror t2d_hevents t2d_arc_land; do EXPORTS="$EXPORTS -Wl,--export=$f"; done
"$SDK/bin/clang++" --target=wasm32-wasip1 -mexec-model=reactor -O3 -std=c++17 -ffp-contract=off -fno-exceptions -Wall $EXPORTS \
  -Wl,--no-entry -Wl,--initial-memory=16777216 -Wl,--max-memory=16777216 -Wl,-z,stack-size=65536 \
  -o t2d.wasm core/bridge/wasm.cpp core/bridge/wasi.cpp core/sdk/reverb.cpp core/host/host.cpp core/host/scale.cpp \
  core/worlds/firmamentum/model.cpp core/worlds/firmamentum/world.cpp core/worlds/firmamentum/sound.cpp \
  core/worlds/oceanus/model.cpp core/worlds/oceanus/world.cpp core/worlds/oceanus/ocean.cpp \
  core/worlds/goetia/model.cpp core/worlds/goetia/world.cpp core/worlds/goetia/goetia.cpp \
  core/worlds/monochord/model.cpp core/worlds/monochord/world.cpp core/worlds/monochord/sound.cpp \
  core/worlds/horologium/model.cpp core/worlds/horologium/world.cpp core/worlds/horologium/sound.cpp \
  core/worlds/arcadia/land.cpp core/worlds/arcadia/model.cpp core/worlds/arcadia/world.cpp core/worlds/arcadia/sound.cpp \
  core/worlds/tria/model.cpp core/worlds/tria/world.cpp \
  core/worlds/portus/world.cpp \
  core/worlds/cymatica/model.cpp core/worlds/cymatica/plate.cpp core/worlds/cymatica/world.cpp
echo "t2d.wasm ($(wc -c < t2d.wasm | tr -d ' ') bytes, wasi-sdk)"
