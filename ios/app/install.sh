#!/usr/bin/env bash
# Сборка Release для iPhone и установка по кабелю: xcodegen → xcodebuild → T2D.ipa → ideviceinstaller. Запуск из любой папки.
set -euo pipefail
cd "$(dirname "$0")"
xcodegen
xcodebuild -project T2D.xcodeproj -scheme T2D -configuration Release -sdk iphoneos -derivedDataPath build -allowProvisioningUpdates
rm -rf build/Payload build/T2D.ipa
mkdir -p build/Payload
cp -R build/Build/Products/Release-iphoneos/T2D.app build/Payload/
(cd build && zip -qry T2D.ipa Payload)
ideviceinstaller install build/T2D.ipa
