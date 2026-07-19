import { useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import { HeaderAction, ScreenHeader } from "../src/ui/ScreenHeader";
import { colors, radii } from "../src/ui/theme";
import { apiPost } from "../src/utils/api";

interface Message {
  id: string;
  role: "user" | "assistant";
  text: string;
}

const STARTER_QUESTIONS = [
  "What did I improve recently?",
  "Which trainer cues come up most?",
  "How has my squat progressed?",
];

export default function AskScreen() {
  const router = useRouter();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const listRef = useRef<FlatList<Message>>(null);

  const send = async () => {
    const question = input.trim();
    if (!question || loading) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      role: "user",
      text: question,
    };
    setMessages((previous) => [...previous, userMessage]);
    setInput("");
    setLoading(true);

    try {
      const history = messages.map((message) => ({
        role: message.role,
        content: message.text,
      }));
      const response = await apiPost<{ answer: string }>("/api/assistant", { question, history });
      setMessages((previous) => [
        ...previous,
        {
          id: (Date.now() + 1).toString(),
          role: "assistant",
          text: response.answer,
        },
      ]);
    } catch {
      setMessages((previous) => [
        ...previous,
        {
          id: (Date.now() + 1).toString(),
          role: "assistant",
          text: "I couldn’t reach your training history. Check your connection and try again.",
        },
      ]);
    } finally {
      setLoading(false);
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 100);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView
        style={styles.keyboardView}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => <MessageBubble message={item} />}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.listContent}
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
          ListHeaderComponent={
            <>
              <ScreenHeader
                eyebrow="TRAINING INTELLIGENCE"
                title="Ask your history."
                subtitle="Turn every recorded session into answers you can use in the next one."
                onBack={() => router.back()}
                action={
                  <HeaderAction
                    label="New chat"
                    onPress={() => {
                      if (!loading) {
                        setMessages([]);
                        setInput("");
                      }
                    }}
                  />
                }
              />
              {messages.length === 0 && (
                <EmptyConversation onSelect={setInput} />
              )}
            </>
          }
          ListFooterComponent={
            loading ? (
              <View style={styles.thinkingCard}>
                <View style={styles.aiMark}>
                  <Text style={styles.aiMarkText}>✦</Text>
                </View>
                <ActivityIndicator size="small" color={colors.violet} />
                <Text style={styles.thinkingText}>Reading your training history…</Text>
              </View>
            ) : null
          }
        />

        <View style={styles.composerShell}>
          <View style={styles.composer}>
            <TextInput
              style={styles.input}
              value={input}
              onChangeText={setInput}
              placeholder="Ask about your workouts…"
              placeholderTextColor={colors.textFaint}
              multiline
              returnKeyType="send"
              onSubmitEditing={send}
              blurOnSubmit
            />
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Send question"
              style={[styles.sendButton, (!input.trim() || loading) && styles.sendDisabled]}
              onPress={send}
              disabled={!input.trim() || loading}
            >
              <Text style={styles.sendText}>↑</Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.composerHint}>Answers are grounded in your recorded sessions.</Text>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function EmptyConversation({ onSelect }: { onSelect: (question: string) => void }) {
  return (
    <View style={styles.emptyContainer}>
      <View style={styles.intelligenceCard}>
        <View style={styles.intelligenceOrb} />
        <Text style={styles.spark}>✦</Text>
        <Text style={styles.intelligenceEyebrow}>YOUR SESSIONS, CONNECTED</Text>
        <Text style={styles.intelligenceTitle}>Find the signal in your training.</Text>
        <Text style={styles.intelligenceBody}>
          Ask about exercises, progress, coaching cues, or patterns across time.
        </Text>
      </View>

      <Text style={styles.promptEyebrow}>TRY A QUESTION</Text>
      {STARTER_QUESTIONS.map((question) => (
        <TouchableOpacity
          key={question}
          style={styles.promptCard}
          onPress={() => onSelect(question)}
        >
          <Text style={styles.promptText}>{question}</Text>
          <Text style={styles.promptArrow}>→</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

function MessageBubble({ message }: { message: Message }) {
  const fromUser = message.role === "user";
  return (
    <View style={[styles.messageGroup, fromUser && styles.userMessageGroup]}>
      <Text style={[styles.messageLabel, fromUser && styles.userMessageLabel]}>
        {fromUser ? "YOU" : "TRAINWELL"}
      </Text>
      <View style={[styles.bubble, fromUser ? styles.userBubble : styles.aiBubble]}>
        {fromUser ? (
          <Text style={[styles.messageText, styles.userMessageText]}>{message.text}</Text>
        ) : (
          <AssistantMessage content={message.text} />
        )}
      </View>
    </View>
  );
}

function InlineMarkdown({ text }: { text: string }) {
  return (
    <Text style={styles.messageText}>
      {text.split(/(\*\*[^*]+\*\*)/g).map((part, index) =>
        part.startsWith("**") && part.endsWith("**") ? (
          <Text key={index} style={styles.messageStrong}>{part.slice(2, -2)}</Text>
        ) : (
          <Text key={index}>{part}</Text>
        )
      )}
    </Text>
  );
}

function AssistantMessage({ content }: { content: string }) {
  return (
    <View style={styles.formattedMessage}>
      {content.split("\n").map((rawLine, index) => {
        const line = rawLine.trim();
        if (!line) return <View key={index} style={styles.messageSpacer} />;

        const heading = line.match(/^#{1,3}\s+(.+)$/);
        if (heading) {
          return <Text key={index} style={styles.messageHeading}>{heading[1].replace(/\*\*/g, "")}</Text>;
        }

        const bullet = line.match(/^[-*]\s+(.+)$/);
        if (bullet) {
          return (
            <View key={index} style={styles.messageBulletRow}>
              <Text style={styles.messageBullet}>•</Text>
              <View style={styles.messageBulletContent}><InlineMarkdown text={bullet[1]} /></View>
            </View>
          );
        }

        return <InlineMarkdown key={index} text={line} />;
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  keyboardView: { flex: 1 },
  listContent: { paddingHorizontal: 18, paddingTop: 10, paddingBottom: 20, flexGrow: 1 },
  emptyContainer: { paddingBottom: 14 },
  intelligenceCard: {
    minHeight: 245,
    borderRadius: 28,
    backgroundColor: colors.violetDark,
    borderWidth: 1,
    borderColor: "rgba(155, 138, 251, 0.2)",
    padding: 22,
    overflow: "hidden",
    marginBottom: 27,
  },
  intelligenceOrb: {
    position: "absolute",
    width: 190,
    height: 190,
    borderRadius: 95,
    borderWidth: 34,
    borderColor: "rgba(155, 138, 251, 0.06)",
    right: -55,
    top: -58,
  },
  spark: { color: colors.violet, fontSize: 28 },
  intelligenceEyebrow: { color: colors.violet, fontSize: 9, fontWeight: "900", letterSpacing: 1.25, marginTop: 24 },
  intelligenceTitle: { color: colors.text, fontSize: 26, lineHeight: 29, fontWeight: "900", letterSpacing: -0.7, marginTop: 8, maxWidth: 280 },
  intelligenceBody: { color: "#ACA4D7", fontSize: 12, lineHeight: 18, marginTop: 12, maxWidth: 290 },
  promptEyebrow: { color: colors.textFaint, fontSize: 9, fontWeight: "900", letterSpacing: 1.4, marginBottom: 10 },
  promptCard: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    minHeight: 58,
    borderRadius: radii.medium,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    paddingHorizontal: 16,
    marginBottom: 9,
  },
  promptText: { color: colors.text, fontSize: 13, fontWeight: "700", flex: 1, paddingRight: 12 },
  promptArrow: { color: colors.accent, fontSize: 18 },
  messageGroup: { alignSelf: "flex-start", maxWidth: "88%", marginBottom: 17 },
  userMessageGroup: { alignSelf: "flex-end", alignItems: "flex-end" },
  messageLabel: { color: colors.violet, fontSize: 8, fontWeight: "900", letterSpacing: 1.2, marginBottom: 6, marginLeft: 4 },
  userMessageLabel: { color: colors.accent, marginLeft: 0, marginRight: 4 },
  bubble: { borderRadius: 20, paddingHorizontal: 15, paddingVertical: 13 },
  aiBubble: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderTopLeftRadius: 6 },
  userBubble: { backgroundColor: colors.accent, borderBottomRightRadius: 6 },
  messageText: { color: colors.text, fontSize: 14, lineHeight: 21 },
  formattedMessage: { gap: 7 },
  messageStrong: { fontWeight: "800", color: "#F5F7FA" },
  messageHeading: { color: colors.text, fontSize: 15, lineHeight: 21, fontWeight: "900", marginTop: 2 },
  messageSpacer: { height: 3 },
  messageBulletRow: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  messageBullet: { color: colors.violet, fontSize: 15, lineHeight: 21 },
  messageBulletContent: { flex: 1 },
  userMessageText: { color: colors.accentText, fontWeight: "600" },
  thinkingCard: { flexDirection: "row", alignItems: "center", gap: 9, marginBottom: 8 },
  aiMark: { width: 28, height: 28, borderRadius: 10, backgroundColor: colors.violetDark, alignItems: "center", justifyContent: "center" },
  aiMarkText: { color: colors.violet, fontSize: 13 },
  thinkingText: { color: colors.textMuted, fontSize: 11 },
  composerShell: { paddingHorizontal: 14, paddingTop: 10, paddingBottom: 8, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.background },
  composer: { flexDirection: "row", alignItems: "flex-end", gap: 9, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 20, padding: 7 },
  input: { flex: 1, color: colors.text, fontSize: 14, lineHeight: 20, minHeight: 43, maxHeight: 112, paddingHorizontal: 10, paddingVertical: 10 },
  sendButton: { width: 43, height: 43, borderRadius: 16, backgroundColor: colors.accent, alignItems: "center", justifyContent: "center" },
  sendDisabled: { backgroundColor: colors.surfaceMuted, opacity: 0.55 },
  sendText: { color: colors.accentText, fontSize: 21, lineHeight: 23, fontWeight: "900" },
  composerHint: { color: colors.textFaint, fontSize: 9, textAlign: "center", marginTop: 7 },
});
