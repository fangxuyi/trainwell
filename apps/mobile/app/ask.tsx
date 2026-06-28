import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  FlatList,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from "react-native";
import { useState, useRef } from "react";
import { apiPost } from "../src/utils/api";

interface Message {
  id: string;
  role: "user" | "assistant";
  text: string;
}

export default function AskScreen() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const listRef = useRef<FlatList>(null);

  const send = async () => {
    const question = input.trim();
    if (!question || loading) return;

    const userMsg: Message = { id: Date.now().toString(), role: "user", text: question };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setLoading(true);

    try {
      const res = await apiPost<{ answer: string }>("/api/assistant", { question });
      const aiMsg: Message = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        text: res.answer,
      };
      setMessages((prev) => [...prev, aiMsg]);
    } catch (err) {
      const errMsg: Message = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        text: "Sorry, couldn't reach the server. Check your connection and try again.",
      };
      setMessages((prev) => [...prev, errMsg]);
    } finally {
      setLoading(false);
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 100);
    }
  };

  const renderItem = ({ item }: { item: Message }) => (
    <View
      style={[
        styles.bubble,
        item.role === "user" ? styles.userBubble : styles.aiBubble,
      ]}
    >
      <Text style={item.role === "user" ? styles.userText : styles.aiText}>
        {item.text}
      </Text>
    </View>
  );

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={90}
    >
      {messages.length === 0 && (
        <View style={styles.emptyState}>
          <Text style={styles.emptyTitle}>Ask about your workouts</Text>
          <Text style={styles.emptyHint}>
            "What exercises did I do last session?"{"\n"}
            "How has my squat weight changed?"{"\n"}
            "What cues did my trainer give me?"
          </Text>
        </View>
      )}

      <FlatList
        ref={listRef}
        data={messages}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        contentContainerStyle={styles.list}
        onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
      />

      {loading && (
        <View style={styles.thinkingRow}>
          <ActivityIndicator size="small" color="#38BDF8" />
          <Text style={styles.thinkingText}>Thinking...</Text>
        </View>
      )}

      <View style={styles.inputRow}>
        <TextInput
          style={styles.input}
          value={input}
          onChangeText={setInput}
          placeholder="Ask anything about your workouts..."
          placeholderTextColor="#475569"
          multiline
          returnKeyType="send"
          onSubmitEditing={send}
          blurOnSubmit
        />
        <TouchableOpacity
          style={[styles.sendButton, (!input.trim() || loading) && styles.sendDisabled]}
          onPress={send}
          disabled={!input.trim() || loading}
        >
          <Text style={styles.sendText}>Send</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0F172A" },
  list: { padding: 16, paddingBottom: 8, flexGrow: 1, justifyContent: "flex-end" },
  emptyState: {
    position: "absolute",
    top: 0, left: 0, right: 0, bottom: 80,
    justifyContent: "center",
    alignItems: "center",
    padding: 32,
  },
  emptyTitle: {
    color: "#94A3B8",
    fontSize: 18,
    fontWeight: "600",
    marginBottom: 16,
    textAlign: "center",
  },
  emptyHint: {
    color: "#475569",
    fontSize: 14,
    lineHeight: 24,
    textAlign: "center",
  },
  bubble: {
    maxWidth: "85%",
    borderRadius: 16,
    padding: 12,
    marginBottom: 10,
  },
  userBubble: {
    backgroundColor: "#2563EB",
    alignSelf: "flex-end",
    borderBottomRightRadius: 4,
  },
  aiBubble: {
    backgroundColor: "#1E293B",
    alignSelf: "flex-start",
    borderBottomLeftRadius: 4,
  },
  userText: { color: "#fff", fontSize: 15, lineHeight: 21 },
  aiText: { color: "#CBD5E1", fontSize: 15, lineHeight: 21 },
  thinkingRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingBottom: 8,
    gap: 8,
  },
  thinkingText: { color: "#475569", fontSize: 13 },
  inputRow: {
    flexDirection: "row",
    padding: 12,
    gap: 10,
    borderTopWidth: 1,
    borderTopColor: "#1E293B",
    alignItems: "flex-end",
  },
  input: {
    flex: 1,
    backgroundColor: "#1E293B",
    borderRadius: 12,
    color: "#F1F5F9",
    fontSize: 15,
    paddingHorizontal: 14,
    paddingVertical: 10,
    maxHeight: 100,
  },
  sendButton: {
    backgroundColor: "#2563EB",
    borderRadius: 12,
    paddingHorizontal: 18,
    paddingVertical: 10,
    justifyContent: "center",
  },
  sendDisabled: { backgroundColor: "#1E3A6E", opacity: 0.5 },
  sendText: { color: "#fff", fontWeight: "700", fontSize: 15 },
});
