import { Component, type ReactNode } from 'react';
import { Text, View } from 'react-native';
import { Button } from './Button';

interface State {
  error: Error | null;
}

/** Turns a render crash into a screen with Try again; the store and saved data are untouched. */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.warn('ErrorBoundary: render failed', error);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <View className="flex-1 bg-bg items-center justify-center px-8">
        <Text className="font-sans-semibold text-ink text-lg mb-2">Something went wrong</Text>
        <Text className="font-sans text-muted text-center mb-4">{error.message}</Text>
        <Text className="font-sans text-faint text-center mb-6">Your saved workouts are untouched.</Text>
        <View className="w-full max-w-[320px]">
          <Button variant="primary" label="Try again" onPress={() => this.setState({ error: null })} />
        </View>
      </View>
    );
  }
}
