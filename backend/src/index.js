import dotenv from 'dotenv';
import { initDatabase } from './database.js';
import { startDnsServer, reloadDnsCache } from './dns-server.js';
import { startApiServer } from './api-server.js';

// Load environment variables (.env)
dotenv.config();

async function main() {
  console.log('-------------------------------------------');
  console.log('       Starting NetSentry Engine...        ');
  console.log('-------------------------------------------');

  try {
    // 1. Database migration setup
    console.log('Initializing SQLite Database...');
    await initDatabase();
    console.log('Database initialized successfully.');

    // 2. Pre-load rule sets into Memory
    await reloadDnsCache();

    // 3. Launch DNS Engine on Port 53 (UDP)
    try {
      startDnsServer();
    } catch (dnsErr) {
      console.error('================================================================');
      console.error('CRITICAL: DNS Engine failed to bind on UDP Port 53.');
      console.error('Reason:', dnsErr.message);
      console.error('----------------------------------------------------------------');
      console.error('Troubleshooting:');
      console.error('1. Are you running as administrator/root? (Port 53 is privileged).');
      console.error('2. Is systemd-resolved or another DNS server already using Port 53?');
      console.error('   On Linux, disable systemd-resolved or bind to a different port');
      console.error('   by setting the DNS_PORT environment variable (e.g. DNS_PORT=5353).');
      console.error('================================================================');
      console.log('Continuing server boot in API-Only/Dashboard mode...');
    }

    // 4. Launch Dashboard & API Server on Port 8080 (TCP)
    startApiServer();

  } catch (err) {
    console.error('Failed to start NetSentry application:', err);
    process.exit(1);
  }
}

// Global process exception safety nets
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err.message);
});

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Promise Rejection:', reason);
});

main();
