import type { WorkoutSession } from "@trainwell/schemas";
import { useCallback, useRef, useState, type ReactNode } from "react";
import {
  ActivityIndicator,
  Alert,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { ExerciseMediaPreview } from "../../src/components/ExerciseMediaPreview";
import { getNotesBySession } from "../../src/db/quickNotes";
import { deleteSession, getSessionById } from "../../src/db/sessions";
import { deleteLocalAudio } from "../../src/storage/audioFiles";
import {
  processInterruptedRecording,
  retrySessionSync,
} from "../../src/sync/recovery";
import { HeaderAction, ScreenHeader } from "../../src/ui/ScreenHeader";
import { sessionStatusPresentation } from "../../src/ui/sessionPresentation";
import { colors, radii } from "../../src/ui/theme";
import { apiDelete } from "../../src/utils/api";
import { formatDuration } from "../../src/utils/time";

const SYNCING_STATUSES = new Set(["syncing", "locally_complete"]);

export default function SessionDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [session, setSession] = useState<WorkoutSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [noteCount, setNoteCount] = useState(0);
  const [recovering, setRecovering] = useState(false);
  const [previewExerciseId, setPreviewExerciseId] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadAll = useCallback(async () => {
    const [currentSession, notes] = await Promise.all([
      getSessionById(id),
      getNotesBySession(id),
    ]);
    setSession(currentSession);
    setNoteCount(notes.length);
    setLoading(false);
    return currentSession;
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      loadAll().then((currentSession) => {
        if (currentSession && SYNCING_STATUSES.has(currentSession.localStatus)) {
          pollRef.current = setInterval(async () => {
            const refreshed = await getSessionById(id);
            if (!refreshed) return;
            setSession(refreshed);
            if (!SYNCING_STATUSES.has(refreshed.localStatus)) {
              clearInterval(pollRef.current!);
              pollRef.current = null;
            }
          }, 3000);
        }
      });

      return () => {
        if (pollRef.current) {
          clearInterval(pollRef.current);
          pollRef.current = null;
        }
      };
    }, [id, loadAll])
  );

  const handleDelete = () => {
    Alert.alert(
      "Delete Session",
      "This permanently deletes the session and all local audio. This cannot be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            try {
              await apiDelete(`/api/workouts/${id}`);
              await deleteLocalAudio(id);
              await deleteSession(id);
              router.replace("/");
            } catch (error) {
              Alert.alert("Could not delete session", (error as Error).message);
            }
          },
        },
      ]
    );
  };

  if (loading) {
    return (
      <SafeAreaView style={[styles.safeArea, styles.center]}>
        <ActivityIndicator color={colors.accent} />
      </SafeAreaView>
    );
  }

  if (!session) {
    return (
      <SafeAreaView style={[styles.safeArea, styles.center]}>
        <Text style={styles.errorText}>Session not found.</Text>
        <TouchableOpacity style={styles.returnButton} onPress={() => router.replace("/")}>
          <Text style={styles.returnButtonText}>Return home</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  const status = sessionStatusPresentation(session);
  const isSyncing = SYNCING_STATUSES.has(session.localStatus);
  const date = new Date(session.startedAt);

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <ScreenHeader
          eyebrow="SESSION RECAP"
          title={session.workoutType ?? "Training session"}
          subtitle={date.toLocaleDateString("en-US", {
            weekday: "long",
            month: "long",
            day: "numeric",
            year: "numeric",
          })}
          onBack={() => router.back()}
          action={<HeaderAction label="History" onPress={() => router.push("/history")} />}
        />

        <View style={styles.heroCard}>
          <View style={styles.heroOrb} />
          <View style={styles.heroTopRow}>
            <View style={styles.dateTile}>
              <Text style={styles.dateMonth}>
                {date.toLocaleDateString("en-US", { month: "short" }).toUpperCase()}
              </Text>
              <Text style={styles.dateDay}>{date.getDate()}</Text>
            </View>
            <View style={styles.heroCopy}>
              <View style={styles.statusRow}>
                <View style={[styles.statusDot, { backgroundColor: status.color }]} />
                <Text style={[styles.statusText, { color: status.color }]}>{status.label}</Text>
              </View>
              <Text style={styles.heroTitle}>Your work, captured.</Text>
              <Text style={styles.heroMeta}>
                {session.trainerName ? `Training with ${session.trainerName}` : "Independent training session"}
              </Text>
            </View>
          </View>
          {session.goals.length > 0 && (
            <View style={styles.goalRow}>
              {session.goals.slice(0, 3).map((goal) => (
                <View key={goal} style={styles.goalPill}>
                  <Text style={styles.goalText}>{goal}</Text>
                </View>
              ))}
            </View>
          )}
        </View>

        <View style={styles.metricsRow}>
          <MetricTile
            value={session.durationSeconds ? formatDuration(session.durationSeconds) : "—"}
            label="Duration"
          />
          <MetricTile value={String(session.exercises?.length ?? 0)} label="Exercises" />
          <MetricTile value={String(noteCount)} label="Quick notes" />
        </View>

        {isSyncing && (
          <View style={styles.syncingCard}>
            <ActivityIndicator color={colors.warning} size="small" />
            <View style={styles.noticeCopy}>
              <Text style={styles.syncingTitle}>Building your recap</Text>
              <Text style={styles.syncingText}>
                {session.localStatus === "syncing"
                  ? "Uploading and processing your session."
                  : "Preparing your recording for sync."}
              </Text>
            </View>
          </View>
        )}

        {session.localStatus === "interrupted" && (
          <View style={styles.interruptedCard}>
            <Text style={styles.noticeEyebrow}>RECOVERY AVAILABLE</Text>
            <Text style={styles.interruptedTitle}>The recording stopped unexpectedly.</Text>
            <Text style={styles.interruptedText}>
              Trainwell preserved any audio left on this phone. It may be incomplete and will not
              upload unless you choose to process it.
            </Text>
            <TouchableOpacity
              style={[styles.recoveryButton, recovering && styles.buttonDisabled]}
              disabled={recovering}
              onPress={async () => {
                setRecovering(true);
                try {
                  await processInterruptedRecording(id);
                } catch (error) {
                  Alert.alert("Recovery failed", (error as Error).message);
                } finally {
                  await loadAll();
                  setRecovering(false);
                }
              }}
            >
              <Text style={styles.recoveryButtonText}>
                {recovering ? "Trying saved audio…" : "Try processing saved audio"}
              </Text>
              <Text style={styles.recoveryArrow}>→</Text>
            </TouchableOpacity>
          </View>
        )}

        {session.exercises && session.exercises.length > 0 && (
          <ReportSection eyebrow="MOVEMENT BREAKDOWN" title="Exercises">
            {session.exercises.map((exercise, index) => {
              const exerciseKey = exercise.id || String(index);
              return (
                <View key={exerciseKey} style={styles.exerciseRow}>
                  <View style={styles.exerciseHeader}>
                    <View style={styles.exerciseNumber}>
                      <Text style={styles.exerciseNumberText}>
                        {String(index + 1).padStart(2, "0")}
                      </Text>
                    </View>
                    <View style={styles.exerciseBody}>
                      <Text style={styles.exerciseName}>{exercise.canonicalName}</Text>
                      {exercise.sets.length > 0 && (
                        <Text style={styles.exerciseDetail}>
                          {exercise.sets.length} set{exercise.sets.length !== 1 ? "s" : ""}
                          {exercise.sets[0]?.weight
                            ? `  ·  ${exercise.sets[0].weight.value} ${exercise.sets[0].weight.unit}`
                            : ""}
                        </Text>
                      )}
                    </View>
                  </View>
                  {exercise.techniqueNotes.length > 0 && (
                    <Text style={styles.exerciseCue}>{exercise.techniqueNotes[0].text}</Text>
                  )}
                  {exercise.referenceMedia && (
                    <ExerciseMediaPreview
                      exerciseName={exercise.canonicalName}
                      media={exercise.referenceMedia}
                      expanded={previewExerciseId === exerciseKey}
                      onToggle={() =>
                        setPreviewExerciseId((current) =>
                          current === exerciseKey ? null : exerciseKey
                        )
                      }
                    />
                  )}
                </View>
              );
            })}
          </ReportSection>
        )}

        {session.markdownContent && (
          <ReportSection eyebrow="GENERATED RECORD" title="Session summary">
            <Text style={styles.summaryText}>{session.markdownContent}</Text>
          </ReportSection>
        )}

        {session.sessionNotes && session.sessionNotes.length > 0 && (
          <ReportSection eyebrow="FROM THE SESSION" title="Notes">
            {session.sessionNotes.map((note, index) => (
              <ListItem key={`${note}-${index}`} text={note} />
            ))}
          </ReportSection>
        )}

        {session.nextSessionPlan && (
          <ReportSection eyebrow="KEEP THE MOMENTUM" title="Next session">
            {session.nextSessionPlan.exercises.map((exercise, index) => (
              <View key={`${exercise.exerciseName}-${index}`} style={styles.planItem}>
                <Text style={styles.planNumber}>{String(index + 1).padStart(2, "0")}</Text>
                <View style={styles.planCopy}>
                  <Text style={styles.planName}>{exercise.exerciseName}</Text>
                  <Text style={styles.planDetail}>
                    {[
                      exercise.targetSets ? `${exercise.targetSets} sets` : null,
                      exercise.targetWeight ? `at ${exercise.targetWeight}` : null,
                    ]
                      .filter(Boolean)
                      .join(" · ") || "Continue building from this session"}
                  </Text>
                </View>
              </View>
            ))}
            {session.nextSessionPlan.generalNotes.map((note, index) => (
              <ListItem key={`${note}-${index}`} text={note} />
            ))}
          </ReportSection>
        )}

        {session.remoteStatus === "review_required" && session.syncStatus === "pending" && (
          <View style={styles.reviewButton}>
            <View>
              <Text style={styles.reviewEyebrow}>SAVING YOUR REVIEW</Text>
              <Text style={styles.reviewTitle}>Finalizing…</Text>
            </View>
            <ActivityIndicator color={colors.background} />
          </View>
        )}

        {session.remoteStatus === "review_required" && session.syncStatus !== "pending" && (
          <TouchableOpacity
            style={styles.reviewButton}
            onPress={() => router.push(`/review/${id}`)}
          >
            <View>
              <Text style={styles.reviewEyebrow}>MAKE IT YOURS</Text>
              <Text style={styles.reviewTitle}>Review & finalize</Text>
            </View>
            <View style={styles.reviewArrowCircle}>
              <Text style={styles.reviewArrow}>↗</Text>
            </View>
          </TouchableOpacity>
        )}

        {session.localStatus === "local_error" && (
          <View style={styles.errorCard}>
            <Text style={styles.noticeEyebrow}>SYNC NEEDS ATTENTION</Text>
            <Text style={styles.errorTitle}>Your session is safe on this phone.</Text>
            <Text style={styles.errorCardText}>
              Try the upload again, or add credits if your balance is empty.
            </Text>
            <View style={styles.errorActions}>
              <TouchableOpacity
                style={styles.errorAction}
                onPress={async () => {
                  try {
                    await retrySessionSync(id);
                  } catch (error) {
                    Alert.alert("Retry failed", (error as Error).message);
                  } finally {
                    await loadAll();
                  }
                }}
              >
                <Text style={styles.errorActionText}>Retry sync</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.errorAction} onPress={() => router.push("/credits")}>
                <Text style={styles.errorActionText}>Get credits</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        <TouchableOpacity style={styles.deleteButton} onPress={handleDelete}>
          <Text style={styles.deleteButtonText}>Delete this session</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

function MetricTile({ value, label }: { value: string; label: string }) {
  return (
    <View style={styles.metricTile}>
      <Text style={styles.metricValue} numberOfLines={1}>{value}</Text>
      <Text style={styles.metricLabel}>{label}</Text>
    </View>
  );
}

function ReportSection({
  eyebrow,
  title,
  children,
}: {
  eyebrow: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <View style={styles.reportSection}>
      <Text style={styles.sectionEyebrow}>{eyebrow}</Text>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

function ListItem({ text }: { text: string }) {
  return (
    <View style={styles.listItem}>
      <View style={styles.listDot} />
      <Text style={styles.listText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  scrollView: { flex: 1 },
  content: { paddingHorizontal: 18, paddingTop: 10, paddingBottom: 48 },
  center: { alignItems: "center", justifyContent: "center", padding: 24 },
  errorText: { color: colors.danger, fontSize: 16, fontWeight: "700" },
  returnButton: { marginTop: 16, borderRadius: radii.pill, backgroundColor: colors.surface, paddingHorizontal: 16, paddingVertical: 10 },
  returnButtonText: { color: colors.accent, fontSize: 12, fontWeight: "800" },
  heroCard: {
    borderRadius: 28,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 19,
    overflow: "hidden",
  },
  heroOrb: {
    position: "absolute",
    width: 180,
    height: 180,
    borderRadius: 90,
    borderWidth: 32,
    borderColor: "rgba(199, 243, 107, 0.035)",
    right: -58,
    top: -70,
  },
  heroTopRow: { flexDirection: "row", alignItems: "center" },
  dateTile: { width: 66, height: 76, borderRadius: 20, backgroundColor: colors.accent, alignItems: "center", justifyContent: "center", marginRight: 15 },
  dateMonth: { color: "#506A28", fontSize: 9, fontWeight: "900", letterSpacing: 1.2 },
  dateDay: { color: colors.accentText, fontSize: 30, fontWeight: "900", letterSpacing: -1, marginTop: 1 },
  heroCopy: { flex: 1 },
  statusRow: { flexDirection: "row", alignItems: "center" },
  statusDot: { width: 6, height: 6, borderRadius: 3, marginRight: 6 },
  statusText: { fontSize: 9, fontWeight: "900", letterSpacing: 0.5, textTransform: "uppercase" },
  heroTitle: { color: colors.text, fontSize: 18, fontWeight: "900", letterSpacing: -0.35, marginTop: 7 },
  heroMeta: { color: colors.textMuted, fontSize: 11, marginTop: 5 },
  goalRow: { flexDirection: "row", flexWrap: "wrap", gap: 7, marginTop: 17, paddingTop: 14, borderTopWidth: 1, borderTopColor: colors.border },
  goalPill: { borderRadius: radii.pill, backgroundColor: colors.surfaceMuted, paddingHorizontal: 11, paddingVertical: 7 },
  goalText: { color: colors.textMuted, fontSize: 9, fontWeight: "800" },
  metricsRow: { flexDirection: "row", gap: 9, marginTop: 10, marginBottom: 27 },
  metricTile: { flex: 1, minHeight: 82, borderRadius: radii.medium, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, padding: 13, justifyContent: "center" },
  metricValue: { color: colors.text, fontSize: 20, fontWeight: "900", letterSpacing: -0.6 },
  metricLabel: { color: colors.textFaint, fontSize: 9, fontWeight: "700", marginTop: 4 },
  syncingCard: { flexDirection: "row", alignItems: "center", gap: 12, borderRadius: radii.medium, backgroundColor: "rgba(244, 199, 107, 0.08)", borderWidth: 1, borderColor: "rgba(244, 199, 107, 0.2)", padding: 15, marginBottom: 12 },
  noticeCopy: { flex: 1 },
  syncingTitle: { color: colors.warning, fontSize: 13, fontWeight: "800" },
  syncingText: { color: colors.textMuted, fontSize: 10, lineHeight: 15, marginTop: 3 },
  interruptedCard: { borderRadius: radii.large, backgroundColor: "rgba(244, 199, 107, 0.08)", borderWidth: 1, borderColor: "rgba(244, 199, 107, 0.22)", padding: 18, marginBottom: 12 },
  noticeEyebrow: { color: colors.warning, fontSize: 8, fontWeight: "900", letterSpacing: 1.3 },
  interruptedTitle: { color: colors.text, fontSize: 18, lineHeight: 22, fontWeight: "900", marginTop: 8 },
  interruptedText: { color: colors.textMuted, fontSize: 11, lineHeight: 17, marginTop: 7 },
  recoveryButton: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderRadius: radii.medium, backgroundColor: colors.warning, paddingHorizontal: 15, paddingVertical: 13, marginTop: 15 },
  recoveryButtonText: { color: "#2B220F", fontSize: 12, fontWeight: "900" },
  recoveryArrow: { color: "#2B220F", fontSize: 17 },
  buttonDisabled: { opacity: 0.55 },
  reportSection: { borderRadius: radii.large, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, padding: 17, marginBottom: 12 },
  sectionEyebrow: { color: colors.accent, fontSize: 8, fontWeight: "900", letterSpacing: 1.35 },
  sectionTitle: { color: colors.text, fontSize: 21, fontWeight: "900", letterSpacing: -0.45, marginTop: 5, marginBottom: 15 },
  exerciseRow: { borderRadius: radii.medium, backgroundColor: "rgba(7, 10, 17, 0.52)", borderWidth: 1, borderColor: colors.border, padding: 13, marginBottom: 9 },
  exerciseHeader: { flexDirection: "row", alignItems: "center", gap: 11 },
  exerciseNumber: { width: 36, height: 36, borderRadius: 11, alignItems: "center", justifyContent: "center", backgroundColor: colors.surfaceMuted },
  exerciseNumberText: { color: colors.accent, fontSize: 10, fontWeight: "900" },
  exerciseBody: { flex: 1 },
  exerciseName: { color: colors.text, fontSize: 14, fontWeight: "800" },
  exerciseDetail: { color: colors.textFaint, fontSize: 10, fontWeight: "700", marginTop: 4 },
  exerciseCue: { color: colors.textMuted, fontSize: 11, lineHeight: 17, borderLeftWidth: 2, borderLeftColor: "rgba(155, 138, 251, 0.55)", paddingLeft: 10, marginTop: 11 },
  summaryText: { color: colors.textMuted, fontSize: 13, lineHeight: 21 },
  listItem: { flexDirection: "row", alignItems: "flex-start", gap: 10, marginBottom: 10 },
  listDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.accent, marginTop: 6 },
  listText: { color: colors.textMuted, fontSize: 12, lineHeight: 18, flex: 1 },
  planItem: { flexDirection: "row", alignItems: "center", borderRadius: radii.medium, backgroundColor: colors.violetDark, padding: 13, marginBottom: 9 },
  planNumber: { color: colors.violet, fontSize: 10, fontWeight: "900", width: 31 },
  planCopy: { flex: 1 },
  planName: { color: colors.text, fontSize: 13, fontWeight: "800" },
  planDetail: { color: "#ACA4D7", fontSize: 10, marginTop: 4 },
  reviewButton: { minHeight: 98, flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderRadius: radii.large, backgroundColor: colors.accent, paddingHorizontal: 20, marginBottom: 12, overflow: "hidden" },
  reviewEyebrow: { color: "#506A28", fontSize: 8, fontWeight: "900", letterSpacing: 1.25 },
  reviewTitle: { color: colors.accentText, fontSize: 21, fontWeight: "900", letterSpacing: -0.45, marginTop: 5 },
  reviewArrowCircle: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.accentText, alignItems: "center", justifyContent: "center" },
  reviewArrow: { color: colors.accent, fontSize: 20, fontWeight: "700" },
  errorCard: { borderRadius: radii.large, backgroundColor: "rgba(255, 125, 125, 0.08)", borderWidth: 1, borderColor: "rgba(255, 125, 125, 0.22)", padding: 18, marginBottom: 12 },
  errorTitle: { color: colors.text, fontSize: 17, fontWeight: "900", marginTop: 8 },
  errorCardText: { color: colors.textMuted, fontSize: 11, lineHeight: 17, marginTop: 6 },
  errorActions: { flexDirection: "row", gap: 9, marginTop: 14 },
  errorAction: { flex: 1, borderRadius: radii.medium, backgroundColor: "rgba(255, 125, 125, 0.12)", padding: 12, alignItems: "center" },
  errorActionText: { color: colors.danger, fontSize: 11, fontWeight: "900" },
  deleteButton: { borderRadius: radii.medium, borderWidth: 1, borderColor: "rgba(255, 125, 125, 0.16)", padding: 14, alignItems: "center", marginTop: 7 },
  deleteButtonText: { color: colors.danger, fontSize: 11, fontWeight: "800" },
});
