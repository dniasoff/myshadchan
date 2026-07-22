// Every Worker response uses this envelope (ARCHITECTURE-SPINE.md, "Worker API
// / validation" convention): { success, data?, error?, meta? }.
export interface Envelope<T> {
  success: boolean;
  data?: T;
  error?: string;
  meta?: Record<string, unknown>;
}

export function ok<T>(data: T, meta?: Record<string, unknown>): Envelope<T> {
  return { success: true, data, meta };
}

export function fail(
  error: string,
  meta?: Record<string, unknown>,
): Envelope<never> {
  return { success: false, error, meta };
}
