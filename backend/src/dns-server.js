import dgram from 'dgram';
import dnsPacket from 'dns-packet';
import { db } from './database.js';

const UPSTREAM_PORT = 53;
const getUpstreamDns = () => process.env.UPSTREAM_DNS || '1.1.1.1';
const getDnsPort = () => parseInt(process.env.DNS_PORT) || 53;

// In-memory caches for maximum performance
let whitelistCache = new Set();
let blacklistCache = new Set();
let blockedDomainsCache = new Set();
let clientCache = new Map(); // IP -> Client object

// Statistics counter (resets on start, populated by logs)
export const activeStats = {
  totalQueries: 0,
  blockedQueries: 0
};

// Reload in-memory rules and client schedules from SQLite
export async function reloadDnsCache() {
  console.log('Reloading DNS filter cache from database...');
  try {
    const wl = await db.all("SELECT domain FROM custom_rules WHERE type = 'whitelist'");
    const bl = await db.all("SELECT domain FROM custom_rules WHERE type = 'blacklist'");
    const bd = await db.all("SELECT domain FROM blocked_domains");
    const cl = await db.all("SELECT * FROM clients");

    whitelistCache = new Set(wl.map(r => r.domain.toLowerCase()));
    blacklistCache = new Set(bl.map(r => r.domain.toLowerCase()));
    blockedDomainsCache = new Set(bd.map(r => r.domain.toLowerCase()));
    
    clientCache.clear();
    for (const client of cl) {
      clientCache.set(client.ip, client);
    }
    
    // Update stats counters from database logs
    const totalCount = await db.get("SELECT COUNT(*) as count FROM dns_logs");
    const blockedCount = await db.get("SELECT COUNT(*) as count FROM dns_logs WHERE status = 'blocked'");
    activeStats.totalQueries = totalCount.count;
    activeStats.blockedQueries = blockedCount.count;

    console.log(`DNS cache updated. Whitelist: ${whitelistCache.size}, Blacklist: ${blacklistCache.size}, Blocklist: ${blockedDomainsCache.size}, Clients tracked: ${clientCache.size}`);
  } catch (err) {
    console.error('Error reloading DNS cache:', err.message);
  }
}

// Check if a query domain matches a rule (including subdomains)
function isDomainMatch(queryDomain, ruleSet) {
  if (ruleSet.has(queryDomain)) return true;
  
  // Check parent domains
  let parts = queryDomain.split('.');
  while (parts.length > 1) {
    parts.shift();
    const parentDomain = parts.join('.');
    if (ruleSet.has(parentDomain)) {
      return true;
    }
  }
  return false;
}

function isClientBlockedBySchedule(client, now = new Date()) {
  if (!client || !client.scheduleEnabled) return false;

  const currentHour = String(now.getHours()).padStart(2, '0');
  const currentMinute = String(now.getMinutes()).padStart(2, '0');
  const currentTime = `${currentHour}:${currentMinute}`;
  const currentDay = now.getDay(); // 0 = Sunday, 1 = Monday, etc.

  const start = client.scheduleStart;
  const end = client.scheduleEnd;
  
  let days = [];
  try {
    days = JSON.parse(client.scheduleDays || '[]');
  } catch (e) {
    days = [1, 2, 3, 4, 5];
  }

  if (start < end) {
    if (currentTime >= start && currentTime <= end) {
      return days.includes(currentDay);
    }
  } else {
    if (currentTime >= start) {
      return days.includes(currentDay);
    } else if (currentTime <= end) {
      const yesterday = (currentDay - 1 + 7) % 7;
      return days.includes(yesterday);
    }
  }

  return false;
}

// Core DNS UDP server setup
export function startDnsServer() {
  const server = dgram.createSocket('udp4');

  server.on('message', async (msg, rinfo) => {
    const clientIp = rinfo.address;
    
    // 1. Register new client dynamically if not seen before
    if (!clientCache.has(clientIp)) {
      try {
        await db.run('INSERT OR IGNORE INTO clients (ip, name) VALUES (?, ?)', [clientIp, `Device ${clientIp}`]);
        // Fast update cache
        const cl = await db.get('SELECT * FROM clients WHERE ip = ?', [clientIp]);
        if (cl) clientCache.set(clientIp, cl);
      } catch (err) {
        console.error('Failed to auto-register client:', err.message);
      }
    }

    const client = clientCache.get(clientIp);

    let query;
    try {
      query = dnsPacket.decode(msg);
    } catch (e) {
      console.warn(`Failed to decode DNS packet from ${clientIp}:`, e.message);
      return;
    }

    if (!query.questions || query.questions.length === 0) {
      return;
    }

    const question = query.questions[0];
    const domain = question.name.toLowerCase();
    const qType = question.type;

    activeStats.totalQueries++;

    // 2. Schedule Parental Lock check
    if (isClientBlockedBySchedule(client)) {
      activeStats.blockedQueries++;
      logQuery(clientIp, client?.name || clientIp, domain, qType, 'blocked', 'schedule');
      sendBlockResponse(server, rinfo, query, 'schedule');
      return;
    }

    // 3. Whitelist check (overrides ad/blacklists)
    if (isDomainMatch(domain, whitelistCache)) {
      logQuery(clientIp, client?.name || clientIp, domain, qType, 'allowed', 'whitelist');
      forwardQuery(server, rinfo, msg);
      return;
    }

    // 4. Blacklist check
    if (isDomainMatch(domain, blacklistCache)) {
      activeStats.blockedQueries++;
      logQuery(clientIp, client?.name || clientIp, domain, qType, 'blocked', 'blacklist');
      sendBlockResponse(server, rinfo, query, 'blacklist');
      return;
    }

    // 5. Spam/Ad filter check
    if (isDomainMatch(domain, blockedDomainsCache)) {
      activeStats.blockedQueries++;
      logQuery(clientIp, client?.name || clientIp, domain, qType, 'blocked', 'adlist');
      sendBlockResponse(server, rinfo, query, 'adlist');
      return;
    }

    // 6. Normal resolving: forward to upstream resolver
    logQuery(clientIp, client?.name || clientIp, domain, qType, 'allowed', 'upstream');
    forwardQuery(server, rinfo, msg);
  });

  server.on('error', (err) => {
    console.error('DNS Server Error:', err.message);
  });

  server.on('listening', () => {
    const address = server.address();
    console.log(`DNS engine listening on ${address.address}:${address.port}`);
    console.log(`Forwarding DNS requests to ${getUpstreamDns()}:${UPSTREAM_PORT}`);
  });

  server.bind(getDnsPort());
  return server;
}

// Forward allowed DNS queries directly to Upstream (e.g. Cloudflare)
function forwardQuery(server, clientRinfo, msg) {
  const forwardSocket = dgram.createSocket('udp4');
  const upstream = getUpstreamDns();
  
  forwardSocket.send(msg, 0, msg.length, UPSTREAM_PORT, upstream, (err) => {
    if (err) {
      console.error(`Upstream forward failure to ${upstream}:`, err.message);
      forwardSocket.close();
    }
  });

  forwardSocket.on('message', (responseMsg) => {
    server.send(responseMsg, 0, responseMsg.length, clientRinfo.port, clientRinfo.address, (err) => {
      if (err) console.error('Relaying DNS reply to client failed:', err.message);
    });
    forwardSocket.close();
  });

  // Timeout socket after 3.5 seconds
  setTimeout(() => {
    try {
      forwardSocket.close();
    } catch (e) {}
  }, 3500);
}

// Create and send a blocked DNS packet reply (REFUSED or 0.0.0.0 Null Route)
function sendBlockResponse(server, clientRinfo, query, blockReason) {
  const question = query.questions[0];
  let answer = [];

  let rcodeValue = 0; // default NOERROR
  if (blockReason === 'schedule') {
    rcodeValue = 5; // REFUSED (Parental lock returns connection refused)
  } else {
    // Null routing based on record type
    if (question.type === 'A') {
      answer.push({
        type: 'A',
        class: 'IN',
        name: question.name,
        ttl: 3600,
        data: '0.0.0.0'
      });
    } else if (question.type === 'AAAA') {
      answer.push({
        type: 'AAAA',
        class: 'IN',
        name: question.name,
        ttl: 3600,
        data: '::'
      });
    } else {
      rcodeValue = 3; // NXDOMAIN (Other record types return Not Found)
    }
  }

  const responsePacket = {
    type: 'response',
    id: query.id,
    flags: 128 | rcodeValue, // RECURSION_AVAILABLE (128) | rcodeValue
    questions: query.questions,
    answers: answer
  };

  try {
    const responseBuffer = dnsPacket.encode(responsePacket);
    server.send(responseBuffer, 0, responseBuffer.length, clientRinfo.port, clientRinfo.address);
  } catch (err) {
    console.error('Failed to construct block packet:', err.message);
  }
}

// Save query logs asynchronously into SQLite
async function logQuery(clientIp, clientName, domain, type, status, reason) {
  try {
    await db.run(
      'INSERT INTO dns_logs (clientIp, clientName, domain, type, status, reason) VALUES (?, ?, ?, ?, ?, ?)',
      [clientIp, clientName, domain, type, status, reason]
    );
  } catch (err) {
    console.error('Failed to log DNS query:', err.message);
  }
}
