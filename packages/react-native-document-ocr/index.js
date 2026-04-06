'use strict';

const { NativeModules, Platform } = require('react-native');

const MODULE_NAME = 'DocumentOcr';

const LINKING_ERROR =
  `The package '${MODULE_NAME}' is not linked in this native build. ` +
  `Reinstall dependencies and rebuild the app.`;

const nativeModule = NativeModules[MODULE_NAME];
const isConfigured = !!nativeModule && nativeModule.isConfigured === true;

function getModule() {
  if (!nativeModule) {
    throw new Error(LINKING_ERROR);
  }

  return nativeModule;
}

function recognizePdfText(filePath, options) {
  return getModule().recognizePdfText(filePath, options || {});
}

module.exports = {
  recognizePdfText,
  isConfigured,
  isAvailable: Platform.OS === 'ios' && isConfigured,
};