import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Animated as NativeAnimated,
  Easing as NativeEasing,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useFocusEffect } from "expo-router";
import Animated, {
  Easing,
  FadeInDown,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { BottomTabBar } from "@/components/BottomTabBar";
import {
  NOTE_SANS,
  NOTE_SERIF,
} from "@/components/NoteUI";
import { OverviewGraph } from "@/components/overview/OverviewGraph";
import { TimeFlow } from "@/components/overview/TimeFlow";
import { formatApiDate } from "@/lib/featured-note";
import {
  fetchGraph,
  type Graph,
  type GraphNode,
} from "@/lib/visualizations";

const COLORS = {
  ink: "#1D3B4F",
  inkSoft: "#6E8A9C",
  inkFaint: "#9FB2BD",
  lensInactive: "#B6C4CB",
  deep: "#2E5E8C",
  divider: "#EDF0F1",
};

const LENSES = ["base", "network", "time"] as const;
type Lens = (typeof LENSES)[number];
type Period = "all" | "today" | "week" | "month";

type PeriodOption = { id: Period; label: string };

const PERIODS: PeriodOption[] = [
  { id: "all", label: "Gesamt" },
  { id: "today", label: "Heute" },
  { id: "week", label: "Letzte 7 Tage" },
  { id: "month", label: "Letzter Monat" },
];

// The tab routes live in a stack. Keeping these two small UI values outside the
// screen preserves the exact memory position when navigating away and back.
let retainedLensIndex = 0;
let retainedPeriod: Period = "all";

function dateKeyDaysAgo(days: number): string {
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() - days);
  return formatApiDate(date);
}

function nodeDate(node: GraphNode): string {
  return (node.date || node.capturedAt).slice(0, 10);
}

function periodIncludes(dateKey: string, period: Period): boolean {
  if (period === "all") return true;
  if (period === "today") return dateKey === dateKeyDaysAgo(0);
  if (period === "week") return dateKey >= dateKeyDaysAgo(6);
  return dateKey >= dateKeyDaysAgo(29);
}

function graphForPeriod(graph: Graph | null, period: Period): Graph | null {
  if (!graph || period === "all") return graph;

  const selectedNodes = graph.nodes.filter((node) =>
    periodIncludes(nodeDate(node), period),
  );
  const newIndexByOld = new Map(
    selectedNodes.map((node, index) => [node.idx, index]),
  );
  const nodes = selectedNodes.map((node, index) => ({ ...node, idx: index }));
  const edges = graph.edges.flatMap((edge) => {
    const source = newIndexByOld.get(edge.source);
    const target = newIndexByOld.get(edge.target);
    return source == null || target == null ? [] : [{ ...edge, source, target }];
  });
  const counts = new Map<number, number>();
  for (const node of selectedNodes) {
    counts.set(node.cluster, (counts.get(node.cluster) ?? 0) + 1);
  }
  const clusters = graph.clusters
    .filter((cluster) => counts.has(cluster.id))
    .map((cluster) => ({ ...cluster, count: counts.get(cluster.id) ?? 0 }));
  const clusterIds = new Set(clusters.map(({ id }) => id));
  const days = graph.time.days
    .filter((day) => periodIncludes(day.date, period))
    .map((day) => ({
      ...day,
      topics: day.topics.filter((topic) => clusterIds.has(topic.cluster)),
    }));
  const maxDailyWordCount = Math.max(0, ...days.map((day) => day.wordCount));

  return {
    ...graph,
    meta: { ...graph.meta, nodes: nodes.length, clusters: clusters.length },
    nodes,
    edges,
    clusters,
    time: { ...graph.time, days, maxDailyWordCount },
  };
}

function LensButton({
  index,
  selected,
  onPress,
}: {
  index: number;
  selected: boolean;
  onPress: () => void;
}) {
  const progress = useSharedValue(selected ? 1 : 0);

  useEffect(() => {
    progress.value = withTiming(selected ? 1 : 0, {
      duration: 250,
      easing: Easing.out(Easing.cubic),
    });
  }, [progress, selected]);

  const textStyle = useAnimatedStyle(() => ({
    color: `rgba(${Math.round(182 + (29 - 182) * progress.value)}, ${Math.round(
      196 + (59 - 196) * progress.value,
    )}, ${Math.round(203 + (79 - 203) * progress.value)}, 1)`,
  }));

  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected }}
      hitSlop={{ top: 16, bottom: 16, left: 6, right: 6 }}
      onPress={onPress}
      style={({ pressed }) => pressed && styles.pressed}
    >
      <Animated.Text style={[styles.lensLabel, textStyle]}>
        {LENSES[index]}
      </Animated.Text>
    </Pressable>
  );
}

function PeriodMenu({
  onClose,
  onSelect,
  selected,
  visible,
}: {
  onClose: () => void;
  onSelect: (period: Period) => void;
  selected: Period;
  visible: boolean;
}) {
  const insets = useSafeAreaInsets();

  return (
    <Modal
      animationType="fade"
      onRequestClose={onClose}
      presentationStyle="overFullScreen"
      transparent
      visible={visible}
    >
      <View style={styles.menuLayer}>
        <Pressable
          accessibilityLabel="Zeitraumauswahl schließen"
          onPress={onClose}
          style={StyleSheet.absoluteFill}
        />
        <Animated.View
          entering={FadeInDown.duration(180).easing(Easing.out(Easing.cubic))}
          style={[styles.periodMenu, { top: insets.top + 48 }]}
        >
          <Text style={styles.menuLabel}>ZEITRAUM</Text>
          {PERIODS.map((option, index) => {
            const active = option.id === selected;
            return (
              <Pressable
                key={option.id}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                onPress={() => onSelect(option.id)}
                style={({ pressed }) => [
                  styles.periodRow,
                  index < PERIODS.length - 1 && styles.periodRowDivider,
                  pressed && styles.pressed,
                ]}
              >
                <Text
                  style={[
                    styles.periodLabel,
                    active && styles.periodLabelActive,
                  ]}
                >
                  {option.label}
                </Text>
                {active ? <View style={styles.periodDot} /> : null}
              </Pressable>
            );
          })}
        </Animated.View>
      </View>
    </Modal>
  );
}

function EmptyMessage({ children }: { children: string }) {
  return (
    <View pointerEvents="none" style={styles.emptyState}>
      <Text style={styles.emptyText}>{children}</Text>
    </View>
  );
}

export default function OverviewScreen() {
  const insets = useSafeAreaInsets();
  const [activeIndex, setActiveIndex] = useState(retainedLensIndex);
  const [period, setPeriod] = useState<Period>(retainedPeriod);
  const [periodSheetOpen, setPeriodSheetOpen] = useState(false);
  const [graph, setGraph] = useState<Graph | null>(null);
  const [status, setStatus] = useState<"loading" | "error" | "ready">(
    "loading",
  );
  const lensOpacities = useRef(
    LENSES.map(
      (_, index) => new NativeAnimated.Value(index === retainedLensIndex ? 1 : 0),
    ),
  ).current;
  const contentOpacity = useRef(new NativeAnimated.Value(0)).current;

  const loadGraph = useCallback(() => {
    setStatus("loading");
    fetchGraph("network")
      .then((nextGraph) => {
        setGraph(nextGraph);
        setStatus("ready");
      })
      .catch(() => setStatus("error"));
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadGraph();
    }, [loadGraph]),
  );

  const visibleGraph = useMemo(
    () => graphForPeriod(graph, period),
    [graph, period],
  );
  const networkGraph = period === "today" ? graph : visibleGraph;
  const networkFilterDate = period === "today" ? dateKeyDaysAgo(0) : null;
  const noData = status === "ready" && (visibleGraph?.nodes.length ?? 0) === 0;
  const periodLabel = PERIODS.find(({ id }) => id === period)?.label ?? "Gesamt";

  useEffect(() => {
    if (status !== "ready") {
      contentOpacity.setValue(0);
      return;
    }
    contentOpacity.setValue(0);
    NativeAnimated.timing(contentOpacity, {
      toValue: 1,
      duration: 200,
      useNativeDriver: true,
    }).start();
  }, [contentOpacity, period, status, visibleGraph]);

  const selectLens = useCallback(
    (index: number) => {
      const next = Math.max(0, Math.min(LENSES.length - 1, index));
      if (next === activeIndex) return;
      retainedLensIndex = next;
      setActiveIndex(next);
      NativeAnimated.parallel([
        NativeAnimated.timing(lensOpacities[activeIndex], {
          toValue: 0,
          duration: 160,
          easing: NativeEasing.out(NativeEasing.cubic),
          useNativeDriver: true,
        }),
        NativeAnimated.timing(lensOpacities[next], {
          toValue: 1,
          duration: 220,
          easing: NativeEasing.out(NativeEasing.cubic),
          useNativeDriver: true,
        }),
      ]).start();
    },
    [activeIndex, lensOpacities],
  );

  const selectPeriod = (next: Period) => {
    retainedPeriod = next;
    setPeriod(next);
    setPeriodSheetOpen(false);
  };

  return (
    <View style={styles.root}>
      <LinearGradient
        colors={["#DBE3E8", "#E7EBEC", "#EAEDED"]}
        locations={[0, 0.46, 1]}
        style={StyleSheet.absoluteFill}
      />

      <View
        style={[
          styles.header,
          { paddingTop: Math.max(insets.top - 4, 0), paddingBottom: 2 },
        ]}
      >
        <Text style={styles.brand}>thoughts</Text>
        <Pressable
          accessibilityLabel={`Zeitraum auswählen. Aktuell ${periodLabel}`}
          accessibilityRole="button"
          onPress={() => setPeriodSheetOpen(true)}
          style={({ pressed }) => [
            styles.periodButton,
            pressed && styles.pressed,
          ]}
        >
          <Text style={styles.periodButtonText}>{periodLabel}</Text>
          <Ionicons name="chevron-down" size={12} color={COLORS.inkSoft} />
        </Pressable>
      </View>

      <View accessibilityRole="tablist" style={styles.lenses}>
        {LENSES.map((lens, index) => (
          <LensButton
            key={lens}
            index={index}
            onPress={() => selectLens(index)}
            selected={index === activeIndex}
          />
        ))}
      </View>

      <View style={styles.pager}>
        {LENSES.map((lens, index) => (
          <NativeAnimated.View
            key={lens}
            pointerEvents={index === activeIndex ? "auto" : "none"}
            style={[
              styles.page,
              {
                opacity: lensOpacities[index],
                zIndex: index === activeIndex ? 1 : 0,
              },
            ]}
          >
                {status === "loading" ? null : status === "error" ? (
                  <View style={styles.errorState}>
                    <Text style={styles.emptyText}>
                      Memory konnte nicht geladen werden.
                    </Text>
                    <Pressable
                      accessibilityRole="button"
                      onPress={loadGraph}
                      style={({ pressed }) => [
                        styles.retryButton,
                        pressed && styles.pressed,
                      ]}
                    >
                      <Text style={styles.retryText}>Erneut versuchen</Text>
                    </Pressable>
                  </View>
                ) : noData ? (
                  <EmptyMessage>
                    In diesem Zeitraum nichts aufgenommen.
                  </EmptyMessage>
                ) : lens === "base" ? (
                  <EmptyMessage>Noch nichts hier.</EmptyMessage>
                ) : (
                  <NativeAnimated.View
                    style={[styles.visualization, { opacity: contentOpacity }]}
                  >
                    {lens === "network" ? (
                      <OverviewGraph
                        filterDate={networkFilterDate}
                        graph={networkGraph}
                        onRetry={loadGraph}
                        showHint={false}
                        status="ready"
                      />
                    ) : (
                      <TimeFlow
                        graph={visibleGraph}
                        onRetry={loadGraph}
                        status="ready"
                      />
                    )}
                  </NativeAnimated.View>
                )}
          </NativeAnimated.View>
        ))}
      </View>

      <BottomTabBar active="memory" />
      <PeriodMenu
        onClose={() => setPeriodSheetOpen(false)}
        onSelect={selectPeriod}
        selected={period}
        visible={periodSheetOpen}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#E7EBEC" },
  header: {
    paddingHorizontal: 20,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  brand: {
    fontFamily: NOTE_SERIF,
    fontSize: 18,
    letterSpacing: 0.1,
    color: COLORS.ink,
  },
  periodButton: {
    minHeight: 44,
    maxWidth: 170,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 4,
  },
  periodButtonText: {
    fontFamily: NOTE_SERIF,
    fontSize: 13.5,
    color: COLORS.inkSoft,
  },
  lenses: {
    paddingTop: 10,
    paddingBottom: 2,
    paddingHorizontal: 22,
    flexDirection: "row",
    alignItems: "center",
    gap: 22,
  },
  lensLabel: {
    fontFamily: NOTE_SANS,
    fontSize: 12.5,
    fontWeight: "400",
    letterSpacing: 0.875,
    color: COLORS.lensInactive,
  },
  pager: { flex: 1, position: "relative" },
  page: {
    ...StyleSheet.absoluteFillObject,
    paddingHorizontal: 14,
    paddingTop: 2,
    paddingBottom: 104,
  },
  visualization: { flex: 1 },
  emptyState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    transform: [{ translateY: -50 }],
  },
  emptyText: {
    fontFamily: "Newsreader_300Light_Italic",
    fontSize: 15,
    fontWeight: "300",
    lineHeight: 22,
    color: COLORS.inkFaint,
    textAlign: "center",
  },
  errorState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    transform: [{ translateY: -50 }],
  },
  retryButton: {
    minHeight: 44,
    paddingHorizontal: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  retryText: {
    fontFamily: NOTE_SANS,
    fontSize: 12,
    color: COLORS.deep,
  },
  menuLayer: { flex: 1 },
  periodMenu: {
    position: "absolute",
    right: 16,
    width: 206,
    paddingTop: 12,
    paddingHorizontal: 16,
    borderRadius: 18,
    backgroundColor: "rgba(252,252,251,0.98)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.86)",
    shadowColor: COLORS.ink,
    shadowOpacity: 0.16,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 12,
  },
  menuLabel: {
    marginBottom: 7,
    fontFamily: NOTE_SANS,
    fontSize: 9.5,
    letterSpacing: 1.5,
    color: COLORS.inkFaint,
  },
  periodRow: {
    minHeight: 46,
    paddingVertical: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  periodRowDivider: {
    borderBottomWidth: 1,
    borderBottomColor: COLORS.divider,
  },
  periodLabel: {
    fontFamily: NOTE_SERIF,
    fontSize: 15.5,
    color: COLORS.inkSoft,
  },
  periodLabelActive: { color: COLORS.ink },
  periodDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: COLORS.deep,
  },
  pressed: { opacity: 0.58 },
});
