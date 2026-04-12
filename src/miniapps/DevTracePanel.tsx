/**
 * Dev-only trace panel for the mini-app harness.
 *
 * Renders as a small floating button inside MiniAppChatView (visible
 * ONLY in __DEV__ builds) that opens a bottom sheet with three tabs:
 *
 *   - Attempts — each AttemptRecord from the most recent run
 *   - Trace    — the raw TraceEvent stream with colored pills per type
 *   - Program  — the currently-written program text
 *
 * The panel buffers trace events in a ref held by ChatScreen; opening
 * the sheet just dumps the current buffer. No state storms, no IPC.
 *
 * This is the "I need a post-mortem without reproducing the bug"
 * tool. It's explicitly dev-only because it shows internal error
 * classes, stack traces, and raw prompts that aren't meant for users.
 */

import React, { useState, useMemo } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../context/ThemeContext";
import { type ColorPalette, FONT, RADII, SPACING } from "../constants/theme";
import type { TraceEvent } from "./harness";
import type { AttemptRecord } from "./errorFeedback";

type Tab = "attempts" | "trace" | "program";

export interface DevTracePanelProps {
  /** Most recent trace event buffer (oldest first). */
  trace: TraceEvent[];
  /** AttemptRecords for the most recent run. */
  attempts: AttemptRecord[];
  /** The currently-written program text, or null if no app yet. */
  program: string | null;
}

/**
 * Top-level floating-button + modal component. The button is tiny
 * and anchored bottom-right so it doesn't interfere with WebView
 * gestures. Tap opens the sheet; tap the backdrop or the close
 * button to dismiss.
 */
export function DevTracePanel(props: DevTracePanelProps): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  // Small red-dot badge if the most recent run ended in an error.
  const hasError = props.attempts.some((a) => a.errorKind || a.errorMessage);

  return (
    <>
      <TouchableOpacity
        onPress={() => setOpen(true)}
        style={styles.fab}
        activeOpacity={0.7}
        hitSlop={8}
      >
        <Ionicons name="bug-outline" size={16} color={colors.textSecondary} />
        {hasError ? <View style={styles.fabBadge} /> : null}
      </TouchableOpacity>

      <Modal
        visible={open}
        transparent
        animationType="slide"
        onRequestClose={() => setOpen(false)}
      >
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)}>
          <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
            <DevTracePanelBody {...props} onClose={() => setOpen(false)} />
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

function DevTracePanelBody(
  props: DevTracePanelProps & { onClose: () => void },
): React.JSX.Element {
  const [tab, setTab] = useState<Tab>("attempts");
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  return (
    <View style={styles.sheetBody}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Mini-app harness trace</Text>
        <TouchableOpacity onPress={props.onClose} hitSlop={8}>
          <Ionicons name="close" size={20} color={colors.textSecondary} />
        </TouchableOpacity>
      </View>

      <View style={styles.tabs}>
        <TabButton
          label={`Attempts (${props.attempts.length})`}
          active={tab === "attempts"}
          onPress={() => setTab("attempts")}
        />
        <TabButton
          label={`Trace (${props.trace.length})`}
          active={tab === "trace"}
          onPress={() => setTab("trace")}
        />
        <TabButton
          label="Program"
          active={tab === "program"}
          onPress={() => setTab("program")}
        />
      </View>

      <ScrollView
        style={styles.tabContent}
        contentContainerStyle={styles.tabContentInner}
      >
        {tab === "attempts" && <AttemptsTab attempts={props.attempts} />}
        {tab === "trace" && <TraceTab trace={props.trace} />}
        {tab === "program" && <ProgramTab program={props.program} />}
      </ScrollView>
    </View>
  );
}

function TabButton({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}): React.JSX.Element {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return (
    <TouchableOpacity
      onPress={onPress}
      style={[styles.tabButton, active && styles.tabButtonActive]}
      activeOpacity={0.7}
    >
      <Text style={[styles.tabLabel, active && styles.tabLabelActive]}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

function AttemptsTab({
  attempts,
}: {
  attempts: AttemptRecord[];
}): React.JSX.Element {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  if (attempts.length === 0) {
    return <Text style={styles.emptyLabel}>No attempts recorded.</Text>;
  }
  return (
    <>
      {attempts.map((a, i) => (
        <View key={i} style={styles.attemptRow}>
          <View style={styles.attemptRowHeader}>
            <Text style={styles.attemptIdx}>#{a.attempt}</Text>
            {a.toolUsed ? (
              <Text style={styles.attemptTool}>{a.toolUsed}</Text>
            ) : null}
            {a.errorKind ? (
              <Text style={styles.attemptErrorKind}>{a.errorKind}</Text>
            ) : (
              <Text style={styles.attemptSuccess}>success</Text>
            )}
          </View>
          {a.errorMessage ? (
            <Text style={styles.attemptMsg}>{a.errorMessage}</Text>
          ) : null}
          {a.programFingerprint ? (
            <Text style={styles.attemptMeta}>
              fingerprint: {a.programFingerprint}
            </Text>
          ) : null}
        </View>
      ))}
    </>
  );
}

function TraceTab({ trace }: { trace: TraceEvent[] }): React.JSX.Element {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  if (trace.length === 0) {
    return <Text style={styles.emptyLabel}>No trace events yet.</Text>;
  }
  const startAt = trace[0].at;
  return (
    <>
      {trace.map((ev, i) => {
        const delta = (ev.at - startAt).toString().padStart(5, " ") + "ms";
        return (
          <View key={i} style={styles.traceRow}>
            <Text style={styles.traceDelta}>{delta}</Text>
            <Text style={[styles.tracePill, pillStyleForType(ev.t, colors)]}>
              {ev.t}
            </Text>
            <Text style={styles.tracePayload} numberOfLines={3}>
              {renderTracePayload(ev)}
            </Text>
          </View>
        );
      })}
    </>
  );
}

function ProgramTab({
  program,
}: {
  program: string | null;
}): React.JSX.Element {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  if (!program) {
    return <Text style={styles.emptyLabel}>No program written yet.</Text>;
  }
  return (
    <View>
      <Text style={styles.programMeta}>{program.length} chars</Text>
      <Text style={styles.programCode}>{program}</Text>
    </View>
  );
}

/** Extract a compact text summary for a TraceEvent (max ~120 chars). */
function renderTracePayload(ev: TraceEvent): string {
  const { t, at: _at, ...rest } = ev;
  try {
    return JSON.stringify(rest).slice(0, 160);
  } catch {
    return String(t);
  }
}

function pillStyleForType(
  t: TraceEvent["t"],
  colors: ColorPalette,
): { backgroundColor: string; color: string } {
  // Color-code pills by phase so the timeline scans quickly.
  switch (t) {
    case "start":
    case "done":
      return { backgroundColor: colors.accent, color: "#fff" };
    case "promptBuilt":
    case "compact":
      return { backgroundColor: colors.surface, color: colors.textSecondary };
    case "llamaStart":
    case "llamaEnd":
      return { backgroundColor: colors.surfaceHover, color: colors.textPrimary };
    case "toolCall":
    case "toolResult":
      return { backgroundColor: colors.surfaceHover, color: colors.textPrimary };
    case "retry":
    case "timeout":
      return { backgroundColor: colors.errorBarBg, color: colors.errorText };
    case "cancelled":
      return { backgroundColor: colors.surface, color: colors.textTertiary };
    default:
      return { backgroundColor: colors.surface, color: colors.textSecondary };
  }
}

function createStyles(colors: ColorPalette) {
  return StyleSheet.create({
    fab: {
      position: "absolute",
      bottom: 18,
      right: 18,
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: colors.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      alignItems: "center",
      justifyContent: "center",
      opacity: 0.85,
    },
    fabBadge: {
      position: "absolute",
      top: 4,
      right: 4,
      width: 8,
      height: 8,
      borderRadius: 4,
      backgroundColor: colors.errorText,
    },
    backdrop: {
      flex: 1,
      backgroundColor: "rgba(0,0,0,0.5)",
      justifyContent: "flex-end",
    },
    sheet: {
      backgroundColor: colors.base,
      borderTopLeftRadius: RADII.lg,
      borderTopRightRadius: RADII.lg,
      maxHeight: "80%",
      minHeight: "40%",
      overflow: "hidden",
    },
    sheetBody: {
      flex: 1,
      paddingHorizontal: SPACING.lg,
      paddingTop: SPACING.lg,
      paddingBottom: SPACING.xl,
    },
    header: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginBottom: SPACING.md,
    },
    headerTitle: {
      fontSize: 15,
      fontWeight: FONT.semibold,
      color: colors.textPrimary,
    },
    tabs: {
      flexDirection: "row",
      gap: SPACING.xs,
      marginBottom: SPACING.sm,
    },
    tabButton: {
      paddingHorizontal: SPACING.md,
      paddingVertical: SPACING.sm,
      borderRadius: RADII.sm,
      backgroundColor: colors.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    tabButtonActive: {
      backgroundColor: colors.surfaceHover,
      borderColor: colors.accent,
    },
    tabLabel: {
      fontSize: 11,
      color: colors.textSecondary,
      fontWeight: FONT.medium,
    },
    tabLabelActive: {
      color: colors.textPrimary,
    },
    tabContent: {
      flex: 1,
    },
    tabContentInner: {
      paddingBottom: SPACING.lg,
    },
    emptyLabel: {
      fontSize: 13,
      fontStyle: "italic",
      color: colors.textTertiary,
      textAlign: "center",
      marginTop: SPACING.lg,
    },

    attemptRow: {
      backgroundColor: colors.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      borderRadius: RADII.sm,
      padding: SPACING.sm,
      marginBottom: SPACING.sm,
    },
    attemptRowHeader: {
      flexDirection: "row",
      alignItems: "center",
      gap: SPACING.sm,
      marginBottom: 2,
    },
    attemptIdx: {
      fontSize: 11,
      fontWeight: FONT.semibold,
      color: colors.textPrimary,
    },
    attemptTool: {
      fontSize: 10,
      color: colors.textSecondary,
      fontFamily: "Menlo",
    },
    attemptErrorKind: {
      fontSize: 10,
      color: colors.errorText,
      fontFamily: "Menlo",
    },
    attemptSuccess: {
      fontSize: 10,
      color: colors.accent,
      fontFamily: "Menlo",
    },
    attemptMsg: {
      fontSize: 11,
      color: colors.textSecondary,
      marginTop: 2,
    },
    attemptMeta: {
      fontSize: 9,
      color: colors.textTertiary,
      marginTop: 2,
      fontFamily: "Menlo",
    },

    traceRow: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: SPACING.xs,
      marginBottom: 4,
    },
    traceDelta: {
      fontSize: 9,
      color: colors.textTertiary,
      fontFamily: "Menlo",
      width: 50,
    },
    tracePill: {
      fontSize: 9,
      fontWeight: FONT.semibold,
      paddingHorizontal: 6,
      paddingVertical: 2,
      borderRadius: RADII.sm,
      fontFamily: "Menlo",
      minWidth: 70,
      textAlign: "center",
      overflow: "hidden",
    },
    tracePayload: {
      flex: 1,
      fontSize: 9,
      color: colors.textSecondary,
      fontFamily: "Menlo",
    },

    programMeta: {
      fontSize: 10,
      color: colors.textTertiary,
      marginBottom: SPACING.sm,
    },
    programCode: {
      fontSize: 11,
      color: colors.textPrimary,
      fontFamily: "Menlo",
      lineHeight: 16,
    },
  });
}
