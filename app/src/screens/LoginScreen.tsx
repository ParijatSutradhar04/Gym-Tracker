import { useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { supabase } from '../auth/supabase';
import { colors } from '../theme';

const INPUT = 'h-12 rounded-[10px] border border-border bg-bg px-4 font-sans text-ink text-[15px]';

export function LoginScreen({ onSignedIn }: { onSignedIn?: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const passwordRef = useRef<TextInput>(null);

  const disabled = submitting || !email.trim() || !password;

  async function submit() {
    if (disabled) return;
    setSubmitting(true);
    setError(null);
    try {
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (signInError) setError(signInError.message);
      else onSignedIn?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sign in failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <SafeAreaView className="flex-1 bg-bg">
      <KeyboardAvoidingView
        className="flex-1 items-center justify-center px-6"
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View className="w-full max-w-[360px] gap-4">
          <View className="mb-2 gap-1">
            <Text className="font-sans-semibold text-ink text-[28px]">Gym Tracker</Text>
            <Text className="font-sans text-muted text-[15px]">Sign in to continue</Text>
          </View>

          <TextInput
            value={email}
            onChangeText={setEmail}
            placeholder="Email"
            placeholderTextColor={colors.faint}
            keyboardType="email-address"
            autoCapitalize="none"
            autoComplete="email"
            textContentType="emailAddress"
            accessibilityLabel="Email"
            returnKeyType="next"
            onSubmitEditing={() => passwordRef.current?.focus()}
            className={INPUT}
          />
          <TextInput
            ref={passwordRef}
            value={password}
            onChangeText={setPassword}
            placeholder="Password"
            placeholderTextColor={colors.faint}
            secureTextEntry
            autoCapitalize="none"
            autoComplete="password"
            textContentType="password"
            accessibilityLabel="Password"
            onSubmitEditing={submit}
            className={INPUT}
          />

          {error ? <Text className="font-sans text-muted text-[13px]">{error}</Text> : null}

          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled }}
            disabled={disabled}
            onPress={submit}
            className={`h-[52px] rounded-[10px] items-center justify-center bg-accent ${disabled ? 'opacity-40' : ''}`}
          >
            <Text className="font-sans-semibold text-[15px] text-on-accent">Sign In</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
