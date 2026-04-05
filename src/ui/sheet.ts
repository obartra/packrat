import { $ } from '../utils';
import { clearPendingPhoto, pendingPhoto } from '../photos';

export type SheetSaveFn = () => void | Promise<void>;

let currentSheetSave: SheetSaveFn | null = null;

/** Open the slide-up sheet with a title, body HTML, and save handler. */
export function openSheet(title: string, bodyHTML: string, onSave: SheetSaveFn): void {
  $('sheet-title').textContent = title;
  $('sheet-body').innerHTML = bodyHTML;
  currentSheetSave = onSave;
  $('sheet-overlay').classList.remove('hidden');
  const s = $('sheet');
  s.classList.remove('hidden');
  requestAnimationFrame(() => requestAnimationFrame(() => s.classList.add('open')));
  clearPendingPhoto();
}

export function closeSheet(): void {
  const s = $('sheet');
  s.classList.remove('open');
  setTimeout(() => {
    s.classList.add('hidden');
    $('sheet-overlay').classList.add('hidden');
    pendingPhoto.file = null;
  }, 310);
}

// Wire global listeners once at module load.
$('btn-sheet-close').addEventListener('click', closeSheet);
$('btn-sheet-save').addEventListener('click', () => {
  if (currentSheetSave) currentSheetSave();
});
$('sheet-overlay').addEventListener('click', closeSheet);
