import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  StyleSheet,
  View,
  useColorScheme,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import * as SplashScreen from 'expo-splash-screen';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  AppBootScreen,
  getAppBootScreenPalette,
} from './src/components/AppBootScreen';
import { LlamaContext } from './src/context/LlamaContext';
import { FileRagProvider } from './src/context/FileRagContext';
import { useLlama } from './src/hooks/useLlama';
import { AppNavigator } from './src/navigation/AppNavigator';
import { ThemeProvider, useTheme } from './src/context/ThemeContext';
import {
  findPreferredLoadableMiniAppModelCandidate,
  findPreferredLoadableModelCandidate,
  SELECTED_MODEL_KEY,
} from './src/utils/loadableModels';
import { SELECTED_MINIAPP_MODEL_KEY } from './src/miniapps/types';
import { MINIAPP_CONTEXT_SIZE } from './src/agent/miniAppAgent';
import { isModelAllowedByDeviceMemory } from './src/utils/modelMemory';
import { logBootStep } from './src/utils/bootTrace';

const ACTIVE_CHAT_MODE_KEY = 'tensorchat_active_chat_mode';

const MIN_BOOT_SCREEN_VISIBLE_MS = 900;
const APP_READY_FALLBACK_MS = 1200;
const SPLASH_HIDE_RETRY_DELAY_MS = 120;
const SPLASH_HIDE_MAX_ATTEMPTS = 4;

SplashScreen.setOptions({
  duration: 280,
  fade: true,
});

void SplashScreen.preventAutoHideAsync().catch(() => {
  // Ignore duplicate or unsupported preventAutoHide calls.
});

logBootStep('App module evaluated');

async function hideNativeSplashWithRetry(): Promise<void> {
  for (let attempt = 1; attempt <= SPLASH_HIDE_MAX_ATTEMPTS; attempt += 1) {
    try {
      await SplashScreen.hideAsync();
      logBootStep('Native splash hidden');
      return;
    } catch (error) {
      if (attempt === SPLASH_HIDE_MAX_ATTEMPTS) {
        console.warn('[App] Failed to hide native splash screen:', error);
        return;
      }

      await new Promise((resolve) => {
        setTimeout(resolve, SPLASH_HIDE_RETRY_DELAY_MS);
      });
    }
  }
}

interface StartupLoadCandidate {
  modelPath: string;
  mmprojPath?: string;
  contextSize?: number;
}

export default function App(): React.JSX.Element {
  const llama = useLlama();
  const { loadModel } = llama;
  const [appReady, setAppReady] = useState(false);
  const [startupLoadCandidate, setStartupLoadCandidate] = useState<
    StartupLoadCandidate | null
  >(null);
  const [startupAutoloadPending, setStartupAutoloadPending] = useState(false);

  useEffect(() => {
    logBootStep('App component mounted');
  }, []);

  useEffect(() => {
    if (appReady) {
      logBootStep('App marked ready');
    }
  }, [appReady]);

  useEffect(() => {
    logBootStep(
      startupAutoloadPending
        ? 'Startup autoload pending'
        : 'Startup autoload idle',
    );
  }, [startupAutoloadPending]);

  useEffect(() => {
    let cancelled = false;
    let readinessFallbackTimeout: ReturnType<typeof setTimeout> | null = setTimeout(() => {
      readinessFallbackTimeout = null;

      if (!cancelled) {
        logBootStep('Startup prepare timed out; forcing app ready');
        console.warn('[App] Startup prepare timed out, continuing app launch');
        setAppReady(true);
      }
    }, APP_READY_FALLBACK_MS);

    const settleAppReady = () => {
      if (readinessFallbackTimeout !== null) {
        clearTimeout(readinessFallbackTimeout);
        readinessFallbackTimeout = null;
      }

      if (!cancelled) {
        setAppReady(true);
      }
    };

    async function prepare() {
      logBootStep('Startup prepare started');

      try {
        // Startup is mode-aware: if the user was last in miniapp mode, we
        // restore a Qwen 3.5 2B model for that mode (text-only, no mmproj).
        // Translation mode has its own loading path inside ChatScreen, so we
        // default to the regular chat model slot for everything else.
        const lastActiveMode = await AsyncStorage.getItem(ACTIVE_CHAT_MODE_KEY);
        const isMiniAppStartup = lastActiveMode === 'miniapp';

        const selectionKey = isMiniAppStartup
          ? SELECTED_MINIAPP_MODEL_KEY
          : SELECTED_MODEL_KEY;
        const savedId = await AsyncStorage.getItem(selectionKey);
        logBootStep(
          savedId
            ? `Found saved model selection (${isMiniAppStartup ? 'miniapp' : 'chat'})`
            : 'No saved model selection',
        );

        // For miniapp mode, prefer ANY downloaded 2B variant as a fallback
        // so first-time users get a working model without having to pin a
        // preference first. For chat mode, keep the existing broad search.
        const candidate = isMiniAppStartup
          ? await findPreferredLoadableMiniAppModelCandidate(savedId, {
              isModelEligible: isModelAllowedByDeviceMemory,
            })
          : await findPreferredLoadableModelCandidate(savedId, {
              isModelEligible: isModelAllowedByDeviceMemory,
            });

        if (cancelled) {
          return;
        }

        if (candidate) {
          logBootStep(`Resolved startup model candidate: ${candidate.model.id}`);
          if (candidate.model.id !== savedId) {
            await AsyncStorage.setItem(selectionKey, candidate.model.id);
          }

          if (cancelled) {
            return;
          }

          setStartupAutoloadPending(true);
          setStartupLoadCandidate({
            modelPath: candidate.modelPath,
            // Miniapp mode never loads the mmproj sidecar — vision is
            // intentionally disabled per the feature brief.
            ...(candidate.mmprojPath && !isMiniAppStartup
              ? { mmprojPath: candidate.mmprojPath }
              : {}),
            // Miniapp mode requests a larger context window so the system
            // prompt injection + tool grammar overhead + app-code output
            // all fit comfortably.
            ...(isMiniAppStartup ? { contextSize: MINIAPP_CONTEXT_SIZE } : {}),
          });
        } else if (savedId) {
          logBootStep('Saved model missing; clearing stored selection');
          await AsyncStorage.removeItem(selectionKey);
        } else {
          logBootStep('No startup model candidate found');
        }
      } catch (err) {
        logBootStep('Startup prepare failed');
        console.warn('[App] Auto-load last model failed:', err);
      } finally {
        settleAppReady();
      }
    }

    prepare();

    return () => {
      cancelled = true;

      if (readinessFallbackTimeout !== null) {
        clearTimeout(readinessFallbackTimeout);
      }
    };
  }, []);

  useEffect(() => {
    if (!startupLoadCandidate) {
      return;
    }

    let cancelled = false;

    void (async () => {
      const modelName = startupLoadCandidate.modelPath.split('/').pop() ?? startupLoadCandidate.modelPath;
      logBootStep(`Startup model load started: ${modelName}`);

      try {
        const didLoadModel = await loadModel(
          startupLoadCandidate.modelPath,
          startupLoadCandidate.mmprojPath,
          startupLoadCandidate.contextSize != null
            ? { contextSize: startupLoadCandidate.contextSize }
            : undefined,
        );

        if (didLoadModel) {
          logBootStep(`Startup model load finished: ${modelName}`);
        } else {
          logBootStep(`Startup model load did not activate: ${modelName}`);
        }
      } catch (err) {
        logBootStep(`Startup model load failed: ${modelName}`);
        console.warn('[App] Startup model load failed:', err);
      } finally {
        if (!cancelled) {
          setStartupAutoloadPending(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [loadModel, startupLoadCandidate]);
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <KeyboardProvider>
          <LlamaContext.Provider value={llama}>
            <FileRagProvider>
              <AppContent
                appReady={appReady}
                startupHasModelCandidate={startupLoadCandidate !== null}
                startupAutoloadPending={startupAutoloadPending}
              />
            </FileRagProvider>
          </LlamaContext.Provider>
        </KeyboardProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

function AppContent({
  appReady,
  startupHasModelCandidate,
  startupAutoloadPending,
}: {
  appReady: boolean;
  startupHasModelCandidate: boolean;
  startupAutoloadPending: boolean;
}): React.JSX.Element {
  const { colors, scheme } = useTheme();
  const launchScheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  const showBootScreen = !appReady;
  const bootScreenPalette = getAppBootScreenPalette(launchScheme);
  const [renderBootScreen, setRenderBootScreen] = useState(showBootScreen);
  const [bootSubtitleTypingComplete, setBootSubtitleTypingComplete] = useState(false);
  const [bootScreenVisibleSince, setBootScreenVisibleSince] = useState<number | null>(
    showBootScreen ? Date.now() : null,
  );
  const nativeSplashHideRequestedRef = useRef(false);
  const bootScreenOpacity = useRef(new Animated.Value(showBootScreen ? 1 : 0)).current;

  const handleRootLayout = () => {
    if (nativeSplashHideRequestedRef.current || !renderBootScreen) {
      return;
    }

    nativeSplashHideRequestedRef.current = true;
    void hideNativeSplashWithRetry();
  };

  useEffect(() => {
    logBootStep('App content mounted');
  }, []);

  useEffect(() => {
    logBootStep(showBootScreen ? 'Boot overlay visible' : 'Boot overlay dismissed');
  }, [showBootScreen]);

  useEffect(() => {
    if (showBootScreen) {
      setRenderBootScreen(true);
      setBootSubtitleTypingComplete(false);
      setBootScreenVisibleSince(Date.now());
      bootScreenOpacity.stopAnimation();
      bootScreenOpacity.setValue(1);
      return;
    }

    if (!renderBootScreen) {
      return;
    }

    if (bootScreenVisibleSince === null) {
      return;
    }

    if (!bootSubtitleTypingComplete) {
      return;
    }

    let cancelled = false;
    const remainingVisibleMs = Math.max(
      0,
      MIN_BOOT_SCREEN_VISIBLE_MS - (Date.now() - bootScreenVisibleSince),
    );

    const timeoutId = setTimeout(() => {
      Animated.parallel([
        Animated.timing(bootScreenOpacity, {
          toValue: 0,
          duration: 320,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
      ]).start(({ finished }) => {
        if (!finished || cancelled) {
          return;
        }

        setRenderBootScreen(false);
        setBootScreenVisibleSince(null);
      });
    }, remainingVisibleMs);

    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
      bootScreenOpacity.stopAnimation();
    };
  }, [
    bootScreenOpacity,
    bootSubtitleTypingComplete,
    bootScreenVisibleSince,
    renderBootScreen,
    showBootScreen,
  ]);

  return (
    <View
      onLayout={handleRootLayout}
      style={[
        styles.root,
        { backgroundColor: renderBootScreen ? bootScreenPalette.background : colors.base },
      ]}
    >
      <StatusBar style={(renderBootScreen ? launchScheme : scheme) === 'dark' ? 'light' : 'dark'} />
      <AppNavigator
        appReady={appReady}
        startupAutoloadPending={startupAutoloadPending}
      />
      {renderBootScreen ? (
        <Animated.View
          pointerEvents="auto"
          style={[
            StyleSheet.absoluteFillObject,
            {
              opacity: bootScreenOpacity,
            },
          ]}
        >
          <AppBootScreen
            phase={appReady && startupHasModelCandidate ? 'autoload' : 'prepare'}
            scheme={launchScheme}
            bottomAccessory={startupHasModelCandidate ? 'composer' : 'catalogBanner'}
            onSubtitleTypingComplete={() => setBootSubtitleTypingComplete(true)}
          />
        </Animated.View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
});
