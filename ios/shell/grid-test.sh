#!/bin/sh
# ПРОБА: тест сетки ведущих часов (Shell/Grid.swift) на Mac: swiftc без Xcode-проекта.
set -e
cd "$(dirname "$0")"
out=$(mktemp -d)
cat > "$out/main.swift" <<'EOF'
import Foundation
func check(_ got: Int, _ want: Int, _ what: String) { if got != want { print("FAIL \(what): \(got) != \(want)"); exit(1) } }
check(Grid.anchor(expected: 384, phase: 384), 384, "on time — as is")
check(Grid.anchor(expected: 386.4, phase: 384), 384, "small drift — same bar")
check(Grid.anchor(expected: 804, phase: 384), 768, "page fell 8 s behind — nearest bar with the same phase, no stall")
check(Grid.anchor(expected: 804, phase: 390), 774, "phase inside the bar is kept")
check(Grid.anchor(expected: 10, phase: 96), 0, "page ahead — back to the bar start, not a jump forward")
check(Grid.anchor(expected: 140, phase: -6), 186, "negative phase")
print("ok")
EOF
swiftc -o "$out/t" Shell/Grid.swift "$out/main.swift" && "$out/t"
