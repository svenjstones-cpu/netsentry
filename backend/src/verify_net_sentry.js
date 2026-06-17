import dgram from 'dgram';
import http from 'http';
import dnsPacket from 'dns-packet';
import { db, initDatabase } from './database.js';
import { startDnsServer, reloadDnsCache } from './dns-server.js';
import { startApiServer } from './api-server.js';

// Setup environment variables for local non-root testing
process.env.DNS_PORT = 5553;
process.env.API_PORT = 8089;
process.env.DB_DIR = './scratch-data';
process.env.UPSTREAM_DNS = '1.1.1.1';

function sendDnsQuery(domain, port = 5553) {
  return new Promise((resolve, reject) => {
    const socket = dgram.createSocket('udp4');
    const buf = dnsPacket.encode({
      type: 'query',
      id: Math.floor(Math.random() * 65535),
      flags: dnsPacket.RECURSION_DESIRED,
      questions: [{
        type: 'A',
        name: domain
      }]
    });

    socket.on('message', (msg) => {
      const response = dnsPacket.decode(msg);
      socket.close();
      resolve(response);
    });

    socket.on('error', (err) => {
      socket.close();
      reject(err);
    });

    socket.send(buf, 0, buf.length, port, '127.0.0.1', (err) => {
      if (err) {
        socket.close();
        reject(err);
      }
    });

    setTimeout(() => {
      try { socket.close(); } catch (e) {}
      reject(new Error(`Timeout resolving domain ${domain}`));
    }, 2000);
  });
}

function fetchApi(path) {
  return new Promise((resolve, reject) => {
    http.get(`http://127.0.0.1:8089${path}`, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          resolve(data);
        }
      });
    }).on('error', reject);
  });
}

async function runTest() {
  console.log('--- STARTING NETSENTRY AUTOMATED VERIFICATION ---');

  // 1. Setup DB
  console.log('\n[1/7] Preparing database schema...');
  await initDatabase();
  
  // Clear any existing test records
  await db.run('DELETE FROM dns_logs');
  await db.run('DELETE FROM custom_rules');
  await db.run('DELETE FROM clients');
  await db.run('DELETE FROM blocked_domains');
  
  await reloadDnsCache();

  // 2. Start Servers
  console.log('\n[2/7] Starting test servers...');
  const dnsServer = startDnsServer();
  const apiServer = startApiServer();

  try {
    // 3. Test normal query (Allowed)
    console.log('\n[3/7] Testing ALLOWED domain resolution (google.com)...');
    const allowedRes = await sendDnsQuery('google.com');
    console.log('Result type:', allowedRes.type);
    console.log('Result RCODE:', allowedRes.rcode);
    console.log('Result Answers:', allowedRes.answers);
    
    if (allowedRes.rcode !== 'NOERROR' || allowedRes.answers.length === 0) {
      throw new Error('Google.com resolution failed! RCODE should be NOERROR and should contain answers.');
    }
    console.log('✅ PASS: Allowed domain resolved successfully.');

    // 4. Test Blacklist Block
    console.log('\n[4/7] Testing BLACKLIST blocked domain (forbidden.net)...');
    // Add to rules table
    await db.run("INSERT INTO custom_rules (type, domain) VALUES ('blacklist', 'forbidden.net')");
    await reloadDnsCache();

    const blockedRes = await sendDnsQuery('forbidden.net');
    console.log('Result RCODE:', blockedRes.rcode);
    console.log('Result Answers:', blockedRes.answers);
    
    if (blockedRes.answers.length === 0 || blockedRes.answers[0].data !== '0.0.0.0') {
      throw new Error('forbidden.net blocking failed! Should return A record with 0.0.0.0 Null Route.');
    }
    console.log('✅ PASS: Blacklisted domain correctly returned 0.0.0.0.');

    // 5. Test parental lock schedule block
    console.log('\n[5/7] Testing PARENTAL CONTROL schedule block for client IP...');
    // Create an active block schedule for our client (127.0.0.1)
    // We set start time to 2 hours before now, and end time to 2 hours after now
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    
    const startHour = pad((now.getHours() - 1 + 24) % 24);
    const endHour = pad((now.getHours() + 1) % 24);
    const startStr = `${startHour}:00`;
    const endStr = `${endHour}:00`;
    const dayOfWeek = now.getDay();

    console.log(`Setting block schedule for 127.0.0.1: ${startStr} to ${endStr} on day ${dayOfWeek}`);
    await db.run(`
      INSERT OR REPLACE INTO clients (ip, name, icon, scheduleEnabled, scheduleDays, scheduleStart, scheduleEnd)
      VALUES (?, ?, ?, 1, ?, ?, ?)
    `, ['127.0.0.1', 'Test Local PC', 'laptop', JSON.stringify([dayOfWeek]), startStr, endStr]);
    
    await reloadDnsCache();

    console.log('Querying google.com during blocked hours...');
    const scheduleBlockedRes = await sendDnsQuery('google.com');
    console.log('Result Full Object:', JSON.stringify(scheduleBlockedRes, null, 2));
    
    if (scheduleBlockedRes.rcode !== 'REFUSED') {
      throw new Error(`Schedule block failed! Expected RCODE to be REFUSED, got ${scheduleBlockedRes.rcode}`);
    }
    console.log('✅ PASS: Client request correctly REFUSED due to schedule lock.');

    // 6. Test Web API Stats & Logs endpoints
    console.log('\n[6/7] Testing Web dashboard API responses...');
    
    const stats = await fetchApi('/api/stats');
    console.log('API Stats:', stats);
    if (stats.totalQueries < 3) {
      throw new Error(`Expected at least 3 queries in stats, got ${stats.totalQueries}`);
    }
    
    const logs = await fetchApi('/api/logs?page=1&limit=5');
    console.log('API Query Logs Count:', logs.logs.length);
    console.log('API Query Logs list sample:', logs.logs[0]);
    if (logs.logs.length === 0) {
      throw new Error('Expected query logs in database, but got 0.');
    }
    
    const clients = await fetchApi('/api/clients');
    console.log('API Clients list:', clients);
    if (clients.length === 0 || !clients.some(c => c.ip === '127.0.0.1')) {
      throw new Error('Discovered client 127.0.0.1 should be in the clients API output.');
    }
    
    console.log('✅ PASS: Web REST APIs returned correct aggregated database data.');

    // 7. Cleanup and finish
    console.log('\n[7/7] Cleaning up servers...');
    dnsServer.close();
    apiServer.close();
    
    // Clean up test DB files
    console.log('Cleaning up scratch files...');
    try {
      db.run('DROP TABLE IF EXISTS clients');
      db.run('DROP TABLE IF EXISTS dns_logs');
      db.run('DROP TABLE IF EXISTS custom_rules');
      db.run('DROP TABLE IF EXISTS adlists');
      db.run('DROP TABLE IF EXISTS blocked_domains');
    } catch(e) {}

    console.log('\n🎉 ALL VERIFICATION TESTS PASSED SUCCESSFULLY! NETSENTRY IS FULLY FUNCTIONAL.');

  } catch (err) {
    console.error('\n❌ VERIFICATION TEST FAILED:', err.message);
    try { dnsServer.close(); } catch(e){}
    try { apiServer.close(); } catch(e){}
    process.exit(1);
  }
}

runTest();
