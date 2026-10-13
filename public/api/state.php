<?php
/**
 * SkyArc Server-Side Persistence Handler for Hostinger / Apache / LiteSpeed / PHP Hosting
 * Persists all projects, expenses, custodies, and settings directly to disk (system_state.json)
 */

// Silence direct HTML error output so JSON responses are never corrupted
@error_reporting(0);
@ini_set('display_errors', '0');
@ini_set('memory_limit', '512M');
@ini_set('post_max_size', '128M');
@ini_set('upload_max_filesize', '128M');
@ini_set('max_execution_time', '300');

// Start output buffering to catch any accidental output or warnings
if (!ob_get_level()) {
    ob_start();
} else {
    ob_clean();
}

// CORS Headers - Allow all origins and all headers
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS');
header('Access-Control-Allow-Headers: *');
header('Access-Control-Max-Age: 86400');
header('Content-Type: application/json; charset=UTF-8');

// Handle preflight OPTIONS request
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    echo json_encode(['status' => 'ok']);
    exit(0);
}

// Helper to find the active writable database file path
function getStorageCandidates() {
    $dir = __DIR__;
    $candidates = [
        dirname(dirname($dir)) . '/data/system_state.json',
        dirname($dir) . '/data/system_state.json',
        $dir . '/data/system_state.json',
        $dir . '/system_state.json',
        dirname($dir) . '/system_state.json',
        sys_get_temp_dir() . '/skyarc_system_state.json'
    ];
    return $candidates;
}

function resolveActiveReadPath() {
    $candidates = getStorageCandidates();
    foreach ($candidates as $filePath) {
        if (file_exists($filePath) && filesize($filePath) > 20) {
            return $filePath;
        }
    }
    // Return the first candidate (even if empty or newly created)
    return $candidates[0];
}

function resolveActiveWritePath() {
    $candidates = getStorageCandidates();
    foreach ($candidates as $filePath) {
        $parent = dirname($filePath);
        if (!is_dir($parent)) {
            @mkdir($parent, 0775, true);
        }
        if (is_writable($parent) || (file_exists($filePath) && is_writable($filePath))) {
            return $filePath;
        }
    }
    return $candidates[0];
}

// ----------------------------------------------------
// Helper for active user sessions
// ----------------------------------------------------
function getSessionsFilePath() {
    $dir = __DIR__;
    return $dir . '/data/active_user_sessions.json';
}

function getActiveSessions() {
    $path = getSessionsFilePath();
    if (file_exists($path)) {
        $raw = @file_get_contents($path);
        if ($raw) {
            $sess = json_decode($raw, true);
            if (is_array($sess)) return $sess;
        }
    }
    return [];
}

// ----------------------------------------------------
// GET: Retrieve latest system state
// ----------------------------------------------------
if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    // Check if session has been evicted
    $headers = getallheaders();
    $userId = isset($_GET['userId']) ? $_GET['userId'] : (isset($headers['X-User-Id']) ? $headers['X-User-Id'] : (isset($headers['x-user-id']) ? $headers['x-user-id'] : ''));
    $sessionId = isset($_GET['sessionId']) ? $_GET['sessionId'] : (isset($headers['X-Session-Id']) ? $headers['X-Session-Id'] : (isset($headers['x-session-id']) ? $headers['x-session-id'] : ''));

    if (!empty($userId) && !empty($sessionId)) {
        $activeSessions = getActiveSessions();
        if (isset($activeSessions[$userId])) {
            $activeSess = $activeSessions[$userId];
            if (!empty($activeSess['activeSessionId']) && $activeSess['activeSessionId'] !== $sessionId) {
                ob_clean();
                echo json_encode([
                    'success' => false,
                    'sessionEvicted' => true,
                    'error' => 'SESSION_EVICTED',
                    'message' => 'تم إنهاء الجلسة لتسجيل الدخول من جهاز آخر',
                    'activeSession' => $activeSess,
                    'data' => null
                ], JSON_UNESCAPED_UNICODE);
                exit;
            }
        }
    }

    $activeFile = resolveActiveReadPath();

    if (!file_exists($activeFile)) {
        ob_clean();
        echo json_encode([
            'success' => true,
            'exists' => false,
            'data' => null,
            'storagePath' => basename(dirname($activeFile)) . '/' . basename($activeFile),
            'message' => 'No database file found on Hostinger server yet'
        ], JSON_UNESCAPED_UNICODE);
        exit;
    }

    $raw = @file_get_contents($activeFile);
    if ($raw === false) {
        ob_clean();
        http_response_code(500);
        echo json_encode(['success' => false, 'error' => 'تعذر قراءة ملف قاعدة البيانات من القرص'], JSON_UNESCAPED_UNICODE);
        exit;
    }

    $parsed = json_decode($raw, true);
    if ($parsed === null) {
        ob_clean();
        http_response_code(500);
        echo json_encode(['success' => false, 'error' => 'الملف المحفوظ يحتوي على بيانات غير صالحة'], JSON_UNESCAPED_UNICODE);
        exit;
    }

    $lastModified = date('c', filemtime($activeFile));
    $version = isset($parsed['serverVersion']) ? (int)$parsed['serverVersion'] : (isset($parsed['version']) ? (int)$parsed['version'] : 1);

    $expensesCount = isset($parsed['expenses']) && is_array($parsed['expenses']) ? count($parsed['expenses']) : 0;
    $projectsCount = isset($parsed['projects']) && is_array($parsed['projects']) ? count($parsed['projects']) : 0;
    $custodiesCount = isset($parsed['custodies']) && is_array($parsed['custodies']) ? count($parsed['custodies']) : 0;
    $usersCount = isset($parsed['users']) && is_array($parsed['users']) ? count($parsed['users']) : 0;

    ob_clean();
    echo json_encode([
        'success' => true,
        'exists' => true,
        'data' => $parsed,
        'lastModified' => $lastModified,
        'version' => $version,
        'storageFile' => basename($activeFile),
        'stats' => [
            'expenses' => $expensesCount,
            'projects' => $projectsCount,
            'custodies' => $custodiesCount,
            'users' => $usersCount
        ]
    ], JSON_UNESCAPED_UNICODE);
    exit;
}

// ----------------------------------------------------
// POST: Save system state to disk
// ----------------------------------------------------
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    // Read raw body
    $rawInput = file_get_contents('php://input');

    // Fallback: Check $_POST
    if (empty($rawInput)) {
        if (!empty($_POST['data'])) {
            $rawInput = $_POST['data'];
        } elseif (!empty($_POST['payload'])) {
            $rawInput = $_POST['payload'];
        }
    }

    if (empty($rawInput)) {
        ob_clean();
        http_response_code(400);
        echo json_encode(['success' => false, 'error' => 'حجم البيانات المرفوعة فارغ أو تجاوز الحد الأقصى للمخدم'], JSON_UNESCAPED_UNICODE);
        exit;
    }

    $payload = json_decode($rawInput, true);
    if ($payload === null) {
        ob_clean();
        http_response_code(400);
        echo json_encode(['success' => false, 'error' => 'صيغة البيانات المستلمة غير صالحة'], JSON_UNESCAPED_UNICODE);
        exit;
    }

    // Check if session has been evicted
    $headers = getallheaders();
    $userId = isset($payload['userId']) ? $payload['userId'] : (isset($_GET['userId']) ? $_GET['userId'] : (isset($headers['X-User-Id']) ? $headers['X-User-Id'] : (isset($headers['x-user-id']) ? $headers['x-user-id'] : '')));
    $sessionId = isset($payload['sessionId']) ? $payload['sessionId'] : (isset($_GET['sessionId']) ? $_GET['sessionId'] : (isset($headers['X-Session-Id']) ? $headers['X-Session-Id'] : (isset($headers['x-session-id']) ? $headers['x-session-id'] : '')));

    if (!empty($userId) && !empty($sessionId)) {
        $activeSessions = getActiveSessions();
        if (isset($activeSessions[$userId])) {
            $activeSess = $activeSessions[$userId];
            if (!empty($activeSess['activeSessionId']) && $activeSess['activeSessionId'] !== $sessionId) {
                ob_clean();
                http_response_code(403);
                echo json_encode([
                    'success' => false,
                    'sessionEvicted' => true,
                    'error' => 'SESSION_EVICTED',
                    'message' => 'تم إنهاء الجلسة لتسجيل الدخول من جهاز آخر. تم حجب استقبال البيانات من هذا المتصفح.',
                    'activeSession' => $activeSess
                ], JSON_UNESCAPED_UNICODE);
                exit;
            }
        }
    }

    $dataToSave = isset($payload['data']) && is_array($payload['data']) ? $payload['data'] : $payload;
    $updatedBy = isset($payload['updatedBy']) ? $payload['updatedBy'] : 'مستخدم النظام';

    $writePath = resolveActiveWritePath();

    // Read existing file to perform atomic merge & tombstone enforcement
    $existingData = [];
    $currentVersion = 1;
    if (file_exists($writePath)) {
        $oldRaw = @file_get_contents($writePath);
        if ($oldRaw) {
            $existingData = json_decode($oldRaw, true) ?: [];
            if (isset($existingData['serverVersion'])) {
                $currentVersion = (int)$existingData['serverVersion'] + 1;
            } elseif (isset($existingData['version']) && is_numeric($existingData['version'])) {
                $currentVersion = (int)$existingData['version'] + 1;
            }
        }
    }

    // 1. Reconcile Tombstones across all entities
    $mergedDeletedExpenses = array_merge(
        (isset($existingData['deletedExpenseIds']) && is_array($existingData['deletedExpenseIds'])) ? $existingData['deletedExpenseIds'] : [],
        (isset($dataToSave['deletedExpenseIds']) && is_array($dataToSave['deletedExpenseIds'])) ? $dataToSave['deletedExpenseIds'] : []
    );
    $mergedDeletedCustodies = array_merge(
        (isset($existingData['deletedCustodyIds']) && is_array($existingData['deletedCustodyIds'])) ? $existingData['deletedCustodyIds'] : [],
        (isset($dataToSave['deletedCustodyIds']) && is_array($dataToSave['deletedCustodyIds'])) ? $dataToSave['deletedCustodyIds'] : []
    );
    $mergedDeletedProjects = array_merge(
        (isset($existingData['deletedProjectIds']) && is_array($existingData['deletedProjectIds'])) ? $existingData['deletedProjectIds'] : [],
        (isset($dataToSave['deletedProjectIds']) && is_array($dataToSave['deletedProjectIds'])) ? $dataToSave['deletedProjectIds'] : []
    );
    $mergedDeletedUsers = array_merge(
        (isset($existingData['deletedUserIds']) && is_array($existingData['deletedUserIds'])) ? $existingData['deletedUserIds'] : [],
        (isset($dataToSave['deletedUserIds']) && is_array($dataToSave['deletedUserIds'])) ? $dataToSave['deletedUserIds'] : []
    );
    $mergedDeletedRoles = array_merge(
        (isset($existingData['deletedRoleIds']) && is_array($existingData['deletedRoleIds'])) ? $existingData['deletedRoleIds'] : [],
        (isset($dataToSave['deletedRoleIds']) && is_array($dataToSave['deletedRoleIds'])) ? $dataToSave['deletedRoleIds'] : []
    );
    $mergedDeletedStages = array_merge(
        (isset($existingData['deletedWorkflowStageIds']) && is_array($existingData['deletedWorkflowStageIds'])) ? $existingData['deletedWorkflowStageIds'] : [],
        (isset($dataToSave['deletedWorkflowStageIds']) && is_array($dataToSave['deletedWorkflowStageIds'])) ? $dataToSave['deletedWorkflowStageIds'] : []
    );

    // 2. Smart Merge Projects: existing records on server disk are never discarded unless deleted in tombstones
    $projectsMap = [];
    if (isset($existingData['projects']) && is_array($existingData['projects'])) {
        foreach ($existingData['projects'] as $p) {
            if (!empty($p['id']) && empty($mergedDeletedProjects[$p['id']])) {
                $projectsMap[$p['id']] = $p;
            }
        }
    }
    if (isset($dataToSave['projects']) && is_array($dataToSave['projects'])) {
        foreach ($dataToSave['projects'] as $p) {
            if (!empty($p['id']) && empty($mergedDeletedProjects[$p['id']])) {
                $projectsMap[$p['id']] = isset($projectsMap[$p['id']]) ? array_merge($projectsMap[$p['id']], $p) : $p;
            }
        }
    }
    $cleanProjects = array_values($projectsMap);

    // 3. Smart Merge Custodies
    $custodiesMap = [];
    if (isset($existingData['custodies']) && is_array($existingData['custodies'])) {
        foreach ($existingData['custodies'] as $c) {
            if (!empty($c['id']) && empty($mergedDeletedCustodies[$c['id']])) {
                $custodiesMap[$c['id']] = $c;
            }
        }
    }
    if (isset($dataToSave['custodies']) && is_array($dataToSave['custodies'])) {
        foreach ($dataToSave['custodies'] as $c) {
            if (!empty($c['id']) && empty($mergedDeletedCustodies[$c['id']])) {
                $custodiesMap[$c['id']] = isset($custodiesMap[$c['id']]) ? array_merge($custodiesMap[$c['id']], $c) : $c;
            }
        }
    }
    $cleanCustodies = array_values($custodiesMap);

    // 4. Smart Merge Users
    $usersMap = [];
    if (isset($existingData['users']) && is_array($existingData['users'])) {
        foreach ($existingData['users'] as $u) {
            if (!empty($u['id']) && empty($mergedDeletedUsers[$u['id']])) {
                $usersMap[$u['id']] = $u;
            }
        }
    }
    if (isset($dataToSave['users']) && is_array($dataToSave['users'])) {
        foreach ($dataToSave['users'] as $u) {
            if (!empty($u['id']) && empty($mergedDeletedUsers[$u['id']])) {
                $usersMap[$u['id']] = isset($usersMap[$u['id']]) ? array_merge($usersMap[$u['id']], $u) : $u;
            }
        }
    }
    $cleanUsers = array_values($usersMap);

    // 5. Smart Merge Expenses
    $expensesMap = [];
    if (isset($existingData['expenses']) && is_array($existingData['expenses'])) {
        foreach ($existingData['expenses'] as $exp) {
            if (!empty($exp['id']) && empty($mergedDeletedExpenses[$exp['id']])) {
                $expensesMap[$exp['id']] = $exp;
            }
        }
    }
    if (isset($dataToSave['expenses']) && is_array($dataToSave['expenses'])) {
        foreach ($dataToSave['expenses'] as $exp) {
            if (!empty($exp['id']) && empty($mergedDeletedExpenses[$exp['id']])) {
                if (!isset($expensesMap[$exp['id']])) {
                    $expensesMap[$exp['id']] = $exp;
                } else {
                    $existTime = isset($expensesMap[$exp['id']]['updatedAt']) ? strtotime($expensesMap[$exp['id']]['updatedAt']) : 0;
                    $inTime = isset($exp['updatedAt']) ? strtotime($exp['updatedAt']) : 0;
                    if ($inTime >= $existTime) {
                        $expensesMap[$exp['id']] = $exp;
                    }
                }
            }
        }
    }
    $cleanExpenses = array_values($expensesMap);

    // 6. Merge Roles, Stages, Settings
    $cleanRoles = (isset($dataToSave['roles']) && is_array($dataToSave['roles']) && count($dataToSave['roles']) > 0)
        ? $dataToSave['roles']
        : (isset($existingData['roles']) ? $existingData['roles'] : []);
    $cleanStages = (isset($dataToSave['workflowStages']) && is_array($dataToSave['workflowStages']) && count($dataToSave['workflowStages']) > 0)
        ? $dataToSave['workflowStages']
        : (isset($existingData['workflowStages']) ? $existingData['workflowStages'] : []);
    $cleanSettings = (isset($dataToSave['settings']) && is_array($dataToSave['settings']))
        ? array_merge((isset($existingData['settings']) && is_array($existingData['settings'])) ? $existingData['settings'] : [], $dataToSave['settings'])
        : (isset($existingData['settings']) ? $existingData['settings'] : []);

    // Combine into complete authoritative state
    $dataToSave = array_merge($existingData, $dataToSave);
    $dataToSave['deletedExpenseIds'] = $mergedDeletedExpenses;
    $dataToSave['deletedCustodyIds'] = $mergedDeletedCustodies;
    $dataToSave['deletedProjectIds'] = $mergedDeletedProjects;
    $dataToSave['deletedUserIds'] = $mergedDeletedUsers;
    $dataToSave['deletedRoleIds'] = $mergedDeletedRoles;
    $dataToSave['deletedWorkflowStageIds'] = $mergedDeletedStages;
    $dataToSave['projects'] = $cleanProjects;
    $dataToSave['custodies'] = $cleanCustodies;
    $dataToSave['users'] = $cleanUsers;
    $dataToSave['expenses'] = $cleanExpenses;
    $dataToSave['roles'] = $cleanRoles;
    $dataToSave['workflowStages'] = $cleanStages;
    $dataToSave['settings'] = $cleanSettings;

    $nowIso = date('c');
    $dataToSave['lastSyncedAt'] = $nowIso;
    $dataToSave['syncedBy'] = $updatedBy;
    $dataToSave['serverSavedAt'] = $nowIso;
    $dataToSave['serverVersion'] = $currentVersion;

    $jsonOutput = json_encode($dataToSave, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE);

    // Write directly with OS file lock (LOCK_EX) for 100% atomic persistence
    $writeOk = @file_put_contents($writePath, $jsonOutput, LOCK_EX);

    if ($writeOk === false) {
        // Try fallback to secondary candidate
        $candidates = getStorageCandidates();
        $saved = false;
        foreach ($candidates as $cand) {
            if ($cand !== $writePath) {
                $p = dirname($cand);
                if (!is_dir($p)) @mkdir($p, 0775, true);
                $tryWrite = @file_put_contents($cand, $jsonOutput, LOCK_EX);
                if ($tryWrite !== false) {
                    $writePath = $cand;
                    $saved = true;
                    break;
                }
            }
        }

        if (!$saved) {
            ob_clean();
            http_response_code(500);
            echo json_encode([
                'success' => false,
                'error' => 'تعذر الكتابة على القرص. يرجى التأكد من صلاحيات المجلد على الاستضافة (0775 또는 0755)',
                'attemptedPath' => $writePath
            ], JSON_UNESCAPED_UNICODE);
            exit;
        }
    }

    // Auto-backup: Create periodic backup snapshot every 4 hours
    $parentDir = dirname($writePath);
    $backupsDir = $parentDir . '/backups';
    if (!is_dir($backupsDir)) {
        @mkdir($backupsDir, 0775, true);
    }
    if (is_dir($backupsDir)) {
        $lastBackupFile = $parentDir . '/last_backup_time.txt';
        $lastBackup = file_exists($lastBackupFile) ? (int)@file_get_contents($lastBackupFile) : 0;
        $now = time();
        if ($now - $lastBackup > 14400) {
            @file_put_contents($lastBackupFile, (string)$now);
            $backupName = 'auto_backup_' . date('Y-m-d_H-i-s') . '.json';
            @file_put_contents($backupsDir . '/' . $backupName, $jsonOutput, LOCK_EX);
        }
    }

    $expensesCount = isset($dataToSave['expenses']) && is_array($dataToSave['expenses']) ? count($dataToSave['expenses']) : 0;
    $projectsCount = isset($dataToSave['projects']) && is_array($dataToSave['projects']) ? count($dataToSave['projects']) : 0;
    $custodiesCount = isset($dataToSave['custodies']) && is_array($dataToSave['custodies']) ? count($dataToSave['custodies']) : 0;
    $usersCount = isset($dataToSave['users']) && is_array($dataToSave['users']) ? count($dataToSave['users']) : 0;

    ob_clean();
    echo json_encode([
        'success' => true,
        'savedAt' => $nowIso,
        'version' => $currentVersion,
        'storageLocation' => basename(dirname($writePath)) . '/' . basename($writePath),
        'stats' => [
            'expenses' => $expensesCount,
            'projects' => $projectsCount,
            'custodies' => $custodiesCount,
            'users' => $usersCount
        ]
    ], JSON_UNESCAPED_UNICODE);
    exit;
}

ob_clean();
http_response_code(405);
echo json_encode(['success' => false, 'error' => 'Method not allowed'], JSON_UNESCAPED_UNICODE);
