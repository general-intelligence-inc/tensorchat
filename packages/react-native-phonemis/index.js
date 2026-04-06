'use strict';

const { NativeModules, Platform } = require('react-native');

const MODULE_NAME = 'Phonemis';

const LINKING_ERROR =
  `The package '${MODULE_NAME}' is not linked in this native build. ` +
  `Reinstall dependencies and rebuild the app.`;

const nativeModule = NativeModules[MODULE_NAME];

function getModule() {
  if (!nativeModule) {
    throw new Error(LINKING_ERROR);
  }

  return nativeModule;
}

function normalizeLocale(locale) {
  switch ((locale || 'en-us').toLowerCase()) {
    case 'en_gb':
    case 'en-gb':
    case 'gb':
    case 'en-uk':
    case 'en_uk':
      return 'en_gb';
    case 'en_us':
    case 'en-us':
    case 'us':
    default:
      return 'en_us';
  }
}

async function phonemize(text, locale) {
  return getModule().phonemize(text, normalizeLocale(locale));
}

function clearCaches() {
  if (nativeModule && typeof nativeModule.clearCaches === 'function') {
    nativeModule.clearCaches();
  }
}

module.exports = {
  phonemize,
  clearCaches,
  isAvailable: Platform.OS !== 'web' && !!nativeModule,
};