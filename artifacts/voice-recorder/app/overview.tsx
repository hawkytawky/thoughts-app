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
import { NOTE_SANS } from "@/components/NoteUI";
import { PrimaryScreenHeader } from "@/components/PrimaryScreenHeader";
import { GalaxyGraph } from "@/components/overview/GalaxyGraph";
import { FeelingLens } from "@/components/overview/FeelingLens";
import { formatApiDate } from "@/lib/featured-note";
import { MEMORY_FRAME, MEMORY_THEME } from "@/lib/memory-theme";
import { fetchGraph, type Graph, type GraphNode } from "@/lib/visualizations";

const COLORS = {
  ink: "#1D3B4F",
  inkSoft: "#6E8A9C",
  inkFaint: "#9FB2BD",
  deep: "#2E5E8C",
  divider: "#EDF0F1",
};

const VIEW_MODES = ["base", "network", "feeling"] as const;
const GRAPH_REFRESH_INTERVAL_MS = 30_000;
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
let retainedViewModeIndex = 0;
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
    return source == null || target == null
      ? []
      : [{ ...edge, source, target }];
  });
  const secondaryTopicEdges = graph.secondaryTopicEdges.flatMap((edge) => {
    const source = newIndexByOld.get(edge.source);
    return source == null ? [] : [{ ...edge, source }];
  });
  const counts = new Map<string, number>();
  for (const node of selectedNodes) {
    counts.set(node.cluster, (counts.get(node.cluster) ?? 0) + 1);
  }
  const clusters = graph.clusters.map((cluster) => ({
    ...cluster,
    count: counts.get(cluster.id) ?? 0,
  }));
  return {
    ...graph,
    meta: { ...graph.meta, nodes: nodes.length, clusters: clusters.length },
    nodes,
    edges,
    secondaryTopicEdges,
    clusters,
  };
}

function ViewModeButton({
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

  const textStyle = useAnimatedStyle(() => {
    const inactive = [179, 187, 194];
    const active = [36, 53, 66];
    return {
      color: `rgba(${Math.round(inactive[0] + (active[0] - inactive[0]) * progress.value)}, ${Math.round(inactive[1] + (active[1] - inactive[1]) * progress.value)}, ${Math.round(inactive[2] + (active[2] - inactive[2]) * progress.value)}, 1)`,
    };
  });

  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected }}
      hitSlop={{ top: 16, bottom: 16, left: 6, right: 6 }}
      onPress={onPress}
      style={({ pressed }) => pressed && styles.pressed}
    >
      <Animated.Text style={[styles.viewModeLabel, textStyle]}>
        {VIEW_MODES[index]}
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
  const initialViewModeIndex = Math.min(
    retainedViewModeIndex,
    VIEW_MODES.length - 1,
  );
  const [activeViewModeIndex, setActiveViewModeIndex] =
    useState(initialViewModeIndex);
  const [period, setPeriod] = useState<Period>(retainedPeriod);
  const [periodSheetOpen, setPeriodSheetOpen] = useState(false);
  const [graph, setGraph] = useState<Graph | null>(null);
  const graphRef = useRef<Graph | null>(null);
  const [status, setStatus] = useState<"loading" | "error" | "ready">(
    "loading",
  );
  const graphRequestIdRef = useRef(0);
  const graphRequestInFlightRef = useRef(false);
  const viewModeOpacities = useRef(
    VIEW_MODES.map(
      (_, index) =>
        new NativeAnimated.Value(index === initialViewModeIndex ? 1 : 0),
    ),
  ).current;
  const contentOpacity = useRef(new NativeAnimated.Value(0)).current;

  const loadGraph = useCallback(() => {
    if (graphRequestInFlightRef.current) return;
    graphRequestInFlightRef.current = true;
    // Keep the visualization mounted while refreshing after a detail view.
    // Otherwise its focused cluster, selected Thought, and camera are reset.
    if (!graphRef.current) setStatus("loading");
    const requestId = ++graphRequestIdRef.current;
    fetchGraph("network-v2")
      .then((nextGraph) => {
        if (requestId !== graphRequestIdRef.current) return;
        graphRef.current = nextGraph;
        setGraph(nextGraph);
        setStatus("ready");
      })
      .catch((error: unknown) => {
        if (requestId !== graphRequestIdRef.current) return;
        if (__DEV__) console.error("Failed to load visualization graph", error);
        if (!graphRef.current) setStatus("error");
      })
      .finally(() => {
        if (requestId === graphRequestIdRef.current) {
          graphRequestInFlightRef.current = false;
        }
      });
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadGraph();
      const refreshTimer = setInterval(loadGraph, GRAPH_REFRESH_INTERVAL_MS);
      return () => {
        clearInterval(refreshTimer);
        graphRequestIdRef.current += 1;
        graphRequestInFlightRef.current = false;
      };
    }, [loadGraph]),
  );

  const visibleGraph = useMemo(
    () => graphForPeriod(graph, period),
    [graph, period],
  );
  const noData = status === "ready" && (visibleGraph?.nodes.length ?? 0) === 0;
  const periodLabel =
    PERIODS.find(({ id }) => id === period)?.label ?? "Gesamt";
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
  }, [contentOpacity, period, status]);

  const selectViewMode = useCallback(
    (index: number) => {
      const next = Math.max(0, Math.min(VIEW_MODES.length - 1, index));
      if (next === activeViewModeIndex) return;
      retainedViewModeIndex = next;
      setActiveViewModeIndex(next);
      NativeAnimated.parallel([
        NativeAnimated.timing(viewModeOpacities[activeViewModeIndex], {
          toValue: 0,
          duration: 160,
          easing: NativeEasing.out(NativeEasing.cubic),
          useNativeDriver: true,
        }),
        NativeAnimated.timing(viewModeOpacities[next], {
          toValue: 1,
          duration: 220,
          easing: NativeEasing.out(NativeEasing.cubic),
          useNativeDriver: true,
        }),
      ]).start();
    },
    [activeViewModeIndex, viewModeOpacities],
  );

  const selectPeriod = (next: Period) => {
    retainedPeriod = next;
    setPeriod(next);
    setPeriodSheetOpen(false);
  };

  return (
    <View style={styles.root}>
      <PrimaryScreenHeader
        right={
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
            <Ionicons
              name="chevron-down"
              size={12}
              color={MEMORY_THEME.muted}
            />
          </Pressable>
        }
      />

      <View accessibilityRole="tablist" style={styles.viewModes}>
        {VIEW_MODES.map((viewMode, index) => (
          <ViewModeButton
            key={viewMode}
            index={index}
            onPress={() => selectViewMode(index)}
            selected={index === activeViewModeIndex}
          />
        ))}
      </View>

      <View style={styles.pager}>
        {VIEW_MODES.map((viewMode, index) => (
          <NativeAnimated.View
            key={viewMode}
            pointerEvents={index === activeViewModeIndex ? "auto" : "none"}
            style={[
              styles.page,
              viewMode === "network" && styles.networkPage,
              viewMode === "feeling" && styles.feelingPage,
              {
                opacity: viewModeOpacities[index],
                zIndex: index === activeViewModeIndex ? 1 : 0,
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
            ) : noData && viewMode !== "network" && viewMode !== "feeling" ? (
              <EmptyMessage>
                In diesem Zeitraum nichts aufgenommen.
              </EmptyMessage>
            ) : viewMode === "base" ? (
              <EmptyMessage>Noch nichts hier.</EmptyMessage>
            ) : (
              <NativeAnimated.View
                style={[styles.visualization, { opacity: contentOpacity }]}
              >
                {viewMode === "network" ? (
                  <GalaxyGraph
                    graph={visibleGraph}
                    onRetry={loadGraph}
                    period={period}
                    status="ready"
                  />
                ) : (
                  <FeelingLens
                    active={index === activeViewModeIndex}
                    graph={visibleGraph}
                    period={period}
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
  root: { flex: 1, backgroundColor: MEMORY_THEME.field },
  periodButton: {
    minHeight: 44,
    maxWidth: 170,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 4,
  },
  periodButtonText: {
    fontFamily: NOTE_SANS,
    fontSize: MEMORY_FRAME.periodFontSize,
    color: MEMORY_THEME.muted,
  },
  viewModes: {
    paddingTop: 14,
    paddingBottom: 2,
    paddingHorizontal: MEMORY_FRAME.horizontalPadding,
    flexDirection: "row",
    alignItems: "center",
    gap: MEMORY_FRAME.tabGap,
  },
  viewModeLabel: {
    fontFamily: NOTE_SANS,
    fontSize: MEMORY_FRAME.tabFontSize,
    fontWeight: "400",
    letterSpacing: 0,
    color: MEMORY_THEME.inactive,
  },
  pager: { flex: 1, position: "relative" },
  page: {
    ...StyleSheet.absoluteFillObject,
    paddingHorizontal: 14,
    paddingTop: 2,
    paddingBottom: 104,
  },
  networkPage: {
    paddingHorizontal: 0,
    paddingTop: 0,
    paddingBottom: 0,
  },
  feelingPage: {
    paddingHorizontal: 0,
    paddingTop: 0,
    paddingBottom: 0,
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
    paddingVertical: 4,
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
    fontFamily: NOTE_SANS,
    fontSize: MEMORY_FRAME.periodFontSize,
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
