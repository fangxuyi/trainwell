import * as SQLite from "expo-sqlite";
import { initDatabase } from "./schema";

let _db: SQLite.SQLiteDatabase | null = null;

export async function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (!_db) {
    _db = await SQLite.openDatabaseAsync("trainwell.db");
    await initDatabase(_db);
  }
  return _db;
}
