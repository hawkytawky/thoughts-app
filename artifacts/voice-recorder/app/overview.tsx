import React, { useRef, useState } from "react";
import {
  NativeScrollEvent,
  NativeSyntheticEvent,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AppMenuGlyph, AppSidebar } from "@/components/AppSidebar";
import {
  NOTE_COLORS as C,
  NOTE_SANS,
  NOTE_SANS_MEDIUM,
  NOTE_SERIF,
} from "@/components/NoteUI";
import { OverviewGraph } from "@/components/overview/OverviewGraph";

type OverviewView = "base" | "network" | "time";

const VIEWS: { id: OverviewView; label: string }[] = [
  { id: "base", label: "base" },
  { id: "network", label: "network" },
  { id: "time", label: "time" },
];

export default function OverviewScreen() {
  const insets = useSafeAreaInsets();
  const [activeIndex, setActiveIndex] = useState(0);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const scrollRef = useRef<ScrollView>(null);

  const goTo = (index: number) => {
    setActiveIndex(index);
    scrollRef.current?.scrollTo({ x: index * size.w, animated: true });
  };

  const onMomentumEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const index = Math.round(e.nativeEvent.contentOffset.x / (size.w || 1));
    if (index !== activeIndex) setActiveIndex(index);
  };

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top }]}>
        <View style={styles.topBar}>
          <View style={styles.brandGroup}>
            <Pressable
              accessibilityLabel="Menü öffnen"
              accessibilityRole="button"
              hitSlop={10}
              onPress={() => setSidebarOpen(true)}
              style={({ pressed }) => [
                styles.menuButton,
                pressed && styles.controlPressed,
              ]}
            >
              <AppMenuGlyph />
            </Pressable>
            <Text style={styles.brand}>thoughts</Text>
          </View>
          <Text style={styles.pageLabel}>Overview</Text>
        </View>

        <View accessibilityRole="tablist" style={styles.tabs}>
          {VIEWS.map((view, index) => {
            const selected = index === activeIndex;
            return (
              <Pressable
                key={view.id}
                accessibilityRole="tab"
                accessibilityState={{ selected }}
                onPress={() => goTo(index)}
                style={({ pressed }) => [
                  styles.tabItem,
                  selected && styles.tabItemActive,
                  pressed && styles.controlPressed,
                ]}
              >
                <Text
                  style={[styles.tabLabel, selected && styles.tabLabelActive]}
                >
                  {view.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      <View
        style={styles.pager}
        onLayout={(e) =>
          setSize({
            w: e.nativeEvent.layout.width,
            h: e.nativeEvent.layout.height,
          })
        }
      >
        {size.w > 0 ? (
          <ScrollView
            ref={scrollRef}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            onMomentumScrollEnd={onMomentumEnd}
            keyboardShouldPersistTaps="handled"
          >
            <View style={[styles.page, { width: size.w, height: size.h }]}>
              <View style={styles.placeholder}>
                <Text style={styles.placeholderText}>
                  Base-Statistiken folgen.
                </Text>
              </View>
            </View>
            <View style={[styles.page, { width: size.w, height: size.h }]}>
              <OverviewGraph />
            </View>
            <View style={[styles.page, { width: size.w, height: size.h }]}>
              <View style={styles.placeholder}>
                <Text style={styles.placeholderText}>
                  Gedankenfluss über Zeit folgt.
                </Text>
              </View>
            </View>
          </ScrollView>
        ) : null}
      </View>

      <AppSidebar
        active="overview"
        insets={insets}
        onClose={() => setSidebarOpen(false)}
        onOpen={() => setSidebarOpen(true)}
        visible={sidebarOpen}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.paper },
  header: { backgroundColor: C.paper, paddingHorizontal: 20 },
  topBar: {
    height: 40,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  brandGroup: {
    height: 40,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  menuButton: {
    width: 20,
    height: 40,
    alignItems: "flex-start",
    justifyContent: "center",
  },
  brand: {
    fontFamily: NOTE_SERIF,
    fontSize: 13,
    lineHeight: 17,
    letterSpacing: 0.08,
    color: C.ink,
  },
  pageLabel: {
    fontFamily: NOTE_SERIF,
    fontSize: 13,
    lineHeight: 17,
    color: C.ink60,
  },
  controlPressed: { opacity: 0.5 },
  tabs: {
    marginTop: 10,
    marginHorizontal: -20,
    flexDirection: "row",
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(191,217,236,0.45)",
  },
  tabItem: {
    flex: 1,
    height: 34,
    alignItems: "center",
    justifyContent: "center",
  },
  tabItemActive: {
    borderBottomWidth: 2,
    borderBottomColor: C.ink,
    marginBottom: -StyleSheet.hairlineWidth,
  },
  tabLabel: {
    fontFamily: NOTE_SANS,
    fontSize: 13,
    color: C.ink40,
  },
  tabLabelActive: {
    fontFamily: NOTE_SANS_MEDIUM,
    color: C.ink,
  },
  pager: { flex: 1 },
  page: { flex: 1 },
  placeholder: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  placeholderText: {
    fontFamily: NOTE_SANS,
    fontSize: 14,
    color: C.ink40,
  },
});
