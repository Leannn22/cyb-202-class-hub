"use strict";

const fs = require("node:fs");
const path = require("node:path");
const Database = require("better-sqlite3");
const { defaultState, reminderCategories } = require("./data.js");

const dbPath = path.resolve(process.env.DB_PATH || path.join(__dirname, "data", "cyb202.sqlite"));
fs.mkdirSync(path.dirname(dbPath), { recursive:true });
const db = new Database(dbPath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
db.exec(`
  CREATE TABLE IF NOT EXISTS class_state (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    revision INTEGER NOT NULL,
    payload TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS admins (
    id TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    salt BLOB NOT NULL,
    password_hash BLOB NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS auth_attempts (
    identifier TEXT PRIMARY KEY,
    failures INTEGER NOT NULL,
    locked_until INTEGER NOT NULL
  );
`);

const seed = db.prepare("INSERT OR IGNORE INTO class_state (id, revision, payload, updated_at) VALUES (1, 1, ?, ?)");
seed.run(JSON.stringify(defaultState), new Date().toISOString());

db.transaction(() => {
  const row = db.prepare("SELECT revision, payload FROM class_state WHERE id=1").get();
  if (!row) throw new Error("The class state row is missing during category migration.");
  const state = JSON.parse(row.payload);
  let changed = false;
  for (const reminder of state.reminders) {
    if (!reminderCategories.includes(reminder.category)) {
      reminder.category = "General";
      changed = true;
    }
  }
  if (changed) {
    db.prepare("UPDATE class_state SET revision=?, payload=?, updated_at=? WHERE id=1").run(
      row.revision + 1,
      JSON.stringify(state),
      new Date().toISOString(),
    );
  }
})();

module.exports = { db, dbPath };
