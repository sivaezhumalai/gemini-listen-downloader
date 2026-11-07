// IndexedDB storage library for saved Gemini audio clips.
(function () {
  const DB_NAME = 'gemini-listen-downloader';
  const DB_VERSION = 1;
  const STORE_NAME = 'clips';

  let dbPromise = null;

  function getDB() {
    if (dbPromise) return dbPromise;

    if (typeof indexedDB === 'undefined' || !indexedDB) {
      return Promise.reject(new Error('Library unavailable: IndexedDB is not supported'));
    }

    dbPromise = new Promise((resolve, reject) => {
      let req;
      try {
        req = indexedDB.open(DB_NAME, DB_VERSION);
      } catch (err) {
        dbPromise = null;
        return reject(new Error('Library unavailable: ' + (err && err.message ? err.message : String(err))));
      }

      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
          store.createIndex('createdAt', 'createdAt', { unique: false });
        }
      };

      req.onsuccess = () => {
        const db = req.result;
        db.onversionchange = () => {
          db.close();
          dbPromise = null;
        };
        resolve(db);
      };

      req.onerror = () => {
        dbPromise = null;
        reject(new Error('Library unavailable: ' + (req.error ? req.error.message : 'failed to open IndexedDB')));
      };

      req.onblocked = () => {
        // DB open blocked
      };
    });

    return dbPromise;
  }

  async function isAvailable() {
    if (typeof indexedDB === 'undefined' || !indexedDB) {
      return false;
    }
    try {
      await getDB();
      return true;
    } catch {
      return false;
    }
  }

  async function saveClip(record) {
    if (!record || typeof record.id !== 'string') {
      throw new Error('Invalid record: id is required');
    }
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const getReq = store.get(record.id);
      let toStore = null;

      getReq.onsuccess = () => {
        const existing = getReq.result;
        if (existing) {
          toStore = Object.assign({}, existing, record, {
            name: existing.name !== undefined ? existing.name : record.name,
            createdAt: existing.createdAt !== undefined ? existing.createdAt : record.createdAt,
          });
        } else {
          toStore = Object.assign({}, record);
          if (toStore.createdAt === undefined) {
            toStore.createdAt = Date.now();
          }
        }
        store.put(toStore);
      };

      getReq.onerror = () => reject(getReq.error);
      tx.oncomplete = () => resolve(toStore);
      tx.onerror = () => reject(tx.error || new Error('Transaction error'));
      tx.onabort = () => reject(tx.error || new Error('Transaction aborted'));
    });
  }

  async function getClip(id) {
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(id);
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => reject(req.error);
      tx.onerror = () => reject(tx.error);
    });
  }

  async function listClips() {
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const index = store.index('createdAt');
      const items = [];
      const req = index.openCursor(null, 'prev');
      req.onsuccess = (e) => {
        const cursor = e.target.result;
        if (cursor) {
          items.push(cursor.value);
          cursor.continue();
        } else {
          resolve(items);
        }
      };
      req.onerror = () => reject(req.error);
      tx.onerror = () => reject(tx.error);
    });
  }

  async function updateClip(id, patch) {
    if (id === undefined || id === null || id === '') {
      return Promise.reject(new Error('Clip id missing'));
    }
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const getReq = store.get(id);
      let updated = null;
      let finished = false;

      getReq.onsuccess = () => {
        const existing = getReq.result;
        if (!existing) {
          finished = true;
          try { tx.abort(); } catch (_) {}
          return reject(new Error('Clip not found: ' + id));
        }
        updated = Object.assign({}, existing, patch, { id });
        store.put(updated);
      };

      getReq.onerror = () => {
        if (!finished) {
          finished = true;
          reject(getReq.error);
        }
      };

      tx.oncomplete = () => {
        if (!finished) {
          resolve(updated);
        }
      };

      tx.onerror = () => {
        if (!finished) {
          finished = true;
          reject(tx.error || new Error('Transaction error'));
        }
      };

      tx.onabort = () => {
        if (!finished) {
          finished = true;
          reject(tx.error || new Error('Transaction aborted'));
        }
      };
    });
  }

  async function deleteClip(id) {
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      store.delete(id);
      tx.oncomplete = () => resolve(undefined);
      tx.onerror = () => reject(tx.error || new Error('Transaction error'));
      tx.onabort = () => reject(tx.error || new Error('Transaction aborted'));
    });
  }

  async function clearClips() {
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      store.clear();
      tx.oncomplete = () => resolve(undefined);
      tx.onerror = () => reject(tx.error || new Error('Transaction error'));
      tx.onabort = () => reject(tx.error || new Error('Transaction aborted'));
    });
  }

  async function prune(maxCount = 30) {
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const countReq = store.count();
      let deletedCount = 0;

      countReq.onsuccess = () => {
        const total = countReq.result;
        const toDelete = total - maxCount;
        if (toDelete <= 0) {
          return;
        }

        const index = store.index('createdAt');
        const curReq = index.openCursor();
        curReq.onsuccess = (e) => {
          const cursor = e.target.result;
          if (cursor && deletedCount < toDelete) {
            cursor.delete();
            deletedCount++;
            if (deletedCount < toDelete) {
              cursor.continue();
            }
          }
        };
        curReq.onerror = () => reject(curReq.error);
      };

      countReq.onerror = () => reject(countReq.error);
      tx.oncomplete = () => resolve(deletedCount);
      tx.onerror = () => reject(tx.error || new Error('Transaction error'));
      tx.onabort = () => reject(tx.error || new Error('Transaction aborted'));
    });
  }

  async function usage() {
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      let count = 0;
      let bytes = 0;
      const req = store.openCursor();
      req.onsuccess = (e) => {
        const cursor = e.target.result;
        if (cursor) {
          count++;
          const sz = cursor.value ? cursor.value.size : 0;
          if (typeof sz === 'number' && !Number.isNaN(sz)) {
            bytes += sz;
          }
          cursor.continue();
        } else {
          resolve({ count, bytes });
        }
      };
      req.onerror = () => reject(req.error);
      tx.onerror = () => reject(tx.error);
    });
  }

  globalThis.__geminiListenStore = {
    isAvailable,
    saveClip,
    getClip,
    listClips,
    updateClip,
    deleteClip,
    clearClips,
    prune,
    usage,
  };
})();
