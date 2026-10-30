/**
 * IndexedDB 存储层：卡片元数据（cards）与图片 Blob（images）。
 * 所有写操作都在单个事务内完成，失败即整体回滚，不留半张卡。
 */

const DB_NAME = 'cardcase';
const DB_VERSION = 1;
const CARD_STORE = 'cards';
const IMAGE_STORE = 'images';

/** 配额不足时抛出的专用错误。 */
export class StorageQuotaError extends Error {
  constructor(message = '存储空间不足，先导出备份再删几张') {
    super(message);
    this.name = 'StorageQuotaError';
  }
}

/** 配额错误转成 StorageQuotaError，其余错误原样返回。 */
function wrapError(error) {
  if (error && error.name === 'QuotaExceededError') {
    return new StorageQuotaError('存储空间不足，先导出备份再删几张');
  }
  return error ?? new Error('IndexedDB 操作失败');
}

/** 打开（必要时创建）数据库。 */
export function openDb() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined' || indexedDB === null) {
      reject(new Error('当前环境不支持 IndexedDB'));
      return;
    }

    let request;
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION);
    } catch (error) {
      reject(wrapError(error));
      return;
    }

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(CARD_STORE)) {
        db.createObjectStore(CARD_STORE, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(IMAGE_STORE)) {
        db.createObjectStore(IMAGE_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(wrapError(request.error));
    request.onblocked = () => reject(new Error('数据库被其他标签页占用，请关闭后重试'));
  });
}

/**
 * 在一个事务里执行写入。work 只负责 put / delete / clear。
 * 事务完成才 resolve；error / abort 一律 reject（事务自动回滚）。
 */
function runWrite(db, storeNames, work) {
  return new Promise((resolve, reject) => {
    let tx;
    try {
      tx = db.transaction(storeNames, 'readwrite');
    } catch (error) {
      reject(wrapError(error));
      return;
    }

    let settled = false;
    const fail = (error) => {
      if (settled) return;
      settled = true;
      reject(wrapError(error));
    };

    tx.oncomplete = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    tx.onerror = () => fail(tx.error);
    tx.onabort = () => fail(tx.error ?? new Error('事务已中止'));

    try {
      work(tx);
    } catch (error) {
      fail(error);
      try {
        tx.abort();
      } catch {
        /* 事务已结束，忽略 */
      }
    }
  });
}

/** 单 store 只读请求，事务完成时返回请求结果。 */
function runRead(db, storeName, makeRequest) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const request = makeRequest(tx.objectStore(storeName));
    let result;
    request.onsuccess = () => {
      result = request.result;
    };
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(wrapError(tx.error));
    tx.onabort = () => reject(wrapError(tx.error ?? new Error('事务已中止')));
  });
}

/** 保存一张卡及图片，同一事务写两个 store。 */
export async function saveCard(card, imageBlob) {
  if (!card || typeof card.id !== 'string' || !card.id) {
    throw new Error('card.id 缺失，无法保存');
  }
  const db = await openDb();
  try {
    await runWrite(db, [CARD_STORE, IMAGE_STORE], (tx) => {
      tx.objectStore(CARD_STORE).put(card);
      tx.objectStore(IMAGE_STORE).put(imageBlob, card.id);
    });
  } finally {
    db.close();
  }
}

/** 只更新卡片元数据（不动图片）。 */
export async function updateCard(card) {
  if (!card || typeof card.id !== 'string' || !card.id) {
    throw new Error('card.id 缺失，无法更新');
  }
  const db = await openDb();
  try {
    await runWrite(db, [CARD_STORE], (tx) => {
      tx.objectStore(CARD_STORE).put(card);
    });
  } finally {
    db.close();
  }
}

/** 读取全部卡片。 */
export async function listCards() {
  const db = await openDb();
  try {
    const result = await runRead(db, CARD_STORE, (store) => store.getAll());
    return result ?? [];
  } finally {
    db.close();
  }
}

/** 读取图片 Blob，不存在时返回 null。 */
export async function getImage(id) {
  const db = await openDb();
  try {
    const result = await runRead(db, IMAGE_STORE, (store) => store.get(id));
    return result ?? null;
  } finally {
    db.close();
  }
}

/** 同一事务删除卡片与图片。 */
export async function deleteCard(id) {
  const db = await openDb();
  try {
    await runWrite(db, [CARD_STORE, IMAGE_STORE], (tx) => {
      tx.objectStore(CARD_STORE).delete(id);
      tx.objectStore(IMAGE_STORE).delete(id);
    });
  } finally {
    db.close();
  }
}

/** 清空两个 store。 */
export async function clearAll() {
  const db = await openDb();
  try {
    await runWrite(db, [CARD_STORE, IMAGE_STORE], (tx) => {
      tx.objectStore(CARD_STORE).clear();
      tx.objectStore(IMAGE_STORE).clear();
    });
  } finally {
    db.close();
  }
}

/**
 * 替换整柜：在同一个 readwrite 事务里先清空 cards/images 再逐条写入。
 * 任一步失败整体 abort，旧数据保持原样；QuotaExceededError 仍包成 StorageQuotaError。
 * @param {Array<{card: object, blob: Blob}>} entries
 */
export async function importReplace(entries) {
  const db = await openDb();
  try {
    await runWrite(db, [CARD_STORE, IMAGE_STORE], (tx) => {
      tx.objectStore(CARD_STORE).clear();
      tx.objectStore(IMAGE_STORE).clear();
      for (const { card, blob } of entries) {
        tx.objectStore(CARD_STORE).put(card);
        tx.objectStore(IMAGE_STORE).put(blob, card.id);
      }
    });
  } finally {
    db.close();
  }
}
