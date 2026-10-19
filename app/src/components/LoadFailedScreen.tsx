import { Text, View } from 'react-native';
import { Button } from './Button';

/** The data could not be fetched from the server. Nothing was changed; Retry asks again. */
export function LoadFailedScreen({ message, retrying, onRetry }: { message: string; retrying: boolean; onRetry(): void }) {
  return (
    <View className="flex-1 bg-bg items-center justify-center px-8">
      <View className="w-full max-w-[360px]">
        <Text className="font-sans-semibold text-ink text-lg mb-2 text-center">Can't load your workouts</Text>
        <Text className="font-sans text-muted text-center mb-6">{message}</Text>
        <Button variant="primary" label={retrying ? 'Retrying…' : 'Retry'} onPress={onRetry} disabled={retrying} />
      </View>
    </View>
  );
}
