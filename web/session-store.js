// Local, atomic session storage. CIF text is kept separately from the small
// settings record so camera autosaves do not rewrite a large structure.
export const SESSION_VERSION = 1;

export function createSessionStore({
  dbName = "phasesmith-viewer-session",
} = {}) {
  let opening = null,
    chain = Promise.resolve(),
    cachedDocument = null;
  const open = () =>
    (opening ??= new Promise((resolve, reject) => {
      const request = indexedDB.open(dbName, 1);
      request.onupgradeneeded = () =>
        request.result.createObjectStore("records");
      request.onerror = () => {
        opening = null;
        reject(request.error);
      };
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => {
          db.close();
          opening = null;
        };
        resolve(db);
      };
    }));
  const completed = (tx) =>
    new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onabort = () =>
        reject(tx.error ?? Error("Session storage transaction was aborted."));
      tx.onerror = () => {}; // onabort reports the transaction's actual failure
    });
  const enqueue = (work) => {
    const result = chain.then(work);
    chain = result.catch(() => {});
    return result;
  };
  return {
    async load() {
      await chain;
      const db = await open(),
        tx = db.transaction("records", "readonly"),
        store = tx.objectStore("records");
      const done = completed(tx),
        document = store.get("document"),
        state = store.get("state");
      await done;
      const record = state.result,
        source = document.result;
      if (
        !record ||
        record.version !== SESSION_VERSION ||
        !source ||
        source.id !== record.documentId ||
        typeof source.text !== "string" ||
        typeof source.filename !== "string" ||
        !record.state ||
        typeof record.state !== "object" ||
        Array.isArray(record.state)
      )
        return null;
      cachedDocument = source;
      return {
        version: record.version,
        document: structuredClone(source),
        state: structuredClone(record.state),
        entrypoint: record.entrypoint,
        savedAt: record.savedAt,
      };
    },
    save({ document, state, entrypoint = "" }) {
      if (
        !document ||
        typeof document.text !== "string" ||
        typeof document.filename !== "string"
      )
        return Promise.reject(
          Error("A session needs its CIF text and filename."),
        );
      if (!state || typeof state !== "object" || Array.isArray(state))
        return Promise.reject(Error("A session needs viewer settings."));
      // Freeze this save before waiting for an earlier transaction.
      const snapshot = structuredClone(state);
      if (
        !cachedDocument ||
        cachedDocument.text !== document.text ||
        cachedDocument.filename !== document.filename
      )
        cachedDocument = {
          id: crypto.randomUUID(),
          text: document.text,
          filename: document.filename,
        };
      const source = cachedDocument,
        savedAt = Date.now();
      return enqueue(async () => {
        const db = await open(),
          tx = db.transaction("records", "readwrite"),
          store = tx.objectStore("records");
        const done = completed(tx),
          manifest = store.get("manifest");
        manifest.onsuccess = () => {
          // Another tab may have saved a different CIF. Restore this source
          // atomically with its settings, without reading/cloning old CIF text.
          if (manifest.result?.id !== source.id) {
            store.put(source, "document");
            store.put({ id: source.id }, "manifest");
          }
          store.put(
            {
              version: SESSION_VERSION,
              documentId: source.id,
              state: snapshot,
              entrypoint,
              savedAt,
            },
            "state",
          );
        };
        await done;
        return { savedAt };
      });
    },
    clear() {
      return enqueue(async () => {
        const db = await open(),
          tx = db.transaction("records", "readwrite"),
          done = completed(tx);
        tx.objectStore("records").clear();
        await done;
        cachedDocument = null;
      });
    },
    async close() {
      await chain;
      if (opening) (await opening).close();
      opening = null;
    },
  };
}
