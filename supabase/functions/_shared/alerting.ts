export interface AlertContext {
  release: string;
  route: string;
  requestId: string;
  accountId?: number;
  function: string;
  surface: "edge-function";
}

export interface AlertPayload {
  timestamp: string;
  context: AlertContext;
  error: {
    category: string;
    errorClass: string;
    httpStatus?: number;
    postgresCode?: string;
    issueCount?: number;
  };
  severity: "critical" | "warning";
}

export interface SilenceAlertPayload {
  timestamp: string;
  context: {
    function: string;
    signal: "reminder-sweep" | "stripe-webhook";
    expectedIntervalMinutes: number;
    lastSeenAt: string | null;
  };
  severity: "critical";
}

interface EdgeEnv {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
}

const ALERT_WEBHOOK_URL = "https://alerts.myshadchan.space/webhook";

function getRelease(): string {
  return (globalThis as { __RELEASE__?: string }).__RELEASE__ ?? "unknown";
}

function summarizeErrorForLog(error: unknown): AlertPayload["error"] {
  if (error instanceof Error) {
    const category = error.name === "TypeError" ? "network" : "unknown";
    return { category, errorClass: error.constructor.name };
  }
  if (typeof error === "object" && error !== null && "status" in error) {
    return {
      category: "http_status",
      errorClass: "ResponseError",
      httpStatus: (error as { status: number }).status,
    };
  }
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = (error as { code: string }).code;
    if (/^[0-9A-Z]{5}$/.test(code)) {
      return {
        category: "database",
        errorClass: "PostgrestError",
        postgresCode: code,
      };
    }
  }
  return { category: "unknown", errorClass: typeof error };
}

export function buildAlertContext(
  functionName: string,
  route: string,
  requestId: string,
  accountId?: number,
): AlertContext {
  return {
    release: getRelease(),
    route,
    requestId,
    accountId,
    function: functionName,
    surface: "edge-function",
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
  env: EdgeEnv,
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
  env: EdgeEnv,
  signal: "reminder-sweep" | "stripe-webhook",
  expectedIntervalMinutes: number,
  lastSeenAt: string | null,
  functionName: string,
): Promise<void> {
  const payload: SilenceAlertPayload = {
    timestamp: new Date().toISOString(),
    context: {
      function: functionName,
      signal,
      expectedIntervalMinutes,
      lastSeenAt,
    },
    severity: "critical",
  };

  await emitAlert(payload);
}

export function createErrorAlerter(
  env: EdgeEnv,
  functionName: string,
  route: string,
  requestId: string,
  accountId?: number,
) {
  const context = buildAlertContext(functionName, route, requestId, accountId);
  return (error: unknown, severity?: "critical" | "warning") =>
    alertOnError(env, error, context, severity);
}
