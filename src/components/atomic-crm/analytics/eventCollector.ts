import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import { AnalyticsEventSchema, type AnalyticsEvent } from "./types";

interface AnalyticsDB extends DBSchema {
  events: {
    key: number;
    value: {
      id?: number;
      event: AnalyticsEvent;
      timestamp: number;
      retries: number;
    };
    indexes: { "by-timestamp": number };
  };
  settings: {
    key: string;
    value: {
      key: string;
      value: unknown;
    };
  };
}

const DB_NAME = "analytics-events-db";
const DB_VERSION = 1;
const MAX_RETRIES = 5;
const FLUSH_INTERVAL_MS = 30000;
const MAX_BATCH_SIZE = 50;

let dbPromise: Promise<IDBPDatabase<AnalyticsDB>> | null = null;
let flushTimer: ReturnType<typeof setInterval> | null = null;
let isOnline = true;
let analyticsEnabled = true;
let accountId: string | null = null;

function getDB(): Promise<IDBPDatabase<AnalyticsDB>> {
  if (!dbPromise) {
    dbPromise = openDB<AnalyticsDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains("events")) {
          const store = db.createObjectStore("events", {
            keyPath: "id",
            autoIncrement: true,
          });
          store.createIndex("by-timestamp", "timestamp");
        }
        if (!db.objectStoreNames.contains("settings")) {
          db.createObjectStore("settings", { keyPath: "key" });
        }
      },
    });
  }
  return dbPromise;
}

export async function initEventCollector(
  accountIdParam: string,
  enabled: boolean,
): Promise<void> {
  accountId = accountIdParam;
  analyticsEnabled = enabled;
  isOnline = navigator.onLine;

  window.addEventListener("online", () => {
    isOnline = true;
    scheduleFlush();
  });
  window.addEventListener("offline", () => {
    isOnline = false;
  });

  if (analyticsEnabled) {
    startFlushTimer();
  }
}

export function setAnalyticsEnabled(enabled: boolean): void {
  analyticsEnabled = enabled;
  if (enabled) {
    startFlushTimer();
  } else {
    stopFlushTimer();
  }
}

function startFlushTimer(): void {
  if (flushTimer) return;
  flushTimer = setInterval(() => {
    if (analyticsEnabled && isOnline) {
      flushEvents().catch(console.error);
    }
  }, FLUSH_INTERVAL_MS);
}

function stopFlushTimer(): void {
  if (flushTimer) {
    clearInterval(flushTimer);
    flushTimer = null;
  }
}

export async function collectEvent(event: AnalyticsEvent): Promise<void> {
  if (!analyticsEnabled || !accountId) return;

  const db = await getDB();
  await db.add("events", {
    event: { ...event, properties: { ...event.properties } },
    timestamp: Date.now(),
    retries: 0,
  });

  if (isOnline) {
    scheduleFlush();
  }
}

function scheduleFlush(): void {
  if (flushTimer) return;
  setTimeout(() => {
    if (analyticsEnabled && isOnline) {
      flushEvents().catch(console.error);
    }
  }, 1000);
}

async function flushEvents(): Promise<void> {
  if (!accountId || !analyticsEnabled || !isOnline) return;

  const db = await getDB();
  const events = await db.getAllFromIndex("events", "by-timestamp");

  if (events.length === 0) return;

  const batches: AnalyticsEvent[][] = [];
  for (let i = 0; i < events.length; i += MAX_BATCH_SIZE) {
    batches.push(events.slice(i, i + MAX_BATCH_SIZE).map((e) => e.event));
  }

  for (const batch of batches) {
    try {
      const response = await fetch("/api/analytics/events", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ events: batch }),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const idsToDelete = events
        .filter((e) => batch.some((be) => be === e.event))
        .map((e) => e.id)
        .filter((id): id is number => id !== undefined);
      const tx = db.transaction("events", "readwrite");
      await Promise.all(idsToDelete.map((id) => tx.store.delete(id)));
      await tx.done;
    } catch {
      for (const event of events.filter((e) =>
        batch.some((be) => be === e.event),
      )) {
        if (event.retries < MAX_RETRIES) {
          await db.put("events", { ...event, retries: event.retries + 1 });
        } else {
          if (event.id !== undefined) {
            await db.delete("events", event.id);
          }
        }
      }
      break;
    }
  }
}

export async function getQueuedEventCount(): Promise<number> {
  const db = await getDB();
  return db.count("events");
}

export async function clearAllEvents(): Promise<void> {
  const db = await getDB();
  await db.clear("events");
}

export async function setSetting(key: string, value: unknown): Promise<void> {
  const db = await getDB();
  await db.put("settings", { key, value });
}

export async function getSetting<T>(key: string): Promise<T | undefined> {
  const db = await getDB();
  const result = await db.get("settings", key);
  return result?.value as T | undefined;
}

function validateEvent(event: unknown): event is AnalyticsEvent {
  return AnalyticsEventSchema.safeParse(event).success;
}

export { validateEvent };
