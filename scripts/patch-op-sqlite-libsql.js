/**
 * Patches @op-engineering/op-sqlite libsql/bridge.cpp to fix
 * 'use of undeclared identifier file_exists' build error.
 *
 * The libsql/bridge.cpp calls file_exists() from ../utils.h but
 * the include path doesn't always resolve correctly in Release builds.
 * Replace with std::filesystem::exists() which is already imported.
 */
const fs = require('fs');
const path = require('path');

const filePath = path.join(
  __dirname,
  '..',
  'node_modules',
  '@op-engineering',
  'op-sqlite',
  'cpp',
  'libsql',
  'bridge.cpp',
);

if (!fs.existsSync(filePath)) {
  console.log('[patch-op-sqlite-libsql] bridge.cpp not found, skipping');
  process.exit(0);
}

let content = fs.readFileSync(filePath, 'utf8');
const needle = 'if (!file_exists(full_path))';
const replacement = 'if (!std::filesystem::exists(full_path))';

if (content.includes(needle)) {
  content = content.replace(needle, replacement);
  fs.writeFileSync(filePath, content, 'utf8');
  console.log('[patch-op-sqlite-libsql] Patched file_exists -> std::filesystem::exists');
} else {
  console.log('[patch-op-sqlite-libsql] Already patched or pattern not found, skipping');
}
