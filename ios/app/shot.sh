#!/usr/bin/env bash
# Снимок в симуляторе: shot.sh [сцена] (firmamentum | topbar | scales | legend | sheet | starsheet | lfo | undo | map | nav | peek | concordia | mixer | audio | oceanus | oceanus-sheet | oceanus-luna | oceanus-fan | monochord | monochord-sheet | monochord-earth-sheet | monochord-wind | monochord-fan | horologium | horologium-ring-sheet | horologium-hub-sheet | horologium-fan | horologium-spin | arcadia | arcadia-land | arcadia-held | arcadia-held-rim | arcadia-sheet | arcadia-fan | tria | tria-lux | tria-fall | tria-held | tria-sheet | tria-fan | inferno | inferno-held | inferno-sheet | inferno-fx | inferno-storm | inferno-fan; по умолчанию firmamentum):
# xcodegen → сборка → запуск с -shot <сцена> → через 5 с скриншот в .shots/ios-<сцена>.png.
set -euo pipefail
SCENE="${1:-firmamentum}"
cd "$(dirname "$0")"
DEV="iPhone 16"
xcodegen
xcodebuild -project T2D.xcodeproj -scheme T2D -sdk iphonesimulator -destination "platform=iOS Simulator,name=$DEV" -derivedDataPath build build
if ! xcrun simctl list devices booted | grep -q "$DEV"; then xcrun simctl boot "$DEV"; fi
xcrun simctl bootstatus "$DEV" -b >/dev/null
xcrun simctl install booted build/Build/Products/Debug-iphonesimulator/T2D.app
xcrun simctl terminate booted dev.uvarov.t2d 2>/dev/null || true
mkdir -p ../../.shots
xcrun simctl launch --console-pty booted dev.uvarov.t2d -shot "$SCENE" > ../../.shots/ios-$SCENE.log 2>&1 &
sleep 5
xcrun simctl io booted screenshot ../../.shots/ios-$SCENE.png
xcrun simctl terminate booted dev.uvarov.t2d 2>/dev/null || true
