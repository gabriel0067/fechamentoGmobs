const DATABASE_NAME = "gmobs-closing-storage";
const DATABASE_VERSION = 1;
const STORE_NAME = "application-state";
export const CLOSING_STORAGE_KEY = "gmobs-closing-v3";
export const BILLED_STORAGE_KEY = "gmobs-billed-documents-v1";
export const ROMANEIO_STORAGE_KEY = "gmobs-romaneios-v1";
const CLOUD_CACHE_PREFIX = "gmobs-cloud-cache-v1:";

let closingWriteQueue: Promise<void> = Promise.resolve();
let billedWriteQueue: Promise<void> = Promise.resolve();
let romaneioWriteQueue: Promise<void> = Promise.resolve();

const openDatabase = () =>
  new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB não está disponível neste navegador."));
      return;
    }

    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME))
        database.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error || new Error("Não foi possível abrir o armazenamento."));
    request.onblocked = () =>
      reject(new Error("O armazenamento está sendo usado por outra aba."));
  });

const readStorage = async <T>(key: string) => {
  const database = await openDatabase();
  try {
    return await new Promise<T | null>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readonly");
      const request = transaction.objectStore(STORE_NAME).get(key);
      request.onsuccess = () => resolve((request.result as T | undefined) ?? null);
      request.onerror = () =>
        reject(request.error || new Error("Não foi possível ler o relatório salvo."));
      transaction.onabort = () =>
        reject(
          transaction.error || new Error("A leitura do relatório foi interrompida."),
        );
    });
  } finally {
    database.close();
  }
};

export function readClosingStorage<T>() {
  return readStorage<T>(CLOSING_STORAGE_KEY);
}

export function readBilledStorage<T>() {
  return readStorage<T>(BILLED_STORAGE_KEY);
}

export function readRomaneioStorage<T>() {
  return readStorage<T>(ROMANEIO_STORAGE_KEY);
}

export function readCloudStateCache<T>(stateKey: string) {
  return readStorage<{ version: string; value: T }>(`${CLOUD_CACHE_PREFIX}${stateKey}`);
}

const writeStorageNow = async (key: string, value: unknown) => {
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readwrite");
      transaction.objectStore(STORE_NAME).put(value, key);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () =>
        reject(
          transaction.error || new Error("Não foi possível salvar o relatório."),
        );
      transaction.onabort = () =>
        reject(
          transaction.error ||
            new Error("O salvamento do relatório foi interrompido."),
        );
    });
  } finally {
    database.close();
  }
};

export function writeClosingStorage(value: unknown) {
  const nextWrite = closingWriteQueue
    .catch(() => undefined)
    .then(() => writeStorageNow(CLOSING_STORAGE_KEY, value));
  closingWriteQueue = nextWrite;
  return nextWrite;
}

export function writeBilledStorage(value: unknown) {
  const nextWrite = billedWriteQueue
    .catch(() => undefined)
    .then(() => writeStorageNow(BILLED_STORAGE_KEY, value));
  billedWriteQueue = nextWrite;
  return nextWrite;
}

export function writeRomaneioStorage(value: unknown) {
  const nextWrite = romaneioWriteQueue
    .catch(() => undefined)
    .then(() => writeStorageNow(ROMANEIO_STORAGE_KEY, value));
  romaneioWriteQueue = nextWrite;
  return nextWrite;
}

export function writeCloudStateCache(stateKey: string, version: string, value: unknown) {
  return writeStorageNow(`${CLOUD_CACHE_PREFIX}${stateKey}`, { version, value });
}
