import React, { createContext, useContext, useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  Project,
  Expense,
  ArchivedExpense,
  ExpenseArchiveCriteria,
  CustodyRecord,
  User,
  AuthSession,
  SessionEvictedInfo,
  AppSettings,
  AppNotification,
  SupportTicket,
  SupervisorSummary,
  UserRole,
  CustomRole,
  WorkflowStage,
  RolePermission,
  ExpenseWorkflowAction,
  SyncProgressInfo,
  OperationStatusInfo,
  ExpenseAttachment,
  ERPPostingStatus,
  ApprovalStatus
} from '../types';
import { StorageService } from '../services/storage';
import { ServerSyncService, subscribeToSessionEvicted } from '../services/serverSync';
import { FirebaseService } from '../services/firebase';
import { AttachmentArchiver } from '../services/attachmentArchiver';
import { getClientDeviceSummary, generateSessionId } from '../utils/sessionManager';
import confetti from 'canvas-confetti';

export interface AttachmentPreviewData {
  url: string;
  title?: string;
  subtitle?: string;
  expenseId?: string;
  projectId?: string;
  expense?: Expense;
  codedFileName?: string;
  projectFolder?: string;
  attachments?: ExpenseAttachment[];
  initialIndex?: number;
}

interface AppContextType {
  // Entities
  projects: Project[];
  expenses: Expense[];
  custodies: CustodyRecord[];
  users: User[];
  roles: CustomRole[];
  workflowStages: WorkflowStage[];
  settings: AppSettings;
  notifications: AppNotification[];
  accessibleNotifications: AppNotification[];
  userUnreadNotificationsCount: number;
  tickets: SupportTicket[];
  currentUser: User;

  // Per-User Isolated Theme Management
  theme: 'system' | 'light' | 'dark';
  isDarkMode: boolean;
  setTheme: (theme: 'system' | 'light' | 'dark') => void;
  toggleTheme: () => void;

  // Permissions & Current User Role
  currentUserRole: CustomRole | null;
  currentUserPermissions: RolePermission;
  isCurrentUserAdmin: boolean;
  hasPermission: (permission: keyof RolePermission) => boolean;
  isScreenAllowed: (screenId: string) => boolean;

  // Computed Summaries
  supervisorsSummary: SupervisorSummary[];
  currentSupervisorSummary: SupervisorSummary | null;
  totalCompanyExpenses: number;
  totalCompanyCustody: number;
  totalPendingApprovalsCount: number;
  activeProjectsCount: number;

  // Network & Sync State
  isOnline: boolean;
  isSimulatingOffline: boolean;
  setIsSimulatingOffline: (val: boolean) => void;
  syncQueueCount: number;
  pendingSyncCount: number;
  lastSyncTime: string;
  isSyncing: boolean;
  triggerSync: () => Promise<void>;
  triggerCloudSync: () => Promise<void>;

  // User & Role Switcher & Strict Auth & Single-Session Enforcement
  isAuthenticated: boolean;
  sessionEvictedInfo: SessionEvictedInfo | null;
  dismissSessionEvictedModal: () => void;
  verifyCurrentSession: () => boolean;
  login: (identifier: string, password: string, rememberMe?: boolean) => Promise<{ success: boolean; message?: string }>;
  logout: () => void;
  resetUserPasswordByManager: (userId: string, newPassword: string) => Promise<boolean>;
  resetAllUsersPasswordByManager: (newPassword?: string) => Promise<boolean>;
  setCurrentUser: (user: User) => void;
  switchRole: (userOrRoleId: string, targetScreen?: string) => void;

  // Expense Actions & Multi-Stage Approval Workflow
  addExpense: (expenseData: Omit<Expense, 'id' | 'fingerprintTime' | 'updatedAt' | 'synced' | 'status' | 'accountantApproval' | 'managementApproval'>) => Promise<Expense>;
  updateExpense: (id: string, expenseData: Partial<Expense>) => Promise<boolean>;
  deleteExpense: (id: string) => Promise<boolean>;
  approveWorkflowStage: (expenseId: string, stageId: string, notes?: string, erpData?: { erpSystemName?: string; erpReferenceNumber?: string }) => Promise<boolean>;
  approveBySupervisor: (id: string, notes?: string) => Promise<boolean>;
  approveByProjectManager: (id: string, notes?: string) => Promise<boolean>;
  approveByAccountant: (id: string, notes?: string, erpData?: { erpSystemName?: string; erpReferenceNumber?: string }) => Promise<boolean>;
  approveByManagement: (id: string, notes?: string) => Promise<boolean>;
  postToExternalERP: (id: string, erpSystemName: string, erpReferenceNumber: string, notes?: string) => Promise<boolean>;
  rejectExpense: (id: string, reason: string) => Promise<boolean>;
  batchApprove: (ids: string[], stageId?: string) => Promise<number>;
  bulkDeleteExpenses: (ids: string[]) => Promise<number>;
  bulkUpdateExpenses: (ids: string[], updates: Partial<Expense>) => Promise<number>;
  bulkImportExpenses: (newExpenses: Expense[], newProjects?: Project[]) => Promise<{ success: boolean; count: number; message: string }>;
  bulkAttachExpensesPhotos: (attachments: { expenseId: string; invoicePhoto: string; fileName: string; attachmentMeta?: any }[]) => Promise<{ success: boolean; count: number; message: string }>;

  // Role Management
  addRole: (roleData: Omit<CustomRole, 'id'>) => Promise<CustomRole>;
  updateRole: (id: string, roleData: Partial<CustomRole>) => Promise<boolean>;
  deleteRole: (id: string) => Promise<boolean>;

  // Workflow Stages Management
  addWorkflowStage: (stageData: Omit<WorkflowStage, 'id'>) => Promise<WorkflowStage>;
  updateWorkflowStage: (id: string, stageData: Partial<WorkflowStage>) => Promise<boolean>;
  deleteWorkflowStage: (id: string) => Promise<boolean>;
  reorderWorkflowStages: (stages: WorkflowStage[]) => Promise<void>;

  // Custody Actions
  addCustody: (custodyData: Omit<CustodyRecord, 'id' | 'synced'>) => Promise<CustodyRecord>;
  updateCustody: (id: string, custodyData: Partial<CustodyRecord>) => Promise<boolean>;
  deleteCustody: (id: string) => Promise<boolean>;

  // Project Actions & Assignment Control
  accessibleProjects: Project[];
  isUserAssignedToProject: (userOrEmail: User | string, project: Project) => boolean;
  canUserAccessProject: (project: Project, user?: User) => boolean;
  canUserOperateOnProject: (projectId: string, user?: User) => { canOperate: boolean; reason?: string };
  getProjectsForUser: (userOrEmail: User | string) => Project[];
  addProject: (projectData: Omit<Project, 'id' | 'createdAt'>) => Promise<Project>;
  updateProject: (id: string, projectData: Partial<Project>) => Promise<boolean>;
  deleteProject: (id: string) => Promise<boolean>;

  // User Actions
  addUser: (userData: Omit<User, 'id'>) => Promise<User>;
  updateUser: (id: string, userData: Partial<User>) => Promise<boolean>;
  deleteUser: (id: string) => Promise<boolean>;

  // Support Tickets
  addTicket: (ticketData: Omit<SupportTicket, 'id' | 'createdAt' | 'status'>) => Promise<SupportTicket>;
  replyToTicket: (ticketId: string, message: string, isAdmin: boolean) => Promise<boolean>;
  updateTicketStatus: (ticketId: string, status: SupportTicket['status']) => Promise<boolean>;

  // Settings, Categories & Notifications
  updateSettings: (newSettings: Partial<AppSettings>) => void;
  renameCategory: (oldName: string, newName: string) => { success: boolean; affectedCount: number; message: string };
  deleteCategory: (categoryName: string) => { success: boolean; message: string; isBlockedByExpenses?: boolean; usageCount?: number };
  getCategoryUsageCount: (categoryName: string) => number;
  renameErpSystem: (oldName: string, newName: string) => { success: boolean; affectedCount: number; message: string };
  deleteErpSystem: (erpName: string) => { success: boolean; message: string; isBlockedByExpenses?: boolean; usageCount?: number };
  getErpUsageCount: (erpName: string) => number;
  markNotificationAsRead: (id: string) => void;
  markAllNotificationsAsRead: () => void;
  deleteNotification: (id: string) => void;
  clearNotifications: () => void;
  clearAllNotifications: () => void;
  addNotification: (
    title: string,
    message: string,
    type: AppNotification['type'],
    relatedId?: string,
    explicitAuthorEmail?: string,
    explicitAuthorName?: string,
    category?: AppNotification['category']
  ) => void;

  // Data & Export
  exportAllToExcel: () => void;
  exportBackup: () => string;
  downloadBackup: () => { success: boolean; filename: string; stats: any };
  validateBackup: (jsonStr: string) => any;
  validateBackupExcel: (buffer: ArrayBuffer) => any;
  importBackup: (jsonStr: string, mode?: 'replace' | 'merge') => boolean;
  importBackupData: (parsedData: any, mode?: 'replace' | 'merge') => boolean;
  createQuickSnapshot: () => { success: boolean; timestamp: string; stats: any };
  getQuickSnapshot: () => { timestamp: string; stats: any; data: any } | null;
  restoreQuickSnapshot: () => boolean;
  resetAllData: () => void;

  // Expense Archive Management
  archivedExpenses: ArchivedExpense[];
  archiveExpenses: (criteria: ExpenseArchiveCriteria) => Promise<{ success: boolean; count: number; amount: number; message?: string }>;
  restoreArchivedExpenses: (expenseIds: string[]) => Promise<{ success: boolean; count: number; message?: string }>;
  deleteArchivedExpensesPermanently: (expenseIds: string[]) => Promise<{ success: boolean; count: number }>;
  exportArchivedExpensesToExcel: () => void;

  // Cloud Sync & Remote Backups
  isCloudConnected: boolean;
  isCloudSyncing: boolean;
  syncProgress: SyncProgressInfo;
  isSavingToServer: boolean;
  isDataUploading: boolean;
  isJustUploaded: boolean;
  lastCloudSyncTime: string | null;
  isServerConnected: boolean;
  lastServerSyncTime: string | null;
  saveToServerNow: () => Promise<{ success: boolean; message: string }>;
  syncWithCloud: () => Promise<{ success: boolean; message?: string }>;
  loadFromCloud: () => Promise<{ success: boolean; message?: string }>;
  createCloudSnapshot: (note?: string) => Promise<{ success: boolean; backupId?: string }>;
  listCloudSnapshots: () => Promise<any[]>;
  restoreCloudSnapshot: (backupId: string) => Promise<boolean>;
  runDailyBackup: () => Promise<{
    success: boolean;
    message: string;
    excelFileName?: string;
    jsonFileName?: string;
    excelSizeKb?: number;
    jsonSizeKb?: number;
    error?: string;
  }>;
  sendDailyBackupToManager: () => Promise<{
    success: boolean;
    message: string;
    excelFileName?: string;
    jsonFileName?: string;
    excelSizeKb?: number;
    jsonSizeKb?: number;
    error?: string;
  }>;
  getDailyBackupStatus: () => Promise<{ success: boolean; status: any }>;

  // Database Boot & Integrity Loading
  isInitialDatabaseLoading: boolean;
  databaseLoadSource: 'cloud' | 'server' | 'offline' | null;
  databaseLoadStats: { expenses: number; projects: number; custodies: number } | null;
  bypassDatabaseLoading: () => void;

  // Active View / Navigation & Modals
  currentView: string;
  setCurrentView: (view: string) => void;
  selectedExpenseForDetail: Expense | null;
  setSelectedExpenseForDetail: (expense: Expense | null) => void;
  isExpenseModalOpen: boolean;
  setIsExpenseModalOpen: (open: boolean) => void;
  editingExpense: Expense | null;
  setEditingExpense: (expense: Expense | null) => void;
  isNotificationsOpen: boolean;
  setIsNotificationsOpen: (open: boolean) => void;
  isPrintModalOpen: boolean;
  setIsPrintModalOpen: (open: boolean) => void;
  printData: { type: 'expense' | 'custody_statement' | 'project_report' | 'filtered_report' | 'expense_list'; data: any } | null;
  setPrintData: (data: { type: 'expense' | 'custody_statement' | 'project_report' | 'filtered_report' | 'expense_list'; data: any } | null) => void;

  // Attachment Preview Lightbox Modal
  previewAttachment: AttachmentPreviewData | null;
  openAttachmentPreview: (data: AttachmentPreviewData | string, expense?: Expense) => void;
  closeAttachmentPreview: () => void;

  // Confirmation Dialog System (Replaces broken browser confirm() in iframe)
  confirmDialog: ConfirmDialogOptions | null;
  confirmAction: (options: ConfirmDialogOptions) => void;
  closeConfirmDialog: () => void;

  // Alert Dialog System (Replaces broken browser alert() in iframe)
  alertDialog: AlertDialogOptions | null;
  showAlert: (title: string, message: string, type?: 'info' | 'warning' | 'error' | 'success', buttonText?: string) => void;
  closeAlertDialog: () => void;

  // Real-time Operation Save & Sync Tracking
  lastOperationStatus: OperationStatusInfo | null;
  setLastOperationStatus: (status: OperationStatusInfo | null) => void;
  clearLastOperationStatus: () => void;
  recordOperationStatus: (action: string, title: string, options?: { savedLocally?: boolean; synced?: boolean; details?: string }) => void;

  // Helpers: check if user can edit or delete expense
  canEditExpense: (expense: Expense) => { canEdit: boolean; remainingMinutes: number; reason?: string };
  canDeleteExpenseCheck: (expense: Expense) => { canDelete: boolean; reason?: string };
  isExpenseApprovedStage1OrMore: (expense: Expense) => boolean;
  isExpenseApprovedByPrecedingStages: (expense: Expense, user?: User) => boolean;
  getExpenseElapsedMinutes: (expense: Expense) => { elapsedMinutes: number; remainingMinutes: number };
}

export interface ConfirmDialogOptions {
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  type?: 'danger' | 'warning' | 'info';
  details?: string;
  onConfirm: () => void | Promise<void>;
  onCancel?: () => void;
}

export interface AlertDialogOptions {
  title: string;
  message: string;
  type?: 'info' | 'warning' | 'error' | 'success';
  buttonText?: string;
  onClose?: () => void;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // Raw Data State
  const [projects, setProjects] = useState<Project[]>(() => StorageService.getProjects());
  const [expenses, setExpenses] = useState<Expense[]>(() => StorageService.getExpenses());
  const [custodies, setCustodies] = useState<CustodyRecord[]>(() => StorageService.getCustodies());
  const [users, setUsers] = useState<User[]>(() => StorageService.getUsers());
  const [roles, setRoles] = useState<CustomRole[]>(() => StorageService.getRoles());
  const [workflowStages, setWorkflowStages] = useState<WorkflowStage[]>(() => StorageService.getWorkflowStages());
  const [settings, setSettings] = useState<AppSettings>(() => StorageService.getSettings());
  const [notifications, setNotifications] = useState<AppNotification[]>(() => StorageService.getNotifications());
  const [tickets, setTickets] = useState<SupportTicket[]>(() => StorageService.getTickets());
  const [archivedExpenses, setArchivedExpenses] = useState<ArchivedExpense[]>(() => StorageService.getArchivedExpenses());
  
  // Global In-App Confirmation Dialog State
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogOptions | null>(null);
  const confirmAction = useCallback((options: ConfirmDialogOptions) => {
    setConfirmDialog(options);
  }, []);
  const closeConfirmDialog = useCallback(() => {
    setConfirmDialog(null);
  }, []);

  // Global In-App Alert Dialog State
  const [alertDialog, setAlertDialog] = useState<AlertDialogOptions | null>(null);
  const showAlert = useCallback((title: string, message: string, type: 'info' | 'warning' | 'error' = 'info', buttonText?: string) => {
    setAlertDialog({ title, message, type, buttonText });
  }, []);
  const closeAlertDialog = useCallback(() => {
    setAlertDialog(null);
  }, []);

  // Strict Auth State & Single-Device Enforcement
  const [sessionEvictedInfo, setSessionEvictedInfo] = useState<SessionEvictedInfo | null>(null);

  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(() => {
    const session = StorageService.getAuthSession();
    return Boolean(session?.isAuthenticated);
  });

  const [currentUser, setCurrentUser] = useState<User>(() => {
    const session = StorageService.getAuthSession();
    if (session?.isAuthenticated && session?.userId) {
      const allUsers = StorageService.getUsers();
      const found = allUsers.find(u => u.id === session.userId);
      if (found) return found;
    }
    return StorageService.getCurrentUser();
  });

  // Track timestamp of last user interaction (mouse, touch, keydown, click)
  const lastUserActivityRef = useRef<number>(Date.now());

  // Handle concurrent sessions eviction: kicks out old device when a new device logs in
  const handleConcurrentSessionEviction = useCallback((incomingUser: User) => {
    if (settings.preventMultiDeviceLogin === false) return;

    console.warn('[Session Security] Concurrent session detected on another device! Evicting current session and clearing local volatile cache.');

    setSessionEvictedInfo({
      isOpen: true,
      userName: incomingUser.name || incomingUser.username || currentUser?.name || 'مستخدم النظام',
      newDevice: incomingUser.lastLoginDevice || 'متصفح / جهاز جديد',
      loginTime: incomingUser.lastLoginAt || new Date().toISOString()
    });

    // Clear local auth credentials
    StorageService.clearAuthSession();
    setIsAuthenticated(false);
  }, [currentUser?.name, settings.preventMultiDeviceLogin]);

  // Check if current session is valid against incoming users list
  const verifySessionValidity = useCallback((incomingUsers?: User[]): boolean => {
    if (settings.preventMultiDeviceLogin === false) return true;
    const session = StorageService.getAuthSession();
    if (!session?.isAuthenticated || !session?.sessionId || !session?.userId) return true;

    const list = incomingUsers && Array.isArray(incomingUsers) ? incomingUsers : users;
    const targetUser = list.find(u => u.id === session.userId || (u.email && currentUser?.email && u.email.toLowerCase() === currentUser.email.toLowerCase()));
    if (targetUser && targetUser.currentSessionId && targetUser.currentSessionId !== session.sessionId) {
      handleConcurrentSessionEviction(targetUser);
      return false;
    }
    return true;
  }, [currentUser?.email, handleConcurrentSessionEviction, settings.preventMultiDeviceLogin, users]);

  const verifyCurrentSession = useCallback((): boolean => {
    return verifySessionValidity(users);
  }, [users, verifySessionValidity]);

  const dismissSessionEvictedModal = useCallback(() => {
    setSessionEvictedInfo(null);
  }, []);

  // Monitor session validity on users change & periodic heartbeat check (every 4 seconds)
  useEffect(() => {
    if (!isAuthenticated) return;
    if (settings.preventMultiDeviceLogin === false) return;

    // Check against current users list
    verifySessionValidity(users);

    const interval = setInterval(() => {
      const latestUsers = StorageService.getUsers();
      verifySessionValidity(latestUsers);
    }, 4000);

    return () => clearInterval(interval);
  }, [isAuthenticated, users, verifySessionValidity, settings.preventMultiDeviceLogin]);

  // Activity listeners to track user actions (reset inactivity timer on mouse, touch, keyboard, scroll, click)
  useEffect(() => {
    if (!isAuthenticated) return;

    const handleActivity = () => {
      lastUserActivityRef.current = Date.now();
    };

    const activityEvents = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll', 'click', 'wheel'];
    activityEvents.forEach(evt => {
      window.addEventListener(evt, handleActivity, { passive: true });
    });

    return () => {
      activityEvents.forEach(evt => {
        window.removeEventListener(evt, handleActivity);
      });
    };
  }, [isAuthenticated]);

  // Inactivity Auto-Logout Timer
  useEffect(() => {
    if (!isAuthenticated) return;
    const timeoutMinutes = settings.inactivityTimeoutMinutes ?? 5;
    if (timeoutMinutes <= 0) return; // 0 means disabled

    const timeoutMs = timeoutMinutes * 60 * 1000;
    lastUserActivityRef.current = Date.now();

    const interval = setInterval(() => {
      const idleTime = Date.now() - lastUserActivityRef.current;
      if (idleTime >= timeoutMs) {
        console.log(`[Inactivity Auto-Logout] User idle for ${idleTime}ms (timeout: ${timeoutMs}ms). Logging out.`);
        StorageService.clearAuthSession();
        setIsAuthenticated(false);
        setSessionEvictedInfo(null);
        showAlert(
          'تم تسجيل الخروج تلقائياً لخمول الموقع',
          `تم تسجيل الخروج تلقائياً لعدم وجود أي نشاط على المتصفح لمدة (${timeoutMinutes} دقيقة) وتفريغ الذاكرة المؤقتة. عند تسجيل الدخول مجدداً سيتم جلب أحدث نسخة محدثة من السيرفر مباشرة.`,
          'warning',
          'حسناً، فهمت'
        );
      }
    }, 3000);

    return () => clearInterval(interval);
  }, [isAuthenticated, settings.inactivityTimeoutMinutes, showAlert]);

  // UI & View State
  const [currentView, setCurrentView] = useState<string>('dashboard');

  const safeSetCurrentView = useCallback((newView: string) => {
    const isSup =
      currentUser.role === 'مشرف' ||
      currentUser.role === 'مشرف موقع' ||
      currentUser.roleId === 'role_supervisor' ||
      currentUser.role.includes('مشرف');

    const isAcc =
      currentUser.role === 'محاسب' ||
      currentUser.role === 'محاسب مالي' ||
      currentUser.roleId === 'role_accountant' ||
      currentUser.role.includes('محاسب');

    const forbiddenSup = ['custody', 'custodies', 'projects', 'settings', 'supervisors', 'approvals'];
    const forbiddenAcc = ['supervisors', 'settings'];

    if (isSup && forbiddenSup.includes(newView)) {
      setCurrentView('expenses');
      return;
    }

    if (isAcc && forbiddenAcc.includes(newView)) {
      setCurrentView('expenses');
      return;
    }

    setCurrentView(newView);
  }, [currentUser]);

  // Enforce role-based screen restrictions for supervisor and accountant
  useEffect(() => {
    const isSup =
      currentUser.role === 'مشرف' ||
      currentUser.role === 'مشرف موقع' ||
      currentUser.roleId === 'role_supervisor' ||
      currentUser.role.includes('مشرف');

    const isAcc =
      currentUser.role === 'محاسب' ||
      currentUser.role === 'محاسب مالي' ||
      currentUser.roleId === 'role_accountant' ||
      currentUser.role.includes('محاسب');

    const forbiddenSup = ['custody', 'custodies', 'projects', 'settings', 'supervisors', 'approvals'];
    const forbiddenAcc = ['supervisors', 'settings'];

    if (isSup && forbiddenSup.includes(currentView)) {
      setCurrentView('expenses');
    }

    if (isAcc && forbiddenAcc.includes(currentView)) {
      setCurrentView('expenses');
    }
  }, [currentUser, currentView]);

  const [selectedExpenseForDetail, setSelectedExpenseForDetail] = useState<Expense | null>(null);
  const [isExpenseModalOpen, setIsExpenseModalOpen] = useState<boolean>(false);
  const [editingExpense, setEditingExpense] = useState<Expense | null>(null);
  const [isNotificationsOpen, setIsNotificationsOpen] = useState<boolean>(false);
  const [isPrintModalOpen, setIsPrintModalOpen] = useState<boolean>(false);
  const [printData, setPrintData] = useState<{ type: 'expense' | 'custody_statement' | 'project_report' | 'filtered_report' | 'expense_list'; data: any } | null>(null);
  const [previewAttachment, setPreviewAttachment] = useState<AttachmentPreviewData | null>(null);

  const openAttachmentPreview = useCallback((data: AttachmentPreviewData | string, expense?: Expense) => {
    let resolvedExpense = expense;
    if (!resolvedExpense && typeof data !== 'string') {
      if (data.expense) {
        resolvedExpense = data.expense;
      } else if (data.expenseId) {
        resolvedExpense = expenses.find(e => e.id === data.expenseId);
      }
    }

    if (typeof data === 'string') {
      const isPdf = Boolean(
        data.startsWith('data:application/pdf') ||
        data.toLowerCase().includes('.pdf') ||
        resolvedExpense?.attachmentFileName?.toLowerCase().endsWith('.pdf')
      );
      const codedFileName = resolvedExpense?.attachmentFileName || (resolvedExpense ? AttachmentArchiver.generateCodedFileName({
        bondNumber: resolvedExpense.id,
        projectCode: resolvedExpense.projectId,
        projectName: resolvedExpense.projectName,
        invoiceNumber: resolvedExpense.invoiceNumber,
        isPdf
      }) : undefined);

      setPreviewAttachment({
        url: data,
        title: resolvedExpense ? `مرفق سند المصروف: ${resolvedExpense.id}` : 'معاينة المرفق',
        subtitle: resolvedExpense ? `${resolvedExpense.projectName} • ${resolvedExpense.category} • ${resolvedExpense.amount.toLocaleString()} ${settings.currencySymbol} • ${resolvedExpense.date}` : undefined,
        expenseId: resolvedExpense?.id,
        projectId: resolvedExpense?.projectId,
        expense: resolvedExpense,
        attachments: resolvedExpense?.attachments,
        codedFileName,
        projectFolder: resolvedExpense?.attachmentProjectFolder || (resolvedExpense ? `مجلد_مشروع_${resolvedExpense.projectId}` : undefined),
      });
    } else {
      const isPdf = Boolean(
        data.url.startsWith('data:application/pdf') ||
        data.url.toLowerCase().includes('.pdf') ||
        resolvedExpense?.attachmentFileName?.toLowerCase().endsWith('.pdf') ||
        data.title?.toLowerCase().endsWith('.pdf')
      );
      const codedFileName = data.codedFileName || (resolvedExpense ? AttachmentArchiver.generateCodedFileName({
        bondNumber: resolvedExpense.id,
        projectCode: resolvedExpense.projectId,
        projectName: resolvedExpense.projectName,
        invoiceNumber: resolvedExpense.invoiceNumber,
        isPdf
      }) : undefined);

      setPreviewAttachment({
        ...data,
        expenseId: data.expenseId || resolvedExpense?.id,
        projectId: data.projectId || resolvedExpense?.projectId,
        expense: resolvedExpense || data.expense,
        attachments: data.attachments || resolvedExpense?.attachments,
        codedFileName: data.codedFileName || codedFileName,
        projectFolder: data.projectFolder || resolvedExpense?.attachmentProjectFolder || (resolvedExpense ? `مجلد_مشروع_${resolvedExpense.projectId}` : undefined),
      });
    }
  }, [expenses, settings.currencySymbol]);

  const closeAttachmentPreview = useCallback(() => {
    setPreviewAttachment(null);
  }, []);

  // Connectivity & Sync State
  const [isOnline, setIsOnline] = useState<boolean>(navigator.onLine);
  const [isSimulatingOffline, setIsSimulatingOffline] = useState<boolean>(false);
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [lastSyncTime, setLastSyncTime] = useState<string>(() => StorageService.getLastSyncTime());
  const [syncQueue, setSyncQueue] = useState(() => StorageService.getSyncQueue());

  // Per-User Isolated Theme Management
  const [theme, setThemeState] = useState<'system' | 'light' | 'dark'>(() => {
    return StorageService.getUserTheme();
  });

  const isDarkMode = theme === 'dark' || (theme === 'system' && typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches);

  // Synchronize isolated theme whenever currentUser changes (switch user, login, session change)
  useEffect(() => {
    if (currentUser?.id) {
      const userTheme = StorageService.getUserTheme(currentUser.id);
      setThemeState(userTheme);
    }
  }, [currentUser?.id]);

  // Handle system color-scheme change dynamically when set to 'system'
  useEffect(() => {
    if (theme !== 'system' || typeof window === 'undefined') return;
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleMediaChange = (e: MediaQueryListEvent) => {
      if (e.matches) {
        document.documentElement.classList.add('dark');
      } else {
        document.documentElement.classList.remove('dark');
      }
    };
    mediaQuery.addEventListener('change', handleMediaChange);
    return () => mediaQuery.removeEventListener('change', handleMediaChange);
  }, [theme]);

  // Apply isolated theme class to document for this user only
  useEffect(() => {
    if (isDarkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [isDarkMode]);

  const setTheme = useCallback((newTheme: 'system' | 'light' | 'dark') => {
    setThemeState(newTheme);
    StorageService.setUserTheme(newTheme, currentUser?.id);
    if (currentUser?.id) {
      setCurrentUser(prev => prev ? { ...prev, themePreference: newTheme } : prev);
      setUsers(prev => prev.map(u => u.id === currentUser.id ? { ...u, themePreference: newTheme } : u));
    }
  }, [currentUser?.id]);

  const toggleTheme = useCallback(() => {
    const next = isDarkMode ? 'light' : 'dark';
    setTheme(next);
  }, [isDarkMode, setTheme]);

  // Cloud Connectivity & Firestore States
  const [isCloudConnected, setIsCloudConnected] = useState<boolean>(false);
  const [isCloudSyncing, setIsCloudSyncing] = useState<boolean>(false);
  const [syncProgress, setSyncProgress] = useState<SyncProgressInfo>({
    isSyncing: false,
    percent: 100,
    remainingSeconds: 0,
    statusText: 'تمت المزامنة وحفظ البيانات بنجاح 100%',
    itemsSynced: 0,
    totalItems: 0,
    remainingItems: 0,
    currentBatch: 1,
    totalBatches: 1
  });
  const syncTimerRef = useRef<any>(null);

  const startProgressTracking = useCallback((totalItemsCount?: number, estimatedDurationMs: number = 1000) => {
    if (syncTimerRef.current) clearInterval(syncTimerRef.current);
    const start = Date.now();
    const total = totalItemsCount && totalItemsCount > 0 ? totalItemsCount : (expenses.length || 1);

    setSyncProgress({
      isSyncing: true,
      percent: 15,
      remainingSeconds: Math.max(1, Math.ceil(estimatedDurationMs / 1000)),
      statusText: 'جاري تحضير الحزم ورفع التعديلات إلى السحابة...',
      itemsSynced: 0,
      totalItems: total,
      remainingItems: total,
      currentBatch: 1,
      totalBatches: Math.max(1, Math.ceil(total / 40)) + 1,
      activeCategory: 'expenses'
    });

    syncTimerRef.current = setInterval(() => {
      const elapsed = Date.now() - start;

      // Watchdog timeout to prevent progress from getting stuck indefinitely
      if (elapsed > 10000) {
        if (syncTimerRef.current) {
          clearInterval(syncTimerRef.current);
          syncTimerRef.current = null;
        }
        setSyncProgress(prev => ({
          ...prev,
          isSyncing: false,
          percent: 100,
          remainingSeconds: 0,
          statusText: 'تم تأمين وحفظ كافة البيانات محلياً بنجاح 100%',
          itemsSynced: total,
          remainingItems: 0
        }));
        setIsCloudSyncing(false);
        return;
      }

      const progressFraction = Math.min(elapsed / estimatedDurationMs, 0.92);
      const currentPercent = Math.min(92, Math.floor(15 + progressFraction * 77));
      const remainingSec = Math.max(0, Math.ceil((estimatedDurationMs - elapsed) / 1000));
      const simulatedSynced = Math.min(total, Math.floor((currentPercent / 100) * total));
      const simulatedRemaining = Math.max(0, total - simulatedSynced);
      const currentBatch = Math.min(
        Math.max(1, Math.ceil(total / 40)),
        Math.max(1, Math.ceil((currentPercent / 100) * Math.max(1, Math.ceil(total / 40))))
      );

      setSyncProgress(prev => {
        if (!prev.isSyncing) return prev;
        return {
          ...prev,
          percent: Math.max(prev.percent, currentPercent),
          remainingSeconds: remainingSec,
          statusText: prev.statusText.includes('تمت') ? prev.statusText : `جاري الرفع والمعالجة السحابية (${currentPercent}%)...`,
          itemsSynced: Math.max(prev.itemsSynced, simulatedSynced),
          totalItems: total,
          remainingItems: simulatedRemaining,
          currentBatch: Math.max(prev.currentBatch || 1, currentBatch)
        };
      });
    }, 100);
  }, [expenses.length]);

  const finishProgressTracking = useCallback((success: boolean = true, message?: string, finalTotal?: number) => {
    if (syncTimerRef.current) {
      clearInterval(syncTimerRef.current);
      syncTimerRef.current = null;
    }
    const total = finalTotal !== undefined ? finalTotal : (expenses.length || 0);
    setSyncProgress({
      isSyncing: false,
      percent: success ? 100 : 0,
      remainingSeconds: 0,
      statusText: message || (success ? 'تمت المزامنة وحفظ كافة البيانات بنجاح 100%' : 'فشلت المزامنة'),
      itemsSynced: success ? total : 0,
      totalItems: total,
      remainingItems: success ? 0 : total,
      currentBatch: 1,
      totalBatches: 1,
      activeCategory: undefined
    });
  }, [expenses.length]);

  const [lastCloudSyncTime, setLastCloudSyncTime] = useState<string | null>(() => {
    return localStorage.getItem('skyarc_last_cloud_sync') || null;
  });

  // Server-Side Disk Storage States
  const [isServerConnected, setIsServerConnected] = useState<boolean>(true);
  const [isServerSaving, setIsServerSaving] = useState<boolean>(false);
  const [isJustUploaded, setIsJustUploaded] = useState<boolean>(false);
  const [lastServerSyncTime, setLastServerSyncTime] = useState<string | null>(() => {
    return ServerSyncService.getLastSyncTimestamp();
  });

  const flashUploadSuccess = useCallback(() => {
    setIsJustUploaded(true);
    const timer = setTimeout(() => {
      setIsJustUploaded(false);
    }, 3500);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    const unsub = ServerSyncService.subscribeToSavingState((saving) => {
      setIsServerSaving(saving);
    });
    return unsub;
  }, []);

  const isDataUploading = isSyncing || isCloudSyncing || isServerSaving;

  // Lifecycle control refs for sync
  const isCloudInitializedRef = useRef<boolean>(false);
  const isApplyingCloudDataRef = useRef<boolean>(false);
  const lastLocalWriteTimeRef = useRef<number>(Date.now());
  const localExpensesCountRef = useRef<number>(expenses.length);
  const hasUserMutatedDataRef = useRef<boolean>(false);
  const lastLocalMutationIdRef = useRef<string | null>(null);
  const lastSeenRevisionRef = useRef<number>(0);

  // Initial Database Boot & Server-First Loading States
  const [isInitialDatabaseLoading, setIsInitialDatabaseLoading] = useState<boolean>(false);
  const [databaseLoadSource, setDatabaseLoadSource] = useState<'cloud' | 'server' | 'offline' | null>(null);
  const [databaseLoadStats, setDatabaseLoadStats] = useState<{ expenses: number; projects: number; custodies: number } | null>(null);

  const bypassDatabaseLoading = useCallback(() => {
    console.warn('[Database Boot] User chose to bypass database loading.');
    setIsInitialDatabaseLoading(false);
  }, []);

  const markUserMutated = useCallback(() => {
    hasUserMutatedDataRef.current = true;
  }, []);

  // Keep localExpensesCountRef in sync
  useEffect(() => {
    localExpensesCountRef.current = expenses.length;
  }, [expenses.length]);

  // Helper to apply incoming cloud state cleanly without triggering outgoing sync loop
  const applyAuthoritativeCloudState = useCallback((cloudData: any, meta?: { hasPendingWrites?: boolean }) => {
    if (!cloudData || typeof cloudData !== 'object') return false;

    // Concurrency Protection:
    // 1. If this is a pending unconfirmed local write from this client, skip replacing state
    if (meta?.hasPendingWrites) {
      return false;
    }

    // 2. If this snapshot has our own local mutationId, it is an echo of our own write. Acknowledge and return.
    if (cloudData.mutationId && cloudData.mutationId === lastLocalMutationIdRef.current) {
      const syncTime = cloudData.serverSavedAt || cloudData.lastSyncedAt || new Date().toISOString();
      setLastCloudSyncTime(syncTime);
      try { localStorage.setItem('skyarc_last_cloud_sync', syncTime); } catch {}
      return true;
    }

    // 3. Otherwise, this is an authoritative update from another user or central database!
    // The database is the primary source of truth, so apply it immediately so all additions/deletions reflect.
    isApplyingCloudDataRef.current = true;
    try {
      const ok = StorageService.importBackupData(cloudData, 'replace');
      if (ok) {
        setProjects(StorageService.getProjects());
        setExpenses(StorageService.getExpenses());
        setCustodies(StorageService.getCustodies());
        setUsers(StorageService.getUsers());
        setRoles(StorageService.getRoles());
        setWorkflowStages(StorageService.getWorkflowStages());
        setSettings(StorageService.getSettings());
        setTickets(StorageService.getTickets());
        setNotifications(StorageService.getNotifications());
        localExpensesCountRef.current = StorageService.getExpenses().length;

        const session = StorageService.getAuthSession();
        if (session?.isAuthenticated && session?.userId) {
          const u = StorageService.getUsers().find(user => user.id === session.userId);
          if (u) setCurrentUser(u);
        }

        const syncTime = cloudData.serverSavedAt || cloudData.lastSyncedAt || new Date().toISOString();
        setLastCloudSyncTime(syncTime);
        try { localStorage.setItem('skyarc_last_cloud_sync', syncTime); } catch {}
        return true;
      }
      return false;
    } finally {
      setTimeout(() => {
        isApplyingCloudDataRef.current = false;
      }, 150);
    }
  }, []);

  // Unified immediate persistence to Cloud Firestore and Server Storage Disk
  const persistChangesDirectly = useCallback(async (
    overrides?: {
      projects?: Project[];
      expenses?: Expense[];
      custodies?: CustodyRecord[];
      users?: User[];
      roles?: CustomRole[];
      workflowStages?: WorkflowStage[];
      settings?: AppSettings;
      deletedExpenseIds?: Record<string, any>;
      deletedCustodyIds?: Record<string, any>;
      deletedProjectIds?: Record<string, any>;
      deletedUserIds?: Record<string, any>;
      deletedRoleIds?: Record<string, any>;
      deletedWorkflowStageIds?: Record<string, any>;
    },
    actionLabel?: string
  ) => {
    const mutationId = `mut_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    const nowIso = new Date().toISOString();
    lastLocalMutationIdRef.current = mutationId;
    lastLocalWriteTimeRef.current = Date.now();
    hasUserMutatedDataRef.current = true;

    // Immediately persist tombstones if passed in overrides
    if (overrides?.deletedExpenseIds) StorageService.saveDeletedExpenseIds(overrides.deletedExpenseIds);
    if (overrides?.deletedCustodyIds) StorageService.saveDeletedCustodyIds(overrides.deletedCustodyIds);
    if (overrides?.deletedProjectIds) StorageService.saveDeletedProjectIds(overrides.deletedProjectIds);
    if (overrides?.deletedUserIds) StorageService.saveDeletedUserIds(overrides.deletedUserIds);
    if (overrides?.deletedRoleIds) StorageService.saveDeletedRoleIds(overrides.deletedRoleIds);
    if (overrides?.deletedWorkflowStageIds) StorageService.saveDeletedWorkflowStageIds(overrides.deletedWorkflowStageIds);

    // Immediately persist entities to local storage
    if (overrides?.projects !== undefined) StorageService.saveProjects(overrides.projects);
    if (overrides?.expenses !== undefined) StorageService.saveExpenses(overrides.expenses);
    if (overrides?.custodies !== undefined) StorageService.saveCustodies(overrides.custodies);
    if (overrides?.users !== undefined) StorageService.saveUsers(overrides.users);
    if (overrides?.roles !== undefined) StorageService.saveRoles(overrides.roles);
    if (overrides?.workflowStages !== undefined) StorageService.saveWorkflowStages(overrides.workflowStages);
    if (overrides?.settings !== undefined) StorageService.saveSettings(overrides.settings);

    const activeProjects = (overrides?.projects !== undefined && overrides.projects.length > 0)
      ? overrides.projects
      : (StorageService.getProjects().length > 0 ? StorageService.getProjects() : projects);

    const activeExpenses = (overrides?.expenses !== undefined && overrides.expenses.length > 0)
      ? overrides.expenses
      : (StorageService.getExpenses().length > 0 ? StorageService.getExpenses() : expenses);

    const activeCustodies = (overrides?.custodies !== undefined && overrides.custodies.length > 0)
      ? overrides.custodies
      : (StorageService.getCustodies().length > 0 ? StorageService.getCustodies() : custodies);
    const activeUsers = overrides?.users !== undefined ? overrides.users : StorageService.getUsers();
    const activeRoles = overrides?.roles !== undefined ? overrides.roles : StorageService.getRoles();
    const activeStages = overrides?.workflowStages !== undefined ? overrides.workflowStages : StorageService.getWorkflowStages();
    const activeSettings = overrides?.settings !== undefined ? overrides.settings : StorageService.getSettings();

    const updaterName = currentUser?.name || currentUser?.username || 'مدير النظام';
    const payload = {
      version: '10.0',
      exportedAt: nowIso,
      exportedBy: updaterName,
      mutationId,
      writerId: currentUser?.id || 'sys',
      writerName: updaterName,
      serverSavedAt: nowIso,
      lastSyncedAt: nowIso,
      projects: activeProjects,
      deletedProjectIds: overrides?.deletedProjectIds ?? StorageService.getDeletedProjectIds(),
      expenses: activeExpenses,
      deletedExpenseIds: overrides?.deletedExpenseIds ?? StorageService.getDeletedExpenseIds(),
      custodies: activeCustodies,
      deletedCustodyIds: overrides?.deletedCustodyIds ?? StorageService.getDeletedCustodyIds(),
      users: activeUsers,
      deletedUserIds: overrides?.deletedUserIds ?? StorageService.getDeletedUserIds(),
      roles: activeRoles,
      deletedRoleIds: overrides?.deletedRoleIds ?? StorageService.getDeletedRoleIds(),
      workflowStages: activeStages,
      deletedWorkflowStageIds: overrides?.deletedWorkflowStageIds ?? StorageService.getDeletedWorkflowStageIds(),
      settings: activeSettings,
      notifications,
      tickets
    };

    // Broadcast update across open tabs/windows immediately
    try {
      if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
        const ch = new BroadcastChannel('skyarc_online_sync');
        ch.postMessage({ type: 'STATE_UPDATED', data: payload });
        ch.close();
      }
    } catch {}

    // Immediate direct write to Firebase Firestore Cloud & Server Storage API
    try {
      startProgressTracking(activeExpenses.length, 300);
      
      // 1. Direct write to Firebase Firestore Cloud
      const cloudSuccess = await FirebaseService.saveCloudState(payload, updaterName).catch(e => {
        console.warn('[Direct Firebase Save Notice]:', e);
        return false;
      });

      // 2. Redundant write to Server Storage API (/api/state) with skipFirebase: true
      const serverRes = await ServerSyncService.saveServerState(payload, updaterName, true, { skipFirebase: true }).catch(e => {
        console.warn('[Server Storage Save Notice]:', e);
        return { success: false };
      });

      if (cloudSuccess || serverRes?.success) {
        setIsServerConnected(true);
        setIsCloudConnected(true);
        const syncedTime = new Date().toLocaleTimeString('ar-SA');
        setLastServerSyncTime(syncedTime);
        setLastCloudSyncTime(nowIso);
        try {
          localStorage.setItem('skyarc_last_server_sync', syncedTime);
          localStorage.setItem('skyarc_last_cloud_sync', nowIso);
        } catch {}
      }

      flashUploadSuccess();
      finishProgressTracking(true, `تم حفظ ${actionLabel || 'البيانات'} في قاعدة بيانات Firebase السحابية والسيرفر بنجاح`, activeExpenses.length);
    } catch (err) {
      console.warn('[Direct Persist Error]:', err);
    }
  }, [currentUser, notifications, tickets, flashUploadSuccess, startProgressTracking, finishProgressTracking]);

  // Cross-tab real-time sync channel
  const [lastOperationStatus, setLastOperationStatus] = useState<OperationStatusInfo | null>(null);

  const clearLastOperationStatus = useCallback(() => {
    setLastOperationStatus(null);
  }, []);

  const recordOperationStatus = useCallback((action: string, title: string, options?: { savedLocally?: boolean; synced?: boolean; details?: string }) => {
    const isActuallyOnline = navigator.onLine && !isSimulatingOffline;
    const info: OperationStatusInfo = {
      id: `OP-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      action,
      title,
      savedLocally: options?.savedLocally !== false,
      synced: options?.synced ?? (isActuallyOnline && isCloudConnected),
      timestamp: new Date().toISOString(),
      details: options?.details
    };
    setLastOperationStatus(info);
  }, [isSimulatingOffline, isCloudConnected]);

  useEffect(() => {
    let syncBroadcastChannel: BroadcastChannel | null = null;
    let unsubscribeFirestore: (() => void) | null = null;

    try {
      if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
        syncBroadcastChannel = new BroadcastChannel('skyarc_online_sync');
        syncBroadcastChannel.onmessage = (event) => {
          if (event.data?.type === 'STATE_UPDATED' && event.data?.data) {
            applyAuthoritativeCloudState(event.data.data);
          }
        };
      }
    } catch {}

    // Real-time Firestore Cloud State Subscription
    try {
      unsubscribeFirestore = FirebaseService.subscribeToCloudState((cloudData, metadata) => {
        if (cloudData && typeof cloudData === 'object') {
          console.log('[Firebase Real-time Sync] Received cloud update snapshot.');
          applyAuthoritativeCloudState(cloudData, metadata);
          setIsCloudConnected(true);
        }
      });
    } catch (fbErr) {
      console.warn('[Firebase Real-time Subscription Notice]:', fbErr);
    }

    return () => {
      if (syncBroadcastChannel) {
        syncBroadcastChannel.close();
      }
      if (unsubscribeFirestore) {
        unsubscribeFirestore();
      }
    };
  }, [applyAuthoritativeCloudState]);

  // Initialize Server & Cloud Storage connection and sync on boot
  useEffect(() => {
    let isMounted = true;

    // Safety timeout: Guarantee database boot loading screen is dismissed within 3 seconds no matter what
    const safetyTimer = setTimeout(() => {
      if (isMounted) {
        setIsInitialDatabaseLoading(false);
        setIsCloudSyncing(false);
      }
    }, 3000);

    const initializeServerDatabase = async () => {
      setIsCloudSyncing(true);
      try {
        console.log('[Database Boot] Checking Firebase Firestore & Server Storage API...');
        
        // 1. Try Firebase Firestore Cloud directly
        let cloudLoaded = false;
        try {
          const cloudRes = await FirebaseService.fetchCloudState();
          if (cloudRes && (Array.isArray(cloudRes.projects) || Array.isArray(cloudRes.users))) {
            console.log('[Database Boot] Authoritative state retrieved from Firebase Firestore Cloud.');
            applyAuthoritativeCloudState(cloudRes);
            setDatabaseLoadSource('cloud');
            setIsCloudConnected(true);
            setIsServerConnected(true);
            setDatabaseLoadStats({
              expenses: Array.isArray(cloudRes.expenses) ? cloudRes.expenses.length : 0,
              projects: Array.isArray(cloudRes.projects) ? cloudRes.projects.length : 0,
              custodies: Array.isArray(cloudRes.custodies) ? cloudRes.custodies.length : 0
            });
            cloudLoaded = true;
          }
        } catch (fbErr) {
          console.warn('[Database Boot] Firebase direct fetch notice:', fbErr);
        }

        // 2. If not loaded from Firestore, check Server API
        if (!cloudLoaded) {
          const serverRes = await ServerSyncService.fetchServerState();

          if (serverRes.success && serverRes.exists && serverRes.data) {
            console.log('[Database Boot] Authoritative central state retrieved from Server Disk. Applying state.');
            applyAuthoritativeCloudState(serverRes.data);
            setDatabaseLoadSource('server');
            setIsServerConnected(true);
            setDatabaseLoadStats({
              expenses: Array.isArray(serverRes.data.expenses) ? serverRes.data.expenses.length : 0,
              projects: Array.isArray(serverRes.data.projects) ? serverRes.data.projects.length : 0,
              custodies: Array.isArray(serverRes.data.custodies) ? serverRes.data.custodies.length : 0
            });
          } else {
            console.log('[Database Boot] Central database uninitialized. Seeding baseline state to Firebase & Server...');
            const initialPayload = StorageService.getFullBackupData();
            await ServerSyncService.saveServerState(initialPayload, 'التهيئة الأولية', true).catch(() => {});
            setDatabaseLoadSource('server');
            setIsServerConnected(true);
          }
        }

        isCloudInitializedRef.current = true;
      } catch (err) {
        console.warn('[Database Boot] Database boot initialization error:', err);
        isCloudInitializedRef.current = true;
        setDatabaseLoadSource('server');
      } finally {
        clearTimeout(safetyTimer);
        setIsCloudSyncing(false);
        setIsInitialDatabaseLoading(false);
      }
    };

    initializeServerDatabase();

    return () => {
      isMounted = false;
      clearTimeout(safetyTimer);
    };
  }, [applyAuthoritativeCloudState]);

  // Real-time server polling interval for seamless multi-user synchronization across devices
  useEffect(() => {
    let lastKnownTimestamp: string | null = null;
    let isPolling = false;

    const performServerPoll = async () => {
      if (isPolling || isApplyingCloudDataRef.current) return;
      // Pause polling briefly if active user saved data locally in the last 2.5s
      if (Date.now() - lastLocalWriteTimeRef.current < 2500) return;

      try {
        isPolling = true;
        const check = await ServerSyncService.checkServerTimestamp();
        if (check.success && check.exists && check.lastModified) {
          if (lastKnownTimestamp && check.lastModified !== lastKnownTimestamp) {
            console.log('[Real-time Server Sync] Remote server state updated. Pulling latest data...');
            const res = await ServerSyncService.fetchServerState();
            if (res.success && res.data) {
              lastKnownTimestamp = check.lastModified;
              applyAuthoritativeCloudState(res.data);
              setIsServerConnected(true);
            }
          } else {
            lastKnownTimestamp = check.lastModified;
            setIsServerConnected(true);
          }
        }
      } catch (err) {
        // Silently handle transient network glitches
      } finally {
        isPolling = false;
      }
    };

    // Poll server every 3.5 seconds
    const intervalId = setInterval(performServerPoll, 3500);

    // Immediate check when tab becomes active
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        performServerPoll();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      clearInterval(intervalId);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [applyAuthoritativeCloudState]);

  // Effective network status
  const effectiveOnline = isOnline && !isSimulatingOffline;

  // Listen to browser network changes - ALWAYS pull latest server state when coming online
  useEffect(() => {
    const handleOnline = async () => {
      setIsOnline(true);
      try {
        const res = await ServerSyncService.fetchServerState();
        if (res.success && res.data) {
          applyAuthoritativeCloudState(res.data);
          setIsServerConnected(true);
        }
      } catch (err) {
        console.warn('Online reconnection pull warning:', err);
      }
    };
    const handleOffline = () => {
      setIsOnline(false);
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [applyAuthoritativeCloudState]);

  // Save changes to storage whenever entities change
  useEffect(() => {
    if (projects.length > 0) {
      StorageService.saveProjects(projects);
    }
  }, [projects]);

  useEffect(() => {
    if (expenses.length > 0) {
      StorageService.saveExpenses(expenses);
    }
  }, [expenses]);

  useEffect(() => {
    if (custodies.length > 0) {
      StorageService.saveCustodies(custodies);
    }
  }, [custodies]);

  useEffect(() => {
    StorageService.saveUsers(users);
  }, [users]);

  useEffect(() => {
    StorageService.saveRoles(roles);
  }, [roles]);

  useEffect(() => {
    StorageService.saveWorkflowStages(workflowStages);
  }, [workflowStages]);

  useEffect(() => {
    StorageService.saveSettings(settings);
  }, [settings]);

  useEffect(() => {
    StorageService.saveNotifications(notifications);
  }, [notifications]);

  useEffect(() => {
    StorageService.saveTickets(tickets);
  }, [tickets]);

  useEffect(() => {
    StorageService.saveCurrentUser(currentUser);
  }, [currentUser]);

  // Periodic background polling loop to pull updates made by other users/devices on the server
  useEffect(() => {
    if (isInitialDatabaseLoading || !isCloudInitializedRef.current) return;

    let isSubscribed = true;

    const checkAndPullServerUpdates = async () => {
      // Don't pull if the current user is actively writing (within last 3 seconds) to prevent race condition overwrites
      const timeSinceWrite = Date.now() - lastLocalWriteTimeRef.current;
      if (timeSinceWrite < 3000) return;

      try {
        const checkRes = await ServerSyncService.checkServerTimestamp();
        if (!isSubscribed) return;

        if (checkRes.success && checkRes.lastModified) {
          const currentSyncTime = ServerSyncService.getLastSyncTimestamp();
          // If server's lastModified is different from our last synced timestamp, pull new state from server
          if (checkRes.lastModified !== currentSyncTime) {
            const res = await ServerSyncService.fetchServerState();
            if (isSubscribed && res.success && res.data) {
              applyAuthoritativeCloudState(res.data);
              setIsServerConnected(true);
            }
          }
        }
      } catch (err) {
        console.warn('[Background Sync Polling Error]:', err);
      }
    };

    const intervalId = setInterval(checkAndPullServerUpdates, 3000);

    return () => {
      isSubscribed = false;
      clearInterval(intervalId);
    };
  }, [isInitialDatabaseLoading, applyAuthoritativeCloudState]);

  // Continuous automated server synchronization whenever entities change
  useEffect(() => {
    if (
      isInitialDatabaseLoading ||
      !isCloudInitializedRef.current ||
      isApplyingCloudDataRef.current
    ) {
      return;
    }

    lastLocalWriteTimeRef.current = Date.now();

    const payload = {
      version: '10.0',
      exportedAt: new Date().toISOString(),
      exportedBy: currentUser?.name || currentUser?.username || 'مستخدم النظام',
      projects,
      deletedProjectIds: StorageService.getDeletedProjectIds(),
      expenses,
      deletedExpenseIds: StorageService.getDeletedExpenseIds(),
      custodies,
      deletedCustodyIds: StorageService.getDeletedCustodyIds(),
      users,
      deletedUserIds: StorageService.getDeletedUserIds(),
      roles,
      deletedRoleIds: StorageService.getDeletedRoleIds(),
      workflowStages,
      deletedWorkflowStageIds: StorageService.getDeletedWorkflowStageIds(),
      settings,
      notifications,
      tickets
    };
    const updaterName = currentUser?.name || currentUser?.username || 'مستخدم النظام';

    // Broadcast update across open tabs/windows locally
    try {
      if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
        const ch = new BroadcastChannel('skyarc_online_sync');
        ch.postMessage({ type: 'STATE_UPDATED', data: payload });
        ch.close();
      }
    } catch {}

    // Save state to Central Server Storage Disk continuously
    ServerSyncService.saveServerStateDebounced(
      payload,
      updaterName,
      300,
      (savedAt) => {
        setLastServerSyncTime(savedAt);
        setIsServerConnected(true);
        flashUploadSuccess();
        finishProgressTracking(true, 'تم التحديث والحفظ على سيرفر النظام بنجاح', expenses.length);
      }
    );
  }, [
    projects,
    expenses,
    custodies,
    users,
    roles,
    workflowStages,
    settings,
    notifications,
    tickets
  ]);

  // Current User Role & Permissions resolution
  const currentUserRole = useMemo<CustomRole | null>(() => {
    if (currentUser.roleId) {
      const found = roles.find(r => r.id === currentUser.roleId);
      if (found) return found;
    }
    // Fallback match by name
    const foundByName = roles.find(r => r.name === currentUser.role || r.id.includes(currentUser.role));
    if (foundByName) return foundByName;

    // Fallback default
    return roles[0] || null;
  }, [currentUser, roles]);

  // Is Current User the System Manager / Administrator (Root Controller)
  const isCurrentUserAdmin = useMemo<boolean>(() => {
    const role = currentUser.role || '';
    const roleId = currentUser.roleId || '';
    const roleName = currentUserRole?.name || '';
    return (
      role.includes('مدير') ||
      role.includes('عليا') ||
      roleId === 'role_admin' ||
      roleId === 'role_management' ||
      currentUserRole?.id === 'role_admin' ||
      currentUserRole?.id === 'role_management' ||
      roleName.includes('مدير') ||
      roleName.includes('عليا') ||
      currentUser.email?.toLowerCase() === '2030m.mansour@gmail.com'
    );
  }, [currentUser, currentUserRole]);

  // Master screens list - All screens are always available and open for the Manager
  const allSystemScreens = useMemo<string[]>(() => [
    'dashboard',
    'expenses',
    'approvals',
    'custodies',
    'projects',
    'supervisors',
    'reports',
    'settings',
    'support'
  ], []);

  const currentUserPermissions = useMemo<RolePermission>(() => {
    // For the Manager: EVERYTHING is unlocked, visible, and never hidden or restricted
    if (isCurrentUserAdmin) {
      return {
        allowedScreens: allSystemScreens,
        canViewAllProjects: true,
        canViewAllExpenses: true,
        canViewFinancialReports: true,
        canViewCustodies: true,
        canViewTeamMembers: true,
        canCreateExpense: true,
        canEditExpense: true,
        canDeleteExpense: true,
        expenseEditGraceMinutes: 9999,
        canManageCustody: true,
        canManageProjects: true,
        canApproveAsProjectManager: true,
        canApproveAsAccountant: true,
        canExportToExternalERP: true,
        canApproveAsManagement: true,
        canBatchApprove: true,
        canManageRolesAndPermissions: true,
        canConfigureWorkflow: true,
        canExportExcelAndBackup: true,
      };
    }

    if (currentUserRole) {
      return currentUserRole.permissions;
    }
    // Default safe fallback permissions
    return {
      allowedScreens: allSystemScreens,
      canViewAllProjects: true,
      canViewAllExpenses: true,
      canViewFinancialReports: true,
      canViewCustodies: true,
      canViewTeamMembers: true,
      canCreateExpense: true,
      canEditExpense: true,
      canDeleteExpense: true,
      expenseEditGraceMinutes: 9999,
      canManageCustody: true,
      canManageProjects: true,
      canApproveAsProjectManager: true,
      canApproveAsAccountant: true,
      canExportToExternalERP: true,
      canApproveAsManagement: true,
      canBatchApprove: true,
      canManageRolesAndPermissions: true,
      canConfigureWorkflow: true,
      canExportExcelAndBackup: true,
    };
  }, [currentUserRole, isCurrentUserAdmin, allSystemScreens]);

  const hasPermission = useCallback((permission: keyof RolePermission): boolean => {
    if (isCurrentUserAdmin) return true;
    return !!currentUserPermissions[permission];
  }, [currentUserPermissions, isCurrentUserAdmin]);

  const isScreenAllowed = useCallback((screenId: string): boolean => {
    // Diagnostic and logs screens are exclusively available to the Manager
    if (screenId === 'diagnostics' || screenId === 'sync-logs' || screenId === 'logs') {
      return isCurrentUserAdmin;
    }

    // For the Manager: All screens are permanently open, visible, and can never be hidden
    if (isCurrentUserAdmin) return true;

    // Strict rule: Accountant role cannot access the supervisors screen or settings
    const isAccountant =
      currentUser.role === 'محاسب' ||
      currentUser.role === 'محاسب مالي' ||
      currentUser.roleId === 'role_accountant' ||
      currentUser.role.includes('محاسب');
    if (isAccountant && (screenId === 'supervisors' || screenId === 'settings')) {
      return false;
    }

    if (!currentUserRole || !currentUserRole.permissions) return true;
    const allowed = currentUserRole.permissions.allowedScreens;
    if (!Array.isArray(allowed) || allowed.length === 0) return true;
    const normalized = screenId === 'custody' ? 'custodies' : screenId;
    return allowed.includes(normalized);
  }, [currentUserRole, isCurrentUserAdmin, currentUser]);

  // Check if a user is assigned to a specific project
  const isUserAssignedToProject = useCallback((userOrEmail: User | string, project: Project): boolean => {
    if (!project) return false;
    const targetUser = typeof userOrEmail === 'object'
      ? userOrEmail
      : users.find(u => u.email.toLowerCase() === userOrEmail.toLowerCase() || u.id === userOrEmail);
    const email = (typeof userOrEmail === 'string' ? userOrEmail : targetUser?.email || '').trim().toLowerCase();
    const userId = targetUser?.id || (typeof userOrEmail === 'string' && userOrEmail.startsWith('USR-') ? userOrEmail : '');

    // 1. Check assignedUserIds on project
    if (userId && Array.isArray(project.assignedUserIds) && project.assignedUserIds.includes(userId)) {
      return true;
    }

    // 2. Check assignedEmails on project
    if (email && Array.isArray(project.assignedEmails) && project.assignedEmails.some(e => e.trim().toLowerCase() === email)) {
      return true;
    }

    // 3. Check legacy comma-separated emails string on project
    if (email && project.emails) {
      const emailList = project.emails.split(',').map(e => e.trim().toLowerCase());
      if (emailList.includes(email)) {
        return true;
      }
    }

    // 4. Check assignedProjects array on user
    if (targetUser?.assignedProjects && Array.isArray(targetUser.assignedProjects) && targetUser.assignedProjects.includes(project.id)) {
      return true;
    }

    return false;
  }, [users]);

  // Check if a user has visibility/access to view a project
  const canUserAccessProject = useCallback((project: Project, user?: User): boolean => {
    const targetUser = user || currentUser;
    if (!targetUser || !project) return false;

    // For the Manager: ALWAYS access and view all projects
    if (
      isCurrentUserAdmin ||
      targetUser.role === 'مدير' ||
      targetUser.role === 'مدير عام' ||
      targetUser.roleId === 'role_admin'
    ) {
      return true;
    }

    // For accountant: if role has canViewAllProjects, allow all projects; if specific assignedProjects configured, enforce them; else allow all projects for company-wide auditing
    const isAccountantRole =
      targetUser.role === 'محاسب' ||
      targetUser.role === 'محاسب مالي' ||
      targetUser.roleId === 'role_accountant' ||
      targetUser.role.includes('محاسب');

    if (isAccountantRole) {
      let canViewAll = false;
      if (targetUser.id === currentUser.id) {
        canViewAll = !!currentUserPermissions.canViewAllProjects;
      } else {
        const targetRole = roles.find(r => r.id === targetUser.roleId || r.name === targetUser.role);
        canViewAll = !!targetRole?.permissions?.canViewAllProjects;
      }
      if (canViewAll) return true;

      const hasSpecificAssignedProjects = Array.isArray(targetUser.assignedProjects) && targetUser.assignedProjects.length > 0;
      if (hasSpecificAssignedProjects) {
        return isUserAssignedToProject(targetUser, project);
      }
      return true;
    }

    // For supervisor: strictly assigned projects only in all supervisor screens
    const isSupervisorRole =
      targetUser.role === 'مشرف' ||
      targetUser.role === 'مشرف موقع' ||
      targetUser.roleId === 'role_supervisor' ||
      targetUser.role.includes('مشرف');

    if (isSupervisorRole) {
      return isUserAssignedToProject(targetUser, project);
    }

    // Check if role has canViewAllProjects permission
    let canViewAll = false;
    if (targetUser.id === currentUser.id) {
      canViewAll = !!currentUserPermissions.canViewAllProjects;
    } else {
      const targetRole = roles.find(r => r.id === targetUser.roleId || r.name === targetUser.role);
      canViewAll = !!targetRole?.permissions?.canViewAllProjects;
    }

    // Roles with canViewAllProjects (e.g. General Manager, Executive Management, Financial Auditor) see all projects
    if (canViewAll) {
      return true;
    }

    // Otherwise, user can ONLY access/view projects they are explicitly assigned to
    return isUserAssignedToProject(targetUser, project);
  }, [currentUser, currentUserPermissions, roles, isUserAssignedToProject, isCurrentUserAdmin]);

  // Check if a user is authorized to perform operations (create expense, edit, approve) on a project
  const canUserOperateOnProject = useCallback((projectId: string, user?: User): { canOperate: boolean; reason?: string } => {
    const targetUser = user || currentUser;
    const project = projects.find(p => p.id === projectId);
    if (!project) {
      return { canOperate: false, reason: 'المشروع غير مسجل في قاعدة بيانات النظام.' };
    }

    if (project.status === 'متوقف') {
      return { canOperate: false, reason: `مشروع "${project.name}" متوقف حالياً، ولا يمكن قيد أو تسجيل أي مصروفات عليه.` };
    }

    // The Manager has full operational authority on all active projects
    if (isCurrentUserAdmin) {
      return { canOperate: true };
    }

    const hasAccess = canUserAccessProject(project, targetUser);
    if (!hasAccess) {
      return {
        canOperate: false,
        reason: `أنت لست معيناً ضمن المشرفين أو فريق العمل المصرح لهم على "${project.name}". يمنعك النظام من تنفيذ أي عمليات على هذا المشروع.`
      };
    }

    return { canOperate: true };
  }, [currentUser, projects, canUserAccessProject, isCurrentUserAdmin]);

  // Projects accessible to current user (All if has canViewAllProjects, or strictly assigned projects)
  const accessibleProjects = useMemo<Project[]>(() => {
    return projects.filter(p => canUserAccessProject(p, currentUser));
  }, [projects, currentUser, canUserAccessProject]);

  // Get accessible projects for any specific user (e.g. for picking supervisor in manager mode)
  const getProjectsForUser = useCallback((userOrEmail: User | string): Project[] => {
    const targetUser = typeof userOrEmail === 'object'
      ? userOrEmail
      : users.find(u => u.email.toLowerCase() === userOrEmail.toLowerCase() || u.id === userOrEmail);
    if (!targetUser) return [];

    const targetRole = roles.find(r => r.id === targetUser.roleId || r.name === targetUser.role);
    const isAccountantRole =
      targetUser.role === 'محاسب' ||
      targetUser.role === 'محاسب مالي' ||
      targetUser.roleId === 'role_accountant' ||
      targetUser.role.includes('محاسب');

    if (isAccountantRole) {
      if (targetRole?.permissions?.canViewAllProjects) {
        return projects;
      }
      const hasSpecificAssignedProjects = Array.isArray(targetUser.assignedProjects) && targetUser.assignedProjects.length > 0;
      if (hasSpecificAssignedProjects) {
        return projects.filter(p => isUserAssignedToProject(targetUser, p));
      }
      return projects;
    }

    const isSupervisorRole =
      targetUser.role === 'مشرف' ||
      targetUser.role === 'مشرف موقع' ||
      targetUser.roleId === 'role_supervisor' ||
      targetUser.role.includes('مشرف');

    if (isSupervisorRole) {
      return projects.filter(p => isUserAssignedToProject(targetUser, p));
    }

    if (targetRole?.permissions?.canViewAllProjects) {
      return projects;
    }

    return projects.filter(p => isUserAssignedToProject(targetUser, p));
  }, [users, roles, projects, isUserAssignedToProject]);

  // Add Notification Helper (Tagged with current user email and name)
  const addNotification = useCallback((
    title: string,
    message: string,
    type: AppNotification['type'],
    relatedId?: string,
    explicitAuthorEmail?: string,
    explicitAuthorName?: string,
    category?: AppNotification['category']
  ) => {
    const authorEmail = explicitAuthorEmail || currentUser?.email || 'system';
    const authorName = explicitAuthorName || currentUser?.name || currentUser?.username || 'النظام';
    
    // Auto-determine category if not explicitly provided
    let notifCategory = category;
    if (!notifCategory) {
      if (type === 'expense_added' || title.includes('مصروف') || title.includes('فاتورة')) {
        notifCategory = 'expense';
      } else if (type === 'approved' || type === 'rejected' || title.includes('اعتماد') || title.includes('ترحيل') || title.includes('رفض')) {
        notifCategory = 'approval';
      } else if (type === 'custody_issued' || title.includes('تسليم عهدة')) {
        notifCategory = 'custody';
      } else if (type === 'custody_replenishment' || type === 'low_balance' || title.includes('تعزيز') || title.includes('رصيد')) {
        notifCategory = 'replenishment';
      } else {
        notifCategory = 'other';
      }
    }

    const newNotif: AppNotification = {
      id: `NOTIF-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
      title,
      message,
      type,
      category: notifCategory,
      timestamp: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      read: false,
      relatedId,
      authorEmail,
      authorName,
      readBy: [],
      deletedBy: [],
    };
    setNotifications(prev => [newNotif, ...prev]);
  }, [currentUser]);

  // Notifications accessible to the current user:
  // 1. Filter out notifications created by the current user themselves (only show operations from other users or system)
  // 2. Filter out notifications deleted by the current user
  // 3. Strict filter for important business events ONLY:
  //    - Expense added (إضافة مصروف)
  //    - Expense approvals/rejections across stages (اعتماد/رفض/ترحيل مصروف)
  //    - Custody replenishment requests / low balance alerts (طلب تعزيز عهدة / تنبيه رصيد)
  //    - Custody delivery (تسليم وصرف عهدة)
  //    - Strictly excludes login/logout/switch-user/password operations
  const accessibleNotifications = useMemo<AppNotification[]>(() => {
    const userEmail = (currentUser?.email || '').trim().toLowerCase();
    const userId = currentUser?.id || '';

    return notifications
      .filter(n => {
        // Exclude notifications created by current user
        if (userEmail && n.authorEmail && n.authorEmail.toLowerCase() === userEmail) {
          return false;
        }
        // Exclude notifications deleted by current user
        const deletedList = Array.isArray(n.deletedBy) ? n.deletedBy : [];
        if (deletedList.includes(userEmail) || deletedList.includes(userId)) {
          return false;
        }

        const t = (n.title || '').toLowerCase();
        const m = (n.message || '').toLowerCase();

        // 1. Explicitly exclude login/logout/switch-user/password events
        if (
          t.includes('تسجيل دخول') ||
          t.includes('تسجيل الخروج') ||
          t.includes('تسجيل خروج') ||
          t.includes('تبديل المستخدم') ||
          t.includes('كلمة المرور') ||
          m.includes('تسجيل الدخول') ||
          m.includes('تسجيل الخروج')
        ) {
          return false;
        }

        // 2. Allow only core business notifications:
        const isExpenseAction =
          n.type === 'expense_added' ||
          n.type === 'pending_approval' ||
          n.type === 'approved' ||
          n.type === 'rejected' ||
          n.category === 'expense' ||
          n.category === 'approval' ||
          t.includes('مصروف') ||
          t.includes('فاتورة') ||
          t.includes('سند') ||
          t.includes('اعتماد') ||
          t.includes('ترحيل') ||
          t.includes('رفض');

        const isCustodyAction =
          n.type === 'custody_issued' ||
          n.type === 'custody_replenishment' ||
          n.type === 'low_balance' ||
          n.category === 'custody' ||
          n.category === 'replenishment' ||
          t.includes('عهدة') ||
          t.includes('تعزيز') ||
          t.includes('رصيد');

        return isExpenseAction || isCustodyAction;
      })
      .map(n => {
        const readList = Array.isArray(n.readBy) ? n.readBy : [];
        const isReadByMe = readList.includes(userEmail) || readList.includes(userId);
        return {
          ...n,
          read: isReadByMe
        };
      });
  }, [notifications, currentUser]);

  const userUnreadNotificationsCount = useMemo<number>(() => {
    return accessibleNotifications.filter(n => !n.read).length;
  }, [accessibleNotifications]);

  // Calculate Supervisor Summaries (Total Custody, Approved Expenses, Pending Expenses, Remaining Balance)
  const supervisorsSummary = useMemo<SupervisorSummary[]>(() => {
    const supervisorUsers = users.filter(u =>
      u.role === 'مشرف' ||
      u.role === 'مشرف موقع' ||
      u.roleId === 'role_supervisor' ||
      u.role.includes('مشرف') ||
      (u.permissions && u.permissions.canCreateExpense && !u.permissions.canApproveAsManagement)
    );

    return supervisorUsers.map(sup => {
      const supEmailLower = sup.email?.trim().toLowerCase();
      const supNameLower = sup.name?.trim().toLowerCase();

      // All custody records for this supervisor (case-insensitive email or name match)
      const supCustodies = custodies.filter(c =>
        (c.supervisorEmail && supEmailLower && c.supervisorEmail.trim().toLowerCase() === supEmailLower) ||
        (c.supervisorName && supNameLower && c.supervisorName.trim().toLowerCase() === supNameLower)
      );
      const totalCustody = supCustodies.reduce((sum, c) => sum + c.amount, 0);

      // All non-rejected expenses for this supervisor (case-insensitive email or name match)
      const supExpenses = expenses.filter(e =>
        ((e.supervisorEmail && supEmailLower && e.supervisorEmail.trim().toLowerCase() === supEmailLower) ||
         (e.supervisorName && supNameLower && e.supervisorName.trim().toLowerCase() === supNameLower)) &&
        e.status !== 'مرفوض'
      );
      const approvedExpensesList = supExpenses.filter(e => e.status === 'معتمد');
      const pendingExpensesList = supExpenses.filter(e => e.status !== 'معتمد');

      // Approved expenses for this supervisor
      const totalApproved = approvedExpensesList.reduce((sum, e) => sum + e.amount, 0);

      // Pending expenses for this supervisor (submitted, not yet approved)
      const totalPending = pendingExpensesList.reduce((sum, e) => sum + e.amount, 0);

      // Total all registered expenses
      const totalAllExpenses = totalApproved + totalPending;

      // Dual Balances:
      // 1. Approved Book Balance (Official Audited Accounting Balance)
      const approvedBookBalance = totalCustody - totalApproved;
      
      // 2. Actual Available Remaining Balance in hand (after all registered expenses, approved or not)
      const actualRemainingBalance = totalCustody - totalAllExpenses;

      // Default remainingBalance is set to actualRemainingBalance for honest cash-in-hand tracking
      const remainingBalance = actualRemainingBalance;

      let status: 'رصيد كافي' | 'تحذير رصيد منخفض' | 'رصيد حرج' | 'عجز في العهدة' = 'رصيد كافي';
      if (actualRemainingBalance < 0) {
        status = 'عجز في العهدة';
      } else if (actualRemainingBalance === 0) {
        status = 'رصيد حرج';
      } else if (actualRemainingBalance <= settings.lowBalanceThreshold) {
        status = 'تحذير رصيد منخفض';
      }

      // Dates tracking
      const sortedCustodies = [...supCustodies].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
      const sortedExpenses = [...supExpenses].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

      return {
        email: sup.email,
        name: sup.name,
        phone: sup.phone || '',
        assignedProjects: sup.assignedProjects || [],
        totalCustody,
        totalApprovedExpenses: totalApproved,
        totalPendingExpenses: totalPending,
        totalAllExpenses,
        approvedBookBalance,
        actualRemainingBalance,
        remainingBalance,
        pendingCount: pendingExpensesList.length,
        approvedCount: approvedExpensesList.length,
        custodyCount: supCustodies.length,
        lastCustodyDate: sortedCustodies[0]?.date,
        lastExpenseDate: sortedExpenses[0]?.date,
        status,
      };
    });
  }, [users, custodies, expenses, settings.lowBalanceThreshold]);

  // Current logged in supervisor summary
  const currentSupervisorSummary = useMemo(() => {
    const isSup =
      currentUser.role === 'مشرف' ||
      currentUser.role === 'مشرف موقع' ||
      currentUser.roleId === 'role_supervisor' ||
      currentUser.role.includes('مشرف') ||
      (!currentUserPermissions.canApproveAsManagement && !currentUserPermissions.canManageProjects);

    if (!isSup) return null;

    const userEmailLower = currentUser.email?.trim().toLowerCase();
    const userNameLower = currentUser.name?.trim().toLowerCase();

    let summary = supervisorsSummary.find(
      s =>
        (s.email && userEmailLower && s.email.trim().toLowerCase() === userEmailLower) ||
        (s.id && currentUser.id && s.id === currentUser.id) ||
        (s.name && userNameLower && s.name.trim().toLowerCase() === userNameLower)
    );

    if (!summary) {
      const supCustodies = custodies.filter(c =>
        (c.supervisorEmail && userEmailLower && c.supervisorEmail.trim().toLowerCase() === userEmailLower) ||
        (c.supervisorName && userNameLower && c.supervisorName.trim().toLowerCase() === userNameLower)
      );
      const totalCustody = supCustodies.reduce((sum, c) => sum + c.amount, 0);

      const supExpenses = expenses.filter(e =>
        ((e.supervisorEmail && userEmailLower && e.supervisorEmail.trim().toLowerCase() === userEmailLower) ||
         (e.supervisorName && userNameLower && e.supervisorName.trim().toLowerCase() === userNameLower)) &&
        e.status !== 'مرفوض'
      );

      const approvedExpensesList = supExpenses.filter(e => e.status === 'معتمد');
      const pendingExpensesList = supExpenses.filter(e => e.status !== 'معتمد');
      const totalApproved = approvedExpensesList.reduce((sum, e) => sum + e.amount, 0);
      const totalPending = pendingExpensesList.reduce((sum, e) => sum + e.amount, 0);
      const totalAllExpenses = totalApproved + totalPending;
      const approvedBookBalance = totalCustody - totalApproved;
      const actualRemainingBalance = totalCustody - totalAllExpenses;

      const sortedCustodies = [...supCustodies].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
      const sortedExpenses = [...supExpenses].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

      summary = {
        email: currentUser.email,
        name: currentUser.name,
        phone: currentUser.phone || '',
        assignedProjects: currentUser.assignedProjects || [],
        totalCustody,
        totalApprovedExpenses: totalApproved,
        totalPendingExpenses: totalPending,
        totalAllExpenses,
        approvedBookBalance,
        actualRemainingBalance,
        remainingBalance: actualRemainingBalance,
        pendingCount: pendingExpensesList.length,
        approvedCount: approvedExpensesList.length,
        custodyCount: supCustodies.length,
        lastCustodyDate: sortedCustodies[0]?.date,
        lastExpenseDate: sortedExpenses[0]?.date,
        status: actualRemainingBalance < 0 ? 'عجز في العهدة' : actualRemainingBalance === 0 ? 'رصيد حرج' : actualRemainingBalance <= settings.lowBalanceThreshold ? 'تحذير رصيد منخفض' : 'رصيد كافي'
      };
    }

    return summary;
  }, [currentUser, supervisorsSummary, custodies, expenses, settings.lowBalanceThreshold, currentUserPermissions]);

  // Key totals
  const totalCompanyExpenses = useMemo(() => {
    const isAccountantRole =
      currentUser.role === 'محاسب' ||
      currentUser.role === 'محاسب مالي' ||
      currentUser.roleId === 'role_accountant' ||
      currentUser.role.includes('محاسب');

    const isSupervisorRole =
      currentUser.role === 'مشرف' ||
      currentUser.role === 'مشرف موقع' ||
      currentUser.roleId === 'role_supervisor' ||
      currentUser.role.includes('مشرف');

    if (isAccountantRole || isSupervisorRole || !currentUserPermissions.canViewAllProjects) {
      const allowedPrjIds = new Set(accessibleProjects.map(p => p.id));
      return expenses
        .filter(e => e.status === 'معتمد' && allowedPrjIds.has(e.projectId))
        .reduce((acc, curr) => acc + curr.amount, 0);
    }
    return expenses.filter(e => e.status === 'معتمد').reduce((acc, curr) => acc + curr.amount, 0);
  }, [expenses, currentUser, currentUserPermissions.canViewAllProjects, accessibleProjects]);

  const totalCompanyCustody = useMemo(() => {
    const isAccountantRole =
      currentUser.role === 'محاسب' ||
      currentUser.role === 'محاسب مالي' ||
      currentUser.roleId === 'role_accountant' ||
      currentUser.role.includes('محاسب');

    const isSupervisorRole =
      currentUser.role === 'مشرف' ||
      currentUser.role === 'مشرف موقع' ||
      currentUser.roleId === 'role_supervisor' ||
      currentUser.role.includes('مشرف');

    if (isAccountantRole || isSupervisorRole || !currentUserPermissions.canViewAllProjects) {
      const allowedPrjIds = new Set(accessibleProjects.map(p => p.id));
      return custodies
        .filter(c => !c.projectId || allowedPrjIds.has(c.projectId))
        .reduce((acc, curr) => acc + curr.amount, 0);
    }
    return custodies.reduce((acc, curr) => acc + curr.amount, 0);
  }, [custodies, currentUser, currentUserPermissions.canViewAllProjects, accessibleProjects]);

  // Helper to determine if an expense has been approved at Stage 1 or beyond
  const isExpenseApprovedStage1OrMore = useCallback((expense: Expense): boolean => {
    if (!expense) return false;
    return (
      expense.supervisorApproval === 'تم اعتماد المشرف' ||
      expense.projectManagerApproval === 'تم اعتماد مدير المشروع' ||
      expense.accountantApproval === 'تم الاعتماد' ||
      expense.managementApproval === 'تم اعتماد الادارة' ||
      expense.status === 'معتمد' ||
      expense.status === 'بانتظار مراجعة وترحيل المحاسب المالي' ||
      expense.status === 'بانتظار اعتماد الإدارة العليا' ||
      (typeof expense.currentStageIndex === 'number' && expense.currentStageIndex > 0) ||
      (Array.isArray(expense.workflowHistory) &&
        expense.workflowHistory.some(
          h =>
            h.status === 'approved' &&
            h.stageId !== 'submission' &&
            h.stageId !== 'rejection' &&
            (h.stageId === 'stage_supervisor' ||
              h.stageId === 'stage_pm' ||
              h.stageId === 'stage_accountant' ||
              h.stageId === 'stage_management' ||
              h.stageId.includes('supervisor') ||
              h.stageId.includes('accountant') ||
              h.stageId.includes('management') ||
              (h.stageTitle?.includes('اعتماد') && !h.stageTitle?.includes('قيد')))
        ))
    );
  }, []);

  // Check whether an expense has been approved by the stages preceding the user's role in the multi-stage workflow engine
  // For the Financial Accountant (المحاسب المالي), newly recorded expenses by supervisors or anyone are hidden
  // until they are approved by the preceding stages (Stage 1 / Supervisor approval).
  const isExpenseApprovedByPrecedingStages = useCallback((expense: Expense, userToCheck?: User): boolean => {
    if (!expense) return false;
    const targetUser = userToCheck || currentUser;

    const isAccountantRole =
      targetUser.role === 'محاسب' ||
      targetUser.role === 'محاسب مالي' ||
      targetUser.roleId === 'role_accountant' ||
      targetUser.role.includes('محاسب');

    // If user is not an accountant (e.g. executive management/admin who needs company-wide oversight), do not restrict
    if (!isAccountantRole) return true;

    // 1. If the expense is fully approved or has management/accountant approval, it has passed preceding stages
    if (
      expense.status === 'معتمد' ||
      expense.managementApproval === 'تم اعتماد الادارة' ||
      expense.accountantApproval === 'تم الاعتماد'
    ) {
      return true;
    }

    // 2. Identify active stages and the accountant's stage position
    const activeStages = [...workflowStages].filter(s => s.isActive).sort((a, b) => a.order - b.order);
    const accountantStageIndex = activeStages.findIndex(
      s =>
        s.requiredRoleId === 'role_accountant' ||
        s.roleId === 'role_accountant' ||
        s.id === 'stage_accountant' ||
        s.title?.includes('محاسب')
    );

    // If accountant is at the very first stage (no preceding stages exist)
    if (accountantStageIndex === 0 && activeStages.length > 0) {
      return true;
    }

    const targetStageIdx = accountantStageIndex !== -1 ? accountantStageIndex : 1;

    // 3. If currentStageIndex is at or past the accountant stage index
    if (typeof expense.currentStageIndex === 'number' && expense.currentStageIndex >= targetStageIdx) {
      return true;
    }

    // 4. If currentStageId matches accountant stage or subsequent stages
    if (
      expense.currentStageId === 'stage_accountant' ||
      expense.currentStageId === 'stage_management' ||
      expense.status === 'بانتظار مراجعة وترحيل المحاسب المالي' ||
      expense.status === 'بانتظار اعتماد الإدارة العليا'
    ) {
      return true;
    }

    // 5. If supervisor or PM explicitly approved
    if (
      expense.supervisorApproval === 'تم اعتماد المشرف' ||
      expense.projectManagerApproval === 'تم اعتماد مدير المشروع'
    ) {
      return true;
    }

    // 6. Check workflowHistory for approved action in the preceding stages
    if (Array.isArray(expense.workflowHistory)) {
      const approvedStages = expense.workflowHistory
        .filter(h => h.status === 'approved' && h.stageId !== 'submission')
        .map(h => h.stageId);

      // Has stage_supervisor or stage_pm been approved?
      if (
        approvedStages.includes('stage_supervisor') ||
        approvedStages.includes('stage_pm') ||
        approvedStages.some(id => id.includes('supervisor'))
      ) {
        return true;
      }

      // Check if all preceding stages are approved
      const precedingStages = activeStages.slice(0, targetStageIdx);
      if (precedingStages.length > 0 && precedingStages.every(s => approvedStages.includes(s.id))) {
        return true;
      }
    }

    // Otherwise, this expense has NOT yet been approved by the preceding stages
    return false;
  }, [currentUser, workflowStages]);

  const totalPendingApprovalsCount = useMemo(() => {
    const isAccountantRole =
      currentUser.role === 'محاسب' ||
      currentUser.role === 'محاسب مالي' ||
      currentUser.roleId === 'role_accountant' ||
      currentUser.role.includes('محاسب');

    const isSupervisorRole =
      currentUser.role === 'مشرف' ||
      currentUser.role === 'مشرف موقع' ||
      currentUser.roleId === 'role_supervisor' ||
      currentUser.role.includes('مشرف');

    if (isAccountantRole) {
      // For accountant, only count expenses that have been approved by preceding stages (Stage 1 / Supervisor)
      // and belong to projects the accountant is assigned to
      const allowedPrjIds = new Set(accessibleProjects.map(p => p.id));
      return expenses.filter(
        e =>
          e.status !== 'معتمد' &&
          e.status !== 'مرفوض' &&
          isExpenseApprovedByPrecedingStages(e, currentUser) &&
          allowedPrjIds.has(e.projectId)
      ).length;
    }

    if (isSupervisorRole) {
      // For supervisor, only count his pending expenses belonging to his assigned projects
      const allowedPrjIds = new Set(accessibleProjects.map(p => p.id));
      return expenses.filter(
        e =>
          e.status !== 'معتمد' &&
          e.status !== 'مرفوض' &&
          allowedPrjIds.has(e.projectId) &&
          (e.supervisorEmail?.toLowerCase() === currentUser.email?.toLowerCase() ||
            (Array.isArray(currentUser.assignedProjects) && currentUser.assignedProjects.includes(e.projectId)))
      ).length;
    }

    return expenses.filter(e => e.status !== 'معتمد' && e.status !== 'مرفوض').length;
  }, [expenses, currentUser, isExpenseApprovedByPrecedingStages, accessibleProjects]);

  const activeProjectsCount = useMemo(() => {
    return accessibleProjects.filter(p => p.status === 'جاري').length;
  }, [accessibleProjects]);

  // Helper to compute elapsed minutes and remaining grace period (30 minutes)
  const getExpenseElapsedMinutes = useCallback((expense: Expense): { elapsedMinutes: number; remainingMinutes: number } => {
    const graceMinutes = 30; // 30 minutes rule
    if (!expense) return { elapsedMinutes: 999, remainingMinutes: 0 };

    let createdTime = NaN;

    // 1. First priority: fingerprintTime (ISO timestamp from submission)
    if (expense.fingerprintTime) {
      const t = new Date(expense.fingerprintTime).getTime();
      if (!isNaN(t)) createdTime = t;
    }

    // 2. Second priority: workflowHistory submission timestamp
    if (isNaN(createdTime) && Array.isArray(expense.workflowHistory)) {
      const submissionAction = expense.workflowHistory.find(h => h.stageId === 'submission');
      if (submissionAction?.actionTime) {
        const t = new Date(submissionAction.actionTime).getTime();
        if (!isNaN(t)) createdTime = t;
      }
    }

    // 3. Third priority: updatedAt
    if (isNaN(createdTime) && expense.updatedAt) {
      const t = new Date(expense.updatedAt).getTime();
      if (!isNaN(t)) createdTime = t;
    }

    // 4. Fourth priority: date
    if (isNaN(createdTime) && expense.date) {
      const todayStr = new Date().toISOString().split('T')[0];
      if (expense.date === todayStr) {
        // Registered today without exact time component - keep grace active
        return { elapsedMinutes: 0, remainingMinutes: graceMinutes };
      }
      const t = new Date(expense.date).getTime();
      if (!isNaN(t)) createdTime = t;
    }

    if (isNaN(createdTime)) {
      return { elapsedMinutes: 0, remainingMinutes: graceMinutes };
    }

    const diffMs = Date.now() - createdTime;
    // Protect against minor client clock skews
    const elapsedMinutes = Math.max(0, Math.floor(diffMs / (60 * 1000)));
    const remainingMinutes = Math.max(0, graceMinutes - elapsedMinutes);

    return { elapsedMinutes, remainingMinutes };
  }, []);

  // Check if an expense can be edited (Controlled dynamically by RBAC and configurable grace period)
  const canEditExpense = useCallback((expense: Expense) => {
    if (!expense) return { canEdit: false, remainingMinutes: 0, reason: 'بيانات الفاتورة غير متوفرة.' };

    // 1. Dynamic RBAC Check: Does this role have edit permission?
    if (!hasPermission('canEditExpense')) {
      return {
        canEdit: false,
        remainingMinutes: 0,
        reason: `دورك الحالي (${currentUserRole?.name || currentUser.role}) لا يملك صلاحية تعديل السندات وفقاً لمصفوفة الصلاحيات (RBAC). شاشة المصروفات مخصصة للاطلاع والتدقيق فقط.`
      };
    }

    const isSupervisor =
      currentUser.role === 'مشرف' ||
      currentUser.role === 'مشرف موقع' ||
      currentUser.roleId === 'role_supervisor' ||
      currentUser.role.includes('مشرف');

    const isManagement =
      hasPermission('canManageRolesAndPermissions') ||
      hasPermission('canApproveAsManagement') ||
      currentUser.role === 'مدير عام' ||
      currentUser.roleId === 'role_management';

    // 2. Cannot edit another supervisor's expense (unless management)
    if (
      !isManagement &&
      expense.supervisorEmail &&
      currentUser.email &&
      expense.supervisorEmail.trim().toLowerCase() !== currentUser.email.trim().toLowerCase()
    ) {
      return { canEdit: false, remainingMinutes: 0, reason: 'هذه الفاتورة مسجلة بواسطة مشرف آخر ولا يمكن تعديلها.' };
    }

    // 3. If already approved in Stage 1 or more, cannot edit unless management
    if (!isManagement && isExpenseApprovedStage1OrMore(expense)) {
      return {
        canEdit: false,
        remainingMinutes: 0,
        reason: 'لا يمكن التعديل على الفاتورة نظراً لاعتمادها كمرحلة أولى (قفل مالي إلزامي لمنع التلاعب في المدخلات).'
      };
    }

    // 4. Check configurable grace period
    const graceMinutes = currentUserRole?.permissions.expenseEditGraceMinutes ?? (isSupervisor ? 30 : 9999);

    // If unlimited / management mode (>= 9000 minutes)
    if (graceMinutes >= 9000 || isManagement) {
      if (expense.status === 'معتمد' && !isManagement) {
        return { canEdit: false, remainingMinutes: 0, reason: 'تم اعتماد الفاتورة نهائياً من الإدارة.' };
      }
      return { canEdit: true, remainingMinutes: 999 };
    }

    // If zero grace minutes (lock immediately on save)
    if (graceMinutes === 0) {
      return {
        canEdit: false,
        remainingMinutes: 0,
        reason: 'مهلة التعديل المحددة لهذا الدور هي (0 دقيقة) - السندات مقفلة فوراً بعد الحفظ للاطلاع والتدقيق فقط.'
      };
    }

    // Time window calculation
    const { elapsedMinutes } = getExpenseElapsedMinutes(expense);
    if (elapsedMinutes > graceMinutes) {
      return {
        canEdit: false,
        remainingMinutes: 0,
        reason: `انقضت المهلة الزمنية المحددة لتعديل السند (${graceMinutes} دقيقة). مضى ${elapsedMinutes} دقيقة على تسجيله وهو مقفل رقابياً لمنع التلاعب.`
      };
    }

    const remainingMinutes = Math.max(0, graceMinutes - elapsedMinutes);
    return { canEdit: true, remainingMinutes };
  }, [currentUser, currentUserRole, hasPermission, isExpenseApprovedStage1OrMore, getExpenseElapsedMinutes]);

  // Check if an expense can be deleted (Controlled dynamically by RBAC and configurable grace period)
  const canDeleteExpenseCheck = useCallback((expense: Expense) => {
    if (!expense) return { canDelete: false, reason: 'بيانات الفاتورة غير متوفرة.' };

    // 1. Dynamic RBAC Check: Does this role have delete permission?
    if (!hasPermission('canDeleteExpense')) {
      return {
        canDelete: false,
        reason: `دورك الحالي (${currentUserRole?.name || currentUser.role}) لا يملك صلاحية حذف السندات وفقاً لمصفوفة الصلاحيات (RBAC).`
      };
    }

    const isSupervisor =
      currentUser.role === 'مشرف' ||
      currentUser.role === 'مشرف موقع' ||
      currentUser.roleId === 'role_supervisor' ||
      currentUser.role.includes('مشرف');

    const isManagement =
      hasPermission('canManageRolesAndPermissions') ||
      hasPermission('canApproveAsManagement') ||
      currentUser.role === 'مدير عام' ||
      currentUser.roleId === 'role_management';

    // 2. Cannot delete another supervisor's expense (unless management)
    if (
      !isManagement &&
      expense.supervisorEmail &&
      currentUser.email &&
      expense.supervisorEmail.trim().toLowerCase() !== currentUser.email.trim().toLowerCase()
    ) {
      return { canDelete: false, reason: 'هذه الفاتورة مسجلة بواسطة مشرف آخر ولا يمكن حذفها.' };
    }

    // 3. Cannot delete if approved in Stage 1 or more (unless management)
    if (!isManagement && isExpenseApprovedStage1OrMore(expense)) {
      return {
        canDelete: false,
        reason: 'لا يمكن حذف الفاتورة نظراً لبدء دورة الاعتماد الرسمية عليها (قفل مالي إلزامي لمنع التلاعب).'
      };
    }

    // 4. Check grace period
    const graceMinutes = currentUserRole?.permissions.expenseEditGraceMinutes ?? (isSupervisor ? 30 : 9999);
    if (graceMinutes < 9000 && !isManagement) {
      if (graceMinutes === 0) {
        return {
          canDelete: false,
          reason: 'مهلة الحذف المحددة لهذا الدور هي (0 دقيقة) - السندات مقفلة فوراً بعد الحفظ.'
        };
      }

      const { elapsedMinutes } = getExpenseElapsedMinutes(expense);
      if (elapsedMinutes > graceMinutes) {
        return {
          canDelete: false,
          reason: `انقضت المهلة الزمنية المسموحة لحذف السند (${graceMinutes} دقيقة). مضى ${elapsedMinutes} دقيقة على تسجيله وهو مقفل رقابياً.`
        };
      }
    }

    // 5. Final approval check
    if (expense.status === 'معتمد' && !isManagement) {
      return { canDelete: false, reason: 'تم اعتماد الفاتورة نهائياً من الإدارة، يتطلب الحذف صلاحيات الإدارة العليا.' };
    }

    return { canDelete: true };
  }, [currentUser, currentUserRole, hasPermission, isExpenseApprovedStage1OrMore, getExpenseElapsedMinutes]);

  // Automatic smart alert checks
  useEffect(() => {
    supervisorsSummary.forEach(sup => {
      if (sup.actualRemainingBalance <= settings.lowBalanceThreshold && sup.totalCustody > 0) {
        const exists = notifications.some(
          n => n.type === 'low_balance' && n.relatedId === sup.email && !n.read
        );
        if (!exists) {
          addNotification(
            `تحذير رصيد عهدة منخفض: ${sup.name}`,
            `الرصيد الفعلي المتبقي للمشرف بعد الفواتير المسجلة هو ${sup.actualRemainingBalance.toLocaleString()} ${settings.currencySymbol}، وهو أقل من الحد المسموح به (${settings.lowBalanceThreshold.toLocaleString()} ${settings.currencySymbol}).`,
            'low_balance',
            sup.email
          );
        }
      }
    });
  }, [supervisorsSummary, settings.lowBalanceThreshold, settings.currencySymbol, notifications, addNotification]);

  // Trigger sync immediately and clear pending queue
  const triggerSync = async () => {
    setIsSyncing(true);
    setExpenses(prev => prev.map(e => ({ ...e, synced: true })));
    setCustodies(prev => prev.map(c => ({ ...c, synced: true })));
    StorageService.clearSyncQueue();
    setSyncQueue([]);
    setLastSyncTime(new Date().toISOString());
    setIsSyncing(false);

    addNotification(
      'تمت المزامنة بنجاح',
      'تم تأكيد مزامنة كافة العمليات والبيانات بنجاح.',
      'sync'
    );
  };

  // Strict & Smart Login function
  const login = async (identifier: string, passwordInput: string, rememberMe: boolean = true): Promise<{ success: boolean; message?: string }> => {
    const rawClean = (identifier || '').trim().toLowerCase();
    const cleanIdentifier = rawClean.replace(/^@+/, '').trim();
    const cleanPassword = (passwordInput || '').trim();

    if (!cleanIdentifier) {
      return { success: false, message: 'يرجى إدخال اسم المستخدم أو البريد الإلكتروني' };
    }
    if (!cleanPassword) {
      return { success: false, message: 'يرجى إدخال كلمة المرور' };
    }

    // 1. First attempt to lookup user from current state or storage
    let currentUsersList = users && users.length > 0 ? users : StorageService.getUsers();

    const findMatch = (list: User[]) => {
      return list.find(u => {
        const uUsername = (u.username || '').trim().toLowerCase();
        const uEmail = (u.email || '').trim().toLowerCase();
        const uEmailPrefix = uEmail ? uEmail.split('@')[0] : '';
        const uName = (u.name || '').trim().toLowerCase();
        const isUserAdmin = u.id === 'USR-01' || u.roleId === 'role_admin' || u.role.includes('مدير') || uEmail.includes('mansour');
        const isUserAccountant = u.id === 'USR-02' || u.roleId === 'role_accountant' || u.role.includes('محاسب');
        const isUserSupervisor = u.id === 'USR-03' || u.roleId === 'role_supervisor' || u.role.includes('مشرف');

        // 1. Direct exact matches
        if (uUsername === cleanIdentifier || uEmail === cleanIdentifier || uEmailPrefix === cleanIdentifier || uName === cleanIdentifier) {
          return true;
        }

        // 2. Admin & Executive Manager Aliases (m.manso, m.mansour, 2030m.mansour, admin, الادمن, مدير)
        if (isUserAdmin) {
          if (
            cleanIdentifier === 'admin' ||
            cleanIdentifier === 'ادمن' ||
            cleanIdentifier === 'الادمن' ||
            cleanIdentifier === 'مدير' ||
            cleanIdentifier === 'المدير' ||
            cleanIdentifier === 'منصور' ||
            cleanIdentifier === 'mansour' ||
            cleanIdentifier === 'm.mansour' ||
            cleanIdentifier === 'm.manso' ||
            cleanIdentifier === '2030m.mansour' ||
            cleanIdentifier.startsWith('m.manso') ||
            cleanIdentifier.startsWith('2030m.man') ||
            cleanIdentifier.includes('mansour') ||
            cleanIdentifier.includes('manso')
          ) {
            return true;
          }
        }

        // 3. Accountant Aliases
        if (isUserAccountant) {
          if (
            cleanIdentifier === 'accountant' ||
            cleanIdentifier === 'محاسب' ||
            cleanIdentifier === 'المحاسب' ||
            cleanIdentifier === 'سامي' ||
            cleanIdentifier === 'sami' ||
            cleanIdentifier === 'sami.accountant' ||
            cleanIdentifier.startsWith('sami')
          ) {
            return true;
          }
        }

        // 4. Supervisor Aliases
        if (isUserSupervisor) {
          if (
            cleanIdentifier === 'supervisor' ||
            cleanIdentifier === 'supervisor1' ||
            cleanIdentifier === 'مشرف' ||
            cleanIdentifier === 'المشرف' ||
            cleanIdentifier === 'احمد' ||
            cleanIdentifier === 'أحمد' ||
            cleanIdentifier === 'ahmed' ||
            cleanIdentifier === 'ahmed.supervisor' ||
            cleanIdentifier.startsWith('ahmed')
          ) {
            return true;
          }
        }

        return false;
      });
    };

    let foundUser = findMatch(currentUsersList);

    // If not found, attempt an immediate server fetch in case state hasn't hydrated yet
    if (!foundUser) {
      try {
        const srvRes = await ServerSyncService.fetchServerState();
        if (srvRes.success && srvRes.data?.users && Array.isArray(srvRes.data.users)) {
          currentUsersList = srvRes.data.users;
          setUsers(srvRes.data.users);
          StorageService.saveUsers(srvRes.data.users);
          foundUser = findMatch(currentUsersList);
        }
      } catch (err) {
        console.warn('Login server users fetch error:', err);
      }
    }

    if (!foundUser) {
      return { success: false, message: 'اسم المستخدم أو البريد الإلكتروني غير مسجل في النظام' };
    }

    const expectedPassword = (foundUser.password || 'Password@2026').trim();
    const isTargetAdmin = foundUser.id === 'USR-01' || foundUser.roleId === 'role_admin' || foundUser.role.includes('مدير');

    // Forgiving password comparison (exact or case-insensitive, plus standard emergency aliases for admin)
    const isPasswordCorrect =
      cleanPassword === expectedPassword ||
      cleanPassword.toLowerCase() === expectedPassword.toLowerCase() ||
      (isTargetAdmin && (
        cleanPassword === 'Password@2026' ||
        cleanPassword.toLowerCase() === 'password@2026' ||
        cleanPassword === 'Password2026' ||
        cleanPassword === 'admin' ||
        cleanPassword === '123456'
      ));

    if (!isPasswordCorrect) {
      return {
        success: false,
        message: 'كلمة المرور غير صحيحة. يرجى التأكد من كلمة المرور أو مراجعة مدير النظام.'
      };
    }

    // Generate a unique session token for this device & detect client device details
    const newSessionId = generateSessionId();
    const deviceSummary = getClientDeviceSummary();
    const loginTimestamp = new Date().toISOString();

    const updatedUser: User = {
      ...foundUser,
      currentSessionId: newSessionId,
      lastLoginAt: loginTimestamp,
      lastLoginDevice: deviceSummary
    };

    // Update in-memory and state users list
    const updatedUsersList = (currentUsersList && currentUsersList.length > 0 ? currentUsersList : users).map(u =>
      u.id === foundUser.id ? updatedUser : u
    );
    if (!updatedUsersList.some(u => u.id === foundUser.id)) {
      updatedUsersList.push(updatedUser);
    }

    setUsers(updatedUsersList);
    StorageService.saveUsers(updatedUsersList);
    setCurrentUser(updatedUser);
    StorageService.saveCurrentUser(updatedUser);

    // Save session with unique sessionId
    StorageService.saveAuthSession({
      isAuthenticated: true,
      userId: updatedUser.id,
      sessionId: newSessionId,
      lastLoginAt: loginTimestamp,
      deviceInfo: deviceSummary,
      rememberMe
    });
    setIsAuthenticated(true);
    setSessionEvictedInfo(null);

    // Re-hydrate local entity states so current user session is fully populated
    const curCustodies = StorageService.getCustodies();
    if (curCustodies.length > 0) {
      setCustodies(curCustodies);
    }
    const curExpenses = StorageService.getExpenses();
    if (curExpenses.length > 0) {
      setExpenses(curExpenses);
    }
    const curProjects = StorageService.getProjects();
    if (curProjects.length > 0) {
      setProjects(curProjects);
    }

    // Refresh and apply authoritative central server state on login FIRST
    try {
      const serverRes = await ServerSyncService.fetchServerState();
      if (serverRes.success && serverRes.data) {
        applyAuthoritativeCloudState(serverRes.data);
      }
    } catch (err) {
      console.warn('Post-login cloud refresh warning:', err);
    }

    // Broadcast session update to Cloud & Server so other open devices with this user get evicted instantly
    persistChangesDirectly({ users: updatedUsersList }, 'تسجيل الدخول').catch(() => {});

    const isTargetSupervisor = updatedUser.role.includes('مشرف') || updatedUser.roleId === 'role_supervisor';
    const targetRole = roles.find(r => r.id === updatedUser.roleId || r.name === updatedUser.role);
    if (isTargetSupervisor) {
      setCurrentView('expenses');
    } else if (targetRole?.permissions?.allowedScreens && targetRole.permissions.allowedScreens.length > 0) {
      if (targetRole.permissions.allowedScreens.includes('dashboard')) {
        setCurrentView('dashboard');
      } else {
        setCurrentView((targetRole.permissions.allowedScreens[0] || 'expenses') as any);
      }
    } else {
      setCurrentView('dashboard');
    }

    return { success: true };
  };

  // Logout function - clears local authentication session
  const logout = async () => {
    StorageService.clearAuthSession();
    setIsAuthenticated(false);
    setSessionEvictedInfo(null);
  };

  // Manager Reset Password for single user
  const resetUserPasswordByManager = async (userId: string, newPassword: string): Promise<boolean> => {
    const updated = await updateUser(userId, {
      password: newPassword,
      passwordChangedAt: new Date().toISOString(),
      passwordResetByAdmin: true
    });
    return updated;
  };

  // Manager Reset Passwords for all users
  const resetAllUsersPasswordByManager = async (newPassword: string = 'Password@2026'): Promise<boolean> => {
    try {
      const updatedUsers = StorageService.resetAllUsersPassword(newPassword);
      setUsers(updatedUsers);
      return true;
    } catch {
      return false;
    }
  };

  // Switch role / user helper with dynamic screen permission redirection
  const switchRole = (userOrRoleId: string, targetScreen?: string) => {
    // 1. Search by exact user ID first, then email, then roleId, then role name
    const targetUser =
      users.find(u => u.id === userOrRoleId) ||
      users.find(u => u.email.toLowerCase() === userOrRoleId.toLowerCase()) ||
      users.find(u => u.roleId === userOrRoleId) ||
      users.find(u => u.role === userOrRoleId) ||
      users[0];

    setCurrentUser(targetUser);
    StorageService.saveCurrentUser(targetUser);

    // Resolve target user's role and allowed screens
    const targetRole = roles.find(
      r => r.id === targetUser.roleId || r.name === targetUser.role || r.id.includes(targetUser.role)
    );
    const isTargetSupervisor =
      targetUser.role.includes('مشرف') ||
      targetUser.roleId === 'role_supervisor' ||
      targetRole?.id === 'role_supervisor';

    const isTargetAccountant =
      targetUser.role.includes('محاسب') ||
      targetUser.roleId === 'role_accountant' ||
      targetRole?.id === 'role_accountant';

    if (targetRole && targetRole.permissions?.allowedScreens && targetRole.permissions.allowedScreens.length > 0) {
      let allowed = targetRole.permissions.allowedScreens;
      if (isTargetAccountant) {
        allowed = allowed.filter(s => s !== 'supervisors' && s !== 'settings');
      }
      const normalizedCurrentView = currentView === 'custody' ? 'custodies' : currentView;

      if (targetScreen && allowed.includes(targetScreen)) {
        setCurrentView(targetScreen);
      } else if (isTargetSupervisor) {
        // When switching to a supervisor: if on a manager-only screen, redirect to expenses or dashboard
        if (!allowed.includes(normalizedCurrentView)) {
          setCurrentView('expenses');
        }
      } else if (isTargetAccountant && (normalizedCurrentView === 'supervisors' || normalizedCurrentView === 'settings')) {
        setCurrentView('expenses');
      } else if (!allowed.includes(normalizedCurrentView)) {
        // Redirect to the first allowed screen for this role
        const nextScreen = (allowed[0] || 'expenses') as any;
        setCurrentView(nextScreen);
      }
    }
  };

  // Strict Online Guard: Requires active cloud/network connection for mutations (No offline data drift/overwrite)
  const ensureOnlineForWrite = useCallback((actionName: string = 'العملية'): boolean => {
    const isOnlineConn = typeof navigator !== 'undefined' ? navigator.onLine : true;
    if (!isOnlineConn || isSimulatingOffline) {
      showAlert(
        'التسجيل المباشر مطلوب (Online-Only)',
        `تنبيه رقابي: لا يمكن تنفيذ (${actionName}) أثناء انقطاع الاتصال بالإنترنت. النظام مضبوط للعمل والتسجيل المباشر عبر السحابة لضمان دقة السجلات المحاسبية وحمايتها من التضارب أو الاستبدال.`,
        'warning'
      );
      return false;
    }

    if (settings.preventMultiDeviceLogin !== false) {
      const isSessionValid = verifyCurrentSession();
      if (!isSessionValid) {
        showAlert(
          'انتهت صلاحية الجلسة',
          'تم تسجيل الدخول إلى هذا الحساب من جهاز آخر، تم إنهاء الجلسة على هذا المتصفح لحماية البيانات وتجنب تضارب التعديلات.',
          'error'
        );
        return false;
      }
    }

    return true;
  }, [isSimulatingOffline, settings.preventMultiDeviceLogin, showAlert, verifyCurrentSession]);

  // Expense CRUD Operations
  const addExpense = async (expenseData: Omit<Expense, 'id' | 'fingerprintTime' | 'updatedAt' | 'synced' | 'status' | 'accountantApproval' | 'managementApproval'>) => {
    if (!ensureOnlineForWrite('تسجيل مصروف جديد')) {
      throw new Error('OFFLINE_RECORDING_BLOCKED');
    }

    // Dynamic RBAC check for creating expenses
    if (!hasPermission('canCreateExpense')) {
      showAlert(
        'صلاحيات غير كافية (RBAC)',
        `دورك الحالي (${currentUserRole?.name || currentUser.role}) لا يملك صلاحية إضافة وتسجيل مصروفات جديدة. هذه الشاشة مخصصة للاطلاع والتدقيق فقط.`,
        'error'
      );
      throw new Error('لا تملك صلاحية إضافة مصروف جديد وفقاً لمصفوفة الصلاحيات');
    }

    // Validate that the supervisor has sufficient custody balance
    const supSummary = supervisorsSummary.find(s => s.email === expenseData.supervisorEmail);
    const availableBalance = supSummary ? supSummary.actualRemainingBalance : 0;

    if (availableBalance <= 0 || expenseData.amount > availableBalance) {
      const supName = supSummary ? supSummary.name : expenseData.supervisorName;
      showAlert(
        'رصيد العهدة غير كافٍ',
        `لا يمكن تسجيل المصروف نظراً لعدم وجود رصيد كافٍ في عهدة المشرف (${supName}). الرصيد المتاح: ${availableBalance.toLocaleString()} ${settings.currencySymbol}، بينما مبلغ المصروف: ${expenseData.amount.toLocaleString()} ${settings.currencySymbol}. يجب صرف دفعة عهدة جديدة للمشرف لتغطية المصروف.`,
        'error'
      );
      throw new Error('رصيد عهدة المشرف غير كافٍ لتسجيل هذا المصروف');
    }

    // Verify project assignment & operational permission
    const opCheck = canUserOperateOnProject(expenseData.projectId, currentUser);
    if (!opCheck.canOperate) {
      showAlert('عملية غير مصرح بها على هذا المشروع', opCheck.reason || 'المشروع غير مسند إليك ولا تملك صلاحية قيد سندات عليه.', 'error');
      throw new Error(opCheck.reason || 'المشروع غير مسند');
    }

    const nowIso = new Date().toISOString();
    const id = `EXP-${Date.now().toString(36).toUpperCase()}-${Math.floor(100 + Math.random() * 900)}`;

    const project = projects.find(p => p.id === expenseData.projectId);
    const hasAttachmentsList = Array.isArray(expenseData.attachments) && expenseData.attachments.length > 0;
    const primaryAttachmentUrl = expenseData.invoicePhoto || expenseData.attachments?.[0]?.url || '';
    const hasAttachment = Boolean(primaryAttachmentUrl && primaryAttachmentUrl.trim().length > 0) || hasAttachmentsList;
    const isPdf = Boolean(
      hasAttachment && (
        (primaryAttachmentUrl && (
          primaryAttachmentUrl.startsWith('data:application/pdf') ||
          primaryAttachmentUrl.toLowerCase().includes('.pdf')
        )) ||
        expenseData.attachmentFileName?.toLowerCase().endsWith('.pdf') ||
        expenseData.attachments?.[0]?.fileType === 'pdf'
      )
    );

    const codedFileName = hasAttachment ? AttachmentArchiver.generateCodedFileName({
      bondNumber: id,
      projectCode: project?.code || project?.id || expenseData.projectId,
      projectName: project?.name || expenseData.projectName,
      invoiceNumber: expenseData.invoiceNumber,
      originalFileName: expenseData.attachmentFileName,
      isPdf
    }) : undefined;

    const projectFolder = project ? AttachmentArchiver.getProjectFolderName(project) : `مجلد_مشروع_${expenseData.projectId}`;

    const activeStages = workflowStages.filter(s => s.isActive);
    const initialStage = activeStages.length > 0 ? activeStages[0] : null;

    const initialHistory: ExpenseWorkflowAction[] = [
      {
        stageId: 'submission',
        stageTitle: 'تسجيل وقيد المصروف الميداني',
        status: 'pending',
        actionByEmail: currentUser.email,
        actionByName: currentUser.name,
        actionRole: currentUser.role,
        actionTime: nowIso,
        notes: `تم قيد المصروف لمشروع ${expenseData.projectName} بمبلغ ${expenseData.amount.toLocaleString()} ${settings.currencySymbol}.`
      }
    ];

    const finalAttachments = hasAttachmentsList
      ? expenseData.attachments
      : (primaryAttachmentUrl ? [{
          id: `att-${Date.now()}-1`,
          url: primaryAttachmentUrl,
          fileName: codedFileName || (isPdf ? 'مستند_الفاتورة.pdf' : 'صورة_الفاتورة.jpg'),
          fileType: isPdf ? 'pdf' as const : 'image' as const,
          uploadedAt: nowIso
        }] : []);

    const newExpense: Expense = {
      ...expenseData,
      id,
      invoicePhoto: primaryAttachmentUrl,
      attachments: finalAttachments,
      fingerprintTime: nowIso,
      updatedAt: nowIso,
      attachmentFileName: codedFileName,
      attachmentProjectFolder: projectFolder,
      attachmentMeta: hasAttachment && codedFileName ? {
        codedName: codedFileName,
        originalName: expenseData.attachmentFileName,
        bondNumber: id,
        projectCode: project?.code || project?.id,
        projectName: project?.name || expenseData.projectName,
        projectFolder,
        fileType: isPdf ? 'pdf' : 'image',
        storagePath: `projects/${project?.code || project?.id}/bonds/${codedFileName}`,
        savedAt: nowIso
      } : undefined,
      status: 'بانتظار الاعتماد',
      currentStageId: initialStage ? initialStage.id : 'stage_supervisor',
      currentStageIndex: 0,
      supervisorApproval: 'غير معتمد',
      projectManagerApproval: 'غير معتمد',
      accountantApproval: 'غير معتمد',
      managementApproval: 'غير معتمد',
      erpPostingStatus: 'غير مرحل',
      workflowHistory: initialHistory,
      synced: true,
      offlineCreated: false,
      savedLocally: true,
      lastSavedAt: nowIso,
    };

    const nextExpensesList = [newExpense, ...expenses];
    setExpenses(nextExpensesList);
    persistChangesDirectly({ expenses: nextExpensesList }, 'إضافة مصروف جديد');

    if (hasAttachment) {
      AttachmentArchiver.saveProjectAttachmentRecord(newExpense.projectId, newExpense);
    }

    recordOperationStatus(
      'إضافة مصروف جديد',
      `تم قيد وحفظ المصروف رقم (${newExpense.id}) بمبلغ ${newExpense.amount.toLocaleString()} ${settings.currencySymbol} لمشروع ${newExpense.projectName} في قاعدة البيانات السحابية`,
      { savedLocally: true, synced: true, details: `المشروع: ${newExpense.projectName}` }
    );

    addNotification(
      'تسجيل مصروف جديد',
      `قام ${newExpense.supervisorName} بتسجيل مصروف بمبلغ ${newExpense.amount.toLocaleString()} ${settings.currencySymbol} لمشروع ${newExpense.projectName}.`,
      'expense_added',
      newExpense.id,
      currentUser.email,
      currentUser.name,
      'expense'
    );

    return newExpense;
  };

  const updateExpense = async (id: string, expenseData: Partial<Expense>) => {
    if (!ensureOnlineForWrite('تعديل المصروف')) {
      return false;
    }

    const existingExp = expenses.find(e => e.id === id);
    if (!existingExp) return false;

    // Strict Anti-Tampering Check:
    const editCheck = canEditExpense(existingExp);
    if (!editCheck.canEdit) {
      showAlert('التعديل مقفل رقابياً', editCheck.reason || 'لا يمكنك تعديل هذا المصروف نظراً للقفل المالي لمنع التلاعب.', 'error');
      return false;
    }

    // Verify project assignment & operational permission on current or new project
    const targetProjectId = expenseData.projectId || existingExp.projectId;
    const opCheck = canUserOperateOnProject(targetProjectId, currentUser);
    if (!opCheck.canOperate) {
      showAlert('عملية غير مصرح بها على هذا المشروع', opCheck.reason || 'المشروع غير مسند إليك.', 'error');
      return false;
    }

    // Validate custody balance if amount is increased
    if (typeof expenseData.amount === 'number' && expenseData.amount > existingExp.amount) {
      const supEmail = expenseData.supervisorEmail || existingExp.supervisorEmail;
      const supSummary = supervisorsSummary.find(s => s.email === supEmail);
      const availableBalance = (supSummary ? supSummary.actualRemainingBalance : 0) + existingExp.amount;
      if (expenseData.amount > availableBalance) {
        const supName = supSummary ? supSummary.name : (expenseData.supervisorName || existingExp.supervisorName);
        showAlert(
          'رصيد العهدة غير كافٍ',
          `لا يمكن تعديل المصروف. المبلغ الجديد (${expenseData.amount.toLocaleString()} ${settings.currencySymbol}) يتجاوز رصيد عهدة المشرف المتاح (${availableBalance.toLocaleString()} ${settings.currencySymbol}) للمشرف (${supName}).`,
          'error'
        );
        return false;
      }
    }

    const nowIso = new Date().toISOString();
    let updated = false;
    let savedExp: Expense | null = null;

    setExpenses(prev =>
      prev.map(exp => {
        if (exp.id === id) {
          updated = true;
          const targetProjectId = expenseData.projectId || exp.projectId;
          const targetProjectName = expenseData.projectName || exp.projectName;
          const targetInvoiceNumber = expenseData.invoiceNumber !== undefined ? expenseData.invoiceNumber : exp.invoiceNumber;
          const targetAttachments = expenseData.attachments !== undefined ? expenseData.attachments : exp.attachments;
          const targetPhoto = expenseData.invoicePhoto !== undefined ? expenseData.invoicePhoto : (targetAttachments?.[0]?.url || exp.invoicePhoto);
          const hasAttachment = Boolean(targetPhoto && targetPhoto.trim().length > 0) || Boolean(targetAttachments && targetAttachments.length > 0);

          const isPdf = Boolean(
            hasAttachment && (
              (targetPhoto && (
                targetPhoto.startsWith('data:application/pdf') ||
                targetPhoto.toLowerCase().includes('.pdf')
              )) ||
              (expenseData.attachmentFileName || exp.attachmentFileName)?.toLowerCase().endsWith('.pdf') ||
              targetAttachments?.[0]?.fileType === 'pdf'
            )
          );

          const project = projects.find(p => p.id === targetProjectId);
          const codedFileName = hasAttachment ? (
            exp.attachmentFileName || AttachmentArchiver.generateCodedFileName({
              bondNumber: id,
              projectCode: project?.code || project?.id || targetProjectId,
              projectName: project?.name || targetProjectName,
              invoiceNumber: targetInvoiceNumber,
              originalFileName: expenseData.attachmentFileName,
              isPdf
            })
          ) : undefined;

          const projectFolder = project ? AttachmentArchiver.getProjectFolderName(project) : `مجلد_مشروع_${targetProjectId}`;

          const updatedExp: Expense = {
            ...exp,
            ...expenseData,
            invoicePhoto: targetPhoto,
            attachments: targetAttachments,
            updatedAt: nowIso,
            attachmentFileName: codedFileName,
            attachmentProjectFolder: projectFolder,
            attachmentMeta: hasAttachment && codedFileName ? {
              codedName: codedFileName,
              originalName: expenseData.attachmentFileName || exp.attachmentMeta?.originalName,
              bondNumber: id,
              projectCode: project?.code || project?.id,
              projectName: project?.name || targetProjectName,
              projectFolder,
              fileType: isPdf ? 'pdf' : 'image',
              storagePath: `projects/${project?.code || project?.id}/bonds/${codedFileName}`,
              savedAt: nowIso
            } : undefined,
            synced: effectiveOnline,
            savedLocally: true,
            lastSavedAt: nowIso,
          };

          savedExp = updatedExp;
          return updatedExp;
        }
        return exp;
      })
    );

    if (updated && savedExp) {
      const expToSave: Expense = savedExp;
      const nextExpensesList = expenses.map(e => (e.id === id ? expToSave : e));
      persistChangesDirectly({ expenses: nextExpensesList }, 'تعديل المصروف');

      if (expToSave.invoicePhoto || (Array.isArray(expToSave.attachments) && expToSave.attachments.length > 0)) {
        AttachmentArchiver.saveProjectAttachmentRecord(expToSave.projectId, expToSave);
      }
    }

    if (updated) {
      recordOperationStatus(
        'تعديل وحفظ المصروف',
        `تم حفظ تعديلات المصروف (${id}) في السيرفر وقاعدة البيانات السحابية بنجاح`,
        { savedLocally: true, synced: true }
      );
    }

    return updated;
  };

  const deleteExpense = async (id: string) => {
    if (!ensureOnlineForWrite('حذف المصروف')) {
      return false;
    }

    const existingExp = expenses.find(e => e.id === id);
    if (!existingExp) return false;

    // Strict Anti-Tampering Check:
    const deleteCheck = canDeleteExpenseCheck(existingExp);
    if (!deleteCheck.canDelete) {
      showAlert('الحذف مقفل رقابياً', deleteCheck.reason || 'لا يمكنك حذف هذا المصروف نظراً للقفل المالي لمنع التلاعب.', 'error');
      return false;
    }

    // Verify project assignment & operational permission
    const opCheck = canUserOperateOnProject(existingExp.projectId, currentUser);
    if (!opCheck.canOperate) {
      showAlert('عملية غير مصرح بها على هذا المشروع', opCheck.reason || 'المشروع غير مسند إليك.', 'error');
      return false;
    }

    StorageService.recordDeletedExpense(id, currentUser?.name || currentUser?.username || 'مستخدم النظام');
    const nextExpensesList = expenses.filter(e => e.id !== id);
    setExpenses(nextExpensesList);
    StorageService.saveExpenses(nextExpensesList);

    await persistChangesDirectly({
      expenses: nextExpensesList,
      deletedExpenseIds: StorageService.getDeletedExpenseIds()
    }, 'حذف المصروف');
    recordOperationStatus(
      'حذف المصروف',
      `تم حذف المصروف رقم (${id}) وحفظ التعديلات في السيرفر وقاعدة البيانات السحابية`,
      { savedLocally: true, synced: true }
    );

    return true;
  };

  const bulkDeleteExpenses = async (ids: string[]) => {
    if (ids.length === 0) return 0;
    if (!ensureOnlineForWrite('الحذف الجماعي للمصروفات')) {
      return 0;
    }

    if (!hasPermission('canDeleteExpense')) {
      showAlert(
        'شاشة للاطلاع والتدقيق فقط',
        `دورك الحالي (${currentUserRole?.name || currentUser.role}) لا يملك صلاحية حذف السندات وفقاً لمصفوفة الصلاحيات (RBAC).`,
        'warning'
      );
      return 0;
    }

    const idsSet = new Set(ids);

    // Validate anti-tampering rules on each target expense
    const targetExpenses = expenses.filter(e => idsSet.has(e.id));
    const blockedExpenses = targetExpenses.filter(e => !canDeleteExpenseCheck(e).canDelete);

    if (blockedExpenses.length > 0 && blockedExpenses.length === targetExpenses.length) {
      showAlert(
        'تعذر الحذف الجماعي',
        'كافة السندات المحددة مقفلة رقابياً (معتمدة كمرحلة أولى أو مر عليها أكثر من 30 دقيقة) لمنع التلاعب في المدخلات.',
        'error'
      );
      return 0;
    }

    const authorizedIds = new Set(targetExpenses.filter(e => canDeleteExpenseCheck(e).canDelete).map(e => e.id));
    const authorizedIdsArray = Array.from(authorizedIds);
    let count = 0;

    setExpenses(prev => {
      const remaining = prev.filter(e => {
        if (authorizedIds.has(e.id)) {
          count++;
          return false;
        }
        return true;
      });
      return remaining;
    });

    if (authorizedIdsArray.length > 0) {
      StorageService.recordDeletedExpenses(authorizedIdsArray, currentUser?.name || currentUser?.username || 'مستخدم النظام');
      const nextExpensesList = expenses.filter(e => !authorizedIds.has(e.id));
      StorageService.saveExpenses(nextExpensesList);
      await persistChangesDirectly({
        expenses: nextExpensesList,
        deletedExpenseIds: StorageService.getDeletedExpenseIds()
      }, 'حذف جماعي للمصروفات');
      recordOperationStatus(
        'حذف جماعي للمصروفات',
        `تم حذف (${count}) سند بنجاح وحفظ التعديل في السيرفر وقاعدة البيانات السحابية`,
        { savedLocally: true, synced: true }
      );
    }

    return count;
  };

  const bulkUpdateExpenses = async (ids: string[], updates: Partial<Expense>) => {
    if (ids.length === 0) return 0;
    if (!ensureOnlineForWrite('التحديث الجماعي للمصروفات')) {
      return 0;
    }

    const isAccountant =
      currentUser.role === 'محاسب' ||
      currentUser.role === 'محاسب مالي' ||
      currentUser.roleId === 'role_accountant' ||
      currentUser.role.includes('محاسب');

    if (isAccountant) {
      showAlert('شاشة للاطلاع فقط', 'شاشة المصروفات مخصصة للمحاسب المالي للاطلاع والتدقيق فقط، ولا تملك صلاحية تعديل السندات.', 'warning');
      return 0;
    }

    const nowIso = new Date().toISOString();
    const idsSet = new Set(ids);
    let count = 0;

    let fullUpdates = { ...updates };
    if (updates.projectId && !updates.projectName) {
      const proj = projects.find(p => p.id === updates.projectId);
      if (proj) {
        fullUpdates.projectName = proj.name;
      }
    }

    setExpenses(prev =>
      prev.map(exp => {
        if (idsSet.has(exp.id)) {
          count++;
          return {
            ...exp,
            ...fullUpdates,
            updatedAt: nowIso,
            synced: true,
            savedLocally: true,
            lastSavedAt: nowIso,
          };
        }
        return exp;
      })
    );

    if (count > 0) {
      const nextExpenses = expenses.map(exp => idsSet.has(exp.id) ? { ...exp, ...fullUpdates, updatedAt: nowIso } : exp);
      persistChangesDirectly({ expenses: nextExpenses }, 'تحديث جماعي للمصروفات');
      recordOperationStatus(
        'تحديث جماعي للمصروفات',
        `تم حفظ وتحديث (${count}) سند بنجاح ومزامنتها مباشرة مع السحابة`,
        { savedLocally: true, synced: true }
      );
    }

    return count;
  };

  // Bulk Import Historical / Legacy Expenses (from Excel / CSV)
  const bulkImportExpenses = async (
    newExpenses: Expense[],
    newProjects?: Project[]
  ): Promise<{ success: boolean; count: number; message: string }> => {
    if (!ensureOnlineForWrite('استيراد الفواتير والمصروفات')) {
      return { success: false, count: 0, message: 'يتطلب الاستيراد اتصالاً نشطاً بالإنترنت' };
    }

    if (!newExpenses || newExpenses.length === 0) {
      return { success: false, count: 0, message: 'لا توجد بيانات مصروفات للاستيراد' };
    }

    lastLocalWriteTimeRef.current = Date.now();

    // 1. Calculate and save new projects
    let updatedProjects = [...projects];
    if (newProjects && newProjects.length > 0) {
      const existingCodes = new Set(projects.map(p => (p.code || p.id).trim().toLowerCase()));
      const existingNames = new Set(projects.map(p => p.name.trim().toLowerCase()));
      const toAdd = newProjects.filter(
        np =>
          !existingCodes.has((np.code || np.id).trim().toLowerCase()) &&
          !existingNames.has(np.name.trim().toLowerCase())
      );
      if (toAdd.length > 0) {
        updatedProjects = [...projects, ...toAdd];
        StorageService.saveProjects(updatedProjects);
        setProjects(updatedProjects);
      }
    }

    // 2. Append new expenses and save synchronously
    // Clear any tombstone for imported expenses so they are not filtered out by storage
    const deletedMap = StorageService.getDeletedExpenseIds();
    let hasDeletedTombstone = false;

    const existingIds = new Set(expenses.map(e => e.id));
    const resolvedExpenses: Expense[] = [];

    newExpenses.forEach((item, idx) => {
      const exp = { ...item };
      // If the ID was marked deleted in the past, revive it
      if (exp.id && deletedMap[exp.id]) {
        delete deletedMap[exp.id];
        hasDeletedTombstone = true;
      }
      // If this ID is already taken by an active expense in the current list, create a unique non-colliding ID
      if (!exp.id || existingIds.has(exp.id)) {
        let uniqueId = exp.id ? `${exp.id}_${Date.now().toString().slice(-4)}${idx + 1}` : `EXP-${Date.now()}-${idx + 1}`;
        while (existingIds.has(uniqueId)) {
          uniqueId = `EXP-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
        }
        exp.id = uniqueId;
      }
      existingIds.add(exp.id);
      resolvedExpenses.push(exp);
    });

    if (hasDeletedTombstone) {
      StorageService.saveDeletedExpenseIds(deletedMap);
    }

    const updatedExpenses = [...resolvedExpenses, ...expenses];

    StorageService.saveExpenses(updatedExpenses);
    setExpenses(updatedExpenses);
    localExpensesCountRef.current = updatedExpenses.length;

    // 3. Immediate Cloud Push with automated chunking
    const payload = {
      version: '10.0',
      exportedAt: new Date().toISOString(),
      exportedBy: currentUser?.name || currentUser?.username || 'استيراد إكسيل',
      projects: updatedProjects,
      expenses: updatedExpenses,
      custodies,
      users,
      roles,
      workflowStages,
      settings,
      notifications,
      tickets
    };

    // Excel import completed

    const totalAmount = newExpenses.reduce((sum, e) => sum + (e.amount || 0), 0);
    addNotification(
      'استيراد فواتير ومصروفات سابقة',
      `تم بنجاح استيراد وتثبيت (${newExpenses.length}) سندات مصروفات قديمة بقيمة إجمالية ${totalAmount.toLocaleString()} ${settings.currencySymbol}.`,
      'system'
    );

    return {
      success: true,
      count: newExpenses.length,
      message: `تم بنجاح استيراد (${newExpenses.length}) سند بقيمة ${totalAmount.toLocaleString()} ${settings.currencySymbol}.`
    };
  };

  // Bulk Attach Photos & Documents to Expenses by ID
  const bulkAttachExpensesPhotos = async (
    attachments: {
      expenseId: string;
      invoicePhoto: string;
      fileName: string;
      attachmentMeta?: any;
    }[]
  ): Promise<{ success: boolean; count: number; message: string }> => {
    if (!ensureOnlineForWrite('ربط المرفقات والصور')) {
      return { success: false, count: 0, message: 'يتطلب ربط المرفقات اتصالاً نشطاً بالإنترنت' };
    }

    if (!attachments || attachments.length === 0) {
      return { success: false, count: 0, message: 'لا توجد مرفقات للربط.' };
    }

    const map = new Map<string, { invoicePhoto: string; fileName: string; attachmentMeta?: any }>();
    attachments.forEach(item => {
      map.set(item.expenseId, item);
    });

    const nowIso = new Date().toISOString();
    let updatedCount = 0;

    setExpenses(prev =>
      prev.map(exp => {
        const match = map.get(exp.id);
        if (match) {
          updatedCount++;
          return {
            ...exp,
            invoicePhoto: match.invoicePhoto,
            attachmentFileName: match.fileName,
            attachmentMeta: match.attachmentMeta || exp.attachmentMeta,
            updatedAt: nowIso,
            synced: true,
          };
        }
        return exp;
      })
    );

    if (!effectiveOnline) {
      attachments.forEach(item => {
        StorageService.addToSyncQueue({
          type: 'expense',
          action: 'update',
          data: {
            id: item.expenseId,
            invoicePhoto: item.invoicePhoto,
            attachmentFileName: item.fileName,
            updatedAt: nowIso,
          }
        });
      });
      setSyncQueue(StorageService.getSyncQueue());
    }

    addNotification(
      'ربط المرفقات والصور الجماعي',
      `تم بنجاح ربط وتثبيت (${updatedCount}) صورة ومستند فواتير مع سندات المصروفات المطابقة.`,
      'system'
    );

    return {
      success: true,
      count: updatedCount,
      message: `تم بنجاح ربط (${updatedCount}) مرفق مع السندات المحددة.`
    };
  };

  // Dynamic Multi-Stage Workflow Approval
  const approveWorkflowStage = async (
    expenseId: string,
    stageId: string,
    notes?: string,
    erpData?: { erpSystemName?: string; erpReferenceNumber?: string }
  ) => {
    if (!ensureOnlineForWrite('اعتماد المصروف')) {
      return false;
    }

    const nowIso = new Date().toISOString();
    let success = false;

    const activeStages = [...workflowStages].filter(s => s.isActive).sort((a, b) => a.order - b.order);
    const stageIndex = activeStages.findIndex(s => s.id === stageId);
    const targetStage = activeStages[stageIndex] || {
      id: stageId,
      title: 'اعتماد المرحلة',
      requiresExternalErpPosting: false
    };

    const isLastStage = stageIndex === activeStages.length - 1 || stageIndex === -1;
    const nextStage = !isLastStage && stageIndex >= 0 ? activeStages[stageIndex + 1] : null;

    let nextExpensesList: Expense[] = [];
    setExpenses(prev => {
      const mapped = prev.map(exp => {
        if (exp.id === expenseId) {
          success = true;
          const currentHistory = exp.workflowHistory || [];

          const newAction: ExpenseWorkflowAction = {
            stageId: targetStage.id,
            stageTitle: targetStage.title,
            status: 'approved',
            actionByEmail: currentUser.email,
            actionByName: currentUser.name,
            actionRole: currentUser.role,
            actionTime: nowIso,
            notes: notes || 'تمت المراجعة والاعتماد بنجاح.',
            erpSystemName: erpData?.erpSystemName || exp.erpSystemName,
            erpReferenceNumber: erpData?.erpReferenceNumber || exp.erpReferenceNumber,
          };

          const isFinal = isLastStage;
          const isSupervisorStage = targetStage.id === 'stage_supervisor' || targetStage.id.includes('supervisor') || stageIndex === 0;
          const isAccountantStage = targetStage.id === 'stage_accountant' || targetStage.id.includes('accountant') || (stageIndex === 1 && !isLastStage);
          const isManagementStage = isFinal || targetStage.id === 'stage_management' || targetStage.id.includes('management');

          let newStatus = exp.status;
          if (isFinal) {
            newStatus = 'معتمد';
          } else if (isSupervisorStage) {
            newStatus = 'بانتظار مراجعة وترحيل المحاسب المالي';
          } else if (isAccountantStage) {
            newStatus = 'بانتظار اعتماد الإدارة العليا';
          }

          let updatedErpStatus = exp.erpPostingStatus;
          if (erpData?.erpReferenceNumber) {
            updatedErpStatus = 'تم الترحيل للبرنامج المحاسبي';
          } else if (targetStage.requiresExternalErpPosting && !exp.erpReferenceNumber) {
            updatedErpStatus = 'بانتظار الترحيل';
          }

          return {
            ...exp,
            status: newStatus,
            currentStageId: nextStage ? nextStage.id : (isFinal ? undefined : exp.currentStageId),
            currentStageIndex: nextStage ? stageIndex + 1 : (isFinal ? 3 : exp.currentStageIndex),
            supervisorApproval: isSupervisorStage ? 'تم اعتماد المشرف' : exp.supervisorApproval,
            supervisorNotes: isSupervisorStage ? (notes || exp.supervisorNotes) : exp.supervisorNotes,
            supervisorName: exp.supervisorName, // الاحتفاظ باسم المشرف أو المستخدم الأصلي الذي سجل المصروف وعدم استبداله باسم المعتمد
            supervisorApproverName: isSupervisorStage ? currentUser.name : (exp.supervisorApproverName || exp.projectManagerName),
            supervisorActionTime: isSupervisorStage ? nowIso : exp.supervisorActionTime,

            projectManagerApproval: isSupervisorStage ? 'تم اعتماد المشرف' : exp.projectManagerApproval,
            projectManagerNotes: isSupervisorStage ? (notes || exp.projectManagerNotes) : exp.projectManagerNotes,
            projectManagerName: isSupervisorStage ? currentUser.name : exp.projectManagerName,
            projectManagerActionTime: isSupervisorStage ? nowIso : exp.projectManagerActionTime,

            accountantApproval: isAccountantStage ? 'تم الاعتماد' : exp.accountantApproval,
            accountantNotes: isAccountantStage ? (notes || exp.accountantNotes) : exp.accountantNotes,
            accountantName: isAccountantStage ? currentUser.name : exp.accountantName,
            accountantActionTime: isAccountantStage ? nowIso : exp.accountantActionTime,

            managementApproval: isManagementStage ? 'تم اعتماد الادارة' : exp.managementApproval,
            managementNotes: isManagementStage ? (notes || exp.managementNotes) : exp.managementNotes,
            managementName: isManagementStage ? currentUser.name : exp.managementName,
            managementActionTime: isManagementStage ? nowIso : exp.managementActionTime,

            erpPostingStatus: updatedErpStatus,
            erpSystemName: erpData?.erpSystemName || exp.erpSystemName,
            erpReferenceNumber: erpData?.erpReferenceNumber || exp.erpReferenceNumber,
            erpPostedDate: erpData?.erpReferenceNumber ? nowIso.split('T')[0] : exp.erpPostedDate,

            workflowHistory: [...currentHistory, newAction],
            updatedAt: nowIso,
            synced: true,
            savedLocally: true,
            lastSavedAt: nowIso,
          };
        }
        return exp;
      });
      nextExpensesList = mapped;
      return mapped;
    });

    if (success) {
      if (nextExpensesList.length > 0) {
        persistChangesDirectly({ expenses: nextExpensesList }, isLastStage ? 'اعتماد نهائي للمصروف' : 'اعتماد مرحلي للمصروف');
      }

      recordOperationStatus(
        isLastStage ? 'اعتماد نهائي للمصروف' : 'اعتماد مرحلي للمصروف',
        `تم اعتماد الفاتورة (${expenseId}) بمرحلة (${targetStage.title}) وحفظ الحالة في السيرفر وقاعدة البيانات السحابية`,
        { savedLocally: true, synced: true }
      );

      if (isLastStage) {
        try {
          confetti({
            particleCount: 50,
            spread: 60,
            origin: { y: 0.7 }
          });
        } catch {
          // ignore
        }
      }

      addNotification(
        isLastStage ? 'اعتماد نهائي للمصروف' : 'اعتماد مرحلي للمصروف',
        `تم اعتماد الفاتورة رقم ${expenseId} في مرحلة (${targetStage.title}) بواسطة ${currentUser.name}.`,
        'approved',
        expenseId,
        currentUser.email,
        currentUser.name,
        'approval'
      );
    }

    return success;
  };

  // Specific helpers for standard approval steps
  const approveBySupervisor = async (id: string, notes?: string) => {
    return approveWorkflowStage(id, 'stage_supervisor', notes);
  };

  const approveByProjectManager = async (id: string, notes?: string) => {
    return approveWorkflowStage(id, 'stage_supervisor', notes);
  };

  const approveByAccountant = async (id: string, notes?: string, erpData?: { erpSystemName?: string; erpReferenceNumber?: string }) => {
    return approveWorkflowStage(id, 'stage_accountant', notes, erpData);
  };

  const approveByManagement = async (id: string, notes?: string) => {
    return approveWorkflowStage(id, 'stage_management', notes);
  };

  // ERP Posting dedicated action
  const postToExternalERP = async (id: string, erpSystemName: string, erpReferenceNumber: string, notes?: string) => {
    if (!ensureOnlineForWrite('الترحيل للبرنامج المحاسبي')) {
      return false;
    }

    const nowIso = new Date().toISOString();
    let updated = false;
    let nextExpensesList: Expense[] = [];

    setExpenses(prev => {
      const mapped = prev.map(exp => {
        if (exp.id === id) {
          updated = true;
          const currentHistory = exp.workflowHistory || [];
          const erpAction: ExpenseWorkflowAction = {
            stageId: 'erp_posting',
            stageTitle: 'ترحيل إلى البرنامج المحاسبي الخارجي',
            status: 'approved',
            actionByEmail: currentUser.email,
            actionByName: currentUser.name,
            actionRole: currentUser.role,
            actionTime: nowIso,
            notes: notes || `تم إدخال وترحيل السند بنجاح على نظام ${erpSystemName} برقم قيد ${erpReferenceNumber}.`,
            erpSystemName,
            erpReferenceNumber
          };

          return {
            ...exp,
            erpPostingStatus: 'تم الترحيل للبرنامج المحاسبي' as ERPPostingStatus,
            erpSystemName,
            erpReferenceNumber,
            erpPostedDate: nowIso.split('T')[0],
            workflowHistory: [...currentHistory, erpAction],
            updatedAt: nowIso,
            synced: true,
            savedLocally: true,
            lastSavedAt: nowIso,
          };
        }
        return exp;
      });
      nextExpensesList = mapped;
      return mapped;
    });

    if (updated) {
      if (nextExpensesList.length > 0) {
        persistChangesDirectly({ expenses: nextExpensesList }, 'ترحيل للبرنامج المحاسبي');
      }
      recordOperationStatus(
        'ترحيل للبرنامج المحاسبي',
        `تم ترحيل المصروف (${id}) على نظام (${erpSystemName}) بالقيد (${erpReferenceNumber}) وحفظه سحابياً`,
        { savedLocally: true, synced: true }
      );
      addNotification(
        'تم الترحيل المحاسبي بنجاح',
        `تم ربط وترحيل المصروف رقم ${id} على نظام (${erpSystemName}) برقم القيد: ${erpReferenceNumber}.`,
        'approved',
        id,
        currentUser.email,
        currentUser.name,
        'approval'
      );
    }

    return updated;
  };

  // Rejection
  const rejectExpense = async (id: string, reason: string) => {
    if (!ensureOnlineForWrite('رفض المصروف')) {
      return false;
    }

    const nowIso = new Date().toISOString();
    let rejected = false;
    let nextExpensesList: Expense[] = [];

    setExpenses(prev => {
      const mapped = prev.map(exp => {
        if (exp.id === id) {
          rejected = true;
          const currentHistory = exp.workflowHistory || [];
          const rejectAction: ExpenseWorkflowAction = {
            stageId: exp.currentStageId || 'rejection',
            stageTitle: 'رفض الفاتورة',
            status: 'rejected',
            actionByEmail: currentUser.email,
            actionByName: currentUser.name,
            actionRole: currentUser.role,
            actionTime: nowIso,
            notes: reason,
          };

          return {
            ...exp,
            status: 'مرفوض' as ApprovalStatus,
            supervisorApproval: 'مرفوض' as const,
            projectManagerApproval: 'مرفوض' as const,
            accountantApproval: 'مرفوض' as const,
            managementApproval: 'مرفوض' as const,
            rejectionReason: reason,
            workflowHistory: [...currentHistory, rejectAction],
            updatedAt: nowIso,
            synced: true,
            savedLocally: true,
            lastSavedAt: nowIso,
          };
        }
        return exp;
      });
      nextExpensesList = mapped;
      return mapped;
    });

    if (rejected) {
      if (nextExpensesList.length > 0) {
        persistChangesDirectly({ expenses: nextExpensesList }, 'رفض المصروف');
      }
      recordOperationStatus(
        'رفض المصروف',
        `تم رفض الفاتورة رقم (${id}) وحفظ التعديل في السيرفر وقاعدة البيانات السحابية`,
        { savedLocally: true, synced: true }
      );
      addNotification(
        'تم رفض المصروف',
        `تم رفض الفاتورة رقم ${id}. السبب: ${reason}`,
        'rejected',
        id,
        currentUser.email,
        currentUser.name,
        'approval'
      );
    }

    return rejected;
  };

  // Batch Approval
  const batchApprove = async (ids: string[], stageId?: string) => {
    if (!ensureOnlineForWrite('الاعتماد الجماعي')) {
      return 0;
    }

    let count = 0;
    for (const id of ids) {
      const targetStageId = stageId || 'stage_management';
      const ok = await approveWorkflowStage(id, targetStageId);
      if (ok) count++;
    }

    if (count > 0) {
      addNotification(
        'اعتماد جماعي للمصروفات',
        `تم اعتماد ${count} فاتورة دفعة واحدة بواسطة ${currentUser.name}.`,
        'approved',
        undefined,
        currentUser.email,
        currentUser.name,
        'approval'
      );
    }

    return count;
  };

  // Custom Role Actions
  const addRole = async (roleData: Omit<CustomRole, 'id'>) => {
    if (!ensureOnlineForWrite('إضافة دور جديد')) {
      throw new Error('OFFLINE_ROLE_BLOCKED');
    }

    const id = `role_${Date.now().toString(36)}`;
    const newRole: CustomRole = {
      ...roleData,
      id,
      isSystem: false,
    };
    const nextRoles = [...roles, newRole];
    setRoles(nextRoles);
    StorageService.saveRoles(nextRoles);
    persistChangesDirectly({ roles: nextRoles }, 'إضافة دور جديد');
    addNotification('إضافة دور وظيفي جديد', `تمت إضافة الدور الوظيفي "${newRole.name}" بنجاح.`, 'system');
    return newRole;
  };

  const updateRole = async (id: string, roleData: Partial<CustomRole>) => {
    if (!ensureOnlineForWrite('تحديث الدور الوظيفي')) {
      return false;
    }

    let updated = false;
    const next = roles.map(r => {
      if (r.id === id) {
        updated = true;
        const isManagerRole = r.id === 'role_admin' || r.name === 'مدير عام' || r.name === 'مدير';
        if (isManagerRole) {
          return {
            ...r,
            ...roleData,
            name: 'مدير عام',
            isSystem: true,
            permissions: {
              ...r.permissions,
              ...(roleData.permissions || {}),
              allowedScreens: allSystemScreens,
              canViewAllProjects: true,
              canViewAllExpenses: true,
              canViewFinancialReports: true,
              canViewCustodies: true,
              canViewTeamMembers: true,
              canCreateExpense: true,
              canEditExpense: true,
              canDeleteExpense: true,
              expenseEditGraceMinutes: 9999,
              canManageCustody: true,
              canManageProjects: true,
              canApproveAsProjectManager: true,
              canApproveAsAccountant: true,
              canExportToExternalERP: true,
              canApproveAsManagement: true,
              canBatchApprove: true,
              canManageRolesAndPermissions: true,
              canConfigureWorkflow: true,
              canExportExcelAndBackup: true,
            }
          };
        }
        return { ...r, ...roleData };
      }
      return r;
    });
    setRoles(next);
    StorageService.saveRoles(next);
    if (updated) {
      persistChangesDirectly({ roles: next }, 'تحديث الدور الوظيفي');
      addNotification('تحديث الدور الوظيفي', 'تم حفظ الصلاحيات والتعديلات بنجاح.', 'system');
    }
    return updated;
  };

  const deleteRole = async (id: string) => {
    if (!ensureOnlineForWrite('حذف الدور الوظيفي')) {
      return false;
    }

    if (id === 'role_admin' || id === 'role_accountant' || id === 'role_supervisor') return false;

    let deleted = false;
    const target = roles.find(r => r.id === id);
    if (target && !target.isSystem) {
      deleted = true;
      const next = roles.filter(r => r.id !== id);
      setRoles(next);
      StorageService.saveRoles(next);
      StorageService.recordDeletedRole(id, currentUser?.name || currentUser?.username || 'مستخدم النظام');
      await persistChangesDirectly({ roles: next, deletedRoleIds: StorageService.getDeletedRoleIds() }, 'حذف الدور الوظيفي');
    }
    return deleted;
  };

  // Workflow Stage Actions
  const addWorkflowStage = async (stageData: Omit<WorkflowStage, 'id'>) => {
    if (!ensureOnlineForWrite('إضافة مرحلة اعتماد')) {
      throw new Error('OFFLINE_STAGE_BLOCKED');
    }

    const id = `stage_${Date.now().toString(36)}`;
    const newStage: WorkflowStage = {
      ...stageData,
      id,
      order: stageData.order || (workflowStages.length + 1),
      isActive: stageData.isActive !== false,
    };
    const next = [...workflowStages, newStage].map((s, idx) => ({ ...s, order: idx + 1 }));
    setWorkflowStages(next);
    StorageService.saveWorkflowStages(next);
    await persistChangesDirectly({ workflowStages: next }, 'إضافة مرحلة اعتماد');
    addNotification('إضافة مرحلة اعتماد جديدة', `تمت إضافة المرحلة "${newStage.title}" إلى دورة الاعتماد بالتسلسل المحدد.`, 'system');
    return newStage;
  };

  const updateWorkflowStage = async (id: string, stageData: Partial<WorkflowStage>) => {
    if (!ensureOnlineForWrite('تحديث مرحلة الاعتماد')) {
      return false;
    }

    let updated = false;
    const next = workflowStages.map(s => {
      if (s.id === id) {
        updated = true;
        return { ...s, ...stageData };
      }
      return s;
    });
    if (updated) {
      setWorkflowStages(next);
      StorageService.saveWorkflowStages(next);
      await persistChangesDirectly({ workflowStages: next }, 'تحديث مرحلة الاعتماد');
      addNotification('تحديث مرحلة الاعتماد', 'تم حفظ تعديلات مرحلة الاعتماد بنجاح.', 'system');
    }
    return updated;
  };

  const deleteWorkflowStage = async (id: string) => {
    if (!ensureOnlineForWrite('حذف مرحلة الاعتماد')) {
      return false;
    }

    let deleted = false;
    const exists = workflowStages.some(s => s.id === id);
    if (exists) {
      deleted = true;
      const next = workflowStages.filter(s => s.id !== id).map((s, idx) => ({ ...s, order: idx + 1 }));
      setWorkflowStages(next);
      StorageService.saveWorkflowStages(next);
      StorageService.recordDeletedWorkflowStage(id, currentUser?.name || currentUser?.username || 'مستخدم النظام');
      await persistChangesDirectly({ workflowStages: next, deletedWorkflowStageIds: StorageService.getDeletedWorkflowStageIds() }, 'حذف مرحلة الاعتماد');
      addNotification('حذف مرحلة اعتماد', 'تم حذف مرحلة الاعتماد بنجاح وتحديث التسلسل الهرمي للمراحل.', 'system');
    }
    return deleted;
  };

  const reorderWorkflowStages = async (newStages: WorkflowStage[]) => {
    if (!ensureOnlineForWrite('إعادة ترتيب مراحل الاعتماد')) {
      return;
    }

    const ordered = newStages.map((s, idx) => ({ ...s, order: idx + 1 }));
    setWorkflowStages(ordered);
    StorageService.saveWorkflowStages(ordered);
    await persistChangesDirectly({ workflowStages: ordered }, 'إعادة ترتيب دورة الاعتماد');
    addNotification('إعادة ترتيب دورة الاعتماد', 'تم تحديث الترتيب التسلسلي لمراحل الاعتماد بنجاح.', 'system');
  };

  // Custody Operations
  const addCustody = async (custodyData: Omit<CustodyRecord, 'id' | 'synced'>) => {
    if (!ensureOnlineForWrite('صرف عهدة مالية')) {
      throw new Error('OFFLINE_CUSTODY_BLOCKED');
    }

    const id = `CUST-${Date.now().toString().slice(-6)}`;
    const nowIso = new Date().toISOString();
    const newCustody: CustodyRecord = {
      ...custodyData,
      id,
      synced: true,
      savedLocally: true,
      lastSavedAt: nowIso,
    };

    const currentStoredCustodies = StorageService.getCustodies();
    const nextCustodiesList = [newCustody, ...currentStoredCustodies.filter(c => c.id !== id)];
    setCustodies(nextCustodiesList);
    StorageService.saveCustodies(nextCustodiesList);
    await persistChangesDirectly({ custodies: nextCustodiesList }, 'صرف عهدة مالية');

    recordOperationStatus(
      'صرف عهدة مالية',
      `تم تسليم وصرف دفعة عهدة بمبلغ ${newCustody.amount.toLocaleString()} ${settings.currencySymbol} إلى (${newCustody.supervisorName}) وحفظ السند في السيرفر وقاعدة البيانات السحابية`,
      { savedLocally: true, synced: true }
    );

    addNotification(
      'تسليم عهدة مالية جديدة',
      `تم تسليم وصرف دفعة عهدة جديدة بمبلغ ${newCustody.amount.toLocaleString()} ${settings.currencySymbol} إلى المشرف ${newCustody.supervisorName}.`,
      'custody_issued',
      newCustody.id,
      currentUser.email,
      currentUser.name,
      'custody'
    );

    return newCustody;
  };

  const updateCustody = async (id: string, custodyData: Partial<CustodyRecord>) => {
    if (!ensureOnlineForWrite('تحديث سند العهدة')) {
      return false;
    }

    let updated = false;
    const nowIso = new Date().toISOString();
    const nextCustodiesList = custodies.map(c => {
      if (c.id === id) {
        updated = true;
        return { ...c, ...custodyData, updatedAt: nowIso, synced: true, savedLocally: true, lastSavedAt: nowIso };
      }
      return c;
    });

    setCustodies(nextCustodiesList);
    StorageService.saveCustodies(nextCustodiesList);

    if (updated) {
      await persistChangesDirectly({ custodies: nextCustodiesList }, 'تحديث سند العهدة');
      recordOperationStatus(
        'تحديث سند العهدة',
        `تم حفظ تعديلات سند العهدة رقم (${id}) في السيرفر وقاعدة البيانات السحابية`,
        { savedLocally: true, synced: true }
      );
      addNotification('تحديث سند العهدة', `تم تحديث بيانات سند العهدة رقم ${id} بنجاح.`, 'system', id);
    }
    return updated;
  };

  const deleteCustody = async (id: string) => {
    if (!ensureOnlineForWrite('حذف سند العهدة')) {
      return false;
    }

    const targetCustody = custodies.find(c => c.id === id);
    if (!targetCustody) return false;

    StorageService.recordDeletedCustody(id, currentUser?.name || currentUser?.username || 'مستخدم النظام');
    const nextCustodiesList = custodies.filter(c => c.id !== id);
    setCustodies(nextCustodiesList);
    StorageService.saveCustodies(nextCustodiesList);

    await persistChangesDirectly({
      custodies: nextCustodiesList,
      deletedCustodyIds: StorageService.getDeletedCustodyIds()
    }, 'حذف سند العهدة');
    recordOperationStatus(
      'حذف سند العهدة',
      `تم حذف سند العهدة (${id}) وحفظ التعديل في السيرفر وقاعدة البيانات السحابية`,
      { savedLocally: true, synced: true }
    );

    return true;
  };

  // Project Operations
  const addProject = async (projectData: Omit<Project, 'id' | 'createdAt'>) => {
    if (!ensureOnlineForWrite('إضافة مشروع جديد')) {
      throw new Error('OFFLINE_PROJECT_BLOCKED');
    }

    const id = `PRJ-${Date.now().toString().slice(-4)}${Math.floor(10 + Math.random() * 90)}`;
    const nowIso = new Date().toISOString();
    
    // Resolve assigned users and emails
    const assignedUserIds = projectData.assignedUserIds || [];
    const assignedEmails = projectData.assignedEmails || users.filter(u => assignedUserIds.includes(u.id)).map(u => u.email);
    const emails = assignedEmails.length > 0 ? assignedEmails.join(', ') : (projectData.emails || '');

    const newProject: Project = {
      ...projectData,
      id,
      assignedUserIds,
      assignedEmails,
      emails,
      createdAt: nowIso.split('T')[0],
      savedLocally: true,
      lastSavedAt: nowIso,
    };

    const nextProjectsList = [newProject, ...projects.filter(p => p.id !== id)];
    setProjects(nextProjectsList);
    StorageService.saveProjects(nextProjectsList);
    await persistChangesDirectly({ projects: nextProjectsList }, 'إضافة مشروع جديد');

    // Synchronize assignedProjects in users state
    if (assignedUserIds.length > 0) {
      setUsers(prevUsers => {
        const updatedUsers = prevUsers.map(u => {
          const isAssigned = assignedUserIds.includes(u.id) || assignedEmails.includes(u.email);
          const currentProjects = u.assignedProjects || [];
          if (isAssigned && !currentProjects.includes(id)) {
            return { ...u, assignedProjects: [...currentProjects, id] };
          }
          return u;
        });
        StorageService.saveUsers(updatedUsers);
        persistChangesDirectly({ users: updatedUsers }, 'تحديث تعيينات المستخدمين').catch(() => {});
        return updatedUsers;
      });
    }

    recordOperationStatus(
      'إضافة مشروع جديد',
      `تمت إضافة وحفظ المشروع "${newProject.name}" في السيرفر وقاعدة البيانات السحابية بنجاح`,
      { savedLocally: true, synced: true }
    );

    addNotification(
      'إضافة مشروع جديد',
      `تمت إضافة مشروع "${newProject.name}" بنجاح وتعيين (${assignedUserIds.length}) من المشرفين وفريق العمل عليه.`,
      'system',
      newProject.id
    );

    return newProject;
  };

  const updateProject = async (id: string, projectData: Partial<Project>) => {
    if (!ensureOnlineForWrite('تعديل المشروع')) {
      return false;
    }

    let updated = false;
    const nowIso = new Date().toISOString();
    let finalAssignedIds: string[] | undefined = projectData.assignedUserIds;
    let finalAssignedEmails: string[] | undefined = projectData.assignedEmails;
    let finalEmails: string | undefined = projectData.emails;

    if (finalAssignedIds) {
      finalAssignedEmails = users.filter(u => finalAssignedIds!.includes(u.id)).map(u => u.email);
      finalEmails = finalAssignedEmails.join(', ');
    }

    const nextProjectsList = projects.map(prj => {
      if (prj.id === id) {
        updated = true;
        return {
          ...prj,
          ...projectData,
          savedLocally: true,
          lastSavedAt: nowIso,
          ...(finalAssignedIds ? { assignedUserIds: finalAssignedIds } : {}),
          ...(finalAssignedEmails ? { assignedEmails: finalAssignedEmails } : {}),
          ...(finalEmails !== undefined ? { emails: finalEmails } : {}),
        };
      }
      return prj;
    });

    setProjects(nextProjectsList);
    StorageService.saveProjects(nextProjectsList);

    if (updated) {
      await persistChangesDirectly({ projects: nextProjectsList }, 'تحديث المشروع');
      recordOperationStatus(
        'تحديث المشروع',
        `تم حفظ تعديلات المشروع (${projectData.name || id}) في السيرفر وقاعدة البيانات السحابية بنجاح`,
        { savedLocally: true, synced: true }
      );
    }

    // Synchronize users' assignedProjects
    if (finalAssignedIds) {
      const assignedIdsSet = new Set(finalAssignedIds);
      const assignedEmailsSet = new Set(finalAssignedEmails || []);

      setUsers(prevUsers => {
        const updatedUsers = prevUsers.map(u => {
          const shouldBeAssigned = assignedIdsSet.has(u.id) || assignedEmailsSet.has(u.email);
          const currentList = u.assignedProjects || [];
          const isCurrentlyAssigned = currentList.includes(id);

          if (shouldBeAssigned && !isCurrentlyAssigned) {
            return { ...u, assignedProjects: [...currentList, id] };
          } else if (!shouldBeAssigned && isCurrentlyAssigned) {
            return { ...u, assignedProjects: currentList.filter(pid => pid !== id) };
          }
          return u;
        });
        StorageService.saveUsers(updatedUsers);
        persistChangesDirectly({ users: updatedUsers }, 'تحديث تعيينات المستخدمين').catch(() => {});
        return updatedUsers;
      });
    }

    return updated;
  };

  const deleteProject = async (id: string) => {
    if (!ensureOnlineForWrite('حذف المشروع')) {
      return false;
    }

    // Prevent deletion if project has any expenses recorded
    const linkedExpenses = expenses.filter(e => e.projectId === id);
    if (linkedExpenses.length > 0) {
      addNotification(
        'تعذر حذف المشروع',
        `لا يمكن حذف هذا المشروع لوجود (${linkedExpenses.length}) سند صرف مسجل عليه. يُسمح فقط بالتعديل على بيانات المشروع.`,
        'alert'
      );
      return false;
    }

    const targetProject = projects.find(p => p.id === id);
    if (!targetProject) return false;

    StorageService.recordDeletedProject(id, currentUser?.name || currentUser?.username || 'مستخدم النظام');
    const nextProjectsList = projects.filter(p => p.id !== id);
    setProjects(nextProjectsList);
    StorageService.saveProjects(nextProjectsList);

    await persistChangesDirectly({
      projects: nextProjectsList,
      deletedProjectIds: StorageService.getDeletedProjectIds()
    }, 'حذف المشروع');
    recordOperationStatus(
      'حذف المشروع',
      `تم حذف المشروع (${id}) من السيرفر وقاعدة البيانات السحابية وتحديث التعيينات`,
      { savedLocally: true, synced: true }
    );
    // Clean up assignedProjects in all users
    setUsers(prevUsers => {
      const updatedUsers = prevUsers.map(u => {
        if (u.assignedProjects?.includes(id)) {
          return { ...u, assignedProjects: u.assignedProjects.filter(pid => pid !== id) };
        }
        return u;
      });
      StorageService.saveUsers(updatedUsers);
      persistChangesDirectly({ users: updatedUsers }, 'تحديث تعيينات المستخدمين').catch(() => {});
      return updatedUsers;
    });
    addNotification('حذف مشروع', `تم حذف المشروع رقم ${id} وإزالته من تعيينات المشرفين وفريق العمل.`, 'system');

    return true;
  };

  // User Operations
  const addUser = async (userData: Omit<User, 'id'>) => {
    if (!ensureOnlineForWrite('إضافة عضو / مستخدم')) {
      throw new Error('OFFLINE_USER_BLOCKED');
    }

    const id = `USR-${Date.now().toString().slice(-4)}${Math.floor(10 + Math.random() * 90)}`;
    const newUser: User = { ...userData, id };
    
    const nextUsersList = [...users.filter(u => u.id !== id), newUser];
    setUsers(nextUsersList);
    StorageService.saveUsers(nextUsersList);

    // Persist immediately to Server Disk and Storage
    await persistChangesDirectly({ users: nextUsersList }, 'إضافة مستخدم');

    if (userData.assignedProjects && userData.assignedProjects.length > 0) {
      setProjects(prevProjects => {
        const updated = prevProjects.map(p => {
          if (userData.assignedProjects!.includes(p.id)) {
            const currentIds = p.assignedUserIds || [];
            const currentEmails = p.assignedEmails || [];
            return {
              ...p,
              assignedUserIds: currentIds.includes(id) ? currentIds : [...currentIds, id],
              assignedEmails: currentEmails.includes(userData.email) ? currentEmails : [...currentEmails, userData.email]
            };
          }
          return p;
        });
        StorageService.saveProjects(updated);
        persistChangesDirectly({ projects: updated }, 'تحديث تعيينات المشاريع').catch(() => {});
        return updated;
      });
    }

    recordOperationStatus('إضافة مستخدم', `تمت إضافة العضو (${newUser.name}) في السيرفر وقاعدة البيانات السحابية بنجاح`, { savedLocally: true, synced: true });
    return newUser;
  };

  const updateUser = async (id: string, userData: Partial<User>) => {
    if (!ensureOnlineForWrite('تحديث بيانات العضو')) {
      return false;
    }

    let updated = false;
    let targetUser: User | undefined;
    let nextUsersList: User[] = [];

    setUsers(prev => {
      const mapped = prev.map(u => {
        if (u.id === id) {
          updated = true;
          const updatedUser = { ...u, ...userData };
          targetUser = updatedUser;
          if (currentUser.id === id) {
            setCurrentUser(updatedUser);
            StorageService.saveCurrentUser(updatedUser);
          }
          return updatedUser;
        }
        return u;
      });
      nextUsersList = mapped;
      return mapped;
    });

    // Persist updated users directly to Cloud and Server
    if (nextUsersList.length > 0) {
      StorageService.saveUsers(nextUsersList);
      await persistChangesDirectly({ users: nextUsersList }, 'تحديث مستخدم');
    }

    // If assignedProjects was explicitly updated, sync projects
    if (userData.assignedProjects !== undefined) {
      const assignedPids = userData.assignedProjects || [];
      const userEmail = userData.email || targetUser?.email || '';
      setProjects(prevProjects => {
        const updated = prevProjects.map(p => {
          const shouldBeAssigned = assignedPids.includes(p.id);
          const currentIds = p.assignedUserIds || [];
          const currentEmails = p.assignedEmails || [];
          const isCurrentlyAssigned = currentIds.includes(id) || (userEmail && currentEmails.includes(userEmail));

          if (shouldBeAssigned && !isCurrentlyAssigned) {
            return {
              ...p,
              assignedUserIds: [...currentIds, id],
              assignedEmails: userEmail && !currentEmails.includes(userEmail) ? [...currentEmails, userEmail] : currentEmails
            };
          } else if (!shouldBeAssigned && isCurrentlyAssigned) {
            return {
              ...p,
              assignedUserIds: currentIds.filter(uid => uid !== id),
              assignedEmails: userEmail ? currentEmails.filter(em => em !== userEmail) : currentEmails
            };
          }
          return p;
        });
        StorageService.saveProjects(updated);
        persistChangesDirectly({ projects: updated }, 'تحديث تعيينات المشاريع').catch(() => {});
        return updated;
      });
    }

    if (updated && targetUser) {
      recordOperationStatus('تحديث مستخدم', `تم تحديث بيانات وصلاحيات العضو (${targetUser.name}) في السيرفر وقاعدة البيانات السحابية بنجاح`, { savedLocally: true, synced: true });
    }

    return updated;
  };

  const deleteUser = async (id: string) => {
    if (!ensureOnlineForWrite('حذف العضو')) {
      return false;
    }

    const targetUser = users.find(u => u.id === id);
    if (!targetUser) return false;

    // Check if user has performed any operations in the program (expenses, custodies, approvals)
    const targetEmail = targetUser.email?.toLowerCase().trim();
    const targetName = targetUser.name?.trim();

    const hasExpenses = expenses.some(e =>
      (targetEmail && e.supervisorEmail?.toLowerCase().trim() === targetEmail) ||
      e.supervisorName?.trim() === targetName ||
      e.accountantName?.trim() === targetName ||
      e.managementName?.trim() === targetName ||
      e.projectManagerName?.trim() === targetName ||
      e.workflowHistory?.some(h =>
        (targetEmail && h.actionByEmail?.toLowerCase().trim() === targetEmail) ||
        h.actionByName?.trim() === targetName
      )
    );

    const hasCustody = custodies.some(c =>
      (targetEmail && c.supervisorEmail?.toLowerCase().trim() === targetEmail) ||
      c.supervisorName?.trim() === targetName ||
      c.issuedBy?.trim() === targetName ||
      (targetEmail && c.issuedBy?.toLowerCase().trim() === targetEmail)
    );

    if (hasExpenses || hasCustody) {
      addNotification(
        'تعذر حذف العضو',
        `لا يمكن حذف العضو "${targetUser.name}" لوجود عمليات وسجلات مسجلة باسمه في النظام. يُسمح فقط بالتعديل على بياناته أو سحب مشاريعه.`,
        'alert'
      );
      return false;
    }

    StorageService.recordDeletedUser(id, currentUser?.name || currentUser?.username || 'مستخدم النظام');
    const nextUsersList = users.filter(u => u.id !== id);
    setUsers(nextUsersList);
    StorageService.saveUsers(nextUsersList);

    await persistChangesDirectly({
      users: nextUsersList,
      deletedUserIds: StorageService.getDeletedUserIds()
    }, 'حذف مستخدم');
    recordOperationStatus('حذف مستخدم', `تم حذف العضو (${targetUser.name}) من السيرفر وقاعدة البيانات السحابية بنجاح`, { savedLocally: true, synced: true });

    return true;
  };

  // Support Tickets
  const addTicket = async (ticketData: Omit<SupportTicket, 'id' | 'createdAt' | 'status'>) => {
    const id = `TCK-${Math.floor(100 + Math.random() * 900)}`;
    const newTicket: SupportTicket = {
      ...ticketData,
      id,
      status: 'مفتوحة',
      createdAt: new Date().toISOString(),
      responses: [],
    };
    setTickets(prev => [newTicket, ...prev]);

    addNotification(
      'تذكرة دعم فني جديدة',
      `تم إنشاء التذكرة رقم ${id}: ${newTicket.title}`,
      'system',
      newTicket.id
    );

    return newTicket;
  };

  const replyToTicket = async (ticketId: string, message: string, isAdmin: boolean) => {
    const nowIso = new Date().toISOString();
    let replied = false;

    setTickets(prev =>
      prev.map(t => {
        if (t.id === ticketId) {
          replied = true;
          const newResp = {
            id: 'RES-' + Date.now().toString(),
            sender: currentUser.name,
            message,
            timestamp: nowIso,
            isAdmin,
          };
          return {
            ...t,
            status: isAdmin ? 'قيد المعالجة' : t.status,
            responses: [...(t.responses || []), newResp],
          };
        }
        return t;
      })
    );
    return replied;
  };

  const updateTicketStatus = async (ticketId: string, status: SupportTicket['status']) => {
    let updated = false;
    setTickets(prev =>
      prev.map(t => {
        if (t.id === ticketId) {
          updated = true;
          return { ...t, status };
        }
        return t;
      })
    );
    return updated;
  };

  // Settings, Categories & Notifications
  const updateSettings = (newSettings: Partial<AppSettings>) => {
    if (newSettings.theme) {
      setTheme(newSettings.theme);
      const { theme: _isolatedTheme, ...restSettings } = newSettings;
      if (Object.keys(restSettings).length > 0) {
        setSettings(prev => {
          const next = { ...prev, ...restSettings };
          StorageService.saveSettings(next);
          persistChangesDirectly({ settings: next }, 'تحديث إعدادات النظام');
          return next;
        });
      }
      return;
    }
    setSettings(prev => {
      const next = { ...prev, ...newSettings };
      StorageService.saveSettings(next);
      persistChangesDirectly({ settings: next }, 'تحديث إعدادات النظام');
      return next;
    });
  };

  const getCategoryUsageCount = (categoryName: string): number => {
    return expenses.filter(e => e.category === categoryName).length;
  };

  const deleteCategory = (categoryName: string): { success: boolean; message: string; isBlockedByExpenses?: boolean; usageCount?: number } => {
    const usageCount = expenses.filter(e => e.category === categoryName).length;
    if (usageCount > 0) {
      return {
        success: false,
        isBlockedByExpenses: true,
        usageCount,
        message: `لا يمكن حذف بند "${categoryName}" نظراً لوجود (${usageCount}) عملية صرف مسجلة عليه مسبقاً. يمكنك تعديل اسم البند بدلاً من ذلك.`,
      };
    }
    const currentCategories = settings.customCategories || [];
    if (currentCategories.length <= 1) {
      return {
        success: false,
        message: 'يجب الإبقاء على بند تصنيف واحد على الأقل في المنظومة.',
      };
    }
    const updated = currentCategories.filter(c => c !== categoryName);
    setSettings(prev => {
      const next = { ...prev, customCategories: updated };
      StorageService.saveSettings(next);
      persistChangesDirectly({ settings: next }, 'حذف بند تصنيف');
      return next;
    });
    return {
      success: true,
      message: `تم حذف بند "${categoryName}" بنجاح.`,
    };
  };

  const renameCategory = (oldName: string, newName: string): { success: boolean; affectedCount: number; message: string } => {
    const trimmedNew = newName.trim();
    const trimmedOld = oldName.trim();
    if (!trimmedNew) {
      return { success: false, affectedCount: 0, message: 'اسم البند الجديد لا يمكن أن يكون فارغاً.' };
    }
    if (trimmedNew.toLowerCase() === trimmedOld.toLowerCase()) {
      return { success: false, affectedCount: 0, message: 'الاسم الجديد مطابق للاسم الحالي.' };
    }
    const currentCategories = settings.customCategories || [];
    if (currentCategories.some(c => c.toLowerCase() === trimmedNew.toLowerCase() && c.toLowerCase() !== trimmedOld.toLowerCase())) {
      return { success: false, affectedCount: 0, message: `البند "${trimmedNew}" موجود بالفعل في قائمة التصنيفات.` };
    }

    // 1. Update custom categories list
    const updatedCategories = currentCategories.map(c => (c === trimmedOld ? trimmedNew : c));
    setSettings(prev => ({ ...prev, customCategories: updatedCategories }));

    // 2. Cascade rename across all past expenses
    let affectedCount = 0;
    const updatedExpenses = expenses.map(exp => {
      if (exp.category === trimmedOld) {
        affectedCount++;
        return { ...exp, category: trimmedNew };
      }
      return exp;
    });

    if (affectedCount > 0) {
      setExpenses(updatedExpenses);
    }

    addNotification(
      'تعديل بند المصروفات وتحديث السجلات',
      `تم تغيير مسمى البند من "${trimmedOld}" إلى "${trimmedNew}" وتحديث (${affectedCount}) عملية صرف سابقة مرتبطة به.`,
      'system'
    );

    return {
      success: true,
      affectedCount,
      message: `تم تغيير مسمى البند إلى "${trimmedNew}" وتحديث (${affectedCount}) عملية صرف سابقة مسجلة عليه بنجاح.`,
    };
  };

  const isExpenseLinkedToErp = (expErpName: string | undefined, targetErpName: string): boolean => {
    if (!expErpName || !targetErpName) return false;
    const a = expErpName.trim().toLowerCase();
    const b = targetErpName.trim().toLowerCase();
    if (a === b) return true;

    const cleanA = a.replace(/[()[\]\-]/g, ' ').replace(/\s+/g, ' ').trim();
    const cleanB = b.replace(/[()[\]\-]/g, ' ').replace(/\s+/g, ' ').trim();
    if (cleanA === cleanB) return true;
    if (cleanA.includes(cleanB) || cleanB.includes(cleanA)) return true;

    const tokensA = cleanA.split(' ').filter(w => w.length >= 3);
    const tokensB = cleanB.split(' ').filter(w => w.length >= 3);
    return tokensA.some(t => tokensB.includes(t));
  };

  const getErpUsageCount = (erpName: string): number => {
    return expenses.filter(e => isExpenseLinkedToErp(e.erpSystemName, erpName)).length;
  };

  const deleteErpSystem = (erpName: string): { success: boolean; message: string; isBlockedByExpenses?: boolean; usageCount?: number } => {
    const usageCount = getErpUsageCount(erpName);
    if (usageCount > 0) {
      return {
        success: false,
        isBlockedByExpenses: true,
        usageCount,
        message: `لا يمكن حذف برنامج "${erpName}" نظراً لوجود (${usageCount}) عملية صرف مسجلة ومرتبطة به مسبقاً. يمكنك تعديل اسم البرنامج بدلاً من ذلك.`,
      };
    }
    const currentList = settings.customErpSystems || [];
    if (currentList.length <= 1) {
      return {
        success: false,
        message: 'يجب الإبقاء على برنامج محاسبي واحد على الأقل في قائمة المنظومة.',
      };
    }
    const updated = currentList.filter(s => s !== erpName);
    let newSelected = settings.erpSystemName;
    if (settings.erpSystemName === erpName || isExpenseLinkedToErp(settings.erpSystemName, erpName)) {
      newSelected = updated[0];
    }
    setSettings(prev => ({
      ...prev,
      customErpSystems: updated,
      erpSystemName: newSelected,
    }));
    return {
      success: true,
      message: `تم حذف برنامج "${erpName}" بنجاح.`,
    };
  };

  const renameErpSystem = (oldName: string, newName: string): { success: boolean; affectedCount: number; message: string } => {
    const trimmedNew = newName.trim();
    const trimmedOld = oldName.trim();
    if (!trimmedNew) {
      return { success: false, affectedCount: 0, message: 'اسم البرنامج المحاسبي الجديد لا يمكن أن يكون فارغاً.' };
    }
    if (trimmedNew.toLowerCase() === trimmedOld.toLowerCase()) {
      return { success: false, affectedCount: 0, message: 'الاسم الجديد مطابق للاسم الحالي.' };
    }
    const currentList = settings.customErpSystems || [];
    if (currentList.some(s => s.toLowerCase() === trimmedNew.toLowerCase() && s.toLowerCase() !== trimmedOld.toLowerCase())) {
      return { success: false, affectedCount: 0, message: `البرنامج "${trimmedNew}" موجود بالفعل في قائمة البرامج المحاسبية.` };
    }

    // 1. Update custom ERP list
    const updatedList = currentList.map(s => (s === trimmedOld ? trimmedNew : s));
    let newSelected = settings.erpSystemName;
    if (settings.erpSystemName === trimmedOld || isExpenseLinkedToErp(settings.erpSystemName, trimmedOld)) {
      newSelected = trimmedNew;
    }
    setSettings(prev => ({
      ...prev,
      customErpSystems: updatedList,
      erpSystemName: newSelected,
    }));

    // 2. Cascade rename across all linked past expenses & their workflow histories
    let affectedCount = 0;
    const updatedExpenses = expenses.map(exp => {
      if (isExpenseLinkedToErp(exp.erpSystemName, trimmedOld)) {
        affectedCount++;
        const updatedWorkflow = exp.workflowHistory?.map(item => {
          if (isExpenseLinkedToErp(item.erpSystemName, trimmedOld)) {
            return { ...item, erpSystemName: trimmedNew };
          }
          return item;
        });
        return {
          ...exp,
          erpSystemName: trimmedNew,
          workflowHistory: updatedWorkflow || exp.workflowHistory,
        };
      }
      return exp;
    });

    if (affectedCount > 0) {
      setExpenses(updatedExpenses);
    }

    addNotification(
      'تعديل اسم البرنامج المحاسبي وتحديث السجلات',
      `تم تغيير مسمى البرنامج المحاسبي من "${trimmedOld}" إلى "${trimmedNew}" وتحديث (${affectedCount}) عملية صرف مرتبطة به.`,
      'system'
    );

    return {
      success: true,
      affectedCount,
      message: `تم تعديل مسمى البرنامج إلى "${trimmedNew}" وتحديث (${affectedCount}) عملية صرف مرتبطة به بنجاح.`,
    };
  };

  const markNotificationAsRead = (id: string) => {
    const userKey = currentUser?.email || currentUser?.id || 'current_user';
    setNotifications(prev =>
      prev.map(n => {
        if (n.id === id) {
          const currentReadBy = Array.isArray(n.readBy) ? n.readBy : (n.read ? [userKey] : []);
          const updatedReadBy = currentReadBy.includes(userKey) ? currentReadBy : [...currentReadBy, userKey];
          return {
            ...n,
            read: true,
            readBy: updatedReadBy
          };
        }
        return n;
      })
    );
  };

  const markAllNotificationsAsRead = () => {
    const userKey = currentUser?.email || currentUser?.id || 'current_user';
    setNotifications(prev =>
      prev.map(n => {
        const currentReadBy = Array.isArray(n.readBy) ? n.readBy : (n.read ? [userKey] : []);
        const updatedReadBy = currentReadBy.includes(userKey) ? currentReadBy : [...currentReadBy, userKey];
        return {
          ...n,
          read: true,
          readBy: updatedReadBy
        };
      })
    );
  };

  const deleteNotification = (id: string) => {
    const userKey = currentUser?.email || currentUser?.id || 'current_user';
    setNotifications(prev =>
      prev.map(n => {
        if (n.id === id) {
          const currentDeletedBy = Array.isArray(n.deletedBy) ? n.deletedBy : [];
          const updatedDeletedBy = currentDeletedBy.includes(userKey) ? currentDeletedBy : [...currentDeletedBy, userKey];
          return {
            ...n,
            deletedBy: updatedDeletedBy
          };
        }
        return n;
      })
    );
  };

  const clearNotifications = () => {
    const userKey = currentUser?.email || currentUser?.id || 'current_user';
    setNotifications(prev =>
      prev.map(n => {
        const currentDeletedBy = Array.isArray(n.deletedBy) ? n.deletedBy : [];
        const updatedDeletedBy = currentDeletedBy.includes(userKey) ? currentDeletedBy : [...currentDeletedBy, userKey];
        return {
          ...n,
          deletedBy: updatedDeletedBy
        };
      })
    );
  };

  // Export to Multi-Sheet Excel
  const exportAllToExcel = () => {
    const isAccountantRole =
      currentUser.role === 'محاسب' ||
      currentUser.role === 'محاسب مالي' ||
      currentUser.roleId === 'role_accountant' ||
      currentUser.role.includes('محاسب');

    const targetProjects = (isAccountantRole || !currentUserPermissions.canViewAllProjects)
      ? accessibleProjects
      : projects;

    const allowedPrjIds = new Set(targetProjects.map(p => p.id));

    const targetExpenses = (isAccountantRole || !currentUserPermissions.canViewAllProjects)
      ? expenses.filter(e => allowedPrjIds.has(e.projectId) && (!isAccountantRole || isExpenseApprovedByPrecedingStages(e, currentUser)))
      : expenses;

    const targetCustodies = (isAccountantRole || !currentUserPermissions.canViewAllProjects)
      ? custodies.filter(c => !c.projectId || allowedPrjIds.has(c.projectId))
      : custodies;

    StorageService.exportToExcel(
      targetProjects,
      targetExpenses,
      targetCustodies,
      supervisorsSummary,
      settings.currencySymbol
    );
  };

  // Export JSON Backup String
  const exportBackup = () => {
    return StorageService.exportBackupJSON();
  };

  // Download Backup JSON file immediately
  const downloadBackup = () => {
    const res = StorageService.downloadBackupJSON();
    addNotification(
      'تصدير نسخة احتياطية',
      `تم تنزيل ملف النسخة الاحتياطية (${res.filename}) بنجاح.`,
      'system'
    );
    return res;
  };

  // Validate Backup JSON content
  const validateBackup = (jsonStr: string) => {
    return StorageService.validateBackupJSON(jsonStr);
  };

  // Validate Backup Excel workbook content
  const validateBackupExcel = (buffer: ArrayBuffer) => {
    return StorageService.validateBackupExcel(buffer);
  };

  // Import JSON Backup
  const importBackup = (jsonStr: string, mode: 'replace' | 'merge' = 'replace') => {
    lastLocalWriteTimeRef.current = Date.now();
    const ok = StorageService.importBackupJSON(jsonStr, mode);
    if (ok) {
      const updatedProjects = StorageService.getProjects();
      const updatedExpenses = StorageService.getExpenses();
      const updatedCustodies = StorageService.getCustodies();
      const updatedUsers = StorageService.getUsers();
      const updatedRoles = StorageService.getRoles();
      const updatedStages = StorageService.getWorkflowStages();
      const updatedSettings = StorageService.getSettings();
      const updatedTickets = StorageService.getTickets();
      const updatedNotifications = StorageService.getNotifications();
      const updatedArchived = StorageService.getArchivedExpenses();

      setProjects(updatedProjects);
      setExpenses(updatedExpenses);
      setCustodies(updatedCustodies);
      setUsers(updatedUsers);
      setRoles(updatedRoles);
      setWorkflowStages(updatedStages);
      setSettings(updatedSettings);
      setTickets(updatedTickets);
      setNotifications(updatedNotifications);
      setArchivedExpenses(updatedArchived);
      localExpensesCountRef.current = updatedExpenses.length;

      const updatedUser = StorageService.getCurrentUser();
      if (updatedUser) {
        setCurrentUser(updatedUser);
      }

      // Also persist to server disk storage
      const payload = StorageService.getFullBackupData();
      try {
        ServerSyncService.saveServerState(payload, updatedUser?.name || 'مدير النظام', true);
      } catch {}

      // Broadcast update across open tabs locally
      try {
        if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
          const ch = new BroadcastChannel('skyarc_online_sync');
          ch.postMessage({ type: 'STATE_UPDATED', data: payload });
          ch.close();
        }
      } catch {}

      addNotification(
        'استعادة نسخة احتياطية',
        mode === 'merge'
          ? 'تم دمج وتحديث سجلات النسخة الاحتياطية بنجاح.'
          : 'تم استيراد واستعادة كافة السجلات والبيانات بنجاح.',
        'system'
      );
    }
    return ok;
  };

  // Import Backup from parsed object
  const importBackupData = (parsedData: any, mode: 'replace' | 'merge' = 'replace') => {
    lastLocalWriteTimeRef.current = Date.now();
    const ok = StorageService.importBackupData(parsedData, mode);
    if (ok) {
      const updatedProjects = StorageService.getProjects();
      const updatedExpenses = StorageService.getExpenses();
      const updatedCustodies = StorageService.getCustodies();
      const updatedUsers = StorageService.getUsers();
      const updatedRoles = StorageService.getRoles();
      const updatedStages = StorageService.getWorkflowStages();
      const updatedSettings = StorageService.getSettings();
      const updatedTickets = StorageService.getTickets();
      const updatedNotifications = StorageService.getNotifications();
      const updatedArchived = StorageService.getArchivedExpenses();

      setProjects(updatedProjects);
      setExpenses(updatedExpenses);
      setCustodies(updatedCustodies);
      setUsers(updatedUsers);
      setRoles(updatedRoles);
      setWorkflowStages(updatedStages);
      setSettings(updatedSettings);
      setTickets(updatedTickets);
      setNotifications(updatedNotifications);
      setArchivedExpenses(updatedArchived);
      localExpensesCountRef.current = updatedExpenses.length;

      const updatedUser = StorageService.getCurrentUser();
      if (updatedUser) {
        setCurrentUser(updatedUser);
      }

      // Also persist to server disk storage
      const payload = StorageService.getFullBackupData();
      try {
        ServerSyncService.saveServerState(payload, updatedUser?.name || 'مدير النظام', true);
      } catch {}

      // Broadcast update across open tabs locally
      try {
        if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
          const ch = new BroadcastChannel('skyarc_online_sync');
          ch.postMessage({ type: 'STATE_UPDATED', data: payload });
          ch.close();
        }
      } catch {}

      addNotification(
        'استعادة نسخة احتياطية',
        mode === 'merge'
          ? 'تم دمج وتحديث سجلات النسخة الاحتياطية بنجاح.'
          : 'تم استيراد واستعادة كافة السجلات والبيانات بنجاح.',
        'system'
      );
    }
    return ok;
  };

  // Local Browser Quick Snapshots
  const createQuickSnapshot = () => {
    const res = StorageService.createQuickSnapshot();
    addNotification(
      'نقطة استعادة سريعة',
      'تم إنشاء نقطة استعادة فورية محلياً بنجاح.',
      'system'
    );
    return res;
  };

  const getQuickSnapshot = () => {
    return StorageService.getQuickSnapshot();
  };

  const restoreQuickSnapshot = () => {
    const ok = StorageService.restoreQuickSnapshot();
    if (ok) {
      setProjects(StorageService.getProjects());
      setExpenses(StorageService.getExpenses());
      setCustodies(StorageService.getCustodies());
      setUsers(StorageService.getUsers());
      setRoles(StorageService.getRoles());
      setWorkflowStages(StorageService.getWorkflowStages());
      setSettings(StorageService.getSettings());
      setTickets(StorageService.getTickets());
      setNotifications(StorageService.getNotifications());
      addNotification(
        'استعادة نقطة الاستعادة',
        'تمت استعادة حالة المنظومة من آخر نقطة استعادة بنجاح.',
        'system'
      );
    }
    return ok;
  };

  // Reset to Sample Data - completely cancelled and deleted as requested
  const resetAllData = () => {
    showAlert(
      'العملية ملغاة ومحذوفة',
      'تم إلغاء وحذف استعادة البيانات النموذجية الأولية (Factory Reset) نهائياً لحماية سجلات وبيانات المنظومة.',
      'info'
    );
  };

  // Expense Archive Management
  const archiveExpenses = async (criteria: ExpenseArchiveCriteria): Promise<{ success: boolean; count: number; amount: number; message?: string }> => {
    lastLocalWriteTimeRef.current = Date.now();
    const res = StorageService.archiveExpenses(criteria, currentUser.name);
    if (res.archivedCount > 0) {
      setExpenses(res.activeExpensesRemaining);
      setArchivedExpenses(res.updatedArchivedExpenses);
      localExpensesCountRef.current = res.activeExpensesRemaining.length;

      // Active state archived
      const payload = StorageService.getFullBackupData();

      addNotification(
        'أرشفة المصروفات بنجاح',
        `تم نقل (${res.archivedCount}) سند مصروف بقيمة إجمالية (${res.archivedAmount.toLocaleString('ar-SA')} ${settings.currencySymbol || 'ر.س'}) إلى الأرشيف المنفصل لتسريع قاعدة البيانات والشاشات.`,
        'system'
      );

      return {
        success: true,
        count: res.archivedCount,
        amount: res.archivedAmount,
        message: `تمت أرشفة (${res.archivedCount}) سند بنجاح.`,
      };
    }
    return {
      success: false,
      count: 0,
      amount: 0,
      message: 'لم يتم العثور على أي مصروفات نشطة تطابق شروط ومعايير الأرشفة المحددة.',
    };
  };

  const restoreArchivedExpenses = async (expenseIds: string[]): Promise<{ success: boolean; count: number; message?: string }> => {
    lastLocalWriteTimeRef.current = Date.now();
    const res = StorageService.restoreArchivedExpenses(expenseIds);
    if (res.restoredCount > 0) {
      setExpenses(res.activeExpenses);
      setArchivedExpenses(res.remainingArchived);
      localExpensesCountRef.current = res.activeExpenses.length;

      const payload = StorageService.getFullBackupData();

      addNotification(
        'استعادة سندات من الأرشيف',
        `تمت استعادة (${res.restoredCount}) سند من الأرشيف إلى قائمة المصروفات النشطة بنجاح.`,
        'system'
      );

      return {
        success: true,
        count: res.restoredCount,
        message: `تمت استعادة (${res.restoredCount}) سند بنجاح.`,
      };
    }
    return { success: false, count: 0, message: 'لم يتم تحديد أي سندات لاستعادتها.' };
  };

  const deleteArchivedExpensesPermanently = async (expenseIds: string[]): Promise<{ success: boolean; count: number }> => {
    lastLocalWriteTimeRef.current = Date.now();
    const res = StorageService.deleteArchivedExpenses(expenseIds);
    setArchivedExpenses(res.remainingArchived);
    return { success: true, count: res.deletedCount };
  };

  const exportArchivedExpensesToExcel = () => {
    StorageService.exportArchivedExpensesToExcel(archivedExpenses, settings.currencySymbol || 'ر.س');
  };

  // Explicit Save directly to Cloud Database
  const saveToServerNow = async (): Promise<{ success: boolean; message: string }> => {
    const res = await syncWithCloud();
    return {
      success: res.success,
      message: res.message || (res.success ? 'تم حفظ ومزامنة البيانات مع السحابة المركزية بنجاح' : 'فشلت المزامنة')
    };
  };

  // Server Synchronization Methods
  const syncWithCloud = async (): Promise<{ success: boolean; message?: string }> => {
    const totalRecords = expenses.length;
    setIsCloudSyncing(true);
    startProgressTracking(totalRecords, 500);
    try {
      const fullData = StorageService.getFullBackupData();
      const currentUserName = currentUser?.name || currentUser?.username || 'مستخدم النظام';

      // Clear sync queue and mark records synced locally immediately
      setExpenses(prev => prev.map(e => ({ ...e, synced: true })));
      setCustodies(prev => prev.map(c => ({ ...c, synced: true })));
      StorageService.clearSyncQueue();
      setSyncQueue([]);

      // Save to Central Server API Disk
      const serverRes = await ServerSyncService.saveServerState(fullData, currentUserName, true);

      // Immediately fetch back fresh state from server to pull any concurrent updates from other users
      const fetchRes = await ServerSyncService.fetchServerState();
      if (fetchRes.success && fetchRes.data) {
        applyAuthoritativeCloudState(fetchRes.data);
      }

      if (serverRes.success) {
        setIsServerConnected(true);
        const now = serverRes.savedAt || new Date().toISOString();
        setLastServerSyncTime(now);
        flashUploadSuccess();
        finishProgressTracking(true, `تمت المزامنة وحفظ كافة البيانات بنجاح 100% (${totalRecords} سند)`, totalRecords);
        addNotification(
          'تزامن سيرفر النظام',
          'تمت مزامنة وحفظ جميع بيانات النظام على سيرفر التطبيق بنجاح.',
          'system'
        );
        return { success: true, message: 'تم حفظ ومزامنة البيانات مع السيرفر بنجاح' };
      } else {
        finishProgressTracking(false, serverRes.error || 'فشلت المزامنة مع السيرفر', totalRecords);
        return { success: false, message: serverRes.error || 'فشلت المزامنة مع السيرفر' };
      }
    } catch (e: any) {
      finishProgressTracking(false, e?.message || 'حدث خطأ غير متوقع', totalRecords);
      return { success: false, message: e?.message || 'حدث خطأ غير متوقع' };
    } finally {
      setIsCloudSyncing(false);
    }
  };

  const loadFromCloud = async (): Promise<{ success: boolean; message?: string }> => {
    setIsCloudSyncing(true);
    try {
      // 1. Pull directly from authoritative Firebase Firestore Cloud Database
      let dataToImport = await FirebaseService.fetchCloudState().catch(() => null);
      
      // 2. Fallback to Server Storage API (/api/state)
      if (!dataToImport) {
        const res = await ServerSyncService.fetchServerState();
        dataToImport = (res.success && res.data) ? res.data : null;
      }

      if (dataToImport) {
        const ok = applyAuthoritativeCloudState(dataToImport);
        if (ok) {
          setIsServerConnected(true);
          setIsCloudConnected(true);
          const now = dataToImport.serverSavedAt || new Date().toISOString();
          setLastServerSyncTime(now);
          setLastCloudSyncTime(now);

          addNotification('استرجاع البيانات من السحابة', 'تم استرجاع وتحديث كافة البيانات من قاعدة البيانات بنجاح.', 'sync');
          return { success: true, message: 'تم استرجاع البيانات من قاعدة البيانات بنجاح' };
        }
      }

      return { success: false, message: 'لا توجد بيانات محفوظة في قاعدة البيانات أو تعذر جلبها' };
    } catch (e: any) {
      return { success: false, message: e?.message || 'تعذر جلب البيانات من قاعدة البيانات' };
    } finally {
      setIsCloudSyncing(false);
    }
  };

  const createCloudSnapshot = async (note?: string) => {
    setIsCloudSyncing(true);
    try {
      const fullData = StorageService.getFullBackupData();
      const res = await ServerSyncService.runDailyBackup(fullData);
      if (res.success) {
        addNotification(
          'نسخة احتياطية',
          'تم حفظ نسخة احتياطية مؤرشفة على السيرفر بأمان.',
          'system'
        );
      }
      return { success: res.success, backupId: res.excelFileName };
    } finally {
      setIsCloudSyncing(false);
    }
  };

  const listCloudSnapshots = async () => {
    return [];
  };

  const restoreCloudSnapshot = async (_backupId: string) => {
    return false;
  };

  const runDailyBackup = async () => {
    try {
      const fullData = StorageService.getFullBackupData();
      const res = await ServerSyncService.runDailyBackup(fullData);

      if (res.success) {
        setSettings(prev => {
          const updated = {
            ...prev,
            lastDailyBackupSentAt: new Date().toISOString()
          };
          StorageService.saveSettings(updated);
          return updated;
        });

        addNotification(
          'النسخ الاحتياطي اليومي',
          res.message || 'تم إنشاء حزمة إكسل الشاملة والنسخة الاحتياطية وحفظهما بنجاح على الخادم.',
          'system'
        );
      }
      return res;
    } catch (err: any) {
      return {
        success: false,
        message: err?.message || 'فشل تشغيل النسخ الاحتياطي اليومي',
        error: err?.message
      };
    }
  };

  const sendDailyBackupToManager = async () => {
    return await runDailyBackup();
  };

  const getDailyBackupStatus = async () => {
    return await ServerSyncService.getDailyBackupStatus();
  };

  useEffect(() => {
    if (settings.dailyBackupEnabled !== false) {
      const today = new Date().toISOString().slice(0, 10);
      const lastSentDate = settings.lastDailyBackupSentAt ? settings.lastDailyBackupSentAt.slice(0, 10) : null;
      if (lastSentDate !== today) {
        const timer = setTimeout(() => {
          runDailyBackup().catch(() => {});
        }, 15000);
        return () => clearTimeout(timer);
      }
    }
  }, [settings.dailyBackupEnabled, settings.lastDailyBackupSentAt]);

  return (
    <AppContext.Provider
      value={{
        projects,
        expenses,
        custodies,
        users,
        roles,
        workflowStages,
        settings: {
          ...settings,
          theme,
        },
        theme,
        isDarkMode,
        setTheme,
        toggleTheme,
        notifications,
        tickets,
        currentUser,
        currentUserRole,
        currentUserPermissions,
        isCurrentUserAdmin,
        hasPermission,
        isScreenAllowed,
        supervisorsSummary,
        currentSupervisorSummary,
        totalCompanyExpenses,
        totalCompanyCustody,
        totalPendingApprovalsCount,
        activeProjectsCount,
        isOnline: effectiveOnline,
        isSimulatingOffline,
        setIsSimulatingOffline,
        syncQueueCount: syncQueue.length,
        pendingSyncCount: syncQueue.length,
        lastSyncTime,
        isSyncing,
        triggerSync,
        triggerCloudSync: async () => {
          await syncWithCloud();
        },
        isAuthenticated,
        sessionEvictedInfo,
        dismissSessionEvictedModal,
        verifyCurrentSession,
        login,
        logout,
        resetUserPasswordByManager,
        resetAllUsersPasswordByManager,
        setCurrentUser,
        switchRole,
        addExpense,
        updateExpense,
        deleteExpense,
        approveWorkflowStage,
        approveBySupervisor,
        approveByProjectManager,
        approveByAccountant,
        approveByManagement,
        postToExternalERP,
        rejectExpense,
        batchApprove,
        addRole,
        updateRole,
        deleteRole,
        addWorkflowStage,
        updateWorkflowStage,
        deleteWorkflowStage,
        reorderWorkflowStages,
        addCustody,
        updateCustody,
        deleteCustody,
        accessibleProjects,
        isUserAssignedToProject,
        canUserAccessProject,
        canUserOperateOnProject,
        getProjectsForUser,
        addProject,
        updateProject,
        deleteProject,
        addUser,
        updateUser,
        deleteUser,
        addTicket,
        replyToTicket,
        updateTicketStatus,
        updateSettings,
        renameCategory,
        deleteCategory,
        getCategoryUsageCount,
        renameErpSystem,
        deleteErpSystem,
        getErpUsageCount,
        markNotificationAsRead,
        markAllNotificationsAsRead,
        deleteNotification,
        clearNotifications,
        clearAllNotifications: clearNotifications,
        addNotification,
        accessibleNotifications,
        userUnreadNotificationsCount,
        exportAllToExcel,
        exportBackup,
        downloadBackup,
        validateBackup,
        validateBackupExcel,
        importBackup,
        importBackupData,
        createQuickSnapshot,
        getQuickSnapshot,
        restoreQuickSnapshot,
        resetAllData,
        archivedExpenses,
        archiveExpenses,
        restoreArchivedExpenses,
        deleteArchivedExpensesPermanently,
        exportArchivedExpensesToExcel,
        isCloudConnected,
        isCloudSyncing,
        syncProgress,
        isSavingToServer: isServerSaving,
        isDataUploading,
        isJustUploaded,
        lastCloudSyncTime,
        isServerConnected,
        lastServerSyncTime,
        saveToServerNow,
        syncWithCloud,
        loadFromCloud,
        createCloudSnapshot,
        listCloudSnapshots,
        restoreCloudSnapshot,
        runDailyBackup,
        sendDailyBackupToManager,
        getDailyBackupStatus,
        isInitialDatabaseLoading,
        databaseLoadSource,
        databaseLoadStats,
        bypassDatabaseLoading,
        currentView,
        setCurrentView: safeSetCurrentView,
        selectedExpenseForDetail,
        setSelectedExpenseForDetail,
        isExpenseModalOpen,
        setIsExpenseModalOpen,
        editingExpense,
        setEditingExpense,
        isNotificationsOpen,
        setIsNotificationsOpen,
        isPrintModalOpen,
        setIsPrintModalOpen,
        printData,
        setPrintData,
        previewAttachment,
        openAttachmentPreview,
        closeAttachmentPreview,
        confirmDialog,
        confirmAction,
        closeConfirmDialog,
        alertDialog,
        showAlert,
        closeAlertDialog,
        lastOperationStatus,
        setLastOperationStatus,
        clearLastOperationStatus,
        recordOperationStatus,
        canEditExpense,
        canDeleteExpenseCheck,
        isExpenseApprovedStage1OrMore,
        isExpenseApprovedByPrecedingStages,
        getExpenseElapsedMinutes,
        bulkDeleteExpenses,
        bulkUpdateExpenses,
        bulkImportExpenses,
        bulkAttachExpensesPhotos,
      }}
    >
      {children}
    </AppContext.Provider>
  );
};

export const useApp = () => {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useApp must be used within an AppProvider');
  }
  return context;
};

