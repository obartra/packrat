import { $ } from '../utils';

let confirmCallback: (() => void) | null = null;

/** Open the confirm dialog with a message and an action callback. */
export function showConfirm(msg: string, onConfirm: () => void, label = 'Delete'): void {
  $('confirm-message').textContent = msg;
  $('btn-confirm-ok').textContent = label;
  confirmCallback = onConfirm;
  $('confirm-overlay').classList.remove('hidden');
  $('confirm-box').classList.remove('hidden');
}

export function closeConfirm(): void {
  $('confirm-overlay').classList.add('hidden');
  $('confirm-box').classList.add('hidden');
  confirmCallback = null;
}

// Wire global listeners once at module load.
$('btn-confirm-cancel').addEventListener('click', closeConfirm);
$('confirm-overlay').addEventListener('click', closeConfirm);
$('btn-confirm-ok').addEventListener('click', () => {
  if (confirmCallback) confirmCallback();
  closeConfirm();
});
