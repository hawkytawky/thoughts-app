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
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useLocalSearchParams } from "expo-router";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { BottomTabBar } from "@/components/BottomTabBar";
import { NOTE_SANS } from "@/components/NoteUI";
import { PrimaryScreenHeader } from "@/components/PrimaryScreenHeader";
import { TopRightMenu } from "@/components/TopRightMenu";
import { GalaxyGraph } from "@/components/overview/GalaxyGraph";
import { FeelingLens } from "@/components/overview/FeelingLens";
import { MemoryBriefing } from "@/components/overview/MemoryBriefing";
import { formatApiDate } from "@/lib/featured-note";
import { MEMORY_FRAME, MEMORY_THEME } from "@/lib/memory-theme";
import { fetchGraph, type Graph, type GraphNode } from "@/lib/visualizations";
import {
  fetchWeeklyBriefings,
  type WeeklyBriefingArchive,
} from "@/lib/weekly-briefings";

const COLORS = {
  inkFaint: "#9FB2BD",
  deep: "#2E5E8C",
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
  return (
    <TopRightMenu
      closeLabel="Zeitraumauswahl schließen"
      items={PERIODS.map((option) => ({
        key: option.id,
        label: option.label,
        onPress: () => onSelect(option.id),
        selected: option.id === selected,
      }))}
      onClose={onClose}
      visible={visible}
    />
  );
}

export default function OverviewScreen() {
  const params = useLocalSearchParams<{ view?: string }>();
  const initialViewModeIndex = Math.min(
    params.view === "base" ? 0 : retainedViewModeIndex,
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
  const [briefingArchive, setBriefingArchive] =
    useState<WeeklyBriefingArchive | null>(null);
  const briefingArchiveRef = useRef<WeeklyBriefingArchive | null>(null);
  const [briefingStatus, setBriefingStatus] = useState<
    "loading" | "error" | "ready"
  >("loading");
  const briefingRequestIdRef = useRef(0);
  const briefingRequestInFlightRef = useRef(false);
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

  const loadBriefings = useCallback((forceRefresh = false) => {
    if (briefingRequestInFlightRef.current) return;
    briefingRequestInFlightRef.current = true;
    if (!briefingArchiveRef.current) setBriefingStatus("loading");
    const requestId = ++briefingRequestIdRef.current;
    fetchWeeklyBriefings({ forceRefresh })
      .then((archive) => {
        if (requestId !== briefingRequestIdRef.current) return;
        briefingArchiveRef.current = archive;
        setBriefingArchive(archive);
        setBriefingStatus("ready");
      })
      .catch((error: unknown) => {
        if (requestId !== briefingRequestIdRef.current) return;
        if (__DEV__) console.error("Failed to load weekly briefings", error);
        if (!briefingArchiveRef.current) setBriefingStatus("error");
      })
      .finally(() => {
        if (requestId === briefingRequestIdRef.current) {
          briefingRequestInFlightRef.current = false;
        }
      });
  }, []);

  useFocusEffect(
    useCallback(() => {
      if (activeViewModeIndex === 0) return;
      loadGraph();
      const refreshTimer = setInterval(loadGraph, GRAPH_REFRESH_INTERVAL_MS);
      return () => {
        clearInterval(refreshTimer);
        graphRequestIdRef.current += 1;
        graphRequestInFlightRef.current = false;
      };
    }, [activeViewModeIndex, loadGraph]),
  );

  useFocusEffect(
    useCallback(() => {
      loadBriefings();
      return () => {
        briefingRequestIdRef.current += 1;
        briefingRequestInFlightRef.current = false;
      };
    }, [loadBriefings]),
  );

  useEffect(() => {
    if (params.view !== "base" || activeViewModeIndex === 0) return;
    retainedViewModeIndex = 0;
    setActiveViewModeIndex(0);
    viewModeOpacities.forEach((opacity, index) => {
      opacity.setValue(index === 0 ? 1 : 0);
    });
  }, [activeViewModeIndex, params.view, viewModeOpacities]);

  const visibleGraph = useMemo(
    () => graphForPeriod(graph, period),
    [graph, period],
  );
  const visibleBriefingArchive = useMemo(() => {
    if (!briefingArchive || period === "all") return briefingArchive;
    return {
      ...briefingArchive,
      entries: briefingArchive.entries.filter((entry) =>
        periodIncludes(entry.local_end_date, period),
      ),
    };
  }, [briefingArchive, period]);
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
              viewMode === "base" && styles.basePage,
              viewMode === "network" && styles.networkPage,
              viewMode === "feeling" && styles.feelingPage,
              {
                opacity: viewModeOpacities[index],
                zIndex: index === activeViewModeIndex ? 1 : 0,
              },
            ]}
          >
            {index !== activeViewModeIndex ? null : viewMode === "base" ? (
              <MemoryBriefing
                archive={visibleBriefingArchive}
                onRetry={() => loadBriefings(true)}
                status={briefingStatus}
              />
            ) : status === "loading" ? null : status === "error" ? (
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
  basePage: {
    paddingHorizontal: 0,
    paddingTop: 0,
    paddingBottom: 0,
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
  pressed: { opacity: 0.58 },
});
