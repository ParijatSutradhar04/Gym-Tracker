import { useRef, useState } from 'react';
import { ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { DateBar } from '../components/DateBar';
import { DayBody } from '../components/DayBody';
import { TopBar } from '../components/TopBar';
import { useToday } from '../data/hooks';

export function HomeScreen() {
  const today = useToday();
  const [selected, setSelected] = useState(today);
  const prevToday = useRef(today);
  if (prevToday.current !== today) {
    // Midnight rolled over: a selection that was "today" follows the clock.
    if (selected === prevToday.current) setSelected(today);
    prevToday.current = today;
  }
  return (
    <SafeAreaView className="flex-1 bg-bg">
      <TopBar onExport={() => {}} />
      <DateBar selected={selected} onSelect={setSelected} />
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
        <DayBody date={selected} />
      </ScrollView>
    </SafeAreaView>
  );
}
