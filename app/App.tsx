import './global.css';
import { Inter_400Regular, Inter_500Medium, Inter_600SemiBold, useFonts } from '@expo-google-fonts/inter';
import { RobotoMono_400Regular, RobotoMono_500Medium } from '@expo-google-fonts/roboto-mono';
import { StatusBar } from 'expo-status-bar';
import { Text, View } from 'react-native';

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
    <View className="flex-1 bg-bg items-center justify-center">
      <Text className="font-sans-semibold text-ink">Gym Tracker</Text>
      <StatusBar style="light" />
    </View>
  );
}
