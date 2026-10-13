var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// server.ts
var import_express = __toESM(require("express"), 1);
var import_path = __toESM(require("path"), 1);
var import_fs = __toESM(require("fs"), 1);
var import_os = __toESM(require("os"), 1);
var import_dotenv = __toESM(require("dotenv"), 1);
var XLSX = __toESM(require("xlsx"), 1);
import_dotenv.default.config();
var app = (0, import_express.default)();
var PORT = Number(process.env.PORT) || 3e3;
app.use(import_express.default.json({ limit: "100mb" }));
app.use(import_express.default.text({ limit: "100mb", type: ["text/*", "application/json"] }));
app.use(import_express.default.urlencoded({ extended: true, limit: "100mb" }));
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept, Authorization");
  if (req.method === "OPTIONS") {
    return res.sendStatus(200);
  }
  next();
});
var DATA_DIR = import_path.default.join(process.cwd(), "data");
try {
  if (!import_fs.default.existsSync(DATA_DIR)) {
    import_fs.default.mkdirSync(DATA_DIR, { recursive: true });
  }
  const testPath = import_path.default.join(DATA_DIR, ".write_test");
  import_fs.default.writeFileSync(testPath, "ok", "utf-8");
  import_fs.default.unlinkSync(testPath);
} catch (permErr) {
  console.warn("[Server Storage] Local directory /data not writable, switching to OS temporary directory:", permErr);
  DATA_DIR = import_path.default.join(import_os.default.tmpdir(), "skyarc_data");
  if (!import_fs.default.existsSync(DATA_DIR)) {
    import_fs.default.mkdirSync(DATA_DIR, { recursive: true });
  }
}
var BACKUPS_DIR = import_path.default.join(DATA_DIR, "backups");
var UPLOADS_DIR = import_path.default.join(DATA_DIR, "uploads");
var STATE_FILE = import_path.default.join(DATA_DIR, "system_state.json");
var ARCHIVE_FILE = import_path.default.join(DATA_DIR, "archived_expenses.json");
var SESSIONS_FILE = import_path.default.join(DATA_DIR, "active_user_sessions.json");
try {
  if (!import_fs.default.existsSync(BACKUPS_DIR)) {
    import_fs.default.mkdirSync(BACKUPS_DIR, { recursive: true });
  }
  if (!import_fs.default.existsSync(UPLOADS_DIR)) {
    import_fs.default.mkdirSync(UPLOADS_DIR, { recursive: true });
  }
} catch (bErr) {
  console.warn("[Server Storage] Could not create storage subdirs:", bErr);
}
app.use("/uploads", import_express.default.static(UPLOADS_DIR));
app.use("/api/uploads", import_express.default.static(UPLOADS_DIR));
var cachedState = null;
var lastModifiedTime = "";
var serverVersion = 1;
var lastAutoBackupTime = 0;
var activeUserSessions = {};
function saveActiveSessionsToDisk() {
  try {
    import_fs.default.writeFileSync(SESSIONS_FILE, JSON.stringify(activeUserSessions, null, 2), "utf-8");
  } catch (err) {
    console.warn("[Server Storage] Error writing active_user_sessions.json:", err);
  }
}
function loadStateFromDisk() {
  try {
    if (import_fs.default.existsSync(STATE_FILE)) {
      const content = import_fs.default.readFileSync(STATE_FILE, "utf-8");
      if (content && content.trim()) {
        cachedState = JSON.parse(content);
        const stats = import_fs.default.statSync(STATE_FILE);
        lastModifiedTime = stats.mtime.toISOString();
        console.log(`[Server Storage] Loaded existing database from disk (${(content.length / 1024).toFixed(1)} KB, ${cachedState.expenses?.length || 0} expenses, path: ${STATE_FILE})`);
      }
    } else {
      console.log(`[Server Storage] No prior system_state.json found at ${STATE_FILE}. Ready to receive initial data.`);
    }
    if (import_fs.default.existsSync(SESSIONS_FILE)) {
      try {
        const sessContent = import_fs.default.readFileSync(SESSIONS_FILE, "utf-8");
        if (sessContent && sessContent.trim()) {
          activeUserSessions = JSON.parse(sessContent);
        }
      } catch (sessErr) {
        console.warn("[Server Storage] Could not read active_user_sessions.json:", sessErr);
      }
    }
  } catch (err) {
    console.error("[Server Storage] Error reading database from disk:", err);
  }
}
loadStateFromDisk();
function saveStateToDisk(data, updatedBy = "\u0645\u062F\u064A\u0631 \u0627\u0644\u0646\u0638\u0627\u0645") {
  try {
    if (!import_fs.default.existsSync(DATA_DIR)) {
      import_fs.default.mkdirSync(DATA_DIR, { recursive: true });
    }
    const nowIso = (/* @__PURE__ */ new Date()).toISOString();
    const existingData = cachedState || {};
    const existingDeletedExpenses = existingData.deletedExpenseIds && typeof existingData.deletedExpenseIds === "object" ? existingData.deletedExpenseIds : {};
    const incomingDeletedExpenses = data.deletedExpenseIds && typeof data.deletedExpenseIds === "object" ? data.deletedExpenseIds : {};
    const mergedDeletedExpenses = { ...existingDeletedExpenses, ...incomingDeletedExpenses };
    const existingDeletedCustodies = existingData.deletedCustodyIds && typeof existingData.deletedCustodyIds === "object" ? existingData.deletedCustodyIds : {};
    const incomingDeletedCustodies = data.deletedCustodyIds && typeof data.deletedCustodyIds === "object" ? data.deletedCustodyIds : {};
    const mergedDeletedCustodies = { ...existingDeletedCustodies, ...incomingDeletedCustodies };
    const existingDeletedProjects = existingData.deletedProjectIds && typeof existingData.deletedProjectIds === "object" ? existingData.deletedProjectIds : {};
    const incomingDeletedProjects = data.deletedProjectIds && typeof data.deletedProjectIds === "object" ? data.deletedProjectIds : {};
    const mergedDeletedProjects = { ...existingDeletedProjects, ...incomingDeletedProjects };
    const existingDeletedUsers = existingData.deletedUserIds && typeof existingData.deletedUserIds === "object" ? existingData.deletedUserIds : {};
    const incomingDeletedUsers = data.deletedUserIds && typeof data.deletedUserIds === "object" ? data.deletedUserIds : {};
    const mergedDeletedUsers = { ...existingDeletedUsers, ...incomingDeletedUsers };
    const existingDeletedRoles = existingData.deletedRoleIds && typeof existingData.deletedRoleIds === "object" ? existingData.deletedRoleIds : {};
    const incomingDeletedRoles = data.deletedRoleIds && typeof data.deletedRoleIds === "object" ? data.deletedRoleIds : {};
    const mergedDeletedRoles = { ...existingDeletedRoles, ...incomingDeletedRoles };
    const existingDeletedStages = existingData.deletedWorkflowStageIds && typeof existingData.deletedWorkflowStageIds === "object" ? existingData.deletedWorkflowStageIds : {};
    const incomingDeletedStages = data.deletedWorkflowStageIds && typeof data.deletedWorkflowStageIds === "object" ? data.deletedWorkflowStageIds : {};
    const mergedDeletedStages = { ...existingDeletedStages, ...incomingDeletedStages };
    const incomingExpenses = Array.isArray(data.expenses) ? data.expenses : [];
    const cleanExpenses = incomingExpenses.filter((exp) => exp && exp.id && !mergedDeletedExpenses[exp.id]);
    const incomingCustodies = Array.isArray(data.custodies) ? data.custodies : [];
    const cleanCustodies = incomingCustodies.filter((c) => c && c.id && !mergedDeletedCustodies[c.id]);
    const incomingProjects = Array.isArray(data.projects) ? data.projects : [];
    const cleanProjects = incomingProjects.filter((p) => p && p.id && !mergedDeletedProjects[p.id]);
    const incomingUsers = Array.isArray(data.users) ? data.users : [];
    const cleanUsers = incomingUsers.filter((u) => u && u.id && !mergedDeletedUsers[u.id]);
    const incomingRoles = Array.isArray(data.roles) ? data.roles : [];
    const cleanRoles = incomingRoles.filter((r) => r && r.id && !mergedDeletedRoles[r.id]);
    const incomingStages = Array.isArray(data.workflowStages) ? data.workflowStages : [];
    const cleanStages = incomingStages.filter((s) => s && s.id && !mergedDeletedStages[s.id]);
    const statePayload = {
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
      lastSyncedAt: nowIso,
      syncedBy: updatedBy,
      serverSavedAt: nowIso
    };
    cachedState = statePayload;
    lastModifiedTime = nowIso;
    serverVersion++;
    const jsonString = JSON.stringify(statePayload, null, 2);
    try {
      import_fs.default.writeFileSync(STATE_FILE, jsonString, "utf-8");
    } catch (writeErr) {
      console.warn("[Server Storage] Direct write failed, attempting temp file rename:", writeErr);
      const tempFile = `${STATE_FILE}.tmp.${Date.now()}`;
      import_fs.default.writeFileSync(tempFile, jsonString, "utf-8");
      import_fs.default.renameSync(tempFile, STATE_FILE);
    }
    const now = Date.now();
    if (now - lastAutoBackupTime > 4 * 60 * 60 * 1e3) {
      lastAutoBackupTime = now;
      try {
        if (!import_fs.default.existsSync(BACKUPS_DIR)) import_fs.default.mkdirSync(BACKUPS_DIR, { recursive: true });
        const backupFilename = `auto_backup_${(/* @__PURE__ */ new Date()).toISOString().slice(0, 10)}_${Date.now()}.json`;
        const backupPath = import_path.default.join(BACKUPS_DIR, backupFilename);
        import_fs.default.writeFileSync(backupPath, jsonString, "utf-8");
        console.log(`[Server Storage] Periodic backup saved: ${backupFilename}`);
      } catch (backupErr) {
        console.warn("[Server Storage] Auto-backup notice:", backupErr);
      }
    }
    return { success: true, savedAt: nowIso, version: serverVersion };
  } catch (err) {
    console.error("[Server Storage] Error saving database to disk:", err);
    if (cachedState) {
      return { success: true, savedAt: (/* @__PURE__ */ new Date()).toISOString(), version: serverVersion };
    }
    return { success: false, error: err?.message || "Server disk write failed" };
  }
}
app.get(["/api/health", "/api/health.php"], (req, res) => {
  res.json({
    status: "ok",
    timestamp: (/* @__PURE__ */ new Date()).toISOString(),
    serverStorage: true,
    hasPersistedData: cachedState !== null,
    storagePath: STATE_FILE
  });
});
app.get(["/download-dist", "/api/download-dist", "/dist.zip"], (req, res) => {
  const distZipPath = import_path.default.join(process.cwd(), "public", "dist.zip");
  if (import_fs.default.existsSync(distZipPath)) {
    res.download(distZipPath, "skyarc-hostinger-dist.zip");
  } else {
    const rootZip = import_path.default.join(process.cwd(), "dist.zip");
    if (import_fs.default.existsSync(rootZip)) {
      res.download(rootZip, "skyarc-hostinger-dist.zip");
    } else {
      res.status(404).json({ error: "dist.zip not found. Please build first." });
    }
  }
});
app.get(["/api/server-info", "/api/server-info.php"], (req, res) => {
  try {
    const exists = import_fs.default.existsSync(STATE_FILE);
    let fileSizeKb = 0;
    if (exists) {
      fileSizeKb = Math.round(import_fs.default.statSync(STATE_FILE).size / 1024 * 10) / 10;
    }
    res.json({
      status: "ok",
      mode: "server_disk_persistence",
      exists,
      fileSizeKb,
      lastModified: lastModifiedTime || null,
      version: serverVersion,
      expensesCount: Array.isArray(cachedState?.expenses) ? cachedState.expenses.length : 0,
      projectsCount: Array.isArray(cachedState?.projects) ? cachedState.projects.length : 0,
      custodiesCount: Array.isArray(cachedState?.custodies) ? cachedState.custodies.length : 0,
      usersCount: Array.isArray(cachedState?.users) ? cachedState.users.length : 0
    });
  } catch (err) {
    res.status(500).json({ status: "error", error: err?.message });
  }
});
app.get(["/api/state/timestamp", "/api/state/timestamp.php"], (req, res) => {
  const userId = req.query.userId || req.headers["x-user-id"];
  const sessionId = req.query.sessionId || req.headers["x-session-id"];
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
    timestamp: (/* @__PURE__ */ new Date()).toISOString(),
    sessionEvicted,
    activeSession
  });
});
app.post(["/api/session/register", "/api/session/register.php", "/api/session", "/api/session.php"], (req, res) => {
  try {
    const { userId, sessionId, activeSessionId, userName, device, loginTime } = req.body || {};
    const effectiveSessionId = sessionId || activeSessionId;
    if (!userId || !effectiveSessionId) {
      return res.status(400).json({ success: false, error: "Missing userId or sessionId" });
    }
    const nowIso = (/* @__PURE__ */ new Date()).toISOString();
    activeUserSessions[userId] = {
      userId,
      activeSessionId: effectiveSessionId,
      userName: userName || "\u0645\u0633\u062A\u062E\u062F\u0645 \u0627\u0644\u0646\u0638\u0627\u0645",
      device: device || "\u0645\u062A\u0635\u0641\u062D \u0648\u064A\u0628",
      loginTime: loginTime || nowIso,
      lastSeenAt: nowIso
    };
    saveActiveSessionsToDisk();
    if (cachedState && Array.isArray(cachedState.users)) {
      cachedState.users = cachedState.users.map((u) => {
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
      saveStateToDisk(cachedState, `\u062A\u0633\u062C\u064A\u0644 \u062F\u062E\u0648\u0644 (${userName || userId}) - \u062C\u0644\u0633\u0629 \u0646\u0634\u0637\u0629`);
    }
    res.json({
      success: true,
      activeSession: activeUserSessions[userId]
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err?.message });
  }
});
app.get(["/api/session/active", "/api/session/active.php", "/api/session/active/:userId"], (req, res) => {
  try {
    const userId = req.params.userId || req.query.userId || req.headers["x-user-id"];
    const sessionId = req.query.sessionId || req.headers["x-session-id"];
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
  } catch (err) {
    res.status(500).json({ success: false, error: err?.message });
  }
});
app.get(["/api/state", "/api/state.php"], (req, res) => {
  try {
    const userId = req.query.userId || req.headers["x-user-id"];
    const sessionId = req.query.sessionId || req.headers["x-session-id"];
    if (userId && sessionId && activeUserSessions[userId]) {
      const active = activeUserSessions[userId];
      if (active.activeSessionId && active.activeSessionId !== sessionId) {
        return res.json({
          success: false,
          sessionEvicted: true,
          error: "SESSION_EVICTED",
          message: "\u062A\u0645 \u0625\u0646\u0647\u0627\u0621 \u0627\u0644\u062C\u0644\u0633\u0629 \u0644\u062A\u0633\u062C\u064A\u0644 \u0627\u0644\u062F\u062E\u0648\u0644 \u0645\u0646 \u062C\u0647\u0627\u0632 \u0622\u062E\u0631",
          activeSession: active,
          data: null
        });
      }
    }
    if (!cachedState && import_fs.default.existsSync(STATE_FILE)) {
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
        message: "No data stored on server yet."
      });
    }
  } catch (err) {
    console.error("[Server Storage] Error serving /api/state:", err);
    res.status(500).json({ success: false, error: err?.message || "Server read error" });
  }
});
app.post(["/api/state", "/api/state.php"], (req, res) => {
  try {
    let payload = req.body;
    if (typeof payload === "string") {
      try {
        payload = JSON.parse(payload);
      } catch (err) {
        console.error("[Server Storage] JSON parse failed on string body:", err);
      }
    }
    const dataToSave = payload?.data || payload;
    const updatedBy = payload?.updatedBy || "\u0645\u0633\u062A\u062E\u062F\u0645 \u0627\u0644\u0646\u0638\u0627\u0645";
    const userId = payload?.userId || req.headers["x-user-id"] || req.query.userId;
    const sessionId = payload?.sessionId || req.headers["x-session-id"] || req.query.sessionId;
    if (userId && sessionId && activeUserSessions[userId]) {
      const active = activeUserSessions[userId];
      if (active.activeSessionId && active.activeSessionId !== sessionId) {
        return res.status(403).json({
          success: false,
          sessionEvicted: true,
          error: "SESSION_EVICTED",
          message: "\u062A\u0645 \u0625\u0646\u0647\u0627\u0621 \u0627\u0644\u062C\u0644\u0633\u0629 \u0644\u062A\u0633\u062C\u064A\u0644 \u0627\u0644\u062F\u062E\u0648\u0644 \u0645\u0646 \u062C\u0647\u0627\u0632 \u0622\u062E\u0631. \u062A\u0645 \u062D\u062C\u0628 \u0627\u0633\u062A\u0642\u0628\u0627\u0644 \u0627\u0644\u0628\u064A\u0627\u0646\u0627\u062A \u0645\u0646 \u0647\u0630\u0627 \u0627\u0644\u0645\u062A\u0635\u0641\u062D.",
          activeSession: active
        });
      }
    }
    if (!dataToSave || typeof dataToSave !== "object") {
      return res.status(400).json({ success: false, error: "Invalid state payload" });
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
        expenses: Array.isArray(dataToSave.expenses) ? dataToSave.expenses.length : 0,
        projects: Array.isArray(dataToSave.projects) ? dataToSave.projects.length : 0,
        custodies: Array.isArray(dataToSave.custodies) ? dataToSave.custodies.length : 0,
        users: Array.isArray(dataToSave.users) ? dataToSave.users.length : 0
      }
    });
  } catch (err) {
    console.error("[Server Storage] Error handling POST /api/state:", err);
    res.status(500).json({ success: false, error: err?.message || "Server write error" });
  }
});
app.post(["/api/sync/delta", "/api/sync/delta.php"], (req, res) => {
  try {
    const { deltas, lastSyncedAt, updatedBy } = req.body || {};
    if (!cachedState && import_fs.default.existsSync(STATE_FILE)) {
      loadStateFromDisk();
    }
    if (!cachedState) {
      cachedState = { expenses: [], projects: [], custodies: [], users: [], settings: {}, deletedExpenseIds: {} };
    }
    const currentState = cachedState;
    const nowIso = (/* @__PURE__ */ new Date()).toISOString();
    if (deltas?.deletedExpenseIds) {
      currentState.deletedExpenseIds = { ...currentState.deletedExpenseIds || {}, ...deltas.deletedExpenseIds };
    }
    if (deltas?.deletedCustodyIds) {
      currentState.deletedCustodyIds = { ...currentState.deletedCustodyIds || {}, ...deltas.deletedCustodyIds };
    }
    if (deltas?.deletedProjectIds) {
      currentState.deletedProjectIds = { ...currentState.deletedProjectIds || {}, ...deltas.deletedProjectIds };
    }
    if (deltas?.deletedUserIds) {
      currentState.deletedUserIds = { ...currentState.deletedUserIds || {}, ...deltas.deletedUserIds };
    }
    if (deltas?.deletedRoleIds) {
      currentState.deletedRoleIds = { ...currentState.deletedRoleIds || {}, ...deltas.deletedRoleIds };
    }
    if (deltas?.deletedWorkflowStageIds) {
      currentState.deletedWorkflowStageIds = { ...currentState.deletedWorkflowStageIds || {}, ...deltas.deletedWorkflowStageIds };
    }
    if (Array.isArray(deltas?.expenses)) {
      const expMap = new Map((currentState.expenses || []).map((e) => [e.id, e]));
      for (const exp of deltas.expenses) {
        if (exp && exp.id) {
          expMap.set(exp.id, { ...expMap.get(exp.id) || {}, ...exp, updatedAt: exp.updatedAt || nowIso });
        }
      }
      currentState.expenses = Array.from(expMap.values()).filter((e) => !currentState.deletedExpenseIds?.[e.id]);
    }
    if (Array.isArray(deltas?.projects)) {
      const projMap = new Map((currentState.projects || []).map((p) => [p.id, p]));
      for (const p of deltas.projects) {
        if (p && p.id) {
          projMap.set(p.id, { ...projMap.get(p.id) || {}, ...p });
        }
      }
      currentState.projects = Array.from(projMap.values()).filter((p) => !currentState.deletedProjectIds?.[p.id]);
    }
    if (Array.isArray(deltas?.custodies)) {
      const cMap = new Map((currentState.custodies || []).map((c) => [c.id, c]));
      for (const c of deltas.custodies) {
        if (c && c.id) {
          cMap.set(c.id, { ...cMap.get(c.id) || {}, ...c });
        }
      }
      currentState.custodies = Array.from(cMap.values()).filter((c) => !currentState.deletedCustodyIds?.[c.id]);
    }
    if (deltas?.settings) {
      currentState.settings = { ...currentState.settings || {}, ...deltas.settings };
    }
    if (Array.isArray(deltas?.users)) {
      const uMap = new Map((currentState.users || []).map((u) => [u.id, u]));
      for (const u of deltas.users) {
        if (u && u.id) uMap.set(u.id, { ...uMap.get(u.id) || {}, ...u });
      }
      currentState.users = Array.from(uMap.values()).filter((u) => !currentState.deletedUserIds?.[u.id]);
    }
    const saveResult = saveStateToDisk(currentState, updatedBy || "\u0645\u0633\u062A\u062E\u062F\u0645 \u0627\u0644\u0646\u0638\u0627\u0645 (\u0645\u0632\u0627\u0645\u0646\u0629 \u0627\u0646\u062A\u0642\u0627\u0626\u064A\u0629)");
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
  } catch (err) {
    console.error("[Server Storage] Error handling POST /api/sync/delta:", err);
    res.status(500).json({ success: false, error: err?.message || "Delta sync error" });
  }
});
app.post(["/api/backup", "/api/backup.php"], (req, res) => {
  try {
    const customData = req.body?.data || cachedState;
    const label = req.body?.label || "manual";
    if (!customData) {
      return res.status(400).json({ success: false, error: "No data available to backup" });
    }
    if (!import_fs.default.existsSync(BACKUPS_DIR)) {
      import_fs.default.mkdirSync(BACKUPS_DIR, { recursive: true });
    }
    const dateStr = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
    const filename = `backup_${label}_${dateStr}_${Date.now()}.json`;
    const targetPath = import_path.default.join(BACKUPS_DIR, filename);
    import_fs.default.writeFileSync(targetPath, JSON.stringify(customData, null, 2), "utf-8");
    res.json({ success: true, filename, savedAt: (/* @__PURE__ */ new Date()).toISOString() });
  } catch (err) {
    res.status(500).json({ success: false, error: err?.message });
  }
});
app.get(["/api/backups", "/api/backups.php"], (req, res) => {
  try {
    if (!import_fs.default.existsSync(BACKUPS_DIR)) {
      return res.json({ success: true, backups: [] });
    }
    const files = import_fs.default.readdirSync(BACKUPS_DIR);
    const backups = files.filter((f) => f.endsWith(".json")).map((f) => {
      const stats = import_fs.default.statSync(import_path.default.join(BACKUPS_DIR, f));
      return {
        filename: f,
        sizeKb: Math.round(stats.size / 1024 * 10) / 10,
        createdAt: stats.birthtime.toISOString(),
        modifiedAt: stats.mtime.toISOString()
      };
    }).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    res.json({ success: true, backups });
  } catch (err) {
    res.status(500).json({ success: false, error: err?.message });
  }
});
function generateComprehensiveExcelBuffer(state) {
  const wb = XLSX.utils.book_new();
  const currencySymbol = state?.settings?.currencySymbol || "\u0631.\u0633";
  const rawExpenses = Array.isArray(state?.expenses) ? state.expenses : [];
  const expensesData = rawExpenses.map((e) => ({
    "\u0631\u0642\u0645 \u0627\u0644\u0633\u0646\u062F": e.id || "-",
    "\u0627\u0644\u062A\u0627\u0631\u064A\u062E": e.date || "-",
    "\u0648\u0642\u062A \u0627\u0644\u0628\u0635\u0645\u0629": e.fingerprintTime ? new Date(e.fingerprintTime).toLocaleString("ar-SA") : "-",
    "\u0627\u0644\u0645\u0634\u0631\u0648\u0639": e.projectName || "-",
    "\u0627\u0644\u0645\u0634\u0631\u0641": e.supervisorName || "-",
    "\u0628\u0631\u064A\u062F \u0627\u0644\u0645\u0634\u0631\u0641": e.supervisorEmail || "-",
    "\u0627\u0644\u0628\u0646\u062F": e.category || "-",
    "\u0627\u0644\u0628\u064A\u0627\u0646 \u0648\u0627\u0644\u062A\u0641\u0627\u0635\u064A\u0644": e.details || "-",
    [`\u0627\u0644\u0645\u0628\u0644\u063A (${currencySymbol})`]: Number(e.amount) || 0,
    [`\u0627\u0644\u0636\u0631\u064A\u0628\u0629 (${currencySymbol})`]: Number(e.taxAmount) || 0,
    "\u0631\u0642\u0645 \u0627\u0644\u0641\u0627\u062A\u0648\u0631\u0629": e.invoiceNumber || "-",
    "\u062D\u0627\u0644\u0629 \u0627\u0644\u0627\u0639\u062A\u0645\u0627\u062F": e.status || "-",
    "\u0627\u0639\u062A\u0645\u0627\u062F \u0627\u0644\u0645\u0634\u0631\u0641": e.projectManagerApproval || e.supervisorApproval || "-",
    "\u0627\u0639\u062A\u0645\u0627\u062F \u0627\u0644\u0645\u062D\u0627\u0633\u0628": e.accountantApproval || "-",
    "\u062A\u0631\u062D\u064A\u0644 ERP": e.erpPostingStatus || "-",
    "\u0628\u0631\u0646\u0627\u0645\u062C ERP": e.erpSystemName || "-",
    "\u0631\u0642\u0645 \u0627\u0644\u0642\u064A\u062F \u0627\u0644\u062E\u0627\u0631\u062C\u064A": e.erpReferenceNumber || "-",
    "\u0627\u0639\u062A\u0645\u0627\u062F \u0627\u0644\u0625\u062F\u0627\u0631\u0629": e.managementApproval || "-",
    "\u0645\u0644\u0627\u062D\u0638\u0627\u062A \u0627\u0644\u0625\u062F\u0627\u0631\u0629": e.managementNotes || "-",
    "\u0625\u062D\u062F\u0627\u062B\u064A\u0627\u062A GPS": e.gpsLocation ? `${e.gpsLocation.lat}, ${e.gpsLocation.lng}` : "-"
  }));
  const wsExpenses = XLSX.utils.json_to_sheet(expensesData.length > 0 ? expensesData : [{ "\u062A\u0646\u0628\u064A\u0647": "\u0644\u0627 \u062A\u0648\u062C\u062F \u0645\u0635\u0631\u0648\u0641\u0627\u062A \u0645\u0633\u062C\u0644\u0629 \u062D\u062A\u0649 \u0627\u0644\u0622\u0646" }]);
  XLSX.utils.book_append_sheet(wb, wsExpenses, "\u0627\u0644\u0645\u0635\u0631\u0648\u0641\u0627\u062A");
  const rawCustodies = Array.isArray(state?.custodies) ? state.custodies : [];
  const custodiesData = rawCustodies.map((c) => ({
    "\u0631\u0642\u0645 \u0625\u064A\u0635\u0627\u0644 \u0627\u0644\u0639\u0647\u062F\u0629": c.id || "-",
    "\u0627\u0644\u062A\u0627\u0631\u064A\u062E": c.date || "-",
    "\u0627\u0644\u0645\u0634\u0631\u0641 \u0627\u0644\u0645\u0633\u062A\u0644\u0645": c.supervisorName || "-",
    "\u0627\u0644\u0628\u0631\u064A\u062F \u0627\u0644\u0625\u0644\u0643\u062A\u0631\u0648\u0646\u064A": c.supervisorEmail || "-",
    [`\u0627\u0644\u0645\u0628\u0644\u063A \u0627\u0644\u0645\u0633\u0644\u0645 (${currencySymbol})`]: Number(c.amount) || 0,
    "\u0637\u0631\u064A\u0642\u0629 \u0627\u0644\u062F\u0641\u0639": c.paymentMethod || "-",
    "\u0631\u0642\u0645 \u0627\u0644\u0633\u0646\u062F / \u0627\u0644\u062D\u0648\u0627\u0644\u0629": c.receiptNumber || "-",
    "\u0645\u0644\u0627\u062D\u0638\u0627\u062A": c.notes || "-",
    "\u0627\u0644\u0645\u0633\u0644\u0645 \u0628\u0648\u0627\u0633\u0637\u0629": c.issuedBy || "\u0627\u0644\u0625\u062F\u0627\u0631\u0629"
  }));
  const wsCustodies = XLSX.utils.json_to_sheet(custodiesData.length > 0 ? custodiesData : [{ "\u062A\u0646\u0628\u064A\u0647": "\u0644\u0627 \u062A\u0648\u062C\u062F \u0639\u0647\u062F \u0645\u0633\u062C\u0644\u0629" }]);
  XLSX.utils.book_append_sheet(wb, wsCustodies, "\u0627\u0644\u0639\u0647\u062F \u0627\u0644\u0645\u0633\u0644\u0645\u0629");
  const rawUsers = Array.isArray(state?.users) ? state.users : [];
  const supervisors = rawUsers.filter((u) => u.role === "\u0645\u0634\u0631\u0641" || u.roleId === "role_supervisor" || u.role === "\u0645\u062F\u064A\u0631 \u0645\u0634\u0631\u0648\u0639");
  const supData = supervisors.map((s) => {
    const sCustody = rawCustodies.filter((c) => c.supervisorEmail === s.email).reduce((sum, c) => sum + (Number(c.amount) || 0), 0);
    const sApproved = rawExpenses.filter((e) => e.supervisorEmail === s.email && e.status === "\u0645\u0639\u062A\u0645\u062F").reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
    const sPending = rawExpenses.filter((e) => e.supervisorEmail === s.email && e.status !== "\u0645\u0639\u062A\u0645\u062F" && e.status !== "\u0645\u0631\u0641\u0648\u0636").reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
    return {
      "\u0627\u0633\u0645 \u0627\u0644\u0645\u0634\u0631\u0641": s.name,
      "\u0627\u0644\u0628\u0631\u064A\u062F \u0627\u0644\u0625\u0644\u0643\u062A\u0631\u0648\u0646\u064A": s.email,
      "\u0631\u0642\u0645 \u0627\u0644\u062C\u0648\u0627\u0644": s.phone || "-",
      [`\u0625\u062C\u0645\u0627\u0644\u064A \u0627\u0644\u0639\u0647\u062F \u0627\u0644\u0645\u0633\u0644\u0645\u0629 (${currencySymbol})`]: sCustody,
      [`\u0627\u0644\u0645\u0635\u0631\u0648\u0641\u0627\u062A \u0627\u0644\u0645\u0639\u062A\u0645\u062F\u0629 (${currencySymbol})`]: sApproved,
      [`\u0627\u0644\u0645\u0635\u0631\u0648\u0641\u0627\u062A \u0642\u064A\u062F \u0627\u0644\u0645\u0631\u0627\u062C\u0639\u0629 (${currencySymbol})`]: sPending,
      [`\u0627\u0644\u0631\u0635\u064A\u062F \u0627\u0644\u0641\u0639\u0644\u064A \u0627\u0644\u0645\u062A\u0628\u0642\u064A (${currencySymbol})`]: sCustody - (sApproved + sPending)
    };
  });
  const wsSup = XLSX.utils.json_to_sheet(supData.length > 0 ? supData : [{ "\u062A\u0646\u0628\u064A\u0647": "\u0644\u0627 \u064A\u0648\u062C\u062F \u0645\u0634\u0631\u0641\u064A\u0646 \u0645\u0633\u062C\u0644\u064A\u0646" }]);
  XLSX.utils.book_append_sheet(wb, wsSup, "\u0623\u0631\u0635\u062F\u0629 \u0627\u0644\u0645\u0634\u0631\u0641\u064A\u0646 \u0648\u0627\u0644\u0639\u0647\u062F");
  const rawProjects = Array.isArray(state?.projects) ? state.projects : [];
  const projectsData = rawProjects.map((p) => {
    const prjExpenses = rawExpenses.filter((e) => e.projectId === p.id && e.status === "\u0645\u0639\u062A\u0645\u062F");
    const spent = prjExpenses.reduce((acc, curr) => acc + (Number(curr.amount) || 0), 0);
    return {
      "\u0643\u0648\u062F \u0627\u0644\u0645\u0634\u0631\u0648\u0639": p.code || "-",
      "\u0627\u0633\u0645 \u0627\u0644\u0645\u0634\u0631\u0648\u0639": p.name || "-",
      "\u0627\u0644\u062D\u0627\u0644\u0629": p.status || "-",
      "\u0627\u0644\u0639\u0645\u064A\u0644 / \u0627\u0644\u0645\u0627\u0644\u0643": p.clientName || "-",
      "\u0627\u0644\u0645\u0648\u0642\u0639": p.location || "-",
      [`\u0627\u0644\u0645\u064A\u0632\u0627\u0646\u064A\u0629 \u0627\u0644\u0645\u0631\u0635\u0648\u062F\u0629 (${currencySymbol})`]: Number(p.budget) || 0,
      [`\u0625\u062C\u0645\u0627\u0644\u064A \u0627\u0644\u0645\u0646\u0635\u0631\u0641 \u0627\u0644\u0645\u0639\u062A\u0645\u062F (${currencySymbol})`]: spent,
      [`\u0627\u0644\u0645\u062A\u0628\u0642\u064A \u0645\u0646 \u0627\u0644\u0645\u064A\u0632\u0627\u0646\u064A\u0629 (${currencySymbol})`]: (Number(p.budget) || 0) - spent,
      "\u0646\u0633\u0628\u0629 \u0627\u0644\u0627\u0633\u062A\u0647\u0644\u0627\u0643": `${Math.round(spent / (Number(p.budget) || 1) * 100)}%`,
      "\u0627\u0644\u0645\u0634\u0631\u0641\u064A\u0646": p.emails || "-"
    };
  });
  const wsProjects = XLSX.utils.json_to_sheet(projectsData.length > 0 ? projectsData : [{ "\u062A\u0646\u0628\u064A\u0647": "\u0644\u0627 \u062A\u0648\u062C\u062F \u0645\u0634\u0627\u0631\u064A\u0639 \u0645\u0633\u062C\u0644\u0629" }]);
  XLSX.utils.book_append_sheet(wb, wsProjects, "\u0627\u0644\u0645\u0634\u0627\u0631\u064A\u0639");
  const usersData = rawUsers.map((u) => ({
    "\u0627\u0633\u0645 \u0627\u0644\u062F\u062E\u0648\u0644": u.username || "-",
    "\u0627\u0644\u0627\u0633\u0645 \u0627\u0644\u0643\u0627\u0645\u0644": u.name,
    "\u0627\u0644\u062F\u0648\u0631 \u0627\u0644\u0648\u0638\u064A\u0641\u064A": u.role,
    "\u0627\u0644\u0628\u0631\u064A\u062F \u0627\u0644\u0625\u0644\u0643\u062A\u0631\u0648\u0646\u064A": u.email,
    "\u0631\u0642\u0645 \u0627\u0644\u062C\u0648\u0627\u0644": u.phone || "-",
    "\u0627\u0644\u062D\u0627\u0644\u0629": u.isActive ? "\u0646\u0634\u0637" : "\u0645\u0639\u0637\u0644"
  }));
  const wsUsers = XLSX.utils.json_to_sheet(usersData.length > 0 ? usersData : [{ "\u062A\u0646\u0628\u064A\u0647": "\u0644\u0627 \u064A\u0648\u062C\u062F \u0645\u0633\u062A\u062E\u062F\u0645\u064A\u0646" }]);
  XLSX.utils.book_append_sheet(wb, wsUsers, "\u0627\u0644\u0645\u0633\u062A\u062E\u062F\u0645\u064A\u0646");
  const rawRoles = Array.isArray(state?.roles) ? state.roles : [];
  const rolesData = rawRoles.map((r) => ({
    "\u0645\u0639\u0631\u0641 \u0627\u0644\u062F\u0648\u0631": r.id,
    "\u0627\u0633\u0645 \u0627\u0644\u062F\u0648\u0631": r.name,
    "\u0627\u0644\u0646\u0648\u0639": r.isSystem ? "\u062F\u0648\u0631 \u0646\u0638\u0627\u0645\u064A" : "\u0645\u062E\u0635\u0635",
    "\u0627\u0644\u0648\u0635\u0641": r.description || "-",
    "\u0645\u0647\u0644\u0629 \u0627\u0644\u062A\u0639\u062F\u064A\u0644 (\u062F\u0642\u0627\u0626\u0642)": r.gracePeriodMinutes ?? "-"
  }));
  const wsRoles = XLSX.utils.json_to_sheet(rolesData.length > 0 ? rolesData : [{ "\u062A\u0646\u0628\u064A\u0647": "\u0644\u0627 \u062A\u0648\u062C\u062F \u0623\u062F\u0648\u0627\u0631 \u0625\u0636\u0627\u0641\u064A\u0629" }]);
  XLSX.utils.book_append_sheet(wb, wsRoles, "\u0627\u0644\u0623\u062F\u0648\u0627\u0631 \u0648\u0627\u0644\u0635\u0644\u0627\u062D\u064A\u0627\u062A");
  const totalExpensesAmount = rawExpenses.reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
  const totalCustodiesAmount = rawCustodies.reduce((sum, c) => sum + (Number(c.amount) || 0), 0);
  const infoData = [
    { "\u0627\u0644\u0628\u064A\u0627\u0646": "\u0646\u0648\u0639 \u0627\u0644\u0645\u0644\u0641", "\u0627\u0644\u0642\u064A\u0645\u0629": "\u062D\u0632\u0645\u0629 \u0645\u0635\u0646\u0641 \u0625\u0643\u0633\u0644 \u0627\u0644\u0634\u0627\u0645\u0644 (.xlsx) - \u0627\u0644\u0646\u0633\u062E\u0629 \u0627\u0644\u0627\u062D\u062A\u064A\u0627\u0637\u064A\u0629 \u0627\u0644\u064A\u0648\u0645\u064A\u0629 \u0644\u0644\u0645\u062F\u064A\u0631" },
    { "\u0627\u0644\u0628\u064A\u0627\u0646": "\u062A\u0627\u0631\u064A\u062E \u0648\u0648\u0642\u062A \u0627\u0644\u062A\u0635\u062F\u064A\u0631", "\u0627\u0644\u0642\u064A\u0645\u0629": (/* @__PURE__ */ new Date()).toLocaleString("ar-SA") },
    { "\u0627\u0644\u0628\u064A\u0627\u0646": "\u0625\u062C\u0645\u0627\u0644\u064A \u0639\u062F\u062F \u0627\u0644\u0645\u0635\u0631\u0648\u0641\u0627\u062A \u0627\u0644\u0645\u0633\u062C\u0644\u0629", "\u0627\u0644\u0642\u064A\u0645\u0629": rawExpenses.length },
    { "\u0627\u0644\u0628\u064A\u0627\u0646": `\u0625\u062C\u0645\u0627\u0644\u064A \u0642\u064A\u0645\u0629 \u0627\u0644\u0645\u0635\u0631\u0648\u0641\u0627\u062A (${currencySymbol})`, "\u0627\u0644\u0642\u064A\u0645\u0629": totalExpensesAmount },
    { "\u0627\u0644\u0628\u064A\u0627\u0646": "\u0625\u062C\u0645\u0627\u0644\u064A \u0639\u062F\u062F \u062F\u0641\u0639\u0627\u062A \u0627\u0644\u0639\u0647\u062F", "\u0627\u0644\u0642\u064A\u0645\u0629": rawCustodies.length },
    { "\u0627\u0644\u0628\u064A\u0627\u0646": `\u0625\u062C\u0645\u0627\u0644\u064A \u0642\u064A\u0645\u0629 \u0627\u0644\u0639\u0647\u062F \u0627\u0644\u0645\u0633\u0644\u0645\u0629 (${currencySymbol})`, "\u0627\u0644\u0642\u064A\u0645\u0629": totalCustodiesAmount },
    { "\u0627\u0644\u0628\u064A\u0627\u0646": "\u0625\u062C\u0645\u0627\u0644\u064A \u0639\u062F\u062F \u0627\u0644\u0645\u0634\u0627\u0631\u064A\u0639", "\u0627\u0644\u0642\u064A\u0645\u0629": rawProjects.length },
    { "\u0627\u0644\u0628\u064A\u0627\u0646": "\u0625\u062C\u0645\u0627\u0644\u064A \u0639\u062F\u062F \u0627\u0644\u0645\u0633\u062A\u062E\u062F\u0645\u064A\u0646", "\u0627\u0644\u0642\u064A\u0645\u0629": rawUsers.length },
    { "\u0627\u0644\u0628\u064A\u0627\u0646": "\u0627\u0644\u0628\u0631\u064A\u062F \u0627\u0644\u0625\u0644\u0643\u062A\u0631\u0648\u0646\u064A \u0627\u0644\u0645\u0639\u062A\u0645\u062F \u0644\u0644\u0645\u062F\u064A\u0631", "\u0627\u0644\u0642\u064A\u0645\u0629": state?.settings?.managerBackupEmail || process.env.MANAGER_BACKUP_EMAIL || "2030m.mansour@gmail.com" },
    { "\u0627\u0644\u0628\u064A\u0627\u0646": "\u0627\u0644\u0646\u0638\u0627\u0645", "\u0627\u0644\u0642\u064A\u0645\u0629": "SkyArc Financial Control & Custody Management System v10.0" }
  ];
  const wsInfo = XLSX.utils.json_to_sheet(infoData);
  XLSX.utils.book_append_sheet(wb, wsInfo, "\u0645\u0639\u0644\u0648\u0645\u0627\u062A \u0627\u0644\u0646\u0633\u062E\u0629");
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  return buf;
}
async function performDailyBackup(forceState) {
  try {
    const state = forceState || cachedState || {};
    const dateStr = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
    if (!import_fs.default.existsSync(BACKUPS_DIR)) {
      import_fs.default.mkdirSync(BACKUPS_DIR, { recursive: true });
    }
    const dailyFolder = import_path.default.join(BACKUPS_DIR, "daily");
    if (!import_fs.default.existsSync(dailyFolder)) {
      import_fs.default.mkdirSync(dailyFolder, { recursive: true });
    }
    const jsonString = JSON.stringify(state, null, 2);
    const jsonFileName = `\u0646\u0633\u062E\u0629_\u0627\u062D\u062A\u064A\u0627\u0637\u064A\u0629_\u0643\u0627\u0645\u0644\u0629_${dateStr}.json`;
    const jsonFilePath = import_path.default.join(dailyFolder, jsonFileName);
    import_fs.default.writeFileSync(jsonFilePath, jsonString, "utf-8");
    const latestJsonPath = import_path.default.join(dailyFolder, "latest_daily_backup.json");
    import_fs.default.writeFileSync(latestJsonPath, jsonString, "utf-8");
    const excelBuffer = generateComprehensiveExcelBuffer(state);
    const excelFileName = `\u062D\u0632\u0645\u0629_\u0645\u0635\u0646\u0641_\u0625\u0643\u0633\u0644_\u0627\u0644\u0634\u0627\u0645\u0644_${dateStr}.xlsx`;
    const excelFilePath = import_path.default.join(dailyFolder, excelFileName);
    import_fs.default.writeFileSync(excelFilePath, excelBuffer);
    const latestExcelPath = import_path.default.join(dailyFolder, "latest_daily_backup.xlsx");
    import_fs.default.writeFileSync(latestExcelPath, excelBuffer);
    const excelSizeKb = Math.round(excelBuffer.length / 1024 * 10) / 10;
    const jsonSizeKb = Math.round(Buffer.byteLength(jsonString) / 1024 * 10) / 10;
    const expensesCount = Array.isArray(state.expenses) ? state.expenses.length : 0;
    const projectsCount = Array.isArray(state.projects) ? state.projects.length : 0;
    const custodiesCount = Array.isArray(state.custodies) ? state.custodies.length : 0;
    const statusPayload = {
      lastSentDate: dateStr,
      lastSentAt: (/* @__PURE__ */ new Date()).toISOString(),
      lastBackupDate: dateStr,
      lastBackupAt: (/* @__PURE__ */ new Date()).toISOString(),
      excelFileName,
      jsonFileName,
      excelSizeKb,
      jsonSizeKb,
      expensesCount,
      projectsCount,
      custodiesCount
    };
    const statusFilePath = import_path.default.join(dailyFolder, "daily_backup_status.json");
    import_fs.default.writeFileSync(statusFilePath, JSON.stringify(statusPayload, null, 2), "utf-8");
    const responseMessage = `\u062A\u0645 \u0625\u0646\u0634\u0627\u0621 \u0645\u0635\u0646\u0641 \u0625\u0643\u0633\u0644 \u0627\u0644\u0634\u0627\u0645\u0644 \u0648\u0627\u0644\u0646\u0633\u062E\u0629 \u0627\u0644\u0627\u062D\u062A\u064A\u0627\u0637\u064A\u0629 (${excelFileName}) \u0648\u062D\u0641\u0638\u0647\u0645\u0627 \u0628\u0646\u062C\u0627\u062D \u0639\u0644\u0649 \u0633\u064A\u0631\u0641\u0631 \u0627\u0644\u0628\u064A\u0627\u0646\u0627\u062A \u0627\u0644\u0645\u0631\u0643\u0632\u064A!`;
    return {
      success: true,
      excelFileName,
      jsonFileName,
      dateStr,
      excelSizeKb,
      jsonSizeKb,
      message: responseMessage
    };
  } catch (err) {
    console.error("[Daily Backup] Failed daily backup execution:", err);
    return {
      success: false,
      excelFileName: "",
      jsonFileName: "",
      dateStr: (/* @__PURE__ */ new Date()).toISOString().slice(0, 10),
      excelSizeKb: 0,
      jsonSizeKb: 0,
      message: "\u0641\u0634\u0644 \u062A\u0646\u0641\u064A\u0630 \u0627\u0644\u0646\u0633\u062E \u0627\u0644\u0627\u062D\u062A\u064A\u0627\u0637\u064A \u0627\u0644\u064A\u0648\u0645\u064A",
      error: err?.message || "Unknown error"
    };
  }
}
function checkAndRunDailyBackup() {
  try {
    const today = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
    const dailyFolder = import_path.default.join(BACKUPS_DIR, "daily");
    const statusFilePath = import_path.default.join(dailyFolder, "daily_backup_status.json");
    let alreadyRanToday = false;
    if (import_fs.default.existsSync(statusFilePath)) {
      try {
        const raw = import_fs.default.readFileSync(statusFilePath, "utf-8");
        const parsed = JSON.parse(raw);
        if (parsed.lastBackupDate === today || parsed.lastSentDate === today) {
          alreadyRanToday = true;
        }
      } catch {
      }
    }
    if (!alreadyRanToday && cachedState) {
      console.log(`[Daily Backup Scheduler] Initiating automated daily backup for ${today}...`);
      performDailyBackup();
    }
  } catch (schedErr) {
    console.warn("[Daily Backup Scheduler] Scheduler check encountered issue:", schedErr);
  }
}
setTimeout(checkAndRunDailyBackup, 15e3);
setInterval(checkAndRunDailyBackup, 30 * 60 * 1e3);
app.post([
  "/api/backup/run-daily",
  "/api/backup/run-daily.php",
  "/api/backup/send-daily-email",
  "/api/backup/send-daily-email.php"
], async (req, res) => {
  try {
    const forceState = req.body?.data || req.body?.fullState || null;
    const result = await performDailyBackup(forceState);
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err?.message || "Failed to execute daily backup" });
  }
});
app.get(["/api/backup/daily-status", "/api/backup/daily-status.php"], (req, res) => {
  try {
    const dailyFolder = import_path.default.join(BACKUPS_DIR, "daily");
    const statusFilePath = import_path.default.join(dailyFolder, "daily_backup_status.json");
    if (!import_fs.default.existsSync(statusFilePath)) {
      return res.json({
        success: true,
        status: null
      });
    }
    const raw = import_fs.default.readFileSync(statusFilePath, "utf-8");
    const status = JSON.parse(raw);
    res.json({ success: true, status });
  } catch (err) {
    res.status(500).json({ success: false, error: err?.message });
  }
});
app.get(["/api/backup/download-daily/:type", "/api/backup/download-daily.php"], (req, res) => {
  try {
    const type = req.params?.type || req.query?.type || "excel";
    const dailyFolder = import_path.default.join(BACKUPS_DIR, "daily");
    const dateStr = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
    if (type === "excel" || type === "xlsx") {
      const targetPath = import_path.default.join(dailyFolder, "latest_daily_backup.xlsx");
      if (!import_fs.default.existsSync(targetPath)) {
        const buf = generateComprehensiveExcelBuffer(cachedState || {});
        res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
        res.setHeader("Content-Disposition", `attachment; filename="\u062D\u0632\u0645\u0629_\u0645\u0635\u0646\u0641_\u0625\u0643\u0633\u0644_\u0627\u0644\u0634\u0627\u0645\u0644_${dateStr}.xlsx"`);
        return res.send(buf);
      }
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="\u062D\u0632\u0645\u0629_\u0645\u0635\u0646\u0641_\u0625\u0643\u0633\u0644_\u0627\u0644\u0634\u0627\u0645\u0644_${dateStr}.xlsx"`);
      return res.sendFile(targetPath);
    } else {
      const targetPath = import_path.default.join(dailyFolder, "latest_daily_backup.json");
      if (!import_fs.default.existsSync(targetPath)) {
        const jsonStr = JSON.stringify(cachedState || {}, null, 2);
        res.setHeader("Content-Type", "application/json");
        res.setHeader("Content-Disposition", `attachment; filename="\u0646\u0633\u062E\u0629_\u0627\u062D\u062A\u064A\u0627\u0637\u064A\u0629_\u0643\u0627\u0645\u0644\u0629_${dateStr}.json"`);
        return res.send(jsonStr);
      }
      res.setHeader("Content-Type", "application/json");
      res.setHeader("Content-Disposition", `attachment; filename="\u0646\u0633\u062E\u0629_\u0627\u062D\u062A\u064A\u0627\u0637\u064A\u0629_\u0643\u0627\u0645\u0644\u0629_${dateStr}.json"`);
      return res.sendFile(targetPath);
    }
  } catch (err) {
    res.status(500).json({ success: false, error: err?.message });
  }
});
app.post(["/api/restore", "/api/restore.php", "/api/restore-backup", "/api/restore-backup.php"], (req, res) => {
  try {
    const filename = req.body?.filename;
    if (!filename) {
      return res.status(400).json({ success: false, error: "Missing filename" });
    }
    const backupPath = import_path.default.join(BACKUPS_DIR, filename);
    if (!import_fs.default.existsSync(backupPath)) {
      return res.status(404).json({ success: false, error: "Backup file not found on server" });
    }
    const content = import_fs.default.readFileSync(backupPath, "utf-8");
    const parsed = JSON.parse(content);
    const saveRes = saveStateToDisk(parsed, "\u0627\u0633\u062A\u0631\u062C\u0627\u0639 \u0646\u0633\u062E\u0629 \u0627\u062D\u062A\u064A\u0627\u0637\u064A\u0629 \u0645\u0646 \u0627\u0644\u0633\u064A\u0631\u0641\u0631");
    if (saveRes.success) {
      res.json({ success: true, data: parsed, savedAt: saveRes.savedAt });
    } else {
      res.status(500).json({ success: false, error: saveRes.error });
    }
  } catch (err) {
    res.status(500).json({ success: false, error: err?.message });
  }
});
app.get("/api/archived-expenses", (req, res) => {
  try {
    if (import_fs.default.existsSync(ARCHIVE_FILE)) {
      const content = import_fs.default.readFileSync(ARCHIVE_FILE, "utf-8");
      res.json({ success: true, data: JSON.parse(content) });
    } else {
      res.json({ success: true, data: [] });
    }
  } catch (err) {
    res.status(500).json({ success: false, error: err?.message });
  }
});
app.post("/api/archived-expenses", (req, res) => {
  try {
    const data = req.body?.data || req.body;
    import_fs.default.writeFileSync(ARCHIVE_FILE, JSON.stringify(data, null, 2), "utf-8");
    res.json({ success: true, savedAt: (/* @__PURE__ */ new Date()).toISOString() });
  } catch (err) {
    res.status(500).json({ success: false, error: err?.message });
  }
});
app.get("/api/expenses", async (req, res) => {
  const rawExpenses = cachedState?.expenses || [];
  const expenses = rawExpenses.map((e) => ({
    ...e,
    invoicePhoto: e.invoicePhoto || e.invoice_url,
    invoice_url: e.invoice_url || e.invoicePhoto
  }));
  res.json({ success: true, expenses });
});
app.post("/api/expenses", async (req, res) => {
  try {
    const { id, title, amount, category, date, invoice_url, invoicePhoto, notes } = req.body || {};
    const finalInvoiceUrl = invoice_url || invoicePhoto;
    const expenseId = id || `exp_${Date.now()}`;
    if (cachedState && Array.isArray(cachedState.expenses)) {
      const newExp = { ...req.body || {}, id: expenseId, invoice_url: finalInvoiceUrl, invoicePhoto: finalInvoiceUrl, updatedAt: (/* @__PURE__ */ new Date()).toISOString() };
      const idx = cachedState.expenses.findIndex((e) => e.id === expenseId);
      if (idx >= 0) {
        cachedState.expenses[idx] = { ...cachedState.expenses[idx], ...newExp };
      } else {
        cachedState.expenses.unshift(newExp);
      }
      saveStateToDisk(cachedState);
    }
    res.status(201).json({ success: true, id: expenseId, message: "Expense saved successfully" });
  } catch (err) {
    console.error("POST /api/expenses error:", err);
    res.status(500).json({ success: false, error: err?.message || "Server error" });
  }
});
app.put("/api/expenses/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { invoice_url, invoicePhoto } = req.body || {};
    const finalInvoiceUrl = invoice_url || invoicePhoto;
    if (cachedState && Array.isArray(cachedState.expenses)) {
      const idx = cachedState.expenses.findIndex((e) => e.id === id);
      if (idx >= 0) {
        cachedState.expenses[idx] = {
          ...cachedState.expenses[idx],
          ...req.body,
          invoicePhoto: finalInvoiceUrl || cachedState.expenses[idx].invoicePhoto,
          invoice_url: finalInvoiceUrl || cachedState.expenses[idx].invoice_url,
          updatedAt: (/* @__PURE__ */ new Date()).toISOString()
        };
        saveStateToDisk(cachedState);
      }
    }
    res.json({ success: true, message: `Expense ${id} updated successfully` });
  } catch (err) {
    console.error(`PUT /api/expenses/${req.params.id} error:`, err);
    res.status(500).json({ success: false, error: err?.message || "Server error" });
  }
});
app.delete("/api/expenses/:id", async (req, res) => {
  try {
    const { id } = req.params;
    if (cachedState && Array.isArray(cachedState.expenses)) {
      cachedState.expenses = cachedState.expenses.filter((e) => e.id !== id);
      if (!cachedState.deletedExpenseIds) cachedState.deletedExpenseIds = {};
      cachedState.deletedExpenseIds[id] = true;
      saveStateToDisk(cachedState);
    }
    res.json({ success: true, message: `Expense ${id} deleted successfully` });
  } catch (err) {
    console.error(`DELETE /api/expenses/${req.params.id} error:`, err);
    res.status(500).json({ success: false, error: err?.message || "Server error" });
  }
});
app.post(["/api/upload", "/api/upload.php", "/api/upload-file", "/api/upload-file.php"], async (req, res) => {
  try {
    const { dataUrl, file, fileName, name } = req.body || {};
    const rawData = dataUrl || file;
    const requestedName = String(fileName || name || `attachment_${Date.now()}.jpg`).trim();
    if (!rawData || typeof rawData !== "string") {
      return res.status(400).json({ success: false, error: "\u0628\u064A\u0627\u0646\u0627\u062A \u0627\u0644\u0645\u0644\u0641 (dataUrl) \u0645\u0637\u0644\u0648\u0628\u0629 \u0644\u0644\u0631\u0641\u0639" });
    }
    let mimeType = "image/jpeg";
    let base64Data = rawData;
    const mimeMatch = rawData.match(/^data:([^;]+);base64,(.+)$/);
    if (mimeMatch) {
      mimeType = mimeMatch[1];
      base64Data = mimeMatch[2];
    }
    const buffer = Buffer.from(base64Data, "base64");
    const cleanBase = requestedName.replace(/[^a-zA-Z0-9_\u0600-\u06FF.-]/g, "_").replace(/\s+/g, "_");
    const ext = import_path.default.extname(cleanBase) || (mimeType === "application/pdf" ? ".pdf" : ".jpg");
    const nameWithoutExt = import_path.default.basename(cleanBase, ext);
    const safeFileName = `${nameWithoutExt}_${Date.now()}${ext}`;
    const filePath = import_path.default.join(UPLOADS_DIR, safeFileName);
    import_fs.default.writeFileSync(filePath, buffer);
    const publicUrl = `/uploads/${encodeURIComponent(safeFileName)}`;
    res.json({
      success: true,
      url: publicUrl,
      downloadUrl: publicUrl,
      fileName: safeFileName,
      originalName: requestedName,
      size: buffer.length,
      mimeType,
      message: "\u062A\u0645 \u062D\u0641\u0638 \u0627\u0644\u0645\u0644\u0641 \u0628\u0646\u062C\u0627\u062D \u0639\u0644\u0649 \u0633\u064A\u0631\u0641\u0631 \u0627\u0644\u0628\u064A\u0627\u0646\u0627\u062A \u0627\u0644\u0645\u0631\u0643\u0632\u064A"
    });
  } catch (err) {
    console.error("Error in /api/upload:", err);
    res.status(500).json({ success: false, error: err?.message || "\u0641\u0634\u0644 \u062D\u0641\u0638 \u0627\u0644\u0645\u0644\u0641 \u0639\u0644\u0649 \u0627\u0644\u0633\u064A\u0631\u0641\u0631" });
  }
});
app.get(["/api/uploads-list", "/api/uploads-list.php"], (req, res) => {
  try {
    if (!import_fs.default.existsSync(UPLOADS_DIR)) {
      return res.json({ success: true, files: [], count: 0, totalSizeKb: 0 });
    }
    const files = import_fs.default.readdirSync(UPLOADS_DIR).map((f) => {
      const p = import_path.default.join(UPLOADS_DIR, f);
      const st = import_fs.default.statSync(p);
      return {
        name: f,
        url: `/uploads/${encodeURIComponent(f)}`,
        size: st.size,
        sizeKb: Math.round(st.size / 1024 * 10) / 10,
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
  } catch (err) {
    res.status(500).json({ success: false, error: err?.message || "Error listing uploads" });
  }
});
app.delete("/api/upload/:fileName", (req, res) => {
  try {
    const { fileName } = req.params;
    const clean = import_path.default.basename(fileName);
    const p = import_path.default.join(UPLOADS_DIR, clean);
    if (import_fs.default.existsSync(p)) {
      import_fs.default.unlinkSync(p);
      return res.json({ success: true, message: `File ${clean} deleted` });
    }
    res.status(404).json({ success: false, error: "\u0627\u0644\u0645\u0644\u0641 \u063A\u064A\u0631 \u0645\u0648\u062C\u0648\u062F" });
  } catch (err) {
    res.status(500).json({ success: false, error: err?.message });
  }
});
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa"
    });
    app.use(vite.middlewares);
  } else {
    let distPath = import_fs.default.existsSync(import_path.default.join(__dirname, "index.html")) ? __dirname : import_fs.default.existsSync(import_path.default.join(process.cwd(), "dist", "index.html")) ? import_path.default.join(process.cwd(), "dist") : process.cwd();
    console.log(`[Server] Serving static assets from: ${distPath}`);
    app.use(import_express.default.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(import_path.default.join(distPath, "index.html"));
    });
  }
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`[SkyArc Server] Running successfully on http://0.0.0.0:${PORT} (Process PID: ${process.pid})`);
  });
}
startServer();
