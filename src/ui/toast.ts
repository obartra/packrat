import { $ } from '../utils';

export type ToastKind = '' | 'success' | 'error';

/**
 * Show a toast message at the bottom of the screen.
 * Toasts auto-dismiss after `duration` ms (default 2.8s).
 */
export function showToast(msg: string, type: ToastKind = '', duration = 2800): void {
  const tc = $('toast-container');
  const t = document.createElement('div');
  t.className = 'toast' + (type ? ' ' + type : '');
  t.textContent = msg;
  tc.appendChild(t);
  setTimeout(() => {
    t.classList.add('leaving');
    setTimeout(() => t.remove(), 220);
  }, duration);
}
