import type {
  BodyMeasurement,
  BodyMeasurementUnit,
} from "@trainwell/schemas";
import { requireCurrentUserId } from "../auth/currentUser";
import { apiDelete, apiGet, apiPut } from "../utils/api";
import { now } from "../utils/time";
import { uuid } from "../utils/uuid";
import { getDb } from "./client";

type MeasurementRow = Record<string, unknown>;

function rowToMeasurement(row: MeasurementRow): BodyMeasurement {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    bodyPart: row.body_part as string,
    value: Number(row.value),
    unit: row.unit as BodyMeasurementUnit,
    measuredAt: row.measured_at as string,
    note: (row.note as string | null) ?? undefined,
    syncStatus: row.sync_status as BodyMeasurement["syncStatus"],
    deletedAt: (row.deleted_at as string | null) ?? undefined,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

function remoteToMeasurement(row: Record<string, unknown>): BodyMeasurement {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    bodyPart: row.body_part as string,
    value: Number(row.value),
    unit: row.unit as BodyMeasurementUnit,
    measuredAt: row.measured_at as string,
    note: (row.note as string | null) ?? undefined,
    syncStatus: "synchronized",
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

async function upsertRemoteMeasurement(measurement: BodyMeasurement): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `INSERT INTO body_measurements (
      id, user_id, body_part, value, unit, measured_at, note,
      sync_status, deleted_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'synchronized', NULL, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      body_part = excluded.body_part,
      value = excluded.value,
      unit = excluded.unit,
      measured_at = excluded.measured_at,
      note = excluded.note,
      sync_status = CASE
        WHEN body_measurements.sync_status = 'pending' THEN body_measurements.sync_status
        ELSE 'synchronized'
      END,
      updated_at = CASE
        WHEN body_measurements.sync_status = 'pending' THEN body_measurements.updated_at
        ELSE excluded.updated_at
      END
    WHERE body_measurements.user_id = excluded.user_id
      AND body_measurements.deleted_at IS NULL`,
    [
      measurement.id,
      measurement.userId,
      measurement.bodyPart,
      measurement.value,
      measurement.unit,
      measurement.measuredAt,
      measurement.note ?? null,
      measurement.createdAt,
      measurement.updatedAt,
    ]
  );
}

export async function createBodyMeasurement(params: {
  bodyPart: string;
  value: number;
  unit: BodyMeasurementUnit;
  measuredAt: string;
  note?: string;
}): Promise<BodyMeasurement> {
  const db = await getDb();
  const timestamp = now();
  const id = uuid();
  const userId = requireCurrentUserId();
  await db.runAsync(
    `INSERT INTO body_measurements (
      id, user_id, body_part, value, unit, measured_at, note,
      sync_status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
    [
      id,
      userId,
      params.bodyPart.trim(),
      params.value,
      params.unit,
      params.measuredAt,
      params.note?.trim() || null,
      timestamp,
      timestamp,
    ]
  );
  const row = await db.getFirstAsync<MeasurementRow>(
    "SELECT * FROM body_measurements WHERE id = ? AND user_id = ?",
    [id, userId]
  );
  if (!row) throw new Error("Failed to save measurement");
  return rowToMeasurement(row);
}

export async function listBodyMeasurements(): Promise<BodyMeasurement[]> {
  const db = await getDb();
  const userId = requireCurrentUserId();
  const rows = await db.getAllAsync<MeasurementRow>(
    `SELECT * FROM body_measurements
     WHERE user_id = ? AND deleted_at IS NULL
     ORDER BY measured_at DESC, created_at DESC`,
    [userId]
  );
  return rows.map(rowToMeasurement);
}

export async function deleteBodyMeasurement(id: string): Promise<void> {
  const db = await getDb();
  const userId = requireCurrentUserId();
  const timestamp = now();
  await db.runAsync(
    `UPDATE body_measurements
     SET deleted_at = ?, sync_status = 'pending', updated_at = ?
     WHERE id = ? AND user_id = ?`,
    [timestamp, timestamp, id, userId]
  );
}

export async function syncBodyMeasurements(): Promise<void> {
  const db = await getDb();
  const userId = requireCurrentUserId();
  const pendingRows = await db.getAllAsync<MeasurementRow>(
    `SELECT * FROM body_measurements
     WHERE user_id = ? AND sync_status IN ('pending', 'failed')
     ORDER BY created_at ASC`,
    [userId]
  );

  for (const row of pendingRows) {
    const measurement = rowToMeasurement(row);
    try {
      if (measurement.deletedAt) {
        await apiDelete(`/api/body-measurements/${measurement.id}`);
        await db.runAsync(
          "DELETE FROM body_measurements WHERE id = ? AND user_id = ?",
          [measurement.id, userId]
        );
      } else {
        const remote = await apiPut<Record<string, unknown>>(
          `/api/body-measurements/${measurement.id}`,
          {
            bodyPart: measurement.bodyPart,
            value: measurement.value,
            unit: measurement.unit,
            measuredAt: measurement.measuredAt,
            note: measurement.note,
          }
        );
        await db.runAsync(
          `UPDATE body_measurements
           SET sync_status = 'synchronized', updated_at = ?
           WHERE id = ? AND user_id = ? AND updated_at = ?`,
          [remote.updated_at as string, measurement.id, userId, measurement.updatedAt]
        );
      }
    } catch {
      await db.runAsync(
        `UPDATE body_measurements SET sync_status = 'failed'
         WHERE id = ? AND user_id = ? AND updated_at = ?`,
        [measurement.id, userId, measurement.updatedAt]
      );
    }
  }

  const remoteRows = await apiGet<Record<string, unknown>[]>("/api/body-measurements");
  const remoteIds = remoteRows.map((row) => row.id as string);
  if (remoteIds.length === 0) {
    await db.runAsync(
      "DELETE FROM body_measurements WHERE user_id = ? AND sync_status = 'synchronized'",
      [userId]
    );
  } else {
    await db.runAsync(
      `DELETE FROM body_measurements
       WHERE user_id = ? AND sync_status = 'synchronized'
         AND id NOT IN (${remoteIds.map(() => "?").join(", ")})`,
      [userId, ...remoteIds]
    );
  }
  for (const row of remoteRows) {
    await upsertRemoteMeasurement(remoteToMeasurement(row));
  }
}
