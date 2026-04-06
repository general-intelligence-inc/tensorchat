#!/bin/bash
# Patches the React Native bundled fmt podspec to disable consteval.
# Xcode 16.4+ / Apple Clang 17+ defines __cpp_consteval but rejects
# consteval in certain template contexts used by fmt 11.x.

PODSPEC="node_modules/react-native/third-party-podspecs/fmt.podspec"

if [ ! -f "$PODSPEC" ]; then
  echo "[patch-fmt] fmt.podspec not found, skipping"
  exit 0
fi

# Check if already patched
if grep -q 'prepare_command' "$PODSPEC"; then
  echo "[patch-fmt] Already patched"
  exit 0
fi

# Insert prepare_command before the closing 'end'
sed -i '' '/^end$/i\
  # Fix consteval issue with Xcode 16.4+ / Apple Clang 17+\
  spec.prepare_command = <<-CMD\
    sed -i '\'''\'' '\''s/define FMT_USE_CONSTEVAL 1/define FMT_USE_CONSTEVAL 0/g'\'' include/fmt/base.h\
    sed -i '\'''\'' '\''s/define FMT_CONSTEVAL consteval/define FMT_CONSTEVAL constexpr/g'\'' include/fmt/base.h\
  CMD
' "$PODSPEC"

echo "[patch-fmt] Patched fmt.podspec with prepare_command"
