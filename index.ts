import React from 'react';
import { registerRootComponent } from 'expo';
import {
	ScrollView,
	StyleSheet,
	Text,
	View,
} from 'react-native';

function formatStartupError(error: unknown): string {
	if (error instanceof Error) {
		return error.stack ?? `${error.name}: ${error.message}`;
	}

	if (typeof error === 'string') {
		return error;
	}

	try {
		return JSON.stringify(error, null, 2);
	} catch {
		return String(error);
	}
}

function makeFatalStartupScreen(message: string): () => React.JSX.Element {
	return function FatalStartupScreen(): React.JSX.Element {
		return React.createElement(
			View,
			{ style: styles.root },
			React.createElement(
				Text,
				{ style: styles.title },
				'TensorChat failed during startup',
			),
			React.createElement(
				ScrollView,
				{ contentContainerStyle: styles.scrollContent },
				React.createElement(
					Text,
					{ selectable: true, style: styles.message },
					message,
				),
			),
		);
	};
}

let RootComponent: React.ComponentType;
let bootTrace: (typeof import('./src/utils/bootTrace')) | null = null;

try {
	bootTrace = require('./src/utils/bootTrace') as typeof import('./src/utils/bootTrace');
	bootTrace.logBootStep('Index entry loaded');
	bootTrace.logBootStep('Requiring App module');
	RootComponent = (require('./App') as typeof import('./App')).default;
	bootTrace.logBootStep('App module required');
} catch (error) {
	const message = formatStartupError(error);
	if (bootTrace) {
		message
			.split('\n')
			.slice(0, 8)
			.forEach((line, index) => {
				bootTrace?.logBootStep(`App import error ${index + 1}: ${line.trim().slice(0, 220)}`);
			});
	}
	console.error('[StartupFatal] Failed during root bootstrap:', error);
	RootComponent = makeFatalStartupScreen(message);
}

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(RootComponent);

const styles = StyleSheet.create({
	root: {
		flex: 1,
		backgroundColor: '#0E1014',
		paddingTop: 72,
		paddingHorizontal: 20,
		paddingBottom: 24,
	},
	title: {
		color: '#F8FAFC',
		fontSize: 24,
		fontWeight: '700',
		marginBottom: 16,
	},
	scrollContent: {
		paddingBottom: 32,
	},
	message: {
		color: '#E2E8F0',
		fontSize: 13,
		lineHeight: 18,
		fontFamily: 'Menlo',
	},
});
