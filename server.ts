import express from 'express';
import path from 'path';
import fs from 'fs';
import os from 'os';
import dotenv from 'dotenv';
import * as XLSX from 'xlsx';
import { fileURLToPath } from 'url';
import { GoogleGenAI } from '@google/genai';

dotenv.config();

// Safe resolution of __filename and __dirname for both ESM (development) and bundled CommonJS (production)
const resolvedFilename = typeof __filename !== 'undefined' ? __filename : (typeof import.meta !== 'undefined' && import.meta.url ? fileURLToPath(import.meta.url) : '');
const resolvedDirname = typeof __dirname !== 'undefined' ? __dirname : (resolvedFilename ? path.dirname(resolvedFilename) : process.cwd());

const app = express();
const PORT = Number(process.env.PORT) || Number(process.argv[2]) || (process.env.NODE_ENV === 'production' ? 3015 : 3000);

app.use(express.json({ limit: '100mb' }));
app.use(express.text({ limit: '100mb', type: ['text/*', 'application/json'] }));
app.use(express.urlencoded({ extended: true, limit: '100mb' }));

// CORS & Preflight headers for production hosting environments
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

// Server-Side Persistent Storage Paths (with container/server fallback)
let DATA_DIR = path.join(process.cwd(), 'data');
try {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  // Test write access
  const testPath = path.join(DATA_DIR, '.write_test');
  fs.writeFileSync(testPath, 'ok', 'utf-8');
  fs.unlinkSync(testPath);
} catch (permErr) {
  console.warn('[Server Storage] Local directory /data not writable, switching to OS temporary directory:', permErr);
  DATA_DIR = path.join(os.tmpdir(), 'skyarc_data');
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

const BACKUPS_DIR = path.join(DATA_DIR, 'backups');
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
const STATE_FILE = path.join(DATA_DIR, 'system_state.json');
const ARCHIVE_FILE = path.join(DATA_DIR, 'archived_expenses.json');
const SESSIONS_FILE = path.join(DATA_DIR, 'active_user_sessions.json');

try {
  if (!fs.existsSync(BACKUPS_DIR)) {
    fs.mkdirSync(BACKUPS_DIR, { recursive: true });
  }
  if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  }
} catch (bErr) {
  console.warn('[Server Storage] Could not create storage subdirs:', bErr);
}

// Serve uploaded files statically
app.use('/uploads', express.static(UPLOADS_DIR));
app.use('/api/uploads', express.static(UPLOADS_DIR));

// In-Memory Storage Cache & Versioning
let cachedState: any = null;
let lastModifiedTime: string = '';
let serverVersion: number = 1;
let lastAutoBackupTime: number = 0;
let activeUserSessions: Record<string, { userId: string; activeSessionId: string; userName?: string; device?: string; loginTime: string; lastSeenAt?: string }> = {};

function saveActiveSessionsToDisk() {
  try {
    fs.writeFileSync(SESSIONS_FILE, JSON.stringify(activeUserSessions, null, 2), 'utf-8');
  } catch (err) {
    console.warn('[Server Storage] Error writing active_user_sessions.json:', err);
  }
}

// Load persisted state from disk on server launch
function loadStateFromDisk() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      const content = fs.readFileSync(STATE_FILE, 'utf-8');
      if (content && content.trim()) {
        cachedState = JSON.parse(content);
        const stats = fs.statSync(STATE_FILE);
        lastModifiedTime = stats.mtime.toISOString();
        console.log(`[Server Storage] Loaded existing database from disk (${(content.length / 1024).toFixed(1)} KB, ${(cachedState.expenses?.length || 0)} expenses, path: ${STATE_FILE})`);
      }
    } else {
      console.log(`[Server Storage] No prior system_state.json found at ${STATE_FILE}. Ready to receive initial data.`);
    }

    if (fs.existsSync(SESSIONS_FILE)) {
      try {
        const sessContent = fs.readFileSync(SESSIONS_FILE, 'utf-8');
        if (sessContent && sessContent.trim()) {
          activeUserSessions = JSON.parse(sessContent);
        }
      } catch (sessErr) {
        console.warn('[Server Storage] Could not read active_user_sessions.json:', sessErr);
      }
    }
  } catch (err) {
    console.error('[Server Storage] Error reading database from disk:', err);
  }
}

loadStateFromDisk();

// Safe write to disk (with immediate in-memory cache update & concurrent smart merge)
function saveStateToDisk(data: any, updatedBy: string = 'مدير النظام'): { success: boolean; savedAt?: string; version?: number; error?: string } {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }

    const nowIso = new Date().toISOString();

    // 1. Reconcile Tombstones across all entities
    const existingData = cachedState || {};
    const existingDeletedExpenses = (existingData.deletedExpenseIds && typeof existingData.deletedExpenseIds === 'object') ? existingData.deletedExpenseIds : {};
    const incomingDeletedExpenses = (data.deletedExpenseIds && typeof data.deletedExpenseIds === 'object') ? data.deletedExpenseIds : {};
    const mergedDeletedExpenses = { ...existingDeletedExpenses, ...incomingDeletedExpenses };

    const existingDeletedCustodies = (existingData.deletedCustodyIds && typeof existingData.deletedCustodyIds === 'object') ? existingData.deletedCustodyIds : {};
    const incomingDeletedCustodies = (data.deletedCustodyIds && typeof data.deletedCustodyIds === 'object') ? data.deletedCustodyIds : {};
    const mergedDeletedCustodies = { ...existingDeletedCustodies, ...incomingDeletedCustodies };

    const existingDeletedProjects = (existingData.deletedProjectIds && typeof existingData.deletedProjectIds === 'object') ? existingData.deletedProjectIds : {};
    const incomingDeletedProjects = (data.deletedProjectIds && typeof data.deletedProjectIds === 'object') ? data.deletedProjectIds : {};
    const mergedDeletedProjects = { ...existingDeletedProjects, ...incomingDeletedProjects };

    const existingDeletedUsers = (existingData.deletedUserIds && typeof existingData.deletedUserIds === 'object') ? existingData.deletedUserIds : {};
    const incomingDeletedUsers = (data.deletedUserIds && typeof data.deletedUserIds === 'object') ? data.deletedUserIds : {};
    const mergedDeletedUsers = { ...existingDeletedUsers, ...incomingDeletedUsers };

    const existingDeletedRoles = (existingData.deletedRoleIds && typeof existingData.deletedRoleIds === 'object') ? existingData.deletedRoleIds : {};
    const incomingDeletedRoles = (data.deletedRoleIds && typeof data.deletedRoleIds === 'object') ? data.deletedRoleIds : {};
    const mergedDeletedRoles = { ...existingDeletedRoles, ...incomingDeletedRoles };

    const existingDeletedStages = (existingData.deletedWorkflowStageIds && typeof existingData.deletedWorkflowStageIds === 'object') ? existingData.deletedWorkflowStageIds : {};
    const incomingDeletedStages = (data.deletedWorkflowStageIds && typeof data.deletedWorkflowStageIds === 'object') ? data.deletedWorkflowStageIds : {};
    const mergedDeletedStages = { ...existingDeletedStages, ...incomingDeletedStages };

    // 2. Authoritative Entity Persistence with Tombstone Exclusions
    // Projects
    let cleanProjects: any[] = [];
    if (Array.isArray(data.projects) && (data.projects.length > 0 || Object.keys(mergedDeletedProjects).length > 0)) {
      cleanProjects = data.projects.filter((p: any) => p && p.id && !mergedDeletedProjects[p.id]);
    } else if (Array.isArray(existingData.projects)) {
      cleanProjects = existingData.projects.filter((p: any) => p && p.id && !mergedDeletedProjects[p.id]);
    }

    // Custodies
    let cleanCustodies: any[] = [];
    if (Array.isArray(data.custodies) && (data.custodies.length > 0 || Object.keys(mergedDeletedCustodies).length > 0)) {
      cleanCustodies = data.custodies.filter((c: any) => c && c.id && !mergedDeletedCustodies[c.id]);
    } else if (Array.isArray(existingData.custodies)) {
      cleanCustodies = existingData.custodies.filter((c: any) => c && c.id && !mergedDeletedCustodies[c.id]);
    }

    // Users
    let cleanUsers: any[] = [];
    if (Array.isArray(data.users) && (data.users.length > 0 || Object.keys(mergedDeletedUsers).length > 0)) {
      cleanUsers = data.users.filter((u: any) => u && u.id && !mergedDeletedUsers[u.id]);
    } else if (Array.isArray(existingData.users)) {
      cleanUsers = existingData.users.filter((u: any) => u && u.id && !mergedDeletedUsers[u.id]);
    }

    // Expenses
    let cleanExpenses: any[] = [];
    if (Array.isArray(data.expenses) && (data.expenses.length > 0 || Object.keys(mergedDeletedExpenses).length > 0)) {
      cleanExpenses = data.expenses.filter((exp: any) => exp && exp.id && !mergedDeletedExpenses[exp.id]);
    } else if (Array.isArray(existingData.expenses)) {
      cleanExpenses = existingData.expenses.filter((exp: any) => exp && exp.id && !mergedDeletedExpenses[exp.id]);
    }

    // Roles
    let cleanRoles: any[] = [];
    if (Array.isArray(data.roles) && data.roles.length > 0) {
      cleanRoles = data.roles.filter((r: any) => r && r.id && !mergedDeletedRoles[r.id]);
    } else if (Array.isArray(existingData.roles)) {
      cleanRoles = existingData.roles.filter((r: any) => r && r.id && !mergedDeletedRoles[r.id]);
    }

    // Workflow Stages
    let cleanStages: any[] = [];
    if (Array.isArray(data.workflowStages) && data.workflowStages.length > 0) {
      cleanStages = data.workflowStages.filter((s: any) => s && s.id && !mergedDeletedStages[s.id]);
    } else if (Array.isArray(existingData.workflowStages)) {
      cleanStages = existingData.workflowStages.filter((s: any) => s && s.id && !mergedDeletedStages[s.id]);
    }

    // Settings Merge
    const mergedSettings = (data.settings && typeof data.settings === 'object')
      ? { ...(existingData.settings || {}), ...data.settings }
      : (existingData.settings || {});

    // Notifications & Tickets Merge
    const cleanNotifications = Array.isArray(data.notifications) && data.notifications.length > 0
      ? data.notifications
      : (existingData.notifications || []);
    const cleanTickets = Array.isArray(data.tickets) && data.tickets.length > 0
      ? data.tickets
      : (existingData.tickets || []);
    
    // Inject server metadata
    const statePayload = {
      ...existingData,
      ...data,
      deletedExpenseIds: mergedDeletedExpenses,
      deletedCustodyIds: mergedDeletedCustodies,
      deletedProjectIds: mergedDeletedProjects,
      deletedUserIds: mergedDeletedUsers,
      deletedRoleIds: mergedDeletedRoles,
      deletedWorkflowStageIds: mergedDeletedStages,
      expenses: cleanExpenses,
      custodies: cleanCustodies,
      projects: cleanProjects,
      users: cleanUsers,
      roles: cleanRoles,
      workflowStages: cleanStages,
      settings: mergedSettings,
      notifications: cleanNotifications,
      tickets: cleanTickets,
      lastSyncedAt: nowIso,
      syncedBy: updatedBy,
      serverSavedAt: nowIso
    };

    // Update in-memory state FIRST so reads are always 100% immediate & consistent
    cachedState = statePayload;
    lastModifiedTime = nowIso;
    serverVersion++;

    const jsonString = JSON.stringify(statePayload, null, 2);

    try {
      fs.writeFileSync(STATE_FILE, jsonString, 'utf-8');
    } catch (writeErr) {
      console.warn('[Server Storage] Direct write failed, attempting temp file rename:', writeErr);
      const tempFile = `${STATE_FILE}.tmp.${Date.now()}`;
      fs.writeFileSync(tempFile, jsonString, 'utf-8');
      fs.renameSync(tempFile, STATE_FILE);
    }

    // Trigger auto-backup every 4 hours if data has been updated
    const now = Date.now();
    if (now - lastAutoBackupTime > 4 * 60 * 60 * 1000) {
      lastAutoBackupTime = now;
      try {
        if (!fs.existsSync(BACKUPS_DIR)) fs.mkdirSync(BACKUPS_DIR, { recursive: true });
        const backupFilename = `auto_backup_${new Date().toISOString().slice(0, 10)}_${Date.now()}.json`;
        const backupPath = path.join(BACKUPS_DIR, backupFilename);
        fs.writeFileSync(backupPath, jsonString, 'utf-8');
        console.log(`[Server Storage] Periodic backup saved: ${backupFilename}`);
      } catch (backupErr) {
        console.warn('[Server Storage] Auto-backup notice:', backupErr);
      }
    }

    return { success: true, savedAt: nowIso, version: serverVersion };
  } catch (err: any) {
    console.error('[Server Storage] Error saving database to disk:', err);
    // If in-memory is updated, return success with warning so application continues smoothly
    if (cachedState) {
      return { success: true, savedAt: new Date().toISOString(), version: serverVersion };
    }
    return { success: false, error: err?.message || 'Server disk write failed' };
  }
}

// Lazy initializer for Gemini API client
let aiClient: GoogleGenAI | null = null;
function getAIClient(): GoogleGenAI | null {
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!aiClient) {
      if (apiKey && apiKey !== 'MY_GEMINI_API_KEY') {
        aiClient = new GoogleGenAI({
          apiKey,
          httpOptions: {
            headers: {
              'User-Agent': 'aistudio-build',
            },
          },
        });
      } else {
        aiClient = new GoogleGenAI({
          httpOptions: {
            headers: {
              'User-Agent': 'aistudio-build',
            },
          },
        });
      }
    }
    return aiClient;
  } catch (err) {
    console.error('Error initializing GoogleGenAI client:', err);
    return null;
  }
}

// -------------------------------------------------------------
// Server Storage & Synchronization API Endpoints
// -------------------------------------------------------------

// Health check endpoint with storage diagnostic info
app.get(['/api/health', '/api/health.php'], (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    serverStorage: true,
    hasPersistedData: cachedState !== null,
    storagePath: STATE_FILE
  });
});

// POST /api/log-error: Receive and log client-side runtime errors
app.post(['/api/log-error', '/api/log-error.php'], (req, res) => {
  const { error, stack, location } = req.body || {};
  const logMessage = `\n========================================\n[${new Date().toISOString()}] CLIENT RUNTIME ERROR DETECTED\nMessage: ${error}\nStack: ${stack}\nLocation: ${location}\n========================================\n`;
  
  try {
    const errorLogFile = path.join(process.cwd(), 'data', 'client_errors.log');
    fs.appendFileSync(errorLogFile, logMessage, 'utf-8');
  } catch (err) {
    console.error('Failed to write to client_errors.log:', err);
  }

  console.error(logMessage);
  res.json({ success: true });
});

// Download compiled distribution zip for Hostinger / Shared Hosting
app.get(['/download-dist', '/api/download-dist', '/dist.zip'], (req, res) => {
  const distZipPath = path.join(process.cwd(), 'public', 'dist.zip');
  if (fs.existsSync(distZipPath)) {
    res.download(distZipPath, 'skyarc-hostinger-dist.zip');
  } else {
    const rootZip = path.join(process.cwd(), 'dist.zip');
    if (fs.existsSync(rootZip)) {
      res.download(rootZip, 'skyarc-hostinger-dist.zip');
    } else {
      res.status(404).json({ error: 'dist.zip not found. Please build first.' });
    }
  }
});

// Server Storage Diagnostics & Statistics
app.get(['/api/server-info', '/api/server-info.php'], (req, res) => {
  try {
    const exists = fs.existsSync(STATE_FILE);
    let fileSizeKb = 0;
    if (exists) {
      fileSizeKb = Math.round((fs.statSync(STATE_FILE).size / 1024) * 10) / 10;
    }
    res.json({
      status: 'ok',
      mode: 'server_disk_persistence',
      exists,
      fileSizeKb,
      lastModified: lastModifiedTime || null,
      version: serverVersion,
      expensesCount: Array.isArray(cachedState?.expenses) ? cachedState.expenses.length : 0,
      projectsCount: Array.isArray(cachedState?.projects) ? cachedState.projects.length : 0,
      custodiesCount: Array.isArray(cachedState?.custodies) ? cachedState.custodies.length : 0,
      usersCount: Array.isArray(cachedState?.users) ? cachedState.users.length : 0
    });
  } catch (err: any) {
    res.status(500).json({ status: 'error', error: err?.message });
  }
});

// GET /api/state/timestamp: Ultra-fast heartbeat check for multi-user real-time synchronization
app.get(['/api/state/timestamp', '/api/state/timestamp.php'], (req, res) => {
  const userId = (req.query.userId || req.headers['x-user-id']) as string;
  const sessionId = (req.query.sessionId || req.headers['x-session-id']) as string;
  let sessionEvicted = false;
  let activeSession = null;

  if (userId && sessionId && activeUserSessions[userId]) {
    activeSession = activeUserSessions[userId];
    if (activeSession.activeSessionId && activeSession.activeSessionId !== sessionId) {
      sessionEvicted = true;
    }
  }

  res.json({
    success: true,
    version: serverVersion,
    lastModified: lastModifiedTime || null,
    timestamp: new Date().toISOString(),
    sessionEvicted,
    activeSession
  });
});

// POST /api/session/register: Register active user session for single-device enforcement
app.post(['/api/session/register', '/api/session/register.php', '/api/session', '/api/session.php'], (req, res) => {
  try {
    const { userId, sessionId, activeSessionId, userName, device, loginTime } = req.body || {};
    const effectiveSessionId = sessionId || activeSessionId;
    if (!userId || !effectiveSessionId) {
      return res.status(400).json({ success: false, error: 'Missing userId or sessionId' });
    }

    const nowIso = new Date().toISOString();
    activeUserSessions[userId] = {
      userId,
      activeSessionId: effectiveSessionId,
      userName: userName || 'مستخدم النظام',
      device: device || 'متصفح ويب',
      loginTime: loginTime || nowIso,
      lastSeenAt: nowIso
    };

    saveActiveSessionsToDisk();

    // If cachedState exists and contains users, synchronize currentSessionId for this user
    if (cachedState && Array.isArray(cachedState.users)) {
      cachedState.users = cachedState.users.map((u: any) => {
        if (u.id === userId) {
          return {
            ...u,
            currentSessionId: effectiveSessionId,
            lastLoginAt: loginTime || nowIso,
            lastLoginDevice: device || u.lastLoginDevice
          };
        }
        return u;
      });
      saveStateToDisk(cachedState, `تسجيل دخول (${userName || userId}) - جلسة نشطة`);
    }

    res.json({
      success: true,
      activeSession: activeUserSessions[userId]
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message });
  }
});

// GET /api/session/active: Check if current session is active or has been evicted
app.get(['/api/session/active', '/api/session/active.php', '/api/session/active/:userId'], (req, res) => {
  try {
    const userId = (req.params.userId || req.query.userId || req.headers['x-user-id']) as string;
    const sessionId = (req.query.sessionId || req.headers['x-session-id']) as string;

    if (!userId) {
      return res.json({ success: true, activeSessions: activeUserSessions });
    }

    const currentActive = activeUserSessions[userId];
    if (!currentActive) {
      return res.json({
        success: true,
        isCurrentSessionActive: true,
        sessionEvicted: false,
        activeSession: null
      });
    }

    if (sessionId && currentActive.activeSessionId && currentActive.activeSessionId !== sessionId) {
      return res.json({
        success: true,
        isCurrentSessionActive: false,
        sessionEvicted: true,
        activeSessionId: currentActive.activeSessionId,
        activeSession: currentActive
      });
    }

    res.json({
      success: true,
      isCurrentSessionActive: true,
      sessionEvicted: false,
      activeSessionId: currentActive.activeSessionId,
      activeSession: currentActive
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message });
  }
});

// GET /api/state: Fetch the persisted system state from the server disk
app.get(['/api/state', '/api/state.php'], (req, res) => {
  try {
    const userId = (req.query.userId || req.headers['x-user-id']) as string;
    const sessionId = (req.query.sessionId || req.headers['x-session-id']) as string;

    // Strict security check: If user session was evicted, do NOT send data to this browser
    if (userId && sessionId && activeUserSessions[userId]) {
      const active = activeUserSessions[userId];
      if (active.activeSessionId && active.activeSessionId !== sessionId) {
        return res.json({
          success: false,
          sessionEvicted: true,
          error: 'SESSION_EVICTED',
          message: 'تم إنهاء الجلسة لتسجيل الدخول من جهاز آخر',
          activeSession: active,
          data: null
        });
      }
    }

    if (!cachedState && fs.existsSync(STATE_FILE)) {
      loadStateFromDisk();
    }

    if (cachedState) {
      res.json({
        success: true,
        exists: true,
        data: cachedState,
        lastModified: lastModifiedTime,
        version: serverVersion,
        stats: {
          expenses: Array.isArray(cachedState.expenses) ? cachedState.expenses.length : 0,
          projects: Array.isArray(cachedState.projects) ? cachedState.projects.length : 0,
          custodies: Array.isArray(cachedState.custodies) ? cachedState.custodies.length : 0,
          users: Array.isArray(cachedState.users) ? cachedState.users.length : 0
        }
      });
    } else {
      res.json({
        success: true,
        exists: false,
        data: null,
        version: 0,
        message: 'No data stored on server yet.'
      });
    }
  } catch (err: any) {
    console.error('[Server Storage] Error serving /api/state:', err);
    res.status(500).json({ success: false, error: err?.message || 'Server read error' });
  }
});

// POST /api/state: Save entire system state to server disk
app.post(['/api/state', '/api/state.php'], (req, res) => {
  try {
    let payload = req.body;
    if (typeof payload === 'string') {
      try {
        payload = JSON.parse(payload);
      } catch (err) {
        console.error('[Server Storage] JSON parse failed on string body:', err);
      }
    }
    const dataToSave = payload?.data || payload;
    const updatedBy = payload?.updatedBy || 'مستخدم النظام';
    const userId = (payload?.userId || req.headers['x-user-id'] || req.query.userId) as string;
    const sessionId = (payload?.sessionId || req.headers['x-session-id'] || req.query.sessionId) as string;

    // Strict security check: If user session was evicted, reject write from this evicted browser
    if (userId && sessionId && activeUserSessions[userId]) {
      const active = activeUserSessions[userId];
      if (active.activeSessionId && active.activeSessionId !== sessionId) {
        return res.status(403).json({
          success: false,
          sessionEvicted: true,
          error: 'SESSION_EVICTED',
          message: 'تم إنهاء الجلسة لتسجيل الدخول من جهاز آخر. تم حجب استقبال البيانات من هذا المتصفح.',
          activeSession: active
        });
      }
    }

    if (!dataToSave || typeof dataToSave !== 'object') {
      return res.status(400).json({ success: false, error: 'Invalid state payload' });
    }

    const saveResult = saveStateToDisk(dataToSave, updatedBy);
    if (!saveResult.success) {
      return res.status(500).json({ success: false, error: saveResult.error });
    }

    res.json({
      success: true,
      savedAt: saveResult.savedAt,
      version: saveResult.version,
      stats: {
        expenses: Array.isArray(cachedState?.expenses) ? cachedState.expenses.length : 0,
        projects: Array.isArray(cachedState?.projects) ? cachedState.projects.length : 0,
        custodies: Array.isArray(cachedState?.custodies) ? cachedState.custodies.length : 0,
        users: Array.isArray(cachedState?.users) ? cachedState.users.length : 0
      }
    });
  } catch (err: any) {
    console.error('[Server Storage] Error handling POST /api/state:', err);
    res.status(500).json({ success: false, error: err?.message || 'Server write error' });
  }
});

// POST /api/sync/delta: Incremental / Delta Sync endpoint for selective changes
app.post(['/api/sync/delta', '/api/sync/delta.php'], (req, res) => {
  try {
    const { deltas, lastSyncedAt, updatedBy } = req.body || {};
    if (!cachedState && fs.existsSync(STATE_FILE)) {
      loadStateFromDisk();
    }
    if (!cachedState) {
      cachedState = { expenses: [], projects: [], custodies: [], users: [], settings: {}, deletedExpenseIds: {} };
    }

    const currentState = cachedState;
    const nowIso = new Date().toISOString();

    // 1. Deleted items (tombstones) across all entities
    if (deltas?.deletedExpenseIds) {
      currentState.deletedExpenseIds = { ...(currentState.deletedExpenseIds || {}), ...deltas.deletedExpenseIds };
    }
    if (deltas?.deletedCustodyIds) {
      currentState.deletedCustodyIds = { ...(currentState.deletedCustodyIds || {}), ...deltas.deletedCustodyIds };
    }
    if (deltas?.deletedProjectIds) {
      currentState.deletedProjectIds = { ...(currentState.deletedProjectIds || {}), ...deltas.deletedProjectIds };
    }
    if (deltas?.deletedUserIds) {
      currentState.deletedUserIds = { ...(currentState.deletedUserIds || {}), ...deltas.deletedUserIds };
    }
    if (deltas?.deletedRoleIds) {
      currentState.deletedRoleIds = { ...(currentState.deletedRoleIds || {}), ...deltas.deletedRoleIds };
    }
    if (deltas?.deletedWorkflowStageIds) {
      currentState.deletedWorkflowStageIds = { ...(currentState.deletedWorkflowStageIds || {}), ...deltas.deletedWorkflowStageIds };
    }

    // 2. Upsert expenses (delta changes)
    if (Array.isArray(deltas?.expenses)) {
      const expMap = new Map((currentState.expenses || []).map((e: any) => [e.id, e]));
      for (const exp of deltas.expenses) {
        if (exp && exp.id) {
          expMap.set(exp.id, { ...(expMap.get(exp.id) as any || {}), ...exp, updatedAt: exp.updatedAt || nowIso });
        }
      }
      currentState.expenses = Array.from(expMap.values()).filter((e: any) => !currentState.deletedExpenseIds?.[e.id]);
    }

    // 3. Upsert projects
    if (Array.isArray(deltas?.projects)) {
      const projMap = new Map((currentState.projects || []).map((p: any) => [p.id, p]));
      for (const p of deltas.projects) {
        if (p && p.id) {
          projMap.set(p.id, { ...(projMap.get(p.id) as any || {}), ...p });
        }
      }
      currentState.projects = Array.from(projMap.values()).filter((p: any) => !currentState.deletedProjectIds?.[p.id]);
    }

    // 4. Upsert custodies
    if (Array.isArray(deltas?.custodies)) {
      const cMap = new Map((currentState.custodies || []).map((c: any) => [c.id, c]));
      for (const c of deltas.custodies) {
        if (c && c.id) {
          cMap.set(c.id, { ...(cMap.get(c.id) as any || {}), ...c });
        }
      }
      currentState.custodies = Array.from(cMap.values()).filter((c: any) => !currentState.deletedCustodyIds?.[c.id]);
    }

    // 5. Settings / users if provided
    if (deltas?.settings) {
      currentState.settings = { ...(currentState.settings || {}), ...deltas.settings };
    }
    if (Array.isArray(deltas?.users)) {
      const uMap = new Map((currentState.users || []).map((u: any) => [u.id, u]));
      for (const u of deltas.users) {
        if (u && u.id) uMap.set(u.id, { ...(uMap.get(u.id) as any || {}), ...u });
      }
      currentState.users = Array.from(uMap.values()).filter((u: any) => !currentState.deletedUserIds?.[u.id]);
    }

    const saveResult = saveStateToDisk(currentState, updatedBy || 'مستخدم النظام (مزامنة انتقائية)');
    if (!saveResult.success) {
      return res.status(500).json({ success: false, error: saveResult.error });
    }

    res.json({
      success: true,
      savedAt: saveResult.savedAt,
      version: saveResult.version,
      stats: {
        expenses: currentState.expenses.length,
        projects: currentState.projects.length,
        custodies: currentState.custodies.length
      }
    });
  } catch (err: any) {
    console.error('[Server Storage] Error handling POST /api/sync/delta:', err);
    res.status(500).json({ success: false, error: err?.message || 'Delta sync error' });
  }
});
app.post(['/api/backup', '/api/backup.php'], (req, res) => {
  try {
    const customData = req.body?.data || cachedState;
    const label = req.body?.label || 'manual';
    if (!customData) {
      return res.status(400).json({ success: false, error: 'No data available to backup' });
    }

    if (!fs.existsSync(BACKUPS_DIR)) {
      fs.mkdirSync(BACKUPS_DIR, { recursive: true });
    }

    const dateStr = new Date().toISOString().slice(0, 10);
    const filename = `backup_${label}_${dateStr}_${Date.now()}.json`;
    const targetPath = path.join(BACKUPS_DIR, filename);

    fs.writeFileSync(targetPath, JSON.stringify(customData, null, 2), 'utf-8');
    res.json({ success: true, filename, savedAt: new Date().toISOString() });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message });
  }
});

// GET /api/backups: List backups saved on the server
app.get(['/api/backups', '/api/backups.php'], (req, res) => {
  try {
    if (!fs.existsSync(BACKUPS_DIR)) {
      return res.json({ success: true, backups: [] });
    }
    const files = fs.readdirSync(BACKUPS_DIR);
    const backups = files
      .filter(f => f.endsWith('.json'))
      .map(f => {
        const stats = fs.statSync(path.join(BACKUPS_DIR, f));
        return {
          filename: f,
          sizeKb: Math.round((stats.size / 1024) * 10) / 10,
          createdAt: stats.birthtime.toISOString(),
          modifiedAt: stats.mtime.toISOString()
        };
      })
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    res.json({ success: true, backups });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message });
  }
});

// Helper: Generate Comprehensive Multi-Sheet Excel Workbook for Daily Backup (.xlsx)
function generateComprehensiveExcelBuffer(state: any): Buffer {
  const wb = XLSX.utils.book_new();
  const currencySymbol = state?.settings?.currencySymbol || 'ر.س';

  // 1. Sheet: Expenses (المصروفات)
  const rawExpenses = Array.isArray(state?.expenses) ? state.expenses : [];
  const expensesData = rawExpenses.map((e: any) => ({
    'رقم السند': e.id || '-',
    'التاريخ': e.date || '-',
    'وقت البصمة': e.fingerprintTime ? new Date(e.fingerprintTime).toLocaleString('ar-SA') : '-',
    'المشروع': e.projectName || '-',
    'المشرف': e.supervisorName || '-',
    'بريد المشرف': e.supervisorEmail || '-',
    'البند': e.category || '-',
    'البيان والتفاصيل': e.details || '-',
    [`المبلغ (${currencySymbol})`]: Number(e.amount) || 0,
    [`الضريبة (${currencySymbol})`]: Number(e.taxAmount) || 0,
    'رقم الفاتورة': e.invoiceNumber || '-',
    'حالة الاعتماد': e.status || '-',
    'اعتماد المشرف': e.projectManagerApproval || e.supervisorApproval || '-',
    'اعتماد المحاسب': e.accountantApproval || '-',
    'ترحيل ERP': e.erpPostingStatus || '-',
    'برنامج ERP': e.erpSystemName || '-',
    'رقم القيد الخارجي': e.erpReferenceNumber || '-',
    'اعتماد الإدارة': e.managementApproval || '-',
    'ملاحظات الإدارة': e.managementNotes || '-',
    'إحداثيات GPS': e.gpsLocation ? `${e.gpsLocation.lat}, ${e.gpsLocation.lng}` : '-'
  }));
  const wsExpenses = XLSX.utils.json_to_sheet(expensesData.length > 0 ? expensesData : [{ 'تنبيه': 'لا توجد مصروفات مسجلة حتى الآن' }]);
  XLSX.utils.book_append_sheet(wb, wsExpenses, 'المصروفات');

  // 2. Sheet: Custodies (العهد المسلمة)
  const rawCustodies = Array.isArray(state?.custodies) ? state.custodies : [];
  const custodiesData = rawCustodies.map((c: any) => ({
    'رقم إيصال العهدة': c.id || '-',
    'التاريخ': c.date || '-',
    'المشرف المستلم': c.supervisorName || '-',
    'البريد الإلكتروني': c.supervisorEmail || '-',
    [`المبلغ المسلم (${currencySymbol})`]: Number(c.amount) || 0,
    'طريقة الدفع': c.paymentMethod || '-',
    'رقم السند / الحوالة': c.receiptNumber || '-',
    'ملاحظات': c.notes || '-',
    'المسلم بواسطة': c.issuedBy || 'الإدارة'
  }));
  const wsCustodies = XLSX.utils.json_to_sheet(custodiesData.length > 0 ? custodiesData : [{ 'تنبيه': 'لا توجد عهد مسجلة' }]);
  XLSX.utils.book_append_sheet(wb, wsCustodies, 'العهد المسلمة');

  // 3. Sheet: Supervisor Balances (أرصدة المشرفين والعهد)
  const rawUsers = Array.isArray(state?.users) ? state.users : [];
  const supervisors = rawUsers.filter((u: any) => u.role === 'مشرف' || u.roleId === 'role_supervisor' || u.role === 'مدير مشروع');
  const supData = supervisors.map((s: any) => {
    const sCustody = rawCustodies.filter((c: any) => c.supervisorEmail === s.email).reduce((sum: number, c: any) => sum + (Number(c.amount) || 0), 0);
    const sApproved = rawExpenses.filter((e: any) => e.supervisorEmail === s.email && e.status === 'معتمد').reduce((sum: number, e: any) => sum + (Number(e.amount) || 0), 0);
    const sPending = rawExpenses.filter((e: any) => e.supervisorEmail === s.email && e.status !== 'معتمد' && e.status !== 'مرفوض').reduce((sum: number, e: any) => sum + (Number(e.amount) || 0), 0);
    return {
      'اسم المشرف': s.name,
      'البريد الإلكتروني': s.email,
      'رقم الجوال': s.phone || '-',
      [`إجمالي العهد المسلمة (${currencySymbol})`]: sCustody,
      [`المصروفات المعتمدة (${currencySymbol})`]: sApproved,
      [`المصروفات قيد المراجعة (${currencySymbol})`]: sPending,
      [`الرصيد الفعلي المتبقي (${currencySymbol})`]: sCustody - (sApproved + sPending)
    };
  });
  const wsSup = XLSX.utils.json_to_sheet(supData.length > 0 ? supData : [{ 'تنبيه': 'لا يوجد مشرفين مسجلين' }]);
  XLSX.utils.book_append_sheet(wb, wsSup, 'أرصدة المشرفين والعهد');

  // 4. Sheet: Projects (المشاريع)
  const rawProjects = Array.isArray(state?.projects) ? state.projects : [];
  const projectsData = rawProjects.map((p: any) => {
    const prjExpenses = rawExpenses.filter((e: any) => e.projectId === p.id && e.status === 'معتمد');
    const spent = prjExpenses.reduce((acc: number, curr: any) => acc + (Number(curr.amount) || 0), 0);
    return {
      'كود المشروع': p.code || '-',
      'اسم المشروع': p.name || '-',
      'الحالة': p.status || '-',
      'العميل / المالك': p.clientName || '-',
      'الموقع': p.location || '-',
      [`الميزانية المرصودة (${currencySymbol})`]: Number(p.budget) || 0,
      [`إجمالي المنصرف المعتمد (${currencySymbol})`]: spent,
      [`المتبقي من الميزانية (${currencySymbol})`]: (Number(p.budget) || 0) - spent,
      'نسبة الاستهلاك': `${Math.round((spent / (Number(p.budget) || 1)) * 100)}%`,
      'المشرفين': p.emails || '-'
    };
  });
  const wsProjects = XLSX.utils.json_to_sheet(projectsData.length > 0 ? projectsData : [{ 'تنبيه': 'لا توجد مشاريع مسجلة' }]);
  XLSX.utils.book_append_sheet(wb, wsProjects, 'المشاريع');

  // 5. Sheet: Users (المستخدمين)
  const usersData = rawUsers.map((u: any) => ({
    'اسم الدخول': u.username || '-',
    'الاسم الكامل': u.name,
    'الدور الوظيفي': u.role,
    'البريد الإلكتروني': u.email,
    'رقم الجوال': u.phone || '-',
    'الحالة': u.isActive ? 'نشط' : 'معطل'
  }));
  const wsUsers = XLSX.utils.json_to_sheet(usersData.length > 0 ? usersData : [{ 'تنبيه': 'لا يوجد مستخدمين' }]);
  XLSX.utils.book_append_sheet(wb, wsUsers, 'المستخدمين');

  // 6. Sheet: Roles (الأدوار والصلاحيات)
  const rawRoles = Array.isArray(state?.roles) ? state.roles : [];
  const rolesData = rawRoles.map((r: any) => ({
    'معرف الدور': r.id,
    'اسم الدور': r.name,
    'النوع': r.isSystem ? 'دور نظامي' : 'مخصص',
    'الوصف': r.description || '-',
    'مهلة التعديل (دقائق)': r.gracePeriodMinutes ?? '-'
  }));
  const wsRoles = XLSX.utils.json_to_sheet(rolesData.length > 0 ? rolesData : [{ 'تنبيه': 'لا توجد أدوار إضافية' }]);
  XLSX.utils.book_append_sheet(wb, wsRoles, 'الأدوار والصلاحيات');

  // 7. Sheet: Backup Metadata (معلومات النسخة الاحتياطية)
  const totalExpensesAmount = rawExpenses.reduce((sum: number, e: any) => sum + (Number(e.amount) || 0), 0);
  const totalCustodiesAmount = rawCustodies.reduce((sum: number, c: any) => sum + (Number(c.amount) || 0), 0);
  const infoData = [
    { 'البيان': 'نوع الملف', 'القيمة': 'حزمة مصنف إكسل الشامل (.xlsx) - النسخة الاحتياطية اليومية للمدير' },
    { 'البيان': 'تاريخ ووقت التصدير', 'القيمة': new Date().toLocaleString('ar-SA') },
    { 'البيان': 'إجمالي عدد المصروفات المسجلة', 'القيمة': rawExpenses.length },
    { 'البيان': `إجمالي قيمة المصروفات (${currencySymbol})`, 'القيمة': totalExpensesAmount },
    { 'البيان': 'إجمالي عدد دفعات العهد', 'القيمة': rawCustodies.length },
    { 'البيان': `إجمالي قيمة العهد المسلمة (${currencySymbol})`, 'القيمة': totalCustodiesAmount },
    { 'البيان': 'إجمالي عدد المشاريع', 'القيمة': rawProjects.length },
    { 'البيان': 'إجمالي عدد المستخدمين', 'القيمة': rawUsers.length },
    { 'البيان': 'البريد الإلكتروني المعتمد للمدير', 'القيمة': state?.settings?.managerBackupEmail || process.env.MANAGER_BACKUP_EMAIL || '2030m.mansour@gmail.com' },
    { 'البيان': 'النظام', 'القيمة': 'SkyArc Financial Control & Custody Management System v10.0' }
  ];
  const wsInfo = XLSX.utils.json_to_sheet(infoData);
  XLSX.utils.book_append_sheet(wb, wsInfo, 'معلومات النسخة');

  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  return buf as Buffer;
}

// Core Daily Backup Execution Logic (Local Server Storage & Comprehensive Excel)
async function performDailyBackup(
  forceState?: any
): Promise<{
  success: boolean;
  excelFileName: string;
  jsonFileName: string;
  dateStr: string;
  message: string;
  excelSizeKb: number;
  jsonSizeKb: number;
  error?: string;
}> {
  try {
    const state = forceState || cachedState || {};
    const dateStr = new Date().toISOString().slice(0, 10);

    if (!fs.existsSync(BACKUPS_DIR)) {
      fs.mkdirSync(BACKUPS_DIR, { recursive: true });
    }

    const dailyFolder = path.join(BACKUPS_DIR, 'daily');
    if (!fs.existsSync(dailyFolder)) {
      fs.mkdirSync(dailyFolder, { recursive: true });
    }

    // 1. Generate full backup JSON
    const jsonString = JSON.stringify(state, null, 2);
    const jsonFileName = `نسخة_احتياطية_كاملة_${dateStr}.json`;
    const jsonFilePath = path.join(dailyFolder, jsonFileName);
    fs.writeFileSync(jsonFilePath, jsonString, 'utf-8');

    // Stable pointer for latest daily JSON
    const latestJsonPath = path.join(dailyFolder, 'latest_daily_backup.json');
    fs.writeFileSync(latestJsonPath, jsonString, 'utf-8');

    // 2. Generate comprehensive Excel workbook (.xlsx)
    const excelBuffer = generateComprehensiveExcelBuffer(state);
    const excelFileName = `حزمة_مصنف_إكسل_الشامل_${dateStr}.xlsx`;
    const excelFilePath = path.join(dailyFolder, excelFileName);
    fs.writeFileSync(excelFilePath, excelBuffer);

    // Stable pointer for latest daily Excel
    const latestExcelPath = path.join(dailyFolder, 'latest_daily_backup.xlsx');
    fs.writeFileSync(latestExcelPath, excelBuffer);

    const excelSizeKb = Math.round((excelBuffer.length / 1024) * 10) / 10;
    const jsonSizeKb = Math.round((Buffer.byteLength(jsonString) / 1024) * 10) / 10;

    const expensesCount = Array.isArray(state.expenses) ? state.expenses.length : 0;
    const projectsCount = Array.isArray(state.projects) ? state.projects.length : 0;
    const custodiesCount = Array.isArray(state.custodies) ? state.custodies.length : 0;

    // Record status to disk
    const statusPayload = {
      lastSentDate: dateStr,
      lastSentAt: new Date().toISOString(),
      lastBackupDate: dateStr,
      lastBackupAt: new Date().toISOString(),
      excelFileName,
      jsonFileName,
      excelSizeKb,
      jsonSizeKb,
      expensesCount,
      projectsCount,
      custodiesCount
    };

    const statusFilePath = path.join(dailyFolder, 'daily_backup_status.json');
    fs.writeFileSync(statusFilePath, JSON.stringify(statusPayload, null, 2), 'utf-8');

    const responseMessage = `تم إنشاء مصنف إكسل الشامل والنسخة الاحتياطية (${excelFileName}) وحفظهما بنجاح على سيرفر البيانات المركزي!`;

    return {
      success: true,
      excelFileName,
      jsonFileName,
      dateStr,
      excelSizeKb,
      jsonSizeKb,
      message: responseMessage
    };
  } catch (err: any) {
    console.error('[Daily Backup] Failed daily backup execution:', err);
    return {
      success: false,
      excelFileName: '',
      jsonFileName: '',
      dateStr: new Date().toISOString().slice(0, 10),
      excelSizeKb: 0,
      jsonSizeKb: 0,
      message: 'فشل تنفيذ النسخ الاحتياطي اليومي',
      error: err?.message || 'Unknown error'
    };
  }
}

// Periodic Automated Check for Daily Backup (Runs daily or checks every 30 mins)
function checkAndRunDailyBackup() {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const dailyFolder = path.join(BACKUPS_DIR, 'daily');
    const statusFilePath = path.join(dailyFolder, 'daily_backup_status.json');

    let alreadyRanToday = false;
    if (fs.existsSync(statusFilePath)) {
      try {
        const raw = fs.readFileSync(statusFilePath, 'utf-8');
        const parsed = JSON.parse(raw);
        if (parsed.lastBackupDate === today || parsed.lastSentDate === today) {
          alreadyRanToday = true;
        }
      } catch {}
    }

    if (!alreadyRanToday && cachedState) {
      console.log(`[Daily Backup Scheduler] Initiating automated daily backup for ${today}...`);
      performDailyBackup();
    }
  } catch (schedErr) {
    console.warn('[Daily Backup Scheduler] Scheduler check encountered issue:', schedErr);
  }
}

// Trigger initial check 15 seconds after boot, then check every 30 minutes
setTimeout(checkAndRunDailyBackup, 15000);
setInterval(checkAndRunDailyBackup, 30 * 60 * 1000);

// POST /api/backup/run-daily: Trigger daily backup (Excel + JSON saved to server disk)
app.post([
  '/api/backup/run-daily',
  '/api/backup/run-daily.php',
  '/api/backup/send-daily-email',
  '/api/backup/send-daily-email.php'
], async (req, res) => {
  try {
    const forceState = req.body?.data || req.body?.fullState || null;
    const result = await performDailyBackup(forceState);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || 'Failed to execute daily backup' });
  }
});

// GET /api/backup/daily-status: Fetch last daily backup status & metadata
app.get(['/api/backup/daily-status', '/api/backup/daily-status.php'], (req, res) => {
  try {
    const dailyFolder = path.join(BACKUPS_DIR, 'daily');
    const statusFilePath = path.join(dailyFolder, 'daily_backup_status.json');

    if (!fs.existsSync(statusFilePath)) {
      return res.json({
        success: true,
        status: null
      });
    }

    const raw = fs.readFileSync(statusFilePath, 'utf-8');
    const status = JSON.parse(raw);
    res.json({ success: true, status });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message });
  }
});

// GET /api/backup/download-daily/:type: Download latest daily generated Excel or JSON
app.get(['/api/backup/download-daily/:type', '/api/backup/download-daily.php'], (req, res) => {
  try {
    const type = req.params?.type || (req.query?.type as string) || 'excel';
    const dailyFolder = path.join(BACKUPS_DIR, 'daily');
    const dateStr = new Date().toISOString().slice(0, 10);

    if (type === 'excel' || type === 'xlsx') {
      const targetPath = path.join(dailyFolder, 'latest_daily_backup.xlsx');
      if (!fs.existsSync(targetPath)) {
        // Generate on the fly if not exists
        const buf = generateComprehensiveExcelBuffer(cachedState || {});
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="حزمة_مصنف_إكسل_الشامل_${dateStr}.xlsx"`);
        return res.send(buf);
      }
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="حزمة_مصنف_إكسل_الشامل_${dateStr}.xlsx"`);
      return res.sendFile(targetPath);
    } else {
      const targetPath = path.join(dailyFolder, 'latest_daily_backup.json');
      if (!fs.existsSync(targetPath)) {
        const jsonStr = JSON.stringify(cachedState || {}, null, 2);
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', `attachment; filename="نسخة_احتياطية_كاملة_${dateStr}.json"`);
        return res.send(jsonStr);
      }
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="نسخة_احتياطية_كاملة_${dateStr}.json"`);
      return res.sendFile(targetPath);
    }
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message });
  }
});

// POST /api/restore: Restore a server backup file to active state
app.post(['/api/restore', '/api/restore.php', '/api/restore-backup', '/api/restore-backup.php'], (req, res) => {
  try {
    const filename = req.body?.filename;
    if (!filename) {
      return res.status(400).json({ success: false, error: 'Missing filename' });
    }
    const backupPath = path.join(BACKUPS_DIR, filename);
    if (!fs.existsSync(backupPath)) {
      return res.status(404).json({ success: false, error: 'Backup file not found on server' });
    }

    const content = fs.readFileSync(backupPath, 'utf-8');
    const parsed = JSON.parse(content);
    const saveRes = saveStateToDisk(parsed, 'استرجاع نسخة احتياطية من السيرفر');

    if (saveRes.success) {
      res.json({ success: true, data: parsed, savedAt: saveRes.savedAt });
    } else {
      res.status(500).json({ success: false, error: saveRes.error });
    }
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message });
  }
});

// GET & POST for Archived Expenses
app.get('/api/archived-expenses', (req, res) => {
  try {
    if (fs.existsSync(ARCHIVE_FILE)) {
      const content = fs.readFileSync(ARCHIVE_FILE, 'utf-8');
      res.json({ success: true, data: JSON.parse(content) });
    } else {
      res.json({ success: true, data: [] });
    }
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message });
  }
});

app.post('/api/archived-expenses', (req, res) => {
  try {
    const data = req.body?.data || req.body;
    fs.writeFileSync(ARCHIVE_FILE, JSON.stringify(data, null, 2), 'utf-8');
    res.json({ success: true, savedAt: new Date().toISOString() });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message });
  }
});



app.get('/api/expenses', async (req, res) => {
  const rawExpenses = cachedState?.expenses || [];
  const expenses = rawExpenses.map((e: any) => ({
    ...e,
    invoicePhoto: e.invoicePhoto || e.invoice_url,
    invoice_url: e.invoice_url || e.invoicePhoto
  }));
  res.json({ success: true, expenses });
});

app.post('/api/expenses', async (req, res) => {
  try {
    const { id, title, amount, category, date, invoice_url, invoicePhoto, notes } = req.body || {};
    const finalInvoiceUrl = invoice_url || invoicePhoto;
    const expenseId = id || `exp_${Date.now()}`;

    if (cachedState && Array.isArray(cachedState.expenses)) {
      const newExp = { ...(req.body || {}), id: expenseId, invoice_url: finalInvoiceUrl, invoicePhoto: finalInvoiceUrl, updatedAt: new Date().toISOString() };
      const idx = cachedState.expenses.findIndex((e: any) => e.id === expenseId);
      if (idx >= 0) {
        cachedState.expenses[idx] = { ...cachedState.expenses[idx], ...newExp };
      } else {
        cachedState.expenses.unshift(newExp);
      }
      saveStateToDisk(cachedState);
    }

    res.status(201).json({ success: true, id: expenseId, message: 'Expense saved successfully' });
  } catch (err: any) {
    console.error('POST /api/expenses error:', err);
    res.status(500).json({ success: false, error: err?.message || 'Server error' });
  }
});

app.put('/api/expenses/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { invoice_url, invoicePhoto } = req.body || {};
    const finalInvoiceUrl = invoice_url || invoicePhoto;

    if (cachedState && Array.isArray(cachedState.expenses)) {
      const idx = cachedState.expenses.findIndex((e: any) => e.id === id);
      if (idx >= 0) {
        cachedState.expenses[idx] = { 
          ...cachedState.expenses[idx], 
          ...req.body, 
          invoicePhoto: finalInvoiceUrl || cachedState.expenses[idx].invoicePhoto,
          invoice_url: finalInvoiceUrl || cachedState.expenses[idx].invoice_url,
          updatedAt: new Date().toISOString() 
        };
        saveStateToDisk(cachedState);
      }
    }

    res.json({ success: true, message: `Expense ${id} updated successfully` });
  } catch (err: any) {
    console.error(`PUT /api/expenses/${req.params.id} error:`, err);
    res.status(500).json({ success: false, error: err?.message || 'Server error' });
  }
});

app.delete('/api/expenses/:id', async (req, res) => {
  try {
    const { id } = req.params;

    if (cachedState && Array.isArray(cachedState.expenses)) {
      cachedState.expenses = cachedState.expenses.filter((e: any) => e.id !== id);
      if (!cachedState.deletedExpenseIds) cachedState.deletedExpenseIds = {};
      cachedState.deletedExpenseIds[id] = true;
      saveStateToDisk(cachedState);
    }

    res.json({ success: true, message: `Expense ${id} deleted successfully` });
  } catch (err: any) {
    console.error(`DELETE /api/expenses/${req.params.id} error:`, err);
    res.status(500).json({ success: false, error: err?.message || 'Server error' });
  }
});

// ==========================================
// Central VPS File & Attachment Storage Endpoints
// ==========================================

// POST /api/upload: Upload files, invoices, and vouchers directly to server disk
app.post(['/api/upload', '/api/upload.php', '/api/upload-file', '/api/upload-file.php'], async (req, res) => {
  try {
    const { dataUrl, file, fileName, name } = req.body || {};
    const rawData = dataUrl || file;
    const requestedName = String(fileName || name || `attachment_${Date.now()}.jpg`).trim();

    if (!rawData || typeof rawData !== 'string') {
      return res.status(400).json({ success: false, error: 'بيانات الملف (dataUrl) مطلوبة للرفع' });
    }

    // Match MIME type and base64
    let mimeType = 'image/jpeg';
    let base64Data = rawData;
    const mimeMatch = rawData.match(/^data:([^;]+);base64,(.+)$/);
    if (mimeMatch) {
      mimeType = mimeMatch[1];
      base64Data = mimeMatch[2];
    }

    const buffer = Buffer.from(base64Data, 'base64');
    
    // Generate safe filename with timestamp
    const cleanBase = requestedName
      .replace(/[^a-zA-Z0-9_\u0600-\u06FF.-]/g, '_')
      .replace(/\s+/g, '_');
    const ext = path.extname(cleanBase) || (mimeType === 'application/pdf' ? '.pdf' : '.jpg');
    const nameWithoutExt = path.basename(cleanBase, ext);
    const safeFileName = `${nameWithoutExt}_${Date.now()}${ext}`;

    const filePath = path.join(UPLOADS_DIR, safeFileName);
    fs.writeFileSync(filePath, buffer);

    const publicUrl = `/uploads/${encodeURIComponent(safeFileName)}`;

    res.json({
      success: true,
      url: publicUrl,
      downloadUrl: publicUrl,
      fileName: safeFileName,
      originalName: requestedName,
      size: buffer.length,
      mimeType,
      message: 'تم حفظ الملف بنجاح على سيرفر البيانات المركزي'
    });
  } catch (err: any) {
    console.error('Error in /api/upload:', err);
    res.status(500).json({ success: false, error: err?.message || 'فشل حفظ الملف على السيرفر' });
  }
});

// GET /api/uploads-list: List all uploaded attachments on the server disk
app.get(['/api/uploads-list', '/api/uploads-list.php'], (req, res) => {
  try {
    if (!fs.existsSync(UPLOADS_DIR)) {
      return res.json({ success: true, files: [], count: 0, totalSizeKb: 0 });
    }

    const files = fs.readdirSync(UPLOADS_DIR).map(f => {
      const p = path.join(UPLOADS_DIR, f);
      const st = fs.statSync(p);
      return {
        name: f,
        url: `/uploads/${encodeURIComponent(f)}`,
        size: st.size,
        sizeKb: Math.round((st.size / 1024) * 10) / 10,
        createdAt: st.birthtime.toISOString(),
        modifiedAt: st.mtime.toISOString()
      };
    }).sort((a, b) => new Date(b.modifiedAt).getTime() - new Date(a.modifiedAt).getTime());

    const totalSizeKb = Math.round(files.reduce((acc, f) => acc + f.size, 0) / 1024);

    res.json({
      success: true,
      files,
      count: files.length,
      totalSizeKb
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || 'Error listing uploads' });
  }
});

// DELETE /api/upload/:fileName: Remove an uploaded file
app.delete('/api/upload/:fileName', (req, res) => {
  try {
    const { fileName } = req.params;
    const clean = path.basename(fileName);
    const p = path.join(UPLOADS_DIR, clean);
    if (fs.existsSync(p)) {
      fs.unlinkSync(p);
      return res.json({ success: true, message: `File ${clean} deleted` });
    }
    res.status(404).json({ success: false, error: 'الملف غير موجود' });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message });
  }
});

// Vite & Static Asset Handling
async function startServer() {
  const isProduction = process.env.NODE_ENV === 'production' || resolvedDirname.endsWith('dist') || !fs.existsSync(path.join(process.cwd(), 'server.ts'));
  
  if (!isProduction) {
    try {
      console.log('[Server] Starting Vite development server middleware...');
      const { createServer: createViteServer } = await import('vite');
      const vite = await createViteServer({
        server: { middlewareMode: true },
        appType: 'spa',
      });
      app.use(vite.middlewares);

      // Explicit SPA catch-all route handler to ensure index.html is always transformed and served
      app.use('*', async (req, res, next) => {
        if (req.originalUrl.startsWith('/api/') || req.originalUrl.startsWith('/uploads/')) {
          return next();
        }
        try {
          const indexPath = path.resolve(process.cwd(), 'index.html');
          if (fs.existsSync(indexPath)) {
            let template = fs.readFileSync(indexPath, 'utf-8');
            template = await vite.transformIndexHtml(req.originalUrl, template);
            res.status(200).set({ 'Content-Type': 'text/html' }).end(template);
            return;
          }
          next();
        } catch (e: any) {
          if (vite && typeof vite.ssrFixStacktrace === 'function') {
            vite.ssrFixStacktrace(e);
          }
          next(e);
        }
      });
    } catch (viteErr) {
      console.warn('[Server] Vite not loaded, falling back to static mode:', viteErr);
      const distPath = path.join(process.cwd(), 'dist');
      app.use(express.static(distPath));
      app.get('*', (req, res) => {
        res.sendFile(path.join(distPath, 'index.html'));
      });
    }
  } else {
    // Production serving from dist
    const distPath = fs.existsSync(path.join(process.cwd(), 'dist', 'index.html'))
      ? path.join(process.cwd(), 'dist')
      : (fs.existsSync(path.join(resolvedDirname, 'index.html')) ? resolvedDirname : process.cwd());

    console.log(`[Server] Production mode: Serving static assets from: ${distPath}`);
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[SkyArc Server] Running successfully on http://0.0.0.0:${PORT} (Process PID: ${process.pid})`);
  });
}

startServer();
