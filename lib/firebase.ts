// Import the functions you need from the SDKs you need
import { initializeApp, getApps, getApp } from "firebase/app";
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager, CACHE_SIZE_UNLIMITED } from "firebase/firestore";
import { getAuth, connectAuthEmulator } from "firebase/auth";
import { getStorage } from "firebase/storage";
import { getAnalytics, isSupported } from "firebase/analytics";

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY || '',
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || '',
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || '',
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || '',
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || '',
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID || '',
  measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID || '',
};

// Firebase initialization state
let app: any = null;
let db: any = null;
let auth: any = null;
let storage: any = null;
let analytics: any = null;
let isFirebaseReady = false;

try {
  const hasValidConfig = firebaseConfig.apiKey && firebaseConfig.projectId;
  
  if (hasValidConfig) {
    app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
    db = initializeFirestore(app, {
      localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
    });
    auth = getAuth(app);
    storage = getStorage(app);

    if (typeof window !== "undefined") {
      isSupported().then((supported) => {
        if (supported) {
          analytics = getAnalytics(app);
        }
      }).catch(() => {});
    }

    isFirebaseReady = true;
    console.log("[Firebase] Initialized successfully");
  } else {
    console.warn("[Firebase] No valid config found — running in demo mode");
  }
} catch (e: any) {
  console.warn("[Firebase] Initialization failed, running in demo mode:", e?.message || e);
  app = null;
  db = null;
  auth = null;
  storage = null;
}

// NOTE: When isFirebaseReady is false, pages should NOT call Firebase modular functions.
// The modular API (collection(), getDocs(), etc.) does instanceof checks internally
// and will throw on mock objects. Instead, wrap calls in: if (!isFirebaseReady) return;
export { app, db, auth, storage, analytics, isFirebaseReady };
