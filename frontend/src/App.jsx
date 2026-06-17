import React, { useState, useEffect, useRef } from 'react';
import {
  Activity,
  Shield,
  ShieldAlert,
  Smartphone,
  Laptop,
  Tv,
  Gamepad2,
  Home,
  Settings,
  Search,
  Trash2,
  Plus,
  RefreshCw,
  Clock,
  Calendar,
  ChevronLeft,
  ChevronRight,
  Server,
  Wifi,
  X,
  CheckCircle,
  AlertTriangle,
  FileText,
  Sliders,
  Globe
} from 'lucide-react';

const API_BASE = '/api';

export default function App() {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [systemStatus, setSystemStatus] = useState({
    status: 'online',
    uptime: '0h 0m',
    cpu: 0,
    memory: 0,
    qps: 0,
    blocklistCount: 0
  });

  // Mock initial data as safety fallback in case backend is loading/offline
  const [stats, setStats] = useState({
    totalQueries: 0,
    blockedQueries: 0,
    blockRate: '0.0%',
    activeClientsCount: 0
  });

  const [hourlyStats, setHourlyStats] = useState([]);
  const [logs, setLogs] = useState([]);
  const [logPage, setLogPage] = useState(1);
  const [logTotalPages, setLogTotalPages] = useState(1);
  const [logSearch, setLogSearch] = useState('');
  const [logStatusFilter, setLogStatusFilter] = useState('all');
  const [logClientFilter, setLogClientFilter] = useState('all');

  const [clients, setClients] = useState([]);
  const [whitelist, setWhitelist] = useState([]);
  const [blacklist, setBlacklist] = useState([]);
  const [adlists, setAdlists] = useState([]);

  // Modals and Forms
  const [selectedClient, setSelectedClient] = useState(null);
  const [isClientModalOpen, setIsClientModalOpen] = useState(false);
  const [clientForm, setClientForm] = useState({
    name: '',
    icon: 'laptop',
    scheduleEnabled: false,
    scheduleDays: [1, 2, 3, 4, 5], // Mon-Fri
    scheduleStart: '20:00',
    scheduleEnd: '07:00'
  });

  const [newRule, setNewRule] = useState('');
  const [newAdlist, setNewAdlist] = useState('');
  const [isUpdatingBlocklist, setIsUpdatingBlocklist] = useState(false);
  const [notification, setNotification] = useState(null);

  // Auto-refresh interval references
  const refreshInterval = useRef(null);

  const showNotification = (message, type = 'success') => {
    setNotification({ message, type });
    setTimeout(() => setNotification(null), 4000);
  };

  // Fetch functions
  const fetchStats = async () => {
    try {
      const res = await fetch(`${API_BASE}/stats`);
      if (res.ok) {
        const data = await res.json();
        setStats({
          totalQueries: data.totalQueries,
          blockedQueries: data.blockedQueries,
          blockRate: data.totalQueries > 0 ? ((data.blockedQueries / data.totalQueries) * 100).toFixed(1) + '%' : '0.0%',
          activeClientsCount: data.activeClientsCount
        });
        setHourlyStats(data.hourlyStats || []);
      }
    } catch (err) {
      console.warn('Backend stats API offline, using mock stats.');
    }
  };

  const fetchLogs = async () => {
    try {
      const queryParams = new URLSearchParams({
        page: logPage,
        limit: 10,
        search: logSearch,
        status: logStatusFilter,
        client: logClientFilter
      });
      const res = await fetch(`${API_BASE}/logs?${queryParams.toString()}`);
      if (res.ok) {
        const data = await res.json();
        setLogs(data.logs || []);
        setLogTotalPages(data.totalPages || 1);
      }
    } catch (err) {
      console.warn('Backend logs API offline.');
    }
  };

  const fetchClients = async () => {
    try {
      const res = await fetch(`${API_BASE}/clients`);
      if (res.ok) {
        const data = await res.json();
        setClients(data || []);
      }
    } catch (err) {
      console.warn('Backend clients API offline.');
    }
  };

  const fetchRules = async () => {
    try {
      const res = await fetch(`${API_BASE}/rules`);
      if (res.ok) {
        const data = await res.json();
        setWhitelist(data.whitelist || []);
        setBlacklist(data.blacklist || []);
        setAdlists(data.adlists || []);
      }
    } catch (err) {
      console.warn('Backend rules API offline.');
    }
  };

  const fetchSystemStatus = async () => {
    try {
      const res = await fetch(`${API_BASE}/status`);
      if (res.ok) {
        const data = await res.json();
        setSystemStatus({
          status: 'online',
          uptime: data.uptime,
          cpu: data.cpu,
          memory: data.memory,
          qps: data.qps,
          blocklistCount: data.blocklistCount
        });
      }
    } catch (err) {
      setSystemStatus(prev => ({ ...prev, status: 'offline' }));
    }
  };

  // Perform full refresh
  const refreshAll = () => {
    fetchSystemStatus();
    fetchStats();
    fetchClients();
    fetchRules();
    fetchLogs();
  };

  // Initial load and polling setup
  useEffect(() => {
    refreshAll();
    
    // Set up polling every 4 seconds for logs/stats, 15 seconds for clients/rules
    refreshInterval.current = setInterval(() => {
      fetchSystemStatus();
      fetchStats();
      if (activeTab === 'dashboard') {
        // Just stats & status
      } else if (activeTab === 'logs') {
        fetchLogs();
      }
    }, 4000);

    return () => clearInterval(refreshInterval.current);
  }, [activeTab, logPage, logSearch, logStatusFilter, logClientFilter]);

  // Handle Log search changes
  useEffect(() => {
    setLogPage(1);
  }, [logSearch, logStatusFilter, logClientFilter]);

  // Client Modal controls
  const handleEditClient = (client) => {
    setSelectedClient(client);
    setClientForm({
      name: client.name || '',
      icon: client.icon || 'laptop',
      scheduleEnabled: client.scheduleEnabled === 1 || client.scheduleEnabled === true,
      scheduleDays: client.scheduleDays ? JSON.parse(client.scheduleDays) : [1, 2, 3, 4, 5],
      scheduleStart: client.scheduleStart || '20:00',
      scheduleEnd: client.scheduleEnd || '07:00'
    });
    setIsClientModalOpen(true);
  };

  const saveClientSettings = async (e) => {
    e.preventDefault();
    if (!selectedClient) return;

    try {
      const res = await fetch(`${API_BASE}/clients/${selectedClient.ip}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: clientForm.name,
          icon: clientForm.icon,
          scheduleEnabled: clientForm.scheduleEnabled ? 1 : 0,
          scheduleDays: JSON.stringify(clientForm.scheduleDays),
          scheduleStart: clientForm.scheduleStart,
          scheduleEnd: clientForm.scheduleEnd
        })
      });
      
      if (res.ok) {
        showNotification(`Updated settings for ${clientForm.name || selectedClient.ip}`);
        setIsClientModalOpen(false);
        fetchClients();
      } else {
        showNotification('Failed to update client', 'error');
      }
    } catch (err) {
      showNotification('Network error updating client', 'error');
    }
  };

  const handleToggleDay = (day) => {
    setClientForm(prev => {
      const days = [...prev.scheduleDays];
      if (days.includes(day)) {
        return { ...prev, scheduleDays: days.filter(d => d !== day) };
      } else {
        return { ...prev, scheduleDays: [...days, day].sort() };
      }
    });
  };

  // Rule additions
  const handleAddRule = async (type) => {
    if (!newRule.trim()) return;
    try {
      const res = await fetch(`${API_BASE}/rules`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, domain: newRule.trim() })
      });
      
      if (res.ok) {
        showNotification(`Added ${newRule} to ${type}`);
        setNewRule('');
        fetchRules();
      } else {
        const errData = await res.json();
        showNotification(errData.error || 'Failed to add rule', 'error');
      }
    } catch (err) {
      showNotification('Network error adding rule', 'error');
    }
  };

  const handleDeleteRule = async (type, id) => {
    try {
      const res = await fetch(`${API_BASE}/rules/${type}/${id}`, {
        method: 'DELETE'
      });
      if (res.ok) {
        showNotification(`Rule deleted from ${type}`);
        fetchRules();
      }
    } catch (err) {
      showNotification('Network error deleting rule', 'error');
    }
  };

  // Add/Remove blocklist subscriptions
  const handleAddAdlist = async (e) => {
    e.preventDefault();
    if (!newAdlist.trim()) return;
    try {
      const res = await fetch(`${API_BASE}/adlists`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: newAdlist.trim() })
      });
      if (res.ok) {
        showNotification('Ad Blocklist subscription added');
        setNewAdlist('');
        fetchRules();
      }
    } catch (err) {
      showNotification('Network error adding blocklist', 'error');
    }
  };

  const handleDeleteAdlist = async (id) => {
    try {
      const res = await fetch(`${API_BASE}/adlists/${id}`, {
        method: 'DELETE'
      });
      if (res.ok) {
        showNotification('Ad Blocklist subscription removed');
        fetchRules();
      }
    } catch (err) {
      showNotification('Network error deleting blocklist', 'error');
    }
  };

  // Sync blocklists
  const triggerBlocklistSync = async () => {
    setIsUpdatingBlocklist(true);
    showNotification('Updating spam filters. This could take 1-2 minutes...', 'warning');
    try {
      const res = await fetch(`${API_BASE}/blocklists/update`, { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        showNotification(`Successfully updated blocklist! Loaded ${data.count} domains.`);
        fetchSystemStatus();
      } else {
        showNotification('Failed to update blocklist', 'error');
      }
    } catch (err) {
      showNotification('Network error syncing blocklist', 'error');
    } finally {
      setIsUpdatingBlocklist(false);
    }
  };

  // Quick Whitelist/Blacklist from log page
  const quickRuleAction = async (type, domain) => {
    try {
      const res = await fetch(`${API_BASE}/rules`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, domain })
      });
      if (res.ok) {
        showNotification(`Successfully added ${domain} to ${type}`);
        fetchRules();
      } else {
        showNotification('Rule already exists or is invalid', 'error');
      }
    } catch (err) {
      showNotification('Network error', 'error');
    }
  };

  // Icon mapping
  const renderClientIcon = (iconName) => {
    switch (iconName) {
      case 'smartphone': return <Smartphone size={20} />;
      case 'tv': return <Tv size={20} />;
      case 'gamepad': return <Gamepad2 size={20} />;
      case 'laptop':
      default: return <Laptop size={20} />;
    }
  };

  // Render Days initials
  const getDaysSummaryString = (daysArray) => {
    if (!daysArray || daysArray.length === 0) return 'Never';
    if (daysArray.length === 7) return 'Every day';
    if (daysArray.length === 5 && !daysArray.includes(0) && !daysArray.includes(6)) return 'Weekdays';
    if (daysArray.length === 2 && daysArray.includes(0) && daysArray.includes(6)) return 'Weekends';
    
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    return daysArray.map(d => dayNames[d]).join(', ');
  };

  return (
    <div className="app-container">
      {/* Sidebar */}
      <aside className="sidebar">
        <div className="brand">
          <Shield size={28} className="brand-logo" />
          <span className="brand-name">NetSentry</span>
        </div>

        <nav>
          <ul className="nav-links">
            <li className="nav-item">
              <button
                className={`nav-btn ${activeTab === 'dashboard' ? 'active' : ''}`}
                onClick={() => setActiveTab('dashboard')}
              >
                <Home size={20} />
                Dashboard
              </button>
            </li>
            <li className="nav-item">
              <button
                className={`nav-btn ${activeTab === 'logs' ? 'active' : ''}`}
                onClick={() => setActiveTab('logs')}
              >
                <Activity size={20} />
                Query Log
              </button>
            </li>
            <li className="nav-item">
              <button
                className={`nav-btn ${activeTab === 'clients' ? 'active' : ''}`}
                onClick={() => setActiveTab('clients')}
              >
                <Sliders size={20} />
                Client Manager
              </button>
            </li>
            <li className="nav-item">
              <button
                className={`nav-btn ${activeTab === 'rules' ? 'active' : ''}`}
                onClick={() => setActiveTab('rules')}
              >
                <Settings size={20} />
                Rules & Lists
              </button>
            </li>
          </ul>
        </nav>

        <div className="sidebar-footer">
          <div className="system-status-indicator">
            <span className={`status-dot ${systemStatus.status === 'offline' ? 'error' : ''}`} />
            <div>
              <div className="status-text">{systemStatus.status === 'online' ? 'System Active' : 'System Offline'}</div>
              <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Uptime: {systemStatus.uptime}</div>
            </div>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="main-content">
        {notification && (
          <div
            style={{
              position: 'fixed',
              top: '20px',
              right: '20px',
              background: notification.type === 'error' ? 'rgba(244, 63, 94, 0.95)' : notification.type === 'warning' ? 'rgba(245, 158, 11, 0.95)' : 'rgba(16, 185, 129, 0.95)',
              color: '#fff',
              padding: '0.75rem 1.5rem',
              borderRadius: '8px',
              zIndex: 10000,
              boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              fontWeight: 600,
              animation: 'fadeIn 0.2s ease-out'
            }}
          >
            {notification.type === 'error' ? <AlertTriangle size={18} /> : <CheckCircle size={18} />}
            {notification.message}
          </div>
        )}

        <header className="header">
          <div className="header-title">
            <h1>{activeTab.charAt(0).toUpperCase() + activeTab.slice(1)}</h1>
            <p>
              {activeTab === 'dashboard' && 'Real-time overview of home network DNS and security status.'}
              {activeTab === 'logs' && 'Inspect and manage incoming local network queries.'}
              {activeTab === 'clients' && 'Control friendly network equipment names and schedules.'}
              {activeTab === 'rules' && 'Maintain ad/spam blocklist subscriptions and exceptions.'}
            </p>
          </div>
          <div className="header-actions">
            <button className="btn-secondary" onClick={refreshAll}>
              <RefreshCw size={16} />
              Reload
            </button>
          </div>
        </header>

        {/* Tab 1: Dashboard */}
        {activeTab === 'dashboard' && (
          <>
            {/* Stats Cards */}
            <div className="stats-grid">
              <div className="glass-panel stat-card">
                <div className="stat-header">
                  <span className="stat-title">Total DNS Queries</span>
                  <Activity size={18} className="stat-icon" />
                </div>
                <div className="stat-value">{stats.totalQueries.toLocaleString()}</div>
                <span className="stat-desc">Since engine startup</span>
              </div>
              
              <div className="glass-panel stat-card blocked">
                <div className="stat-header">
                  <span className="stat-title">Queries Blocked</span>
                  <ShieldAlert size={18} className="stat-icon" />
                </div>
                <div className="stat-value">{stats.blockedQueries.toLocaleString()}</div>
                <span className="stat-desc">Spam, ad & scheduled blocks</span>
              </div>

              <div className="glass-panel stat-card rate">
                <div className="stat-header">
                  <span className="stat-title">Ad Block Rate</span>
                  <Shield size={18} className="stat-icon" />
                </div>
                <div className="stat-value">{stats.blockRate}</div>
                <span className="stat-desc">Percentage of requests blocked</span>
              </div>

              <div className="glass-panel stat-card clients">
                <div className="stat-header">
                  <span className="stat-title">Active Clients</span>
                  <Wifi size={18} className="stat-icon" />
                </div>
                <div className="stat-value">{stats.activeClientsCount}</div>
                <span className="stat-desc">Connected network devices</span>
              </div>
            </div>

            {/* Dashboard Charts */}
            <div className="dashboard-charts">
              <div className="glass-panel chart-card">
                <div className="chart-title-wrap">
                  <h3>Hourly Query Volume</h3>
                  <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Last 24 Hours</span>
                </div>
                
                {/* SVG Area Chart */}
                <div className="chart-content">
                  {hourlyStats.length > 0 ? (
                    <div className="custom-chart-bar-container">
                      {hourlyStats.slice(-12).map((item, idx) => {
                        const maxAllowed = Math.max(...hourlyStats.map(h => h.allowed + h.blocked), 10);
                        const allowedPct = (item.allowed / maxAllowed) * 100;
                        const blockedPct = (item.blocked / maxAllowed) * 100;
                        
                        return (
                          <div key={idx} className="chart-bar-column">
                            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 600 }}>
                              {item.allowed + item.blocked}
                            </div>
                            <div className="chart-bar-stack">
                              <div
                                className="chart-bar-fill blocked"
                                style={{ height: `${blockedPct}%` }}
                                title={`Blocked: ${item.blocked}`}
                              />
                              <div
                                className="chart-bar-fill"
                                style={{ height: `${allowedPct}%` }}
                                title={`Allowed: ${item.allowed}`}
                              />
                            </div>
                            <span className="chart-bar-label">{item.hour}</span>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div style={{ margin: 'auto', color: 'var(--text-muted)', fontSize: '0.9rem' }}>
                      No hourly logs recorded yet. Query DNS to populate charts!
                    </div>
                  )}
                </div>
              </div>

              <div className="glass-panel chart-card" style={{ display: 'flex', flexDirection: 'column' }}>
                <div className="chart-title-wrap">
                  <h3>Hardware Status</h3>
                </div>
                <div className="settings-grid" style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                  <div className="system-status-detail">
                    <div className="system-stat-box">
                      <h6>CPU Load</h6>
                      <p style={{ color: systemStatus.cpu > 75 ? 'var(--accent-red)' : 'var(--text-primary)' }}>
                        {systemStatus.cpu}%
                      </p>
                    </div>
                    <div className="system-stat-box">
                      <h6>Memory Usage</h6>
                      <p>{systemStatus.memory}%</p>
                    </div>
                  </div>
                  <div className="system-status-detail">
                    <div className="system-stat-box">
                      <h6>Queries / Sec</h6>
                      <p>{systemStatus.qps}</p>
                    </div>
                    <div className="system-stat-box">
                      <h6>Blocked Domains</h6>
                      <p style={{ color: 'var(--accent-cyan)' }}>
                        {systemStatus.blocklistCount.toLocaleString()}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Top Blocked Domains */}
            <div className="glass-panel">
              <div className="chart-title-wrap">
                <h3>Recently Blocked Requests</h3>
                <button className="action-btn-sm" onClick={() => setActiveTab('logs')}>View All Logs</button>
              </div>
              <div className="table-wrap">
                <table className="custom-table">
                  <thead>
                    <tr>
                      <th>Time</th>
                      <th>Client</th>
                      <th>Requested Domain</th>
                      <th>Block Reason</th>
                      <th>Quick Exception</th>
                    </tr>
                  </thead>
                  <tbody>
                    {logs.filter(l => l.status === 'blocked').slice(0, 5).map((log) => (
                      <tr key={log.id}>
                        <td style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                          {new Date(log.timestamp).toLocaleTimeString()}
                        </td>
                        <td>
                          <span style={{ fontWeight: 600 }}>{log.clientName || log.clientIp}</span>
                          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block' }}>{log.clientIp}</span>
                        </td>
                        <td className="domain-text">{log.domain}</td>
                        <td>
                          <span className={`status-pill ${log.reason === 'schedule' ? 'blocked-schedule' : 'blocked'}`}>
                            {log.reason === 'schedule' ? 'Parental Lock' : 'Spam/Ad'}
                          </span>
                        </td>
                        <td>
                          <button
                            className="action-btn-sm unblock"
                            onClick={() => quickRuleAction('whitelist', log.domain)}
                          >
                            Whitelist
                          </button>
                        </td>
                      </tr>
                    ))}
                    {logs.filter(l => l.status === 'blocked').length === 0 && (
                      <tr>
                        <td colSpan="5" style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '2rem' }}>
                          No blocked queries found. System is monitoring your traffic.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}

        {/* Tab 2: Logs */}
        {activeTab === 'logs' && (
          <div className="glass-panel table-panel">
            <div className="filters-bar">
              <div className="search-input-wrap">
                <Search size={16} />
                <input
                  type="text"
                  className="search-input"
                  placeholder="Search domains..."
                  value={logSearch}
                  onChange={(e) => setLogSearch(e.target.value)}
                />
              </div>

              <select
                className="select-filter"
                value={logStatusFilter}
                onChange={(e) => setLogStatusFilter(e.target.value)}
              >
                <option value="all">All Traffic</option>
                <option value="allowed">Allowed Only</option>
                <option value="blocked">Blocked Only</option>
              </select>

              <select
                className="select-filter"
                value={logClientFilter}
                onChange={(e) => setLogClientFilter(e.target.value)}
              >
                <option value="all">All Equipment</option>
                {clients.map(c => (
                  <option key={c.ip} value={c.ip}>{c.name || c.ip}</option>
                ))}
              </select>
            </div>

            <div className="table-wrap">
              <table className="custom-table">
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>Equipment</th>
                    <th>Requested Host / Domain</th>
                    <th>Type</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map((log) => (
                    <tr key={log.id}>
                      <td style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                        {new Date(log.timestamp).toLocaleTimeString()}
                      </td>
                      <td>
                        <span style={{ fontWeight: 600 }}>{log.clientName || log.clientIp}</span>
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block' }}>{log.clientIp}</span>
                      </td>
                      <td className="domain-text">{log.domain}</td>
                      <td style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--accent-blue)' }}>
                        {log.type}
                      </td>
                      <td>
                        <span className={`status-pill ${log.status === 'allowed' ? 'allowed' : log.reason === 'schedule' ? 'blocked-schedule' : 'blocked'}`}>
                          {log.status === 'allowed' ? 'Allowed' : log.reason === 'schedule' ? 'Scheduled Block' : 'Blocked (Ad)'}
                        </span>
                      </td>
                      <td>
                        {log.status === 'allowed' ? (
                          <button
                            className="action-btn-sm block"
                            onClick={() => quickRuleAction('blacklist', log.domain)}
                          >
                            Block Domain
                          </button>
                        ) : (
                          <button
                            className="action-btn-sm unblock"
                            onClick={() => quickRuleAction('whitelist', log.domain)}
                          >
                            Unblock
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                  {logs.length === 0 && (
                    <tr>
                      <td colSpan="6" style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '3rem' }}>
                        No DNS transactions found matching the filter options.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {logTotalPages > 1 && (
              <div className="pagination">
                <span className="pagination-info">Page {logPage} of {logTotalPages}</span>
                <div className="pagination-controls">
                  <button
                    className="pagination-btn"
                    disabled={logPage <= 1}
                    onClick={() => setLogPage(p => p - 1)}
                  >
                    <ChevronLeft size={16} />
                  </button>
                  <button
                    className="pagination-btn"
                    disabled={logPage >= logTotalPages}
                    onClick={() => setLogPage(p => p + 1)}
                  >
                    <ChevronRight size={16} />
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Tab 3: Client Manager */}
        {activeTab === 'clients' && (
          <div className="clients-grid">
            {clients.map((client) => (
              <div key={client.ip} className="glass-panel client-card">
                <div>
                  <div className="client-info-row">
                    <div className="client-avatar">
                      {renderClientIcon(client.icon)}
                    </div>
                    <div className="client-details">
                      <h4>{client.name || 'Unnamed Client'}</h4>
                      <p>{client.ip}</p>
                    </div>
                  </div>

                  <div className="client-stats-mini">
                    <div className="mini-stat">
                      <h5>Queries</h5>
                      <p>{client.totalQueries ? client.totalQueries.toLocaleString() : 0}</p>
                    </div>
                    <div className="mini-stat">
                      <h5>Blocked</h5>
                      <p style={{ color: client.blockedQueries > 0 ? 'var(--accent-red)' : 'var(--text-primary)' }}>
                        {client.blockedQueries ? client.blockedQueries.toLocaleString() : 0}
                      </p>
                    </div>
                  </div>

                  <div className="schedule-editor" style={{ marginBottom: '1.25rem', borderStyle: client.scheduleEnabled ? 'solid' : 'dashed', borderColor: client.scheduleEnabled ? 'var(--accent-purple)' : 'var(--border-color)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: client.scheduleEnabled ? 'var(--accent-purple)' : 'var(--text-muted)' }}>
                      <Calendar size={16} />
                      <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>
                        {client.scheduleEnabled ? 'Schedule Active' : 'Parental Controls Off'}
                      </span>
                    </div>
                    {client.scheduleEnabled === 1 && (
                      <div style={{ fontSize: '0.75rem', marginTop: '0.5rem', color: 'var(--text-secondary)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                          <Clock size={12} />
                          <span>Blocks between: {client.scheduleStart} - {client.scheduleEnd}</span>
                        </div>
                        <div style={{ marginTop: '0.25rem' }}>
                          Active: {getDaysSummaryString(client.scheduleDays ? JSON.parse(client.scheduleDays) : [])}
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                <div className="client-actions">
                  <button className="btn-secondary" style={{ flex: 1 }} onClick={() => handleEditClient(client)}>
                    Edit Controls
                  </button>
                </div>
              </div>
            ))}

            {clients.length === 0 && (
              <div className="glass-panel" style={{ gridColumn: '1 / -1', textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>
                No active equipment detected on DNS server yet. Discovered devices will appear here automatically.
              </div>
            )}
          </div>
        )}

        {/* Tab 4: Rules & Settings */}
        {activeTab === 'rules' && (
          <div className="rules-container">
            {/* Whitelist and Blacklist */}
            <div className="rule-list-box">
              <div className="glass-panel" style={{ marginBottom: '1.5rem', flex: 1 }}>
                <div className="rule-header-row">
                  <h3>Whitelist Exceptions</h3>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Always allowed domains</span>
                </div>

                <div className="add-rule-form">
                  <input
                    type="text"
                    className="form-input"
                    placeholder="e.g. tracking.service.com"
                    value={newRule}
                    onChange={(e) => setNewRule(e.target.value)}
                  />
                  <button className="btn-primary" onClick={() => handleAddRule('whitelist')}>
                    <Plus size={16} />
                    Add
                  </button>
                </div>

                <ul className="rule-items-list">
                  {whitelist.map(item => (
                    <li key={item.id} className="rule-item">
                      <span className="rule-domain">{item.domain}</span>
                      <button className="delete-btn" onClick={() => handleDeleteRule('whitelist', item.id)}>
                        <Trash2 size={14} />
                      </button>
                    </li>
                  ))}
                  {whitelist.length === 0 && (
                    <li style={{ padding: '1rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                      No custom whitelist rules added yet.
                    </li>
                  )}
                </ul>
              </div>

              <div className="glass-panel" style={{ flex: 1 }}>
                <div className="rule-header-row">
                  <h3>Custom Blacklist</h3>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Always blocked domains</span>
                </div>

                <div className="add-rule-form">
                  <input
                    type="text"
                    className="form-input"
                    placeholder="e.g. distractingwebsite.com"
                    value={newRule}
                    onChange={(e) => setNewRule(e.target.value)}
                  />
                  <button className="btn-primary" onClick={() => handleAddRule('blacklist')}>
                    <Plus size={16} />
                    Add
                  </button>
                </div>

                <ul className="rule-items-list">
                  {blacklist.map(item => (
                    <li key={item.id} className="rule-item">
                      <span className="rule-domain">{item.domain}</span>
                      <button className="delete-btn" onClick={() => handleDeleteRule('blacklist', item.id)}>
                        <Trash2 size={14} />
                      </button>
                    </li>
                  ))}
                  {blacklist.length === 0 && (
                    <li style={{ padding: '1rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                      No custom blacklist rules added.
                    </li>
                  )}
                </ul>
              </div>
            </div>

            {/* Spam Filter / Adlist Subscriptions */}
            <div className="glass-panel rule-list-box">
              <div className="rule-header-row">
                <h3>Spam & Ad Filter Feeds</h3>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Auto-updating hosts feeds</span>
              </div>

              <form className="add-rule-form" onSubmit={handleAddAdlist}>
                <input
                  type="url"
                  className="form-input"
                  placeholder="https://server.com/hosts.txt"
                  value={newAdlist}
                  onChange={(e) => setNewAdlist(e.target.value)}
                />
                <button type="submit" className="btn-primary">
                  <Plus size={16} />
                  Subscribe
                </button>
              </form>

              <div style={{ marginBottom: '1.5rem', flex: 1 }}>
                <ul className="rule-items-list" style={{ maxHeight: '220px' }}>
                  {adlists.map(list => (
                    <li key={list.id} className="rule-item">
                      <div style={{ minWidth: 0, flex: 1, paddingRight: '1rem' }}>
                        <div className="domain-text" style={{ textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }} title={list.url}>
                          {list.url}
                        </div>
                        <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                          Loaded: {list.totalCount ? list.totalCount.toLocaleString() : 0} domains
                        </span>
                      </div>
                      <button className="delete-btn" onClick={() => handleDeleteAdlist(list.id)}>
                        <Trash2 size={14} />
                      </button>
                    </li>
                  ))}
                  {adlists.length === 0 && (
                    <li style={{ padding: '1rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                      No blocklist subscription URLs configured.
                    </li>
                  )}
                </ul>
              </div>

              <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '1.5rem' }}>
                <button
                  className="btn-primary"
                  style={{ width: '100%', justifyContent: 'center' }}
                  disabled={isUpdatingBlocklist}
                  onClick={triggerBlocklistSync}
                >
                  <RefreshCw size={16} className={isUpdatingBlocklist ? 'loading' : ''} style={{ animation: isUpdatingBlocklist ? 'spin 1.5s linear infinite' : 'none' }} />
                  {isUpdatingBlocklist ? 'Syncing Feeds...' : 'Sync & Update Filters'}
                </button>
                <style>{`
                  @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
                `}</style>
              </div>
            </div>
          </div>
        )}

        {/* Modal: Client Configuration & Scheduling */}
        {isClientModalOpen && (
          <div className="modal-overlay">
            <div className="modal-content">
              <div className="modal-header">
                <h3>Control Device Controls</h3>
                <button className="modal-close" onClick={() => setIsClientModalOpen(false)}>
                  <X size={20} />
                </button>
              </div>

              <form onSubmit={saveClientSettings}>
                <div className="form-group">
                  <label>Equipment IP Address</label>
                  <input type="text" className="form-input" value={selectedClient?.ip} disabled style={{ opacity: 0.6 }} />
                </div>

                <div className="form-group">
                  <label>Equipment Friendly Name</label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="e.g. Kid's iPad"
                    required
                    value={clientForm.name}
                    onChange={(e) => setClientForm(prev => ({ ...prev, name: e.target.value }))}
                  />
                </div>

                <div className="form-group">
                  <label>Device Type Icon</label>
                  <div className="icon-selector">
                    <button
                      type="button"
                      className={`icon-option ${clientForm.icon === 'laptop' ? 'selected' : ''}`}
                      onClick={() => setClientForm(prev => ({ ...prev, icon: 'laptop' }))}
                      title="Computer / Laptop"
                    >
                      <Laptop size={18} />
                    </button>
                    <button
                      type="button"
                      className={`icon-option ${clientForm.icon === 'smartphone' ? 'selected' : ''}`}
                      onClick={() => setClientForm(prev => ({ ...prev, icon: 'smartphone' }))}
                      title="Mobile / Tablet"
                    >
                      <Smartphone size={18} />
                    </button>
                    <button
                      type="button"
                      className={`icon-option ${clientForm.icon === 'tv' ? 'selected' : ''}`}
                      onClick={() => setClientForm(prev => ({ ...prev, icon: 'tv' }))}
                      title="Smart TV / Media Player"
                    >
                      <Tv size={18} />
                    </button>
                    <button
                      type="button"
                      className={`icon-option ${clientForm.icon === 'gamepad' ? 'selected' : ''}`}
                      onClick={() => setClientForm(prev => ({ ...prev, icon: 'gamepad' }))}
                      title="Game Console"
                    >
                      <Gamepad2 size={18} />
                    </button>
                  </div>
                </div>

                {/* Parental Controls Schedule */}
                <div className="form-group" style={{ borderTop: '1px solid var(--border-color)', paddingTop: '1.25rem', marginTop: '1.5rem' }}>
                  <div className="schedule-toggle-row">
                    <span className="switch-label" style={{ fontWeight: 600 }}>Enable Scheduled Internet Block</span>
                    <label className="switch">
                      <input
                        type="checkbox"
                        checked={clientForm.scheduleEnabled}
                        onChange={(e) => setClientForm(prev => ({ ...prev, scheduleEnabled: e.target.checked }))}
                      />
                      <span className="slider" />
                    </label>
                  </div>

                  {clientForm.scheduleEnabled && (
                    <div style={{ animation: 'slideUp 0.25s ease-out' }}>
                      <label style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '1rem', display: 'block' }}>
                        Select Days of the Week to Block
                      </label>
                      <div className="day-selector">
                        {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((day, idx) => (
                          <button
                            key={idx}
                            type="button"
                            className={`day-btn ${clientForm.scheduleDays.includes(idx) ? 'selected' : ''}`}
                            onClick={() => handleToggleDay(idx)}
                          >
                            {day}
                          </button>
                        ))}
                      </div>

                      <label style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', display: 'block', marginBottom: '0.5rem' }}>
                        Daily Inactive Hours (Block Window)
                      </label>
                      <div className="time-range-wrap">
                        <div>
                          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block' }}>From (Start)</span>
                          <input
                            type="time"
                            className="time-input"
                            required
                            value={clientForm.scheduleStart}
                            onChange={(e) => setClientForm(prev => ({ ...prev, scheduleStart: e.target.value }))}
                          />
                        </div>
                        <div style={{ alignSelf: 'flex-end', paddingBottom: '0.5rem', color: 'var(--text-muted)', fontWeight: 800 }}>
                          to
                        </div>
                        <div>
                          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block' }}>Until (End)</span>
                          <input
                            type="time"
                            className="time-input"
                            required
                            value={clientForm.scheduleEnd}
                            onChange={(e) => setClientForm(prev => ({ ...prev, scheduleEnd: e.target.value }))}
                          />
                        </div>
                      </div>
                      <p style={{ fontSize: '0.75rem', color: 'var(--accent-purple)', marginTop: '0.75rem', fontStyle: 'italic' }}>
                        Note: The device will be blocked from resolving all DNS names within these hours.
                      </p>
                    </div>
                  )}
                </div>

                <div style={{ display: 'flex', gap: '1rem', marginTop: '2rem' }}>
                  <button type="button" className="btn-secondary" style={{ flex: 1 }} onClick={() => setIsClientModalOpen(false)}>
                    Cancel
                  </button>
                  <button type="submit" className="btn-primary" style={{ flex: 1, justifyContent: 'center' }}>
                    Save Rules
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
