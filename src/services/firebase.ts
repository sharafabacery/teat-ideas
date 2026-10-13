import { initializeApp } from 'firebase/app';
import {
  getFirestore,
  doc,
  getDoc,
  getDocFromServer,
  setDoc,
  collection,
  writeBatch,
  onSnapshot
} from 'firebase/firestore';
import {
  getAuth,
  signInWithPopup,
  GoogleAuthProvider,
  signOut,
  onAuthStateChanged,
  User as FirebaseUser
} from 'firebase/auth';
import firebaseConfig from '../../firebase-applet-config.json';

// Initialize Firebase
const app = initializeApp(firebaseConfig);
export const db = (firebaseConfig.firestoreDatabaseId && firebaseConfig.firestoreDatabaseId !== '(default)')
  ? getFirestore(app, firebaseConfig.firestoreDatabaseId)
  : getFirestore(app);
export const auth = getAuth(app);

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData?.map(provider => ({
        providerId: provider.providerId,
        email: provider.email,
      })) || []
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

// MANDATORY CONNECTION TEST
export async function testConnection(): Promise<boolean> {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
    console.log('Firebase Firestore connection verified successfully.');
    return true;
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
    } else {
      console.warn('Firebase test connection response:', error);
    }
    return false;
  }
}

// Immediate initial connection check
testConnection().catch(e => console.warn('Initial test connection note:', e));

export const FirebaseService = {
  db,
  auth,

  async testConnection() {
    return testConnection();
  },

  async signInWithGoogle(): Promise<FirebaseUser | null> {
    try {
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      const result = await signInWithPopup(auth, provider);
      return result.user;
    } catch (error) {
      console.error('Google Sign-In failed:', error);
      throw error;
    }
  },

  async signOut(): Promise<void> {
    try {
      await signOut(auth);
    } catch (error) {
      console.error('Sign-Out failed:', error);
    }
  },

  onAuthState(callback: (user: FirebaseUser | null) => void) {
    return onAuthStateChanged(auth, callback);
  },

  /**
   * Save the comprehensive application state to Firestore
   */
  async saveCloudState(state: any, userIdentifier: string = 'System'): Promise<boolean> {
    const docPath = 'system_state/main';
    try {
      if (!state || typeof state !== 'object') return false;

      const payload = {
        app: state.app || 'SkyArc Pro',
        version: state.version || '2.0.0',
        mutationId: state.mutationId || null,
        writerId: state.writerId || null,
        writerName: state.writerName || userIdentifier || null,
        revision: state.revision || Date.now(),
        exportedAt: state.exportedAt || new Date().toISOString(),
        exportedBy: state.exportedBy || userIdentifier,
        projects: state.projects || [],
        deletedProjectIds: state.deletedProjectIds || {},
        expenses: state.expenses || [],
        deletedExpenseIds: state.deletedExpenseIds || {},
        custodies: state.custodies || [],
        deletedCustodyIds: state.deletedCustodyIds || {},
        users: state.users || [],
        deletedUserIds: state.deletedUserIds || {},
        roles: state.roles || [],
        deletedRoleIds: state.deletedRoleIds || {},
        workflowStages: state.workflowStages || [],
        deletedWorkflowStageIds: state.deletedWorkflowStageIds || {},
        settings: state.settings || {},
        tickets: state.tickets || [],
        notifications: state.notifications || [],
        lastSyncedAt: new Date().toISOString(),
        syncedBy: userIdentifier,
        serverSavedAt: state.serverSavedAt || new Date().toISOString()
      };

      await setDoc(doc(db, 'system_state', 'main'), payload);

      // Also persist individual collections in Firestore batches for direct querying
      try {
        const batch = writeBatch(db);
        
        // Projects
        if (Array.isArray(payload.projects)) {
          payload.projects.slice(0, 50).forEach((prj: any) => {
            if (prj?.id) {
              batch.set(doc(db, 'projects', String(prj.id)), prj, { merge: true });
            }
          });
        }

        // Custodies
        if (Array.isArray(payload.custodies)) {
          payload.custodies.slice(0, 50).forEach((cus: any) => {
            if (cus?.id) {
              batch.set(doc(db, 'custodies', String(cus.id)), cus, { merge: true });
            }
          });
        }

        // Users
        if (Array.isArray(payload.users)) {
          payload.users.slice(0, 50).forEach((u: any) => {
            if (u?.id) {
              batch.set(doc(db, 'users', String(u.id)), u, { merge: true });
            }
          });
        }

        // Expenses
        if (Array.isArray(payload.expenses)) {
          payload.expenses.slice(0, 50).forEach((exp: any) => {
            if (exp?.id) {
              batch.set(doc(db, 'expenses', String(exp.id)), exp, { merge: true });
            }
          });
        }

        // Individual collection deletions
        if (payload.deletedExpenseIds && typeof payload.deletedExpenseIds === 'object') {
          Object.keys(payload.deletedExpenseIds).slice(0, 30).forEach((id) => {
            batch.delete(doc(db, 'expenses', String(id)));
          });
        }
        if (payload.deletedProjectIds && typeof payload.deletedProjectIds === 'object') {
          Object.keys(payload.deletedProjectIds).slice(0, 30).forEach((id) => {
            batch.delete(doc(db, 'projects', String(id)));
          });
        }
        if (payload.deletedCustodyIds && typeof payload.deletedCustodyIds === 'object') {
          Object.keys(payload.deletedCustodyIds).slice(0, 30).forEach((id) => {
            batch.delete(doc(db, 'custodies', String(id)));
          });
        }
        if (payload.deletedUserIds && typeof payload.deletedUserIds === 'object') {
          Object.keys(payload.deletedUserIds).slice(0, 30).forEach((id) => {
            batch.delete(doc(db, 'users', String(id)));
          });
        }

        await batch.commit();
      } catch (batchErr) {
        console.warn('Batch individual collections write warning:', batchErr);
      }

      return true;
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, docPath);
      return false;
    }
  },

  /**
   * Fetch application state directly from Firestore
   */
  async fetchCloudState(): Promise<any | null> {
    const docPath = 'system_state/main';
    try {
      const docRef = doc(db, 'system_state', 'main');
      const snap = await getDoc(docRef);
      if (snap.exists()) {
        return snap.data();
      }
      return null;
    } catch (error) {
      handleFirestoreError(error, OperationType.GET, docPath);
      return null;
    }
  },

  /**
   * Real-time subscription to cloud state changes across all users and tabs
   */
  subscribeToCloudState(onUpdate: (state: any, metadata?: { hasPendingWrites: boolean; fromCache: boolean }) => void): () => void {
    const docPath = 'system_state/main';
    const docRef = doc(db, 'system_state', 'main');

    const unsubscribe = onSnapshot(
      docRef,
      { includeMetadataChanges: true },
      (snapshot) => {
        if (snapshot.exists()) {
          const data = snapshot.data();
          onUpdate(data, {
            hasPendingWrites: snapshot.metadata.hasPendingWrites,
            fromCache: snapshot.metadata.fromCache
          });
        }
      },
      (error) => {
        handleFirestoreError(error, OperationType.GET, docPath);
      }
    );

    return unsubscribe;
  }
};
