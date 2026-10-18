"use strict";

const { promisify } = require("node:util");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const Database = require("better-sqlite3");
const { db, dbPath } = require("./db.js");

const scrypt = promisify(crypto.scrypt);
const profiles = [
  ["leander", "Leander Dwayne Darell S. Guina"],
  ["representative", "Class Representative"],
  ["vicePresident", "Class Vice President"]
];

function readSecret(prompt) {
  if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== "function") {
    return Promise.reject(new Error("Run this command in an interactive terminal so passphrases are not echoed."));
  }
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    let value = "";
    process.stdout.write(prompt);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    const onData = key => {
      if (key === "\u0003") {
        cleanup();
        process.stdout.write("\n");
        reject(new Error("Setup cancelled."));
      } else if (key === "\r" || key === "\n") {
        cleanup();
        process.stdout.write("\n");
        resolve(value);
      } else if (key === "\u0008" || key === "\u007f") {
        value = value.slice(0, -1);
      } else if (!/[\u0000-\u001f\u007f]/.test(key)) {
        value += key;
      }
    };
    function cleanup() {
      stdin.removeListener("data", onData);
      stdin.setRawMode(false);
      stdin.pause();
    }
    stdin.on("data", onData);
  });
}

async function main() {
  const replace = process.argv.includes("--replace");
  if (db.prepare("SELECT COUNT(*) AS count FROM admins").get().count && !replace) {
    throw new Error("Admin accounts are already configured. Pass --replace to rotate all three passphrases.");
  }
  console.log(`CYB-202 administrator setup\nDatabase: ${dbPath}\nUse a unique passphrase of at least 16 characters for each profile.`);
  const savedAt = new Date().toISOString();
  const save = db.prepare(`
    INSERT INTO admins (id, display_name, salt, password_hash, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET display_name=excluded.display_name, salt=excluded.salt,
      password_hash=excluded.password_hash, updated_at=excluded.updated_at
  `);
  const transaction = db.transaction(records => records.forEach(record => save.run(...record)));
  const records = [];
  for (const [id, name] of profiles) {
    let password;
    let confirmation;
    do {
      password = await readSecret(`${name} passphrase: `);
      confirmation = await readSecret("Confirm passphrase: ");
      if (password !== confirmation) console.error("Passphrases did not match. Please try again.");
      else if (password.length < 16 || password.length > 256) {
        console.error("Use at least 16 characters and no more than 256 characters.");
        password = "";
      }
    } while (!password || password !== confirmation);
    const salt = crypto.randomBytes(16);
    const hash = await scrypt(password, salt, 64, { N:32768, r:8, p:1, maxmem:64 * 1024 * 1024 });
    records.push([id, name, salt, hash, savedAt, savedAt]);
    password = "";
    confirmation = "";
  }
  transaction(records);
  if (replace) {
    const sessionPath=path.join(path.dirname(dbPath),"sessions.sqlite");
    if (fs.existsSync(sessionPath)) {
      const sessions=new Database(sessionPath);
      const table=sessions.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='sessions'").get();
      if (table) sessions.prepare("DELETE FROM sessions").run();
      sessions.close();
    }
  }
  console.log("All three administrator password hashes were stored in the private SQLite database.");
  console.log("The passphrases were not written to a file or printed.");
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
}).finally(() => db.close());
