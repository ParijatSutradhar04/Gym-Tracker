import './global.css';
import { Inter_400Regular, Inter_500Medium, Inter_600SemiBold, useFonts } from '@expo-google-fonts/inter';
import { RobotoMono_400Regular, RobotoMono_500Medium } from '@expo-google-fonts/roboto-mono';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ErrorBoundary } from './src/components/ErrorBoundary';
import { GymProvider } from './src/data/GymProvider';
import { HomeScreen } from './src/screens/HomeScreen';

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
      <GymProvider>
        <ErrorBoundary>
          <HomeScreen />
        </ErrorBoundary>
      </GymProvider>
      <StatusBar style="light" />
    </SafeAreaProvider>
  );
}
