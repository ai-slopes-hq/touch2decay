#!/usr/bin/env bash
# Сборка ядра: render-cli (нативно, для сверки). Запуск из любой папки: core/build.sh
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p core/build
clang++ -std=c++17 -O2 -ffp-contract=off -Wall -Wextra -o core/build/render-cli core/render-cli/main.cpp core/worlds/goetia/goetia.cpp
echo "core/build/render-cli"
