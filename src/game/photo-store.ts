/**
 * Keeps the spirit photographs between sessions (IndexedDB, this browser
 * only). Any storage failure degrades to "photos last until you leave".
 */

export interface StoredPhoto {
  id: string;
  date: string;
  caption: string;
  caught: boolean;
  /** JPEG data URL, ~20–40 KB. */
  image: string;
  createdAt: number;
}

const DB = 'domovoi';
const STORE = 'photos';
const KEEP = 24;

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function savePhoto(photo: StoredPhoto): Promise<void> {
  try {
    const db = await open();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(photo);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    await prune(db);
    db.close();
  } catch {
    // Not remembered; the night goes on.
  }
}

export async function loadPhotos(): Promise<StoredPhoto[]> {
  try {
    const db = await open();
    const all = await new Promise<StoredPhoto[]>((resolve, reject) => {
      const req = db.transaction(STORE, 'readonly').objectStore(STORE).getAll();
      req.onsuccess = () => resolve(req.result as StoredPhoto[]);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return all.sort((a, b) => a.createdAt - b.createdAt);
  } catch {
    return [];
  }
}

async function prune(db: IDBDatabase): Promise<void> {
  const all = await new Promise<StoredPhoto[]>((resolve) => {
    const req = db.transaction(STORE, 'readonly').objectStore(STORE).getAll();
    req.onsuccess = () => resolve(req.result as StoredPhoto[]);
    req.onerror = () => resolve([]);
  });
  if (all.length <= KEEP) return;
  all.sort((a, b) => a.createdAt - b.createdAt);
  const drop = all.slice(0, all.length - KEEP);
  await new Promise<void>((resolve) => {
    const tx = db.transaction(STORE, 'readwrite');
    for (const p of drop) tx.objectStore(STORE).delete(p.id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
}
