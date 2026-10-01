/**
 * 历史存储:IndexedDB。
 *
 * 两个 store:'meta'(历史元数据,列表页只读它)+ 'blobs'(图片正文)。
 * 分开的理由:画廊列表若连带 Blob 一起读,翻几十条历史就得解几十 MB;
 * 元数据轻、正文按需取。缩略图 P0 不做(直连返回原图,浏览器解码已够快)。
 */
import type { TlbHistoryMeta } from '@/types';

const DB_NAME = 'st-taglab';
const DB_VERSION = 3;

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('meta')) {
        const store = db.createObjectStore('meta', { keyPath: 'id' });
        store.createIndex('createdAt', 'createdAt');
      }
      if (!db.objectStoreNames.contains('blobs')) {
        db.createObjectStore('blobs', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('vibes')) {
        db.createObjectStore('vibes', { keyPath: 'id' });
      }
      // v3:画师串预览图(从柏宝绘/智绘姬/小白X 同步进来的快照,keyPath id = 画师串 id)
      if (!db.objectStoreNames.contains('artist-preview')) {
        db.createObjectStore('artist-preview', { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB 打开失败'));
  });
  return dbPromise;
}

/** 通用事务封装(vibes store 共用)。 */
export function tx<T>(store: string, mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    db =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(store, mode);
        const req = run(t.objectStore(store));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error ?? new Error('IndexedDB 操作失败'));
      }),
  );
}

export async function saveHistory(meta: TlbHistoryMeta, blob: Blob): Promise<void> {
  await tx('meta', 'readwrite', s => s.put(meta));
  await tx('blobs', 'readwrite', s => s.put({ id: meta.id, blob }));
}

/** 只更新元数据(标签等),不触碰图片 Blob。 */
export async function putMeta(meta: TlbHistoryMeta): Promise<void> {
  await tx('meta', 'readwrite', s => s.put(meta));
}

/** 历史列表(新→旧);limit 缺省全量 —— 手动测试场景量级不大,全读元数据无压力。 */
export async function listHistory(limit = 500): Promise<TlbHistoryMeta[]> {
  const all = await tx<TlbHistoryMeta[]>('meta', 'readonly', s => s.getAll());
  return all.sort((a, b) => b.createdAt - a.createdAt).slice(0, limit);
}

export async function getBlob(id: string): Promise<Blob | null> {
  const rec = await tx<{ id: string; blob: Blob } | undefined>('blobs', 'readonly', s => s.get(id));
  return rec?.blob ?? null;
}

export async function deleteHistory(id: string): Promise<void> {
  await tx('meta', 'readwrite', s => s.delete(id));
  await tx('blobs', 'readwrite', s => s.delete(id));
}

export async function clearHistory(): Promise<void> {
  await tx('meta', 'readwrite', s => s.clear());
  await tx('blobs', 'readwrite', s => s.clear());
}
