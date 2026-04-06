#!/usr/bin/env node
/**
 * Patches the React Native bundled fmt podspec to disable consteval.
 * Xcode 16.4+ / Apple Clang 17+ defines __cpp_consteval but rejects
 * consteval in certain template contexts used by fmt 11.x.
 *
 * Added to postinstall so it runs after npm install and before pod install.
 */
const fs = require('fs');
const path = require('path');

const PODSPEC = path.join(__dirname, '..', 'node_modules', 'react-native', 'third-party-podspecs', 'fmt.podspec');

if (!fs.existsSync(PODSPEC)) {
  console.log('[patch-fmt] fmt.podspec not found, skipping');
  process.exit(0);
}

let content = fs.readFileSync(PODSPEC, 'utf8');

if (content.includes('prepare_command')) {
  console.log('[patch-fmt] Already patched');
  process.exit(0);
}

// Insert prepare_command before the last 'end'
const patch = `
  # Fix consteval issue with Xcode 16.4+ / Apple Clang 17+
  spec.prepare_command = <<-CMD
    sed -i '' 's/define FMT_USE_CONSTEVAL 1/define FMT_USE_CONSTEVAL 0/g' include/fmt/base.h
    sed -i '' 's/define FMT_CONSTEVAL consteval/define FMT_CONSTEVAL constexpr/g' include/fmt/base.h
  CMD
`;

content = content.replace(/^end\s*$/m, patch + 'end');
fs.writeFileSync(PODSPEC, content, 'utf8');
console.log('[patch-fmt] Patched fmt.podspec with prepare_command');
