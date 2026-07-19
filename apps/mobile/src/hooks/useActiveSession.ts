import { useState, useEffect, useCallback, useRef } from "react";
import type { WorkoutSession, QuickNote } from "@trainwell/schemas";
import { recorder } from "../recording/recorder";
import {
  startLiveActivity,
  updateLiveActivity,
  endLiveActivity,
} from "../native/LiveActivity";
import {
  createSession,
  updateSessionStatus,
  getSessionById,
  beginRecording,
  type CreateSessionParams,
} from "../db/sessions";
import { addQuickNote, getNotesBySession } from "../db/quickNotes";
import { now, elapsedSeconds } from "../utils/time";
import { enqueueJob } from "../db/syncJobs";
import { runSyncWorker } from "../sync/worker";

export type ActiveSessionState =
  | "idle"
  | "creating"
  | "recording"
  | "paused"
  | "stopping"
  | "error";

interface ActiveSession {
  state: ActiveSessionState;
  session: WorkoutSession | null;
  notes: QuickNote[];
  elapsedSeconds: number;
  chunkCount: number;
  error: string | null;
  start: (params: CreateSessionParams) => Promise<void>;
  pause: () => Promise<void>;
  resume: () => Promise<void>;
  stop: () => Promise<WorkoutSession | null>;
  addNote: (text: string) => Promise<QuickNote>;
}

export function useActiveSession(): ActiveSession {
  const [state, setState] = useState<ActiveSessionState>("idle");
  const [session, setSession] = useState<WorkoutSession | null>(null);
  const [notes, setNotes] = useState<QuickNote[]>([]);
  const [elapsed, setElapsed] = useState(0);
  const [chunkCount, setChunkCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (tickRef.current) clearInterval(tickRef.current);
    };
  }, []);

  const startTick = useCallback(() => {
    if (tickRef.current) clearInterval(tickRef.current);
    tickRef.current = setInterval(() => {
      const secs = recorder.getElapsedSeconds();
      setElapsed(secs);
      setChunkCount(recorder.getChunkCount());
    }, 1000);
  }, []);

  const stopTick = useCallback(() => {
    if (tickRef.current) {
      clearInterval(tickRef.current);
      tickRef.current = null;
    }
  }, []);

  const start = useCallback(
    async (params: CreateSessionParams) => {
      setState("creating");
      setError(null);
      try {
        const hasPermission = await recorder.requestPermissions();
        if (!hasPermission) {
          throw new Error(
            "Microphone permission is required to record a session."
          );
        }

        const newSession = await createSession(params);
        const startedAt = now();
        await beginRecording(newSession.id, startedAt);

        await recorder.start(newSession.id, {
          onChunkSaved: (segmentId) => {
            setChunkCount(recorder.getChunkCount());
            // Queue upload if mode allows
            if (params.processingMode !== "local_only") {
              enqueueJob(newSession.id, "upload_audio_chunk", segmentId).catch(
                console.error
              );
            }
          },
          onProgress: (elapsedSeconds) => {
            updateSessionStatus(newSession.id, {
              durationSeconds: Math.round(elapsedSeconds),
            }).catch(console.error);
          },
          onError: (err) => {
            setError(err.message);
            setState("error");
          },
        });

        const updated = await getSessionById(newSession.id);
        setSession(updated);
        setState("recording");
        startTick();
        startLiveActivity(
          params.trainerName ?? "",
          params.workoutType ?? ""
        ).catch(() => {});
      } catch (err) {
        setError((err as Error).message);
        setState("error");
      }
    },
    [startTick]
  );

  const pause = useCallback(async () => {
    if (!session || state !== "recording") return;
    await recorder.pause();
    const pausedAt = recorder.getElapsedSeconds();
    setElapsed(pausedAt);
    updateLiveActivity(Math.round(pausedAt), false).catch(() => {});
    await updateSessionStatus(session.id, { localStatus: "paused" });
    const updated = await getSessionById(session.id);
    setSession(updated);
    setState("paused");
    stopTick();
  }, [session, state, stopTick]);

  const resume = useCallback(async () => {
    if (!session || state !== "paused") return;
    await recorder.resume();
    updateLiveActivity(Math.round(recorder.getElapsedSeconds()), true).catch(() => {});
    await updateSessionStatus(session.id, { localStatus: "recording" });
    const updated = await getSessionById(session.id);
    setSession(updated);
    setState("recording");
    startTick();
  }, [session, state, startTick]);

  const stop = useCallback(async (): Promise<WorkoutSession | null> => {
    if (!session) return null;
    setState("stopping");
    stopTick();

    const endedAt = now();
    const durationSeconds = Math.round(recorder.getElapsedSeconds());

    await recorder.stop();
    endLiveActivity(durationSeconds).catch(() => {});
    await updateSessionStatus(session.id, {
      localStatus: "locally_complete",
      remoteStatus: "not_created",
      endedAt,
      durationSeconds,
    });

    if (session.processingMode !== "local_only") {
      await enqueueJob(session.id, "create_remote_session");
      await updateSessionStatus(session.id, { syncStatus: "pending" });
      // Kick off sync in background — worker updates local DB as it progresses
      runSyncWorker(session.id).catch(console.error);
    }

    const updated = await getSessionById(session.id);
    setSession(null);
    setState("idle");
    setElapsed(0);
    setChunkCount(0);
    return updated;
  }, [session, stopTick]);

  const addNote = useCallback(
    async (text: string): Promise<QuickNote> => {
      if (!session) throw new Error("No active session");
      const offsetSeconds = recorder.getElapsedSeconds();
      const note = await addQuickNote(session.id, text, offsetSeconds);
      setNotes((prev) => [...prev, note]);
      return note;
    },
    [session]
  );

  // Load notes when session changes
  useEffect(() => {
    if (session) {
      getNotesBySession(session.id).then(setNotes).catch(console.error);
    } else {
      setNotes([]);
    }
  }, [session?.id]);

  return {
    state,
    session,
    notes,
    elapsedSeconds: elapsed,
    chunkCount,
    error,
    start,
    pause,
    resume,
    stop,
    addNote,
  };
}
