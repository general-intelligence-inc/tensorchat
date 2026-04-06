import React, { useEffect } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { ChatScreen } from '../screens/ChatScreen';
import { logBootStep } from '../utils/bootTrace';

export function AppNavigator({
  appReady,
  startupAutoloadPending,
}: {
  appReady: boolean;
  startupAutoloadPending: boolean;
}): React.JSX.Element {
  useEffect(() => {
    logBootStep('Navigation container mounted');
  }, []);

  return (
    <NavigationContainer
      onReady={() => {
        logBootStep('Navigation container ready');
      }}
    >
      <ChatScreen
        appReady={appReady}
        startupAutoloadPending={startupAutoloadPending}
      />
    </NavigationContainer>
  );
}
