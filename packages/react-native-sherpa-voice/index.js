'use strict';

const { NativeModules, Platform } = require('react-native');

const MODULE_NAME = 'SherpaVoice';

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

function loadSTTModel(modelPath, modelType = 'whisper') {
  return getModule().loadSTTModel(modelPath, modelType);
}

function isSTTModelLoaded() {
  return getModule().isSTTModelLoaded();
}

function unloadSTTModel() {
  return getModule().unloadSTTModel();
}

function transcribeFile(filePath, options) {
  return getModule().transcribeFile(filePath, options || {});
}

function loadTTSModel(modelPath, modelType = 'piper') {
  return getModule().loadTTSModel(modelPath, modelType);
}

function isTTSModelLoaded() {
  return getModule().isTTSModelLoaded();
}

function unloadTTSModel() {
  return getModule().unloadTTSModel();
}

function synthesize(text, options) {
  return getModule().synthesize(text, options || {});
}

module.exports = {
  loadSTTModel,
  isSTTModelLoaded,
  unloadSTTModel,
  transcribeFile,
  loadTTSModel,
  isTTSModelLoaded,
  unloadTTSModel,
  synthesize,
  isConfigured,
  isAvailable: Platform.OS !== 'web' && isConfigured,
};