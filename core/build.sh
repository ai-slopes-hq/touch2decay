#!/usr/bin/env bash
# Сборка ядра: render-cli и sdk-test (нативно, для сверки) и t2d.wasm (в корень, рядом с t2d-worklet.js). Запуск из любой папки: core/build.sh
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p core/build
# emcc до 3.1.25 (например, 3.1.6 из apt) знает размер стека как TOTAL_STACK, новые — как STACK_SIZE
STACK=STACK_SIZE
if [ "$(printf '%s\n' "$(emcc -dumpversion)" 3.1.25 | sort -V | head -1)" != 3.1.25 ]; then STACK=TOTAL_STACK; fi
clang++ -std=c++17 -O2 -ffp-contract=off -Wall -Wextra -o core/build/render-cli core/render-cli/main.cpp core/worlds/goetia/goetia.cpp core/worlds/firmamentum/sound.cpp core/worlds/oceanus/ocean.cpp core/host/scale.cpp core/worlds/cymatica/model.cpp core/worlds/cymatica/plate.cpp core/worlds/cymatica/world.cpp
echo "core/build/render-cli"
clang++ -std=c++17 -O2 -ffp-contract=off -Wall -Wextra -o core/build/sdk-test core/tests/sdk_test.cpp core/sdk/reverb.cpp core/host/host.cpp core/host/scale.cpp \
  core/worlds/firmamentum/model.cpp core/worlds/firmamentum/world.cpp core/worlds/firmamentum/sound.cpp \
  core/worlds/monochord/model.cpp core/worlds/monochord/world.cpp core/worlds/monochord/sound.cpp core/worlds/cymatica/model.cpp core/worlds/cymatica/plate.cpp core/worlds/cymatica/world.cpp
echo "core/build/sdk-test"
clang++ -std=c++17 -O2 -ffp-contract=off -Wall -Wextra -o core/build/param-cli core/tests/param_cli.cpp
echo "core/build/param-cli"
# t2d.wasm — хост SDK и все миры SDK (Monochordum, Oceanus, Horologium, Firmamentum, Tria, Arcadia, Goetia) одним модулем (core/bridge/wasm.cpp); хост ~1.2 МБ статики — память 16 МБ (линии эха Cymatica ~7 МБ); em++ — нужен libc++ (std::string снимка)
em++ -O3 -std=c++17 -ffp-contract=off -fno-exceptions -Wall -sSTANDALONE_WASM --no-entry \
  -sEXPORTED_FUNCTIONS=_t2d_init,_t2d_args,_t2d_action,_t2d_process,_t2d_dry,_t2d_ret,_t2d_ext,_t2d_mbuf,_t2d_mirror,_t2d_heard,_t2d_str_buf,_t2d_str_cap,_t2d_snapshot,_t2d_restore,_t2d_fader,_t2d_scale,_t2d_time,_t2d_midi_byte,_t2d_midi_msg,_t2d_hmirror,_t2d_hevents,_t2d_arc_land \
  -sFILESYSTEM=0 -sINITIAL_MEMORY=16MB -s$STACK=64KB -sALLOW_MEMORY_GROWTH=0 \
  -o t2d.wasm core/bridge/wasm.cpp core/sdk/reverb.cpp core/host/host.cpp core/host/scale.cpp \
  core/worlds/firmamentum/model.cpp core/worlds/firmamentum/world.cpp core/worlds/firmamentum/sound.cpp \
  core/worlds/oceanus/model.cpp core/worlds/oceanus/world.cpp core/worlds/oceanus/ocean.cpp \
  core/worlds/goetia/model.cpp core/worlds/goetia/world.cpp core/worlds/goetia/goetia.cpp \
  core/worlds/monochord/model.cpp core/worlds/monochord/world.cpp core/worlds/monochord/sound.cpp \
  core/worlds/horologium/model.cpp core/worlds/horologium/world.cpp core/worlds/horologium/sound.cpp \
  core/worlds/arcadia/land.cpp core/worlds/arcadia/model.cpp core/worlds/arcadia/world.cpp core/worlds/arcadia/sound.cpp \
  core/worlds/tria/model.cpp core/worlds/tria/world.cpp \
  core/worlds/cymatica/model.cpp core/worlds/cymatica/plate.cpp core/worlds/cymatica/world.cpp
echo "t2d.wasm ($(wc -c < t2d.wasm | tr -d ' ') bytes)"
