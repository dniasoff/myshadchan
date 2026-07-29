// Hand-written declarations for scripts/stack-env.mjs.
//
// The resolver is plain ESM because the makefile has to run it with bare
// `node`, but playwright.config.ts, vitest.config.ts, e2e/fixtures.ts and the
// database suites all import it too, and tsconfig.node.json has allowJs off.
// One module, one allocation table — duplicating the port arithmetic into TS
// is exactly how the two halves would drift apart.

export declare const MAX_STACK_INDEX: number;
export declare const DEV_DB_URL: string;

export interface StackPorts {
  shadow: number;
  api: number;
  db: number;
  studio: number;
  inbucket: number;
  analytics: number;
  vector: number;
  pooler: number;
  app: number;
  vitestBrowser: number;
}

export interface Stack {
  /** 0..MAX_STACK_INDEX. 0 is the historical, unparameterised allocation. */
  index: number;
  /** False when STACK_ID was unset/empty — the caller is on the default path. */
  isExplicit: boolean;
  /** "" for stack 0, "-N" otherwise. */
  suffix: string;
  projectId: string;
  workdir: string;
  logTag: string;
  outputDir: string;
  ports: StackPorts;
  supabaseUrl: string;
  dbUrl: string;
  studioUrl: string;
  mailpitUrl: string;
  appUrl: string;
}

export declare function parseStackId(raw: unknown): number;
export declare function resolveStack(raw: unknown): Stack;
export declare function dbUrlFromEnv(env?: NodeJS.ProcessEnv): string;
export declare function supabaseUrlFromEnv(env?: NodeJS.ProcessEnv): string;
export declare function shellVars(stack: Stack): Record<string, string>;
