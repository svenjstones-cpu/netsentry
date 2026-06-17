import sqlite3 from 'sqlite3';
import fs from 'fs';
import path from 'path';
import http from 'http';
import https from 'https';

const DB_DIR = process.env.DB_DIR || './data';
const DB_PATH = path.join(DB_DIR, 'netsentry.db');

// Ensure database folder exists
if (!fs.existsSync(DB_DIR)) {
  fs.mkdirSync(DB_DIR, { recursive: true });
}

// Open Database
const sqliteDb = new sqlite3.Database(DB_PATH);

// Promise-based wrappers for sqlite3
export const db = {
  run(sql, params = []) {
    return new Promise((resolve, reject) => {
      sqliteDb.run(sql, params, function (err) {
        if (err) reject(err);
        else resolve({ lastID: this.lastID, changes: this.changes });
      });
    });
  },
  get(sql, params = []) {
    return new Promise((resolve, reject) => {
      sqliteDb.get(sql, params, (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });
  },
  all(sql, params = []) {
    return new Promise((resolve, reject) => {
      sqliteDb.all(sql, params, (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
  },
  exec(sql) {
    return new Promise((resolve, reject) => {
      sqliteDb.exec(sql, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }
};

// Initialize schema
export async function initDatabase() {
  // 1. Clients Table
  await db.run(`
    CREATE TABLE IF NOT EXISTS clients (
      ip TEXT PRIMARY KEY,
      name TEXT,
      icon TEXT DEFAULT 'laptop',
      scheduleEnabled INTEGER DEFAULT 0,
      scheduleDays TEXT DEFAULT '[1,2,3,4,5]',
      scheduleStart TEXT DEFAULT '20:00',
      scheduleEnd TEXT DEFAULT '07:00'
    )
  `);

  // 2. DNS Transaction Logs Table
  await db.run(`
    CREATE TABLE IF NOT EXISTS dns_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      clientIp TEXT,
      clientName TEXT,
      domain TEXT,
      type TEXT,
      status TEXT,
      reason TEXT
    )
  `);

  // 3. Custom Rules (Whitelist/Blacklist)
  await db.run(`
    CREATE TABLE IF NOT EXISTS custom_rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL, -- 'whitelist' or 'blacklist'
      domain TEXT UNIQUE NOT NULL
    )
  `);

  // 4. Ad Blocklist Subscriptions
  await db.run(`
    CREATE TABLE IF NOT EXISTS adlists (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      url TEXT UNIQUE NOT NULL,
      enabled INTEGER DEFAULT 1,
      totalCount INTEGER DEFAULT 0
    )
  `);

  // 5. Materialized Blocked Domains (Loaded from adlists)
  await db.run(`
    CREATE TABLE IF NOT EXISTS blocked_domains (
      domain TEXT PRIMARY KEY,
      listId INTEGER
    )
  `);

  // Seed default adlist if empty
  const defaultAdlist = 'https://raw.githubusercontent.com/StevenBlack/hosts/master/hosts';
  const listCount = await db.get('SELECT COUNT(*) as count FROM adlists');
  if (listCount.count === 0) {
    await db.run('INSERT INTO adlists (url, enabled) VALUES (?, 1)', [defaultAdlist]);
  }
}

// Helper: download text data from HTTP/HTTPS
function fetchUrlText(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    client.get(url, (res) => {
      if (res.statusCode < 200 || res.statusCode >= 300) {
        reject(new Error(`Failed to load ${url}: Status ${res.statusCode}`));
        return;
      }
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

// Sync and compile blocklist domains
export async function updateBlocklists() {
  const lists = await db.all('SELECT * FROM adlists WHERE enabled = 1');
  let loadedCount = 0;

  // Clear existing compilation
  await db.run('DELETE FROM blocked_domains');

  for (const list of lists) {
    try {
      console.log(`Downloading blocklist: ${list.url}`);
      const text = await fetchUrlText(list.url);
      const lines = text.split('\n');
      
      const parsedDomains = [];
      const domainRegex = /^(?:0\.0\.0\.0|127\.0\.0\.1)\s+([a-zA-Z0-9_.-]+)/;

      for (let line of lines) {
        line = line.trim();
        if (!line || line.startsWith('#')) continue;

        // Parse either hosts file format (0.0.0.0 domain) or plain domain lists
        const match = domainRegex.exec(line);
        if (match) {
          const domain = match[1].toLowerCase();
          if (domain !== 'localhost' && domain !== 'broadcasthost') {
            parsedDomains.push(domain);
          }
        } else if (!line.includes(' ') && line.includes('.')) {
          // If it's a list containing just domains, one per line
          parsedDomains.push(line.toLowerCase());
        }
      }

      console.log(`Parsed ${parsedDomains.length} domains from ${list.url}. Saving to database...`);

      // Write parsed domains using a batch transaction for extreme performance
      await db.run('BEGIN TRANSACTION');
      const stmt = sqliteDb.prepare('INSERT OR IGNORE INTO blocked_domains (domain, listId) VALUES (?, ?)');
      for (const domain of parsedDomains) {
        stmt.run(domain, list.id);
      }
      await new Promise((resolve) => stmt.finalize(resolve));
      await db.run('COMMIT');

      // Update totalCount for this list
      await db.run('UPDATE adlists SET totalCount = ? WHERE id = ?', [parsedDomains.length, list.id]);
      loadedCount += parsedDomains.length;
    } catch (err) {
      console.error(`Error processing blocklist ${list.url}:`, err.message);
    }
  }

  return loadedCount;
}
