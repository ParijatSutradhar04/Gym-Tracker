import './global.css';
import { Inter_400Regular, Inter_500Medium, Inter_600SemiBold, useFonts } from '@expo-google-fonts/inter';
import { RobotoMono_400Regular, RobotoMono_500Medium } from '@expo-google-fonts/roboto-mono';
import { StatusBar } from 'expo-status-bar';
import { Platform } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider, useAuth } from './src/auth/AuthProvider';
import { hasLocalData, resolveGate } from './src/auth/gate';
import { ErrorBoundary } from './src/components/ErrorBoundary';
import { GymProvider } from './src/data/GymProvider';
import { useGymState } from './src/data/hooks';
import { HomeScreen } from './src/screens/HomeScreen';
import { LoginScreen } from './src/screens/LoginScreen';

export default function App() {
  const [loaded] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    RobotoMono_400Regular,
    RobotoMono_500Medium,
  });
  if (!loaded) return null;
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <ErrorBoundary>{Platform.OS === 'web' ? <WebGate /> : <NativeGate />}</ErrorBoundary>
      </AuthProvider>
      <StatusBar style="light" />
    </SafeAreaProvider>
  );
}

/** The website keeps nothing of its own, so without a session there is nothing to load. */
function WebGate() {
  const { hasStoredSession, loading } = useAuth();
  if (loading) return null;
  if (resolveGate({ platform: 'web', hasStoredSession, hasLocalData: false }) === 'login') return <LoginScreen />;
  return (
    <GymProvider>
      <HomeScreen />
    </GymProvider>
  );
}

/** The phone opens its own data first; the network and the session are never in the way of a workout. */
function NativeGate() {
  return (
    <GymProvider>
      <NativeScreen />
    </GymProvider>
  );
}

function NativeScreen() {
  const { hasStoredSession, loading } = useAuth();
  const state = useGymState();
  if (loading) return null;
  // `app_signin_prompt` opens the app too; the top bar's sync slot asks to sign in.
  const gate = resolveGate({ platform: 'native', hasStoredSession, hasLocalData: hasLocalData(state) });
  return gate === 'login' ? <LoginScreen /> : <HomeScreen />;
}
