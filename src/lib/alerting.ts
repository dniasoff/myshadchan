export interface AlertContext {
  release: string;
  route: string;
  requestId: string;
  accountId?: number;
  surface: "spa";
}

export interface AlertPayload {
  timestamp: string;
  context: AlertContext;
  error: {
    category: string;
    errorClass: string;
    message: string;
    stack?: string;
  };
  severity: "critical" | "warning";
}

const ALERT_WEBHOOK_URL = "https://alerts.myshadchan.space/webhook";

function getRelease(): string {
  return (window as Window & { __RELEASE__?: string }).__RELEASE__ ?? "unknown";
}

function generateRequestId(): string {
  return crypto.randomUUID();
}

export function buildAlertContext(
  route: string,
  accountId?: number,
): AlertContext {
  return {
    release: getRelease(),
    route,
    requestId: generateRequestId(),
    accountId,
    surface: "spa",
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

function summarizeErrorForLog(error: unknown): AlertPayload["error"] {
  if (error instanceof Error) {
    return {
      category: "unknown",
      errorClass: error.constructor.name,
      message: error.message,
      stack: error.stack,
    };
  }
  if (typeof error === "string") {
    return { category: "unknown", errorClass: "String", message: error };
  }
  return {
    category: "unknown",
    errorClass: typeof error,
    message: String(error),
  };
}

async function emitAlert(payload: AlertPayload): Promise<void> {
  try {
    await fetch(ALERT_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      keepalive: true,
    });
  } catch {
    console.error("alerting.emitFailed", { payloadType: "error" });
  }
}

export async function alertOnError(
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
}

export function createErrorAlerter(route: string, accountId?: number) {
  const context = buildAlertContext(route, accountId);
  return (error: unknown, severity?: "critical" | "warning") =>
    alertOnError(error, context, severity);
}

let errorHandlerAttached = false;

export function attachGlobalErrorHandler(
  getAccountId?: () => number | undefined,
): void {
  if (errorHandlerAttached) return;
  errorHandlerAttached = true;

  const handleError = (event: ErrorEvent | PromiseRejectionEvent) => {
    const error = event instanceof ErrorEvent ? event.error : event.reason;
    const route = window.location.pathname;
    const accountId = getAccountId?.();
    const alerter = createErrorAlerter(route, accountId);
    alerter(error, "critical");
  };

  window.addEventListener("error", handleError);
  window.addEventListener("unhandledrejection", handleError);
}
