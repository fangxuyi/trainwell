import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
  ScrollView,
} from "react-native";
import { useRouter } from "expo-router";
import { useState } from "react";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system";
import { uuid } from "../src/utils/uuid";
import { importSession } from "../src/db/sessions";
import { apiPost } from "../src/utils/api";

function parseWorkoutMarkdown(content: string, filename: string): {
  title: string;
  startedAt: string;
  durationSeconds?: number;
} {
  // Title from first H1 heading, or fall back to filename
  const h1Match = content.match(/^#\s+(.+)$/m);
  const title = h1Match ? h1Match[1].trim() : filename.replace(/\.md$/i, "");

  // Date from "Workout M-D" pattern in title or filename
  const dateMatch = (title + " " + filename).match(/(\d{1,2})-(\d{1,2})/);
  let startedAt: string;
  if (dateMatch) {
    const month = parseInt(dateMatch[1], 10);
    const day = parseInt(dateMatch[2], 10);
    const year = new Date().getFullYear();
    startedAt = new Date(year, month - 1, day, 10, 0, 0).toISOString();
  } else {
    startedAt = new Date().toISOString();
  }

  // Duration from "X min" or "X minutes" anywhere in content
  const durationMatch = content.match(/(\d+)\s*(?:min(?:utes?)?)/i);
  const durationSeconds = durationMatch
    ? parseInt(durationMatch[1], 10) * 60
    : undefined;

  return { title, startedAt, durationSeconds };
}

export default function ImportScreen() {
  const router = useRouter();
  const [importing, setImporting] = useState(false);
  const [preview, setPreview] = useState<{
    title: string;
    startedAt: string;
    durationSeconds?: number;
    content: string;
    filename: string;
  } | null>(null);

  const pickFile = async () => {
    const result = await DocumentPicker.getDocumentAsync({
      type: ["text/markdown", "text/plain", "public.plain-text"],
      copyToCacheDirectory: true,
    });

    if (result.canceled || !result.assets?.[0]) return;

    const asset = result.assets[0];
    const content = await FileSystem.readAsStringAsync(asset.uri);
    const filename = asset.name ?? "workout.md";

    const parsed = parseWorkoutMarkdown(content, filename);
    setPreview({ ...parsed, content, filename });
  };

  const confirmImport = async () => {
    if (!preview) return;
    setImporting(true);

    try {
      const id = uuid();

      // Create server-side session first so Q&A can see it
      await apiPost("/api/workouts/import", {
        id,
        startedAt: preview.startedAt,
        durationSeconds: preview.durationSeconds,
        markdownContent: preview.content,
      });

      // Mirror locally so it appears in history immediately
      await importSession({
        id,
        startedAt: preview.startedAt,
        durationSeconds: preview.durationSeconds,
        markdownContent: preview.content,
      });

      Alert.alert("Imported", `"${preview.title}" added to your history.`, [
        { text: "OK", onPress: () => router.back() },
      ]);
    } catch (err) {
      Alert.alert("Import failed", (err as Error).message);
    } finally {
      setImporting(false);
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.description}>
        Pick a Markdown (.md) workout summary file to import it into Trainwell.
        The session will appear in your history and be available for Q&A.
      </Text>

      <TouchableOpacity style={styles.pickButton} onPress={pickFile} disabled={importing}>
        <Text style={styles.pickButtonText}>Choose Markdown File</Text>
      </TouchableOpacity>

      {preview && (
        <View style={styles.previewCard}>
          <Text style={styles.previewLabel}>File</Text>
          <Text style={styles.previewValue}>{preview.filename}</Text>

          <Text style={styles.previewLabel}>Session date</Text>
          <Text style={styles.previewValue}>
            {new Date(preview.startedAt).toLocaleDateString("en-US", {
              weekday: "long",
              year: "numeric",
              month: "long",
              day: "numeric",
            })}
          </Text>

          {preview.durationSeconds && (
            <>
              <Text style={styles.previewLabel}>Duration</Text>
              <Text style={styles.previewValue}>
                ~{Math.round(preview.durationSeconds / 60)} min
              </Text>
            </>
          )}

          <Text style={styles.previewLabel}>Content size</Text>
          <Text style={styles.previewValue}>
            {preview.content.length.toLocaleString()} characters
          </Text>

          {importing ? (
            <ActivityIndicator color="#38BDF8" style={{ marginTop: 20 }} />
          ) : (
            <TouchableOpacity style={styles.importButton} onPress={confirmImport}>
              <Text style={styles.importButtonText}>Import Session</Text>
            </TouchableOpacity>
          )}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0F172A" },
  content: { padding: 20, paddingBottom: 60 },
  description: {
    color: "#94A3B8",
    fontSize: 14,
    lineHeight: 22,
    marginBottom: 24,
  },
  pickButton: {
    backgroundColor: "#1E293B",
    borderRadius: 12,
    padding: 16,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#334155",
    borderStyle: "dashed",
  },
  pickButtonText: { color: "#38BDF8", fontSize: 15, fontWeight: "600" },
  previewCard: {
    backgroundColor: "#1E293B",
    borderRadius: 12,
    padding: 16,
    marginTop: 20,
  },
  previewLabel: { color: "#475569", fontSize: 12, marginTop: 12 },
  previewValue: { color: "#F1F5F9", fontSize: 15, fontWeight: "500", marginTop: 2 },
  importButton: {
    backgroundColor: "#2563EB",
    borderRadius: 10,
    padding: 14,
    alignItems: "center",
    marginTop: 20,
  },
  importButtonText: { color: "#fff", fontSize: 15, fontWeight: "700" },
});
