import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Pressable, Text, View, type ViewToken } from 'react-native';
import { useGymState, useCtx, useToday } from '../data/hooks';
import { addDays, eachDay, MONTH_NAMES, WEEKDAY_SHORT, weekdayIndex, type DateStr } from '../engine/dates';
import { earliestDataDate } from '../engine/dayView';

const ITEM_W = 58;
const GAP = 8;
const DEFAULT_INSET = 20;
const STRIDE = ITEM_W + GAP;
const FUTURE_DAYS = 84;

function monthLabel(date: DateStr): string {
  const [y, m] = date.split('-');
  return `${MONTH_NAMES[Number(m) - 1].toUpperCase()} ${y}`;
}

interface Props {
  selected: DateStr;
  onSelect: (date: DateStr) => void;
  /** Horizontal padding of the label row and the strip; the desktop column supplies its own margins. */
  inset?: number;
}

export function DateBar({ selected, onSelect, inset = DEFAULT_INSET }: Props) {
  const state = useGymState();
  const ctx = useCtx();
  const today = useToday();
  const earliest = earliestDataDate(state, ctx);
  const dates = useMemo(() => eachDay(earliest, addDays(today, FUTURE_DAYS)), [earliest, today]);
  const todayIndex = dates.indexOf(today);
  const listRef = useRef<FlatList<DateStr>>(null);
  const [label, setLabel] = useState(monthLabel(today));

  // Past <- today -> future: today sits at the left edge, so earlier days are reached by scrolling left.
  useEffect(() => {
    if (todayIndex < 0) return;
    listRef.current?.scrollToIndex({ index: todayIndex, viewPosition: 0, animated: false });
    setLabel(monthLabel(today));
  }, [todayIndex, today]);

  const onViewable = useRef(({ viewableItems }: { viewableItems: ViewToken<DateStr>[] }) => {
    const first = viewableItems.find((v) => v.isViewable && v.item);
    if (first?.item) setLabel(monthLabel(first.item));
  });

  const getItemLayout = useCallback(
    (_: ArrayLike<DateStr> | null | undefined, index: number) => ({ length: STRIDE, offset: inset + index * STRIDE, index }),
    [inset],
  );

  return (
    <View className="pt-3 pb-[18px] gap-3">
      <View style={{ paddingHorizontal: inset }} className="flex-row items-center justify-between">
        <Text className="font-sans-medium text-muted text-[12px] tracking-wider">{label}</Text>
        <Text className="font-sans text-faint text-[11px]">← Past days</Text>
      </View>
      <FlatList
        ref={listRef}
        horizontal
        showsHorizontalScrollIndicator={false}
        data={dates}
        keyExtractor={(d) => d}
        extraData={selected}
        getItemLayout={getItemLayout}
        initialScrollIndex={Math.max(todayIndex, 0)}
        onScrollToIndexFailed={() => {}}
        onViewableItemsChanged={onViewable.current}
        viewabilityConfig={{ itemVisiblePercentThreshold: 100 }}
        contentContainerStyle={{ paddingHorizontal: inset }}
        ItemSeparatorComponent={() => <View style={{ width: GAP }} />}
        renderItem={({ item }) => {
          const on = item === selected;
          const day = item === today ? 'TODAY' : WEEKDAY_SHORT[weekdayIndex(item)].toUpperCase();
          return (
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              onPress={() => onSelect(item)}
              style={{ width: ITEM_W }}
              className={`h-[68px] rounded-[10px] items-center justify-center gap-[7px] ${on ? 'bg-accent' : 'bg-surface'}`}
            >
              <Text className={`font-sans text-[9px] ${on ? 'text-on-accent' : 'text-muted'}`}>{day}</Text>
              <Text className={`font-mono-medium text-[22px] ${on ? 'text-on-accent' : 'text-ink'}`}>
                {Number(item.slice(8))}
              </Text>
            </Pressable>
          );
        }}
      />
    </View>
  );
}
