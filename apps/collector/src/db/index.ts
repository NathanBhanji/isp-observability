import { Database } from "bun:sqlite";
import { initializeDatabase } from "./schema";

const DB_PATH = process.env.DATABASE_PATH || "./data/isp-observability.db";

let db: Database | null = null;

export function getDb(): Database {
  if (!db) {
    // Ensure data directory exists
    const dir = DB_PATH.substring(0, DB_PATH.lastIndexOf("/"));
    if (dir) {
      try {
        require("fs").mkdirSync(dir, { recursive: true });
      } catch {
        // directory already exists
      }
    }

    db = new Database(DB_PATH);
    initializeDatabase(db);
    console.log(`[db] SQLite database initialized at ${DB_PATH}`);
  }
  return db;
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}
