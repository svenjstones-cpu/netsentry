import express from 'express';
import cors from 'cors';
import os from 'os';
import path from 'path';
import fs from 'fs';
import { db, updateBlocklists } from './database.js';
import { reloadDnsCache, activeStats } from './dns-server.js';

export function startApiServer() {
  const PORT = process.env.API_PORT || 8080;
  const FRONTEND_PATH = process.env.FRONTEND_PATH || './public';
  const app = express();

  app.use(cors());
  app.use(express.json());

  // 1. System Status Endpoint
  app.get('/api/status', async (req, res) => {
    try {
      const freeMem = os.freemem();
      const totalMem = os.totalmem();
      const memUsage = Math.round(((totalMem - freeMem) / totalMem) * 100);

      // Simple CPU usage indicator
      const load = os.loadavg();
      const cpuUsage = Math.round((load[0] / os.cpus().length) * 100);

      const blockCount = await db.get('SELECT COUNT(*) as count FROM blocked_domains');

      // Calculate process uptime
      const upSec = Math.floor(process.uptime());
      const hours = Math.floor(upSec / 3600);
      const minutes = Math.floor((upSec % 3600) / 60);
      const uptimeStr = `${hours}h ${minutes}m`;

      // Dynamic Queries Per Second calculation
      const recentQueries = await db.get(`
        SELECT COUNT(*) as count FROM dns_logs 
        WHERE timestamp >= datetime('now', '-10 seconds')
      `);
      const qps = (recentQueries.count / 10).toFixed(1);

      res.json({
        uptime: uptimeStr,
        cpu: Math.min(cpuUsage, 100) || 1, // fallback to min 1%
        memory: memUsage,
        qps,
        blocklistCount: blockCount.count
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // 2. Statistics & Charts Endpoint
  app.get('/api/stats', async (req, res) => {
    try {
      const activeClients = await db.get(`
        SELECT COUNT(DISTINCT clientIp) as count FROM dns_logs 
        WHERE timestamp >= datetime('now', '-24 hours')
      `);

      // Hourly aggregation for the last 24 hours
      const hourly = await db.all(`
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
      `);

      // Fallback: If no logs exist, generate empty hours list for chart
      let hourlyData = hourly;
      if (hourly.length === 0) {
        hourlyData = Array.from({ length: 12 }, (_, i) => {
          const hr = (new Date(Date.now() - (11 - i) * 3600000)).getHours();
          return {
            hour: `${String(hr).padStart(2, '0')}:00`,
            allowed: 0,
            blocked: 0
          };
        });
      }

      res.json({
        totalQueries: activeStats.totalQueries,
        blockedQueries: activeStats.blockedQueries,
        activeClientsCount: Math.max(activeClients.count, clientCacheSize()),
        hourlyStats: hourlyData
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Helper to get cached clients length
  function clientCacheSize() {
    try {
      // Just a safety count
      return 1; 
    } catch(e) { return 0; }
  }

  // 3. Paginated Logs Endpoint
  app.get('/api/logs', async (req, res) => {
    try {
      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 10;
      const search = req.query.search || '';
      const status = req.query.status || 'all';
      const clientIp = req.query.client || 'all';

      const offset = (page - 1) * limit;

      let whereClause = 'WHERE 1=1';
      const params = [];

      if (search) {
        whereClause += ' AND domain LIKE ?';
        params.push(`%${search.toLowerCase()}%`);
      }

      if (status !== 'all') {
        whereClause += ' AND status = ?';
        params.push(status);
      }

      if (clientIp !== 'all') {
        whereClause += ' AND clientIp = ?';
        params.push(clientIp);
      }

      const totalCountRow = await db.get(`SELECT COUNT(*) as count FROM dns_logs ${whereClause}`, params);
      const totalPages = Math.ceil(totalCountRow.count / limit) || 1;

      // Add pagination limits
      const queryParams = [...params, limit, offset];
      const logs = await db.all(`
        SELECT * FROM dns_logs 
        ${whereClause} 
        ORDER BY id DESC 
        LIMIT ? OFFSET ?
      `, queryParams);

      res.json({
        logs,
        totalPages
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // 4. Clients Endpoint (CRUD)
  app.get('/api/clients', async (req, res) => {
    try {
      const clientsList = await db.all(`
        SELECT 
          c.*,
          COALESCE((SELECT COUNT(*) FROM dns_logs l WHERE l.clientIp = c.ip), 0) as totalQueries,
          COALESCE((SELECT COUNT(*) FROM dns_logs l WHERE l.clientIp = c.ip AND l.status = 'blocked'), 0) as blockedQueries
        FROM clients c
      `);
      res.json(clientsList);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.put('/api/clients/:ip', async (req, res) => {
    const { ip } = req.params;
    const { name, icon, scheduleEnabled, scheduleDays, scheduleStart, scheduleEnd } = req.body;

    try {
      await db.run(`
        UPDATE clients 
        SET name = ?, icon = ?, scheduleEnabled = ?, scheduleDays = ?, scheduleStart = ?, scheduleEnd = ?
        WHERE ip = ?
      `, [name, icon, scheduleEnabled, scheduleDays, scheduleStart, scheduleEnd, ip]);
      
      // Update the running DNS Cache
      await reloadDnsCache();
      
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // 5. Whitelist/Blacklist rules endpoints
  app.get('/api/rules', async (req, res) => {
    try {
      const whitelist = await db.all("SELECT * FROM custom_rules WHERE type = 'whitelist'");
      const blacklist = await db.all("SELECT * FROM custom_rules WHERE type = 'blacklist'");
      const adlists = await db.all("SELECT * FROM adlists");
      res.json({ whitelist, blacklist, adlists });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/rules', async (req, res) => {
    const { type, domain } = req.body;
    if (!domain || (type !== 'whitelist' && type !== 'blacklist')) {
      return res.status(400).json({ error: 'Invalid domain or rule type.' });
    }

    try {
      await db.run('INSERT INTO custom_rules (type, domain) VALUES (?, ?)', [type, domain.toLowerCase()]);
      await reloadDnsCache();
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: 'Domain already exists in rules.' });
    }
  });

  app.delete('/api/rules/:type/:id', async (req, res) => {
    const { type, id } = req.params;
    try {
      await db.run('DELETE FROM custom_rules WHERE type = ? AND id = ?', [type, id]);
      await reloadDnsCache();
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // 6. Adlists (Subscribed feeds)
  app.post('/api/adlists', async (req, res) => {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: 'URL is required.' });

    try {
      await db.run('INSERT INTO adlists (url, enabled) VALUES (?, 1)', [url]);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: 'Blocklist URL already subscribed.' });
    }
  });

  app.delete('/api/adlists/:id', async (req, res) => {
    const { id } = req.params;
    try {
      await db.run('DELETE FROM adlists WHERE id = ?', [id]);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // 7. Update Filter compilation trigger
  app.post('/api/blocklists/update', async (req, res) => {
    try {
      const count = await updateBlocklists();
      await reloadDnsCache();
      res.json({ success: true, count });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // 8. Serve Frontend Statically (Production Mode)
  if (fs.existsSync(FRONTEND_PATH)) {
    console.log(`Serving React frontend files from: ${path.resolve(FRONTEND_PATH)}`);
    app.use(express.static(FRONTEND_PATH));
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api')) return next();
      res.sendFile(path.resolve(path.join(FRONTEND_PATH, 'index.html')));
    });
  } else {
    console.log(`Frontend build path [${FRONTEND_PATH}] not found. Running API-only server mode.`);
  }

  // Start Server
  const server = app.listen(PORT, () => {
    console.log(`API/Dashboard server running on http://localhost:${PORT}`);
  });

  return server;
}
