# NetSentry: AI Developer Instructions

This document provides a comprehensive structural and logic map of NetSentry. Any AI assistant maintaining, upgrading, or deploying this codebase should read and adhere to these guidelines.

---

## 1. Project Overview & Monorepo Structure

NetSentry is a self-hosted DNS firewall and network dashboard. It is structured as a monorepo containing:
- `/frontend`: React client dashboard built with Vite and Vanilla CSS.
- `/backend`: Node.js ES Module service hosting a UDP DNS Proxy and an Express API.
- `/docker-compose.yml` & `/Dockerfile`: Multi-stage Docker packaging configuration.

---

## 2. Database Schema (`backend/src/database.js`)

NetSentry uses a local SQLite database (`netsentry.db`) stored in the directory defined by the `DB_DIR` environment variable.

### Schema Mappings
1. **`clients`**: Tracks equipment configs.
   - `ip` TEXT PRIMARY KEY (client IPv4 address)
   - `name` TEXT (friendly name, e.g. "Kid's iPad")
   - `icon` TEXT (default `'laptop'`, handles `'smartphone'`, `'tv'`, `'gamepad'`)
   - `scheduleEnabled` INTEGER (0 = Off, 1 = Active Schedule Lock)
   - `scheduleDays` TEXT (JSON array string representing active day indexes, e.g., `'[1,2,3,4,5]'` where Sun=0, Sat=6)
   - `scheduleStart` TEXT (HH:MM block window start, e.g., `'20:00'`)
   - `scheduleEnd` TEXT (HH:MM block window end, e.g., `'07:00'`)

2. **`dns_logs`**: Logs all incoming DNS traffic.
   - `id` INTEGER PRIMARY KEY AUTOINCREMENT
   - `timestamp` TEXT DEFAULT (ISO 8601 UTC string format: `YYYY-MM-DDTHH:MM:SS.SSSZ`)
   - `clientIp` TEXT
   - `clientName` TEXT
   - `domain` TEXT (queried domain name, forced to lowercase)
   - `type` TEXT (e.g. `'A'`, `'AAAA'`)
   - `status` TEXT (`'allowed'` or `'blocked'`)
   - `reason` TEXT (`'upstream'`, `'whitelist'`, `'blacklist'`, `'adlist'`, `'schedule'`)

3. **`custom_rules`**: User manual overrides.
   - `id` INTEGER PRIMARY KEY AUTOINCREMENT
   - `type` TEXT (`'whitelist'` or `'blacklist'`)
   - `domain` TEXT UNIQUE (forced to lowercase)

4. **`adlists`**: Blocklist subscription feeds.
   - `id` INTEGER PRIMARY KEY AUTOINCREMENT
   - `url` TEXT UNIQUE (external hosts list URL)
   - `enabled` INTEGER DEFAULT 1
   - `totalCount` INTEGER DEFAULT 0

5. **`blocked_domains`**: Materialized cache table of parsed domains from adlists.
   - `domain` TEXT PRIMARY KEY (lowercase)
   - `listId` INTEGER (foreign key to `adlists.id`)

### Core Database Performance Tips
- Wrapping list compilations (which can be over 100,000 domains) inside a transaction (`BEGIN TRANSACTION` / `COMMIT`) is required. Otherwise, SQLite will commit each row individually, stalling the server.

---

## 3. DNS Engine Logic (`backend/src/dns-server.js`)

The DNS engine listens on UDP Port 53 (customizable via `DNS_PORT`). 

### Performance Cache
To avoid database overhead on DNS queries (which must resolve in <15ms), the server maintains memory-resident sets loaded during startup/updates:
- `whitelistCache` = Set of whitelisted domains.
- `blacklistCache` = Set of blacklisted domains.
- `blockedDomainsCache` = Set of blocklist domains.
- `clientCache` = Map of client IPs to their client rule object.

Whenever the API modifies client settings, whitelists, or blacklists, it **must** call `reloadDnsCache()` to refresh these RAM sets.

### Overnight Schedule-Crossing Logic
When checking if a client query falls inside a schedule lock block, use this calculation to properly handle bedtime windows that cross midnight (e.g., `21:00` Monday to `07:00` Tuesday):

```javascript
function isClientBlockedBySchedule(client, now = new Date()) {
  if (!client || !client.scheduleEnabled) return false;

  const currentHour = String(now.getHours()).padStart(2, '0');
  const currentMinute = String(now.getMinutes()).padStart(2, '0');
  const currentTime = `${currentHour}:${currentMinute}`;
  const currentDay = now.getDay(); // 0 = Sunday, 1 = Monday, etc.

  const start = client.scheduleStart;
  const end = client.scheduleEnd;
  const days = JSON.parse(client.scheduleDays || '[]');

  if (start < end) {
    // Block window is in the same day (e.g., 14:00 - 18:00)
    if (currentTime >= start && currentTime <= end) {
      return days.includes(currentDay);
    }
  } else {
    // Block window crosses midnight (e.g., 20:00 - 07:00)
    if (currentTime >= start) {
      // Evening block (e.g. 21:00 Monday matches Monday's schedule)
      return days.includes(currentDay);
    }
    if (currentTime <= end) {
      // Morning block (e.g. 05:00 Tuesday matches Monday's bedtime schedule)
      const yesterday = (currentDay - 1 + 7) % 7;
      return days.includes(yesterday);
    }
  }
  return false;
}
```

### DNS Packet Encoding Requirements
When constructing block responses with the `dns-packet` library:
- **Do not** pass boolean flags or raw numbers to the `flags` parameter along with the `rcode` string. If you specify `flags` as a number without merging the RCODE, the RCODE bits (lower 4 bits) will be overridden, encoding the response as `NOERROR`.
- To set RCODEs correctly, set the `flags` property to `128 | rcodeValue`, where `128` (0x0080) is the `RECURSION_AVAILABLE` bit, and `rcodeValue` is:
  - `5` for `REFUSED` (used for parental schedule blocks)
  - `3` for `NXDOMAIN` (used for invalid queries)
  - `0` for `NOERROR` (used for null route blocks)
- Null routing A queries should return an answer record pointing to `0.0.0.0`. AAAA queries should point to `::`.

---

## 4. API Endpoints (`backend/src/api-server.js`)

The backend API server listens on TCP Port 8080 (customizable via `API_PORT`).

### Aggregate Strftime Query (24h Traffic)
The hourly bar chart data is populated by fetching traffic grouped by hour. To ensure empty hours are not dropped from the chart, use a CTE recursion or pad empty hours in Javascript:
```sql
WITH RECURSIVE hours(h) AS (
  VALUES(0) UNION ALL SELECT h + 1 FROM hours WHERE h < 23
)
SELECT 
  strftime('%H:00', datetime('now', '-' || h || ' hours')) as hour,
  COALESCE(SUM(CASE WHEN l.status = 'allowed' THEN 1 ELSE 0 END), 0) as allowed,
  COALESCE(SUM(CASE WHEN l.status = 'blocked' THEN 1 ELSE 0 END), 0) as blocked
FROM hours
LEFT JOIN dns_logs l ON strftime('%H:00', l.timestamp) = hour 
  AND l.timestamp >= datetime('now', '-24 hours')
GROUP BY hour
ORDER BY hour ASC
```

---

## 5. Development & Testing Commands

### Verify codebase tests
Runs the automated verification suite to test UDP packet intercepts, mock whitelist overrides, database insertions, and API payloads:
```bash
cd backend
node src/verify_net_sentry.js
```

### Start Development Server
```bash
# Run the local helper script (detects admin terminal for port 53 vs 5553)
powershell -ExecutionPolicy Bypass -File .\run-local.ps1
```
Or start manually:
```bash
# Frontend dev (port 5173)
cd frontend && npm run dev
# Backend dev (port 8080 API / port 5553 DNS)
cd backend && $env:DNS_PORT=5553; $env:API_PORT=8080; npm start
```
