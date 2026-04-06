const fs = require('fs');
const https = require('https');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const SHERPA_VERSION = '1.12.28';
const SHERPA_RELEASE_BASE = `https://github.com/k2-fsa/sherpa-onnx/releases/download/v${SHERPA_VERSION}`;

const bridgeRoot = path.resolve(__dirname, '..', 'packages', 'react-native-sherpa-voice');
const stampPath = path.join(bridgeRoot, '.sherpa-vendor-version.json');
const androidTarget = path.join(bridgeRoot, 'android', 'src', 'main', 'jniLibs');
const iosVendorRoot = path.join(bridgeRoot, 'ios', 'vendor');
const iosTarget = path.join(iosVendorRoot, 'build-ios');
const legacyIosOnnxruntimeTarget = path.join(iosTarget, 'ios-onnxruntime');

const androidArchiveUrl = `${SHERPA_RELEASE_BASE}/sherpa-onnx-v${SHERPA_VERSION}-android.tar.bz2`;
const iosArchiveUrl = `${SHERPA_RELEASE_BASE}/sherpa-onnx-v${SHERPA_VERSION}-ios.tar.bz2`;

const expectedAndroidFiles = [
  ['arm64-v8a', 'libonnxruntime.so'],
  ['arm64-v8a', 'libsherpa-onnx-jni.so'],
  ['armeabi-v7a', 'libonnxruntime.so'],
  ['armeabi-v7a', 'libsherpa-onnx-jni.so'],
  ['x86', 'libonnxruntime.so'],
  ['x86', 'libsherpa-onnx-jni.so'],
  ['x86_64', 'libonnxruntime.so'],
  ['x86_64', 'libsherpa-onnx-jni.so'],
].map((parts) => path.join(androidTarget, ...parts));

const expectedIosPaths = [
  path.join(iosTarget, 'sherpa-onnx.xcframework'),
];

function log(message) {
  console.log(`[setup-sherpa-voice] ${message}`);
}

function ensureDirectory(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function removeDirectory(dirPath) {
  fs.rmSync(dirPath, { recursive: true, force: true });
}

function copyDirectory(sourceDir, destinationDir) {
  removeDirectory(destinationDir);
  ensureDirectory(path.dirname(destinationDir));
  fs.cpSync(sourceDir, destinationDir, { recursive: true, dereference: true, force: true });
}

function findDirectory(rootDir, targetName) {
  const pending = [rootDir];

  while (pending.length > 0) {
    const currentDir = pending.pop();
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }

      const candidatePath = path.join(currentDir, entry.name);
      if (entry.name === targetName) {
        return candidatePath;
      }

      pending.push(candidatePath);
    }
  }

  return null;
}

function fileExists(filePath) {
  try {
    return fs.existsSync(filePath);
  } catch {
    return false;
  }
}

function readStampVersion() {
  if (!fileExists(stampPath)) {
    return null;
  }

  try {
    const stamp = JSON.parse(fs.readFileSync(stampPath, 'utf8'));
    return typeof stamp.version === 'string' ? stamp.version : null;
  } catch {
    return null;
  }
}

function isVendorTreeReady() {
  if (readStampVersion() !== SHERPA_VERSION) {
    return false;
  }

  if (fileExists(legacyIosOnnxruntimeTarget)) {
    return false;
  }

  return [...expectedAndroidFiles, ...expectedIosPaths].every(fileExists);
}

function pruneLegacyIosOrtArtifacts() {
  removeDirectory(legacyIosOnnxruntimeTarget);
}

function writeStamp() {
  fs.writeFileSync(
    stampPath,
    `${JSON.stringify({ version: SHERPA_VERSION, updatedAt: new Date().toISOString() }, null, 2)}\n`,
    'utf8',
  );
}

function downloadFile(url, destinationPath, redirectsRemaining = 5) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, (response) => {
      const statusCode = response.statusCode ?? 0;

      if (statusCode >= 300 && statusCode < 400 && response.headers.location) {
        response.resume();

        if (redirectsRemaining === 0) {
          reject(new Error(`Too many redirects while downloading ${url}`));
          return;
        }

        downloadFile(response.headers.location, destinationPath, redirectsRemaining - 1).then(resolve, reject);
        return;
      }

      if (statusCode < 200 || statusCode >= 300) {
        response.resume();
        reject(new Error(`Download failed for ${url} with HTTP ${statusCode}`));
        return;
      }

      ensureDirectory(path.dirname(destinationPath));
      const file = fs.createWriteStream(destinationPath);
      response.pipe(file);

      file.on('finish', () => {
        file.close(resolve);
      });

      file.on('error', (error) => {
        file.close(() => {
          fs.rmSync(destinationPath, { force: true });
          reject(error);
        });
      });
    });

    request.on('error', (error) => {
      fs.rmSync(destinationPath, { force: true });
      reject(error);
    });
  });
}

function extractTarBz2(archivePath, destinationDir) {
  ensureDirectory(destinationDir);
  execFileSync('tar', ['-xjf', archivePath, '-C', destinationDir], { stdio: 'inherit' });
}

async function installAndroidRuntime(workDir) {
  const archivePath = path.join(workDir, 'sherpa-android.tar.bz2');
  const extractDir = path.join(workDir, 'android');

  log(`Downloading Android runtime v${SHERPA_VERSION}`);
  await downloadFile(androidArchiveUrl, archivePath);
  extractTarBz2(archivePath, extractDir);

  const jniLibsDir = findDirectory(extractDir, 'jniLibs');
  if (!jniLibsDir) {
    throw new Error('Unable to locate jniLibs in the sherpa Android release archive.');
  }

  removeDirectory(androidTarget);
  copyDirectory(jniLibsDir, androidTarget);
}

async function installIosRuntime(workDir) {
  const archivePath = path.join(workDir, 'sherpa-ios.tar.bz2');
  const extractDir = path.join(workDir, 'ios');

  log(`Downloading iOS runtime v${SHERPA_VERSION}`);
  await downloadFile(iosArchiveUrl, archivePath);
  extractTarBz2(archivePath, extractDir);

  const buildIosDir = findDirectory(extractDir, 'build-ios');
  if (!buildIosDir) {
    throw new Error('Unable to locate build-ios in the sherpa iOS release archive.');
  }

  removeDirectory(iosVendorRoot);
  copyDirectory(buildIosDir, iosTarget);
  pruneLegacyIosOrtArtifacts();
}

async function main() {
  const hasExpectedVendorPaths = [...expectedAndroidFiles, ...expectedIosPaths].every(fileExists);
  if (readStampVersion() === SHERPA_VERSION && hasExpectedVendorPaths && fileExists(legacyIosOnnxruntimeTarget)) {
    pruneLegacyIosOrtArtifacts();
    writeStamp();
    log(`Pruned bundled iOS ONNX Runtime artifacts for v${SHERPA_VERSION}`);
    return;
  }

  if (isVendorTreeReady()) {
    log(`Sherpa vendor runtime already present for v${SHERPA_VERSION}`);
    return;
  }

  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tensorchat-sherpa-voice-'));

  try {
    await installAndroidRuntime(workDir);
    await installIosRuntime(workDir);
    writeStamp();
    log(`Installed sherpa vendor runtimes for v${SHERPA_VERSION}`);
  } finally {
    removeDirectory(workDir);
  }
}

main().catch((error) => {
  console.error(`[setup-sherpa-voice] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});