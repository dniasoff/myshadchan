import { summarizeErrorForLog, type SafeErrorSummary } from "./safeLog";
import type { BaseEnv } from "./env";

export interface AlertContext {
  release: string;
  route: string;
  requestId: string;
  accountId?: number;
  worker: string;
  surface: "worker" | "edge-function" | "spa";
}

export interface AlertPayload {
  timestamp: string;
  context: AlertContext;
  error: SafeErrorSummary;
  severity: "critical" | "warning";
}

export interface SilenceAlertPayload {
  timestamp: string;
  context: {
    worker: string;
    signal: "reminder-sweep" | "stripe-webhook";
    expectedIntervalMinutes: number;
    lastSeenAt: string | null;
  };
  severity: "critical";
}

const ALERT_WEBHOOK_URL = "https://alerts.myshadchan.space/webhook";

function getRelease(): string {
  return (globalThis as { __RELEASE__?: string }).__RELEASE__ ?? "unknown";
}

export function buildAlertContext(
  worker: string,
  route: string,
  requestId: string,
  accountId?: number,
): AlertContext {
  return {
    release: getRelease(),
    route,
    requestId,
    accountId,
    worker,
    surface: "worker",
  };
}

function redactAccountId(payload: AlertPayload): AlertPayload {
  return {
    ...payload,
    context: {
      ...payload.context,
      accountId: undefined,
    },
  };
}

async function emitAlert(
  payload: AlertPayload | SilenceAlertPayload,
): Promise<void> {
  try {
    await fetch(ALERT_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch {
    console.error("alerting.emitFailed", {
      payloadType: "severity" in payload ? "error" : "silence",
    });
  }
}

export async function alertOnError(
  _env: BaseEnv,
  error: unknown,
  context: AlertContext,
  severity: "critical" | "warning" = "critical",
): Promise<void> {
  const summary = summarizeErrorForLog(error);
  const payload: AlertPayload = {
    timestamp: new Date().toISOString(),
    context,
    error: summary,
    severity,
  };

  const isPaidPath =
    context.route.startsWith("/parse") ||
    context.route.startsWith("/ai") ||
    context.route.startsWith("/share");
  const finalPayload = isPaidPath ? payload : redactAccountId(payload);

  await emitAlert(finalPayload);

  if (isPaidPath && severity === "critical") {
    throw error;
  }
}

export async function alertOnSilence(
  _env: BaseEnv,
  signal: "reminder-sweep" | "stripe-webhook",
  expectedIntervalMinutes: number,
  lastSeenAt: string | null,
  worker: string,
): Promise<void> {
  const payload: SilenceAlertPayload = {
    timestamp: new Date().toISOString(),
    context: {
      worker,
      signal,
      expectedIntervalMinutes,
      lastSeenAt,
    },
    severity: "critical",
  };

  await emitAlert(payload);
}

export function createErrorAlerter(
  env: BaseEnv,
  worker: string,
  route: string,
  requestId: string,
  accountId?: number,
) {
  const context = buildAlertContext(worker, route, requestId, accountId);
  return (error: unknown, severity?: "critical" | "warning") =>
    alertOnError(env, error, context, severity);
}
