import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

const sendErrorToServer = (error: string, stack?: string) => {
  if (typeof window === 'undefined') return;
  try {
    fetch('/api/log-error', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        error,
        stack: stack || 'No stack available',
        location: window.location.href
      })
    }).catch(() => {});
  } catch {}
};

// Intercept and silence benign Vite HMR websocket disconnects in environments with DISABLE_HMR=true
if (typeof window !== 'undefined') {
  const originalError = console.error;
  const originalWarn = console.warn;

  const isBenignDisconnect = (msg: string) => {
    return (
      msg.includes('failed to connect to websocket') ||
      msg.includes('WebSocket closed without opened') ||
      msg.includes('WebSocket') ||
      msg.includes('websocket') ||
      msg.includes('the client is offline') ||
      msg.includes('ResizeObserver') ||
      msg.includes('AbortError') ||
      msg.includes('aborted')
    );
  };

  console.error = (...args: any[]) => {
    const msg = args.map(a => String(a?.message || a || '')).join(' ');
    if (isBenignDisconnect(msg)) {
      return;
    }
    originalError.apply(console, args);
  };

  console.warn = (...args: any[]) => {
    const msg = args.map(a => String(a?.message || a || '')).join(' ');
    if (isBenignDisconnect(msg)) {
      return;
    }
    originalWarn.apply(console, args);
  };

  window.addEventListener(
    'unhandledrejection',
    (event: PromiseRejectionEvent) => {
      const reason = event.reason;
      const errorStr = String(reason?.message || reason?.name || reason || '');
      if (isBenignDisconnect(errorStr)) {
        event.preventDefault();
        event.stopPropagation();
        (event as any).stopImmediatePropagation?.();
        return;
      }
      console.warn('Background promise rejection handled:', errorStr);
      sendErrorToServer('Unhandled promise rejection: ' + errorStr, reason?.stack);
    },
    true
  );

  window.addEventListener(
    'error',
    (event: ErrorEvent) => {
      const errorStr = String(event.message || event.error?.message || '');
      if (isBenignDisconnect(errorStr)) {
        event.preventDefault();
        event.stopPropagation();
        (event as any).stopImmediatePropagation?.();
        return;
      }
      console.warn('Runtime error handled:', errorStr);
      sendErrorToServer('Unhandled runtime error: ' + errorStr, event.error?.stack);
    },
    true
  );
}

// Fallback error renderer to prevent blank white screen in any scenario
function renderFatalError(errorMsg: string) {
  const rootEl = document.getElementById('root') || document.body;
  rootEl.innerHTML = `
    <div style="min-height: 100vh; background: #0f172a; color: #f8fafc; display: flex; align-items: center; justify-content: center; padding: 20px; font-family: 'Cairo', sans-serif; direction: rtl; text-align: center;">
      <div style="max-width: 480px; width: 100%; bg-color: #1e293b; background: #1e293b; padding: 32px; border-radius: 24px; border: 1px solid #334155; box-shadow: 0 25px 50px -12px rgba(0,0,0,0.5);">
        <div style="width: 64px; height: 64px; background: rgba(239, 68, 68, 0.15); border: 1px solid rgba(239, 68, 68, 0.3); color: #f87171; border-radius: 20px; display: flex; align-items: center; justify-content: center; margin: 0 auto 20px; font-size: 28px;">⚠️</div>
        <h2 style="font-size: 18px; font-weight: 800; margin-bottom: 8px; color: #ffffff;">تنبيه بدء التشغيل</h2>
        <p style="font-size: 13px; color: #94a3b8; line-height: 1.6; margin-bottom: 20px;">
          تعذر تحميل واجهة التطبيق تلقائياً بسبب ملفات مؤقتة غير مطابقة. اضغط الزر أدناه لتنظيف الذاكرة المؤقتة والبدء فوراً:
        </p>
        <div style="background: #0f172a; padding: 10px; border-radius: 12px; font-size: 11px; font-family: monospace; color: #cbd5e1; margin-bottom: 20px; word-break: break-all; text-align: left;" dir="ltr">
          ${errorMsg || 'Initial mounting exception'}
        </div>
        <button onclick="localStorage.clear(); sessionStorage.clear(); window.location.reload();" style="width: 100%; padding: 12px; background: #10b981; color: #ffffff; border: none; border-radius: 14px; font-size: 13px; font-weight: 700; cursor: pointer;">
          إصلاح وتحديث الصفحة الآن 🔄
        </button>
      </div>
    </div>
  `;
}

try {
  let rootElement = document.getElementById('root');
  if (!rootElement) {
    rootElement = document.createElement('div');
    rootElement.id = 'root';
    document.body.appendChild(rootElement);
  }

  createRoot(rootElement).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
} catch (err: any) {
  console.error('Fatal mount error:', err);
  sendErrorToServer('Fatal mount error: ' + (err?.message || String(err)), err?.stack);
  renderFatalError(err?.message || String(err));
}
