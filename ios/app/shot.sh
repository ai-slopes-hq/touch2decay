#!/usr/bin/env bash
# Снимок Firmamentum в симуляторе: xcodegen → сборка → запуск с -shot firmamentum → через 5 с скриншот в .shots/ios-firmamentum.png.
set -euo pipefail
cd "$(dirname "$0")"
DEV="iPhone 16"
xcodegen
xcodebuild -project T2D.xcodeproj -scheme T2D -sdk iphonesimulator -destination "platform=iOS Simulator,name=$DEV" -derivedDataPath build build
if ! xcrun simctl list devices booted | grep -q "$DEV"; then xcrun simctl boot "$DEV"; fi
xcrun simctl install booted build/Build/Products/Debug-iphonesimulator/T2D.app
xcrun simctl terminate booted dev.uvarov.t2d 2>/dev/null || true
mkdir -p ../../.shots
xcrun simctl launch --console-pty booted dev.uvarov.t2d -shot firmamentum >/dev/null 2>&1 &
sleep 5
xcrun simctl io booted screenshot ../../.shots/ios-firmamentum.png
xcrun simctl terminate booted dev.uvarov.t2d 2>/dev/null || true
