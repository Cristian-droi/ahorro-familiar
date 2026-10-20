import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// Layer boundaries (docs/convenciones.md, section 2). Covered by
// src/__tests__/eslint-boundaries.test.ts. In flat config, a later block
// replaces `no-restricted-imports` for the files it matches, so each layer
// block repeats the admin-client restriction.

const ADMIN_CLIENT = {
  group: ["@/lib/supabase/admin", "**/supabase/admin", "@/shared/infra/**", "**/shared/infra/**"],
  message: "The Supabase admin client only belongs in src/modules/*/infra (docs/convenciones.md, rule 4).",
};

const FRAMEWORKS_AND_IO = [
  { group: ["@supabase/*"], message: "Domain and application cannot import Supabase. Use a port implemented in infra." },
  { group: ["next", "next/*"], message: "Domain and application cannot import Next.js." },
  { group: ["**/infra", "**/infra/**"], message: "Domain and application cannot import infra. Depend on a port instead." },
];

const DOMAIN_ONLY = [
  { group: ["react", "react-dom", "react/*"], message: "The domain is pure: no React." },
  { group: ["**/application", "**/application/**"], message: "The domain cannot depend on the application layer." },
  { group: ["@/app/**", "@/components/**", "@/lib/**"], message: "The domain cannot import UI, routes or legacy src/lib code." },
];

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),

  // Admin client: warning in legacy code until S4 moves writes to use cases.
  {
    files: ["src/**/*.{ts,tsx,js,jsx,mjs}"],
    ignores: ["src/modules/*/infra/**", "src/lib/supabase/admin.ts"],
    rules: {
      "no-restricted-imports": ["warn", { patterns: [ADMIN_CLIENT] }],
    },
  },

  // Application layer: no infra, Supabase or Next.js.
  {
    files: ["src/modules/*/application/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": ["error", { patterns: [ADMIN_CLIENT, ...FRAMEWORKS_AND_IO] }],
    },
  },

  // Domain layer: pure functions. Time, env and network arrive as parameters.
  {
    files: ["src/modules/*/domain/**/*.{ts,tsx}", "src/shared/domain/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": ["error", { patterns: [ADMIN_CLIENT, ...FRAMEWORKS_AND_IO, ...DOMAIN_ONLY] }],
      "no-restricted-globals": [
        "error",
        { name: "fetch", message: "The domain does no I/O." },
        { name: "process", message: "The domain does not read process.env. Pass values as parameters." },
      ],
      "no-restricted-syntax": [
        "error",
        {
          selector: "NewExpression[callee.name='Date'][arguments.length=0]",
          message: "The domain never reads the clock. Receive the date as a parameter (shared/domain/fechas.ts).",
        },
        {
          selector: "CallExpression[callee.object.name='Date'][callee.property.name='now']",
          message: "The domain never reads the clock. Receive the date as a parameter (shared/domain/fechas.ts).",
        },
      ],
    },
  },
]);

export default eslintConfig;
