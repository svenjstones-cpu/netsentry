# NetSentry: Home DNS Firewall & Parental Control Dashboard

NetSentry is a lightweight, self-hosted DNS sinkhole and internet control dashboard designed to run in a Docker container on your home server (such as `odin`). By acting as the primary DNS resolver for your home network, NetSentry intercepts requests to filter out ads, trackers, and spam, while allowing you to enforce parental schedule locks on specific devices and monitor traffic in real time.

---

## Features

- 🛑 **Ad & Spam Filtering**: Automatically block ads and tracker networks using community-subscribed hosts lists.
- 🕒 **Parental Control Schedules**: Enforce internet blocks on specific local IPs (e.g., kids' tablets) during designated times (e.g., bedtime) with support for overnight midnight-crossing windows.
- 📋 **Live Query Log**: Inspect incoming DNS transactions in real-time, search hostnames, and quick-add whitelist/blacklist overrides.
- 📊 **Glassmorphic UI Dashboard**: Premium, high-performance web dashboard displaying real-time traffic statistics, query history graphs, and device status.
- 🐳 **Dockerized deployment**: Bundles the Node.js backend and React frontend into a single lightweight Docker container.

---

## System Architecture

```
                       +-----------------------------+
                       |     Local Client Device     |
                       +-----------------------------+
                                      |
                                      | DNS Port 53 (UDP)
                                      v
+-------------------------------------------------------------------------+
| NetSentry Container                                                     |
|                                                                         |
|  +--------------------+                   +--------------------------+  |
|  |     DNS Server     |==================>|      SQLite Database     |  |
|  |  (Node / dgram)    |   Loads rules     |  (dns_logs, custom_rules |  |
|  +--------------------+   into RAM cache  |   clients, blocked_doms) |  |
|         |        |                        +--------------------------+  |
|         |        | Allowed                                     ^        |
|         |        v                                             |        |
|         |   +-----------+                                      |        |
|         |   | Upstream  | (e.g., 1.1.1.1)                      |        |
|         |   +-----------+                                      | Read/  |
|         |                                                      | Write  |
|         | Blocked (REFUSED or 0.0.0.0)                         |        |
|         v                                                      v        |
|  +--------------------+                   +--------------------------+  |
|  |   Block Response   |                   |      Express API &       |  |
|  +--------------------+                   |    Static Web Server     |  |
|                                           +--------------------------+  |
|                                                        ^                |
|                                                        | Port 8080 (TCP) |
|                                                        v                |
|                                           +--------------------------+  |
|                                           |     React Dashboard      |  |
|                                           |      Web Console UI      |  |
|                                           +--------------------------+  |
+-------------------------------------------------------------------------+
```

---

## Local Development & Testing

You can run NetSentry locally without root privileges using non-privileged ports:

### 1. Start Frontend (React/Vite Dev Server)
```bash
cd frontend
npm install
npm run dev
```
The React development server runs on `http://localhost:5173`.

### 2. Start Backend (Express & DNS Proxy)
```bash
cd backend
npm install
# Configure test environment variables in your terminal or a .env file:
# DNS_PORT=5553
# API_PORT=8080
# DB_DIR=./data
# UPSTREAM_DNS=1.1.1.1
npm start
```
The DNS server will listen on UDP port `5553`, and the API will listen on port `8080`.

---

## Pushing NetSentry to GitHub

To transfer the project to your home server `odin`, the easiest path is uploading it to your GitHub account:

1. Create a new repository on GitHub (e.g., `netsentry`).
2. Open your terminal in this directory on your local machine and run:
   ```bash
   git init
   git add .
   git commit -m "Initial commit of NetSentry DNS Firewall"
   git branch -M main
   git remote add origin https://github.com/YOUR_USERNAME/netsentry.git
   git push -u origin main
   ```

---

## Deploying on Home Server `odin`

Follow these steps to deploy NetSentry on your server:

### Step 1: Clone the repository on `odin`
SSH into your server `odin` and clone the repository:
```bash
git clone https://github.com/YOUR_USERNAME/netsentry.git
cd netsentry
```

### Step 2: Resolve Port 53 conflicts (Linux Hosts)
Many modern Linux distributions (such as Ubuntu Server) run a built-in DNS stub listener `systemd-resolved` on Port 53. If this is active on `odin`, NetSentry will fail to bind.

To disable `systemd-resolved`'s Port 53 listener and let NetSentry run:
1. Open `/etc/systemd/resolved.conf` with root privileges:
   ```bash
   sudo nano /etc/systemd/resolved.conf
   ```
2. Locate `#DNSStubListener=yes`, uncomment it (remove `#`), and change it to `no`:
   ```ini
   DNSStubListener=no
   ```
3. Save the file and exit (Ctrl+O, Enter, Ctrl+X).
4. Point your host server DNS resolver temporarily to localhost or an external IP by editing `/etc/resolv.conf`:
   ```bash
   sudo ln -sf /run/systemd/resolve/resolv.conf /etc/resolv.conf
   ```
5. Restart `systemd-resolved`:
   ```bash
   sudo systemctl restart systemd-resolved
   ```

### Step 3: Run NetSentry using Docker Compose
Spin up the container service. Docker will automatically pull Node images, compile the React assets, bundle the Express API, and start the DNS firewall in the background:
```bash
docker compose up -d --build
```

Verify the service is running:
```bash
docker compose ps
```

---

## Connecting Your Devices

To route your home network traffic through NetSentry:

### Option A: Router Level (Recommended)
Log in to your home router's admin console, locate the DHCP/DNS settings, and configure the Primary DNS server IP to be **the local IP of server `odin`** (e.g. `192.168.1.50`). 
All devices connecting to your Wi-Fi will automatically route their DNS requests through NetSentry.

### Option B: Single Device Level
Configure DNS settings on a specific equipment item (like a phone or laptop):
- **macOS**: System Settings -> Network -> Wi-Fi -> Details -> DNS -> Add `odin`'s IP.
- **Windows**: Settings -> Network & Internet -> Wi-Fi -> Hardware properties -> DNS assignment (Edit) -> Manual -> Enter `odin`'s IP.
- **iOS / Android**: Go to Wi-Fi settings, tap your network details, change IP settings from DHCP to Static, and set DNS 1 to `odin`'s IP.

---

## Managing Controls in Dashboard

Open your browser and navigate to `http://<ODIN_IP>:8080` (e.g. `http://192.168.1.50:8080`).

1. **Enable Adblocking**: Go to **Rules & Lists** tab. The default StevenBlack hosts blocklist is subscribed. Click **Sync & Update Filters** to download the feed and write domains to database.
2. **Assign Device Schedules**:
   - Query some websites on your client devices.
   - Go to **Client Manager** tab. The newly detected client IPs will show up automatically.
   - Click **Edit Controls** on a device card.
   - Give the client a friendly name (e.g. "Toddler Tablet"), select an icon, toggle **Enable Scheduled Internet Block**, select active days (e.g., Mon-Fri), set active block hours (e.g., `20:00` to `07:00`), and click **Save Rules**.
   - NetSentry will immediately refuse queries from that device within those hours.
