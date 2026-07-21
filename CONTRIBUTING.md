# Contributing to MyShadchan 💜

First off — **thank you.** MyShadchan is a non-profit, community project, and it
only gets better because people like you show up. Whether you're fixing a typo,
sharpening the Hebrew↔English matching, improving accessibility, or building out
a whole epic, you're welcome here.

Please read our [Code of Conduct](./CODE_OF_CONDUCT.md) first — we hold each other
to being kind, patient, and respectful.

---

## 🧭 Ways to contribute

You don't have to write code to make a real difference:

- 🐞 **Report bugs** — [open an issue](https://github.com/dniasoff/myshadchan/issues) with steps to reproduce.
- 💡 **Suggest ideas** — [start a discussion](https://github.com/dniasoff/myshadchan/discussions); lived experience of the shidduch process is the best spec we have.
- 📝 **Improve docs** — READMEs, guides, code comments, the glossary.
- 🧪 **Add tests** — coverage, edge cases, deterministic E2E flows.
- ♿ **Accessibility & i18n** — keyboard/screen-reader support, and English + Hebrew (RTL) polish.
- 🧠 **Code** — fixes and features (see the workflow below).

**Especially valuable right now:** Hebrew/English identity-matching heuristics ·
accessibility on both mobile and desktop · RTL layout polish · resume-parsing test
fixtures · privacy / row-level-security test coverage · documentation.

---

## 🤝 Before you start

- **For anything non-trivial, open an issue or discussion first** so we can shape the
  approach together before you invest time. Small, obvious fixes can go straight to a PR.
- **Look for [`good first issue`](https://github.com/dniasoff/myshadchan/labels/good%20first%20issue)** if you want a friendly way in.
- **Privacy is a feature, not an afterthought.** MyShadchan handles deeply sensitive
  data. Any change that touches auth, data access, channels, sharing, or storage should
  state its privacy behaviour explicitly — treat it as an acceptance criterion. When in
  doubt, ask.

---

## 🛠️ Local setup

You'll need **[Node 24 LTS](https://nodejs.org/)** (see [`.nvmrc`](./.nvmrc)),
**Docker** (for local Supabase), and **Make**.

```sh
git clone https://github.com/dniasoff/myshadchan.git
cd myshadchan
make install        # frontend, backend, local Supabase
make start          # full stack at http://localhost:5173/
```

Prefer throwaway data with no backend? `make start-demo` runs the in-browser FakeRest
demo (resets on reload). More detail lives in the [README](./README.md#-getting-started).

---

## ✅ The workflow

1. **Branch** off `main` (`git switch -c fix/short-description`).
2. **Make focused changes** — one logical change per PR is much easier to review.
3. **Keep it green** before you push:
   ```sh
   make lint          # ESLint + Prettier
   make typecheck     # TypeScript
   make test          # unit tests (Vitest)
   ```
4. **Add tests** for new behaviour — new code paths without tests are a blocking review issue (target **≥ 80%** coverage on new code).
5. **Open a PR** against `main` with a clear description of the *why*, and link the issue it addresses.

---

## 🎨 House style

These conventions live in [`AGENTS.md`](./AGENTS.md) and [`.claude/rules/`](./.claude/rules/) — the short version:

- **Keep files small and focused** — ~200–400 lines typical, 800 max; grow the file *count*, not the file.
- **Immutability** — never mutate objects in place; return new copies.
- **TypeScript, strictly** — no `any` (use `unknown` + narrow); validate external input with **Zod**; add explicit types to exported functions.
- **State** — server state via TanStack Query, shareable UI state in the URL, forms via React Hook Form.
- **Data access** goes through the `dataProvider` seam — components never call Supabase directly. Keep the **FakeRest** provider in sync when you add a resource or method.
- **Multi-tenancy & RLS** — every domain row carries an `account_id`; isolation is enforced in the database, and cross-account access is a bug. Add RLS tests for new tables.
- **Naming** — `camelCase` values, `PascalCase` types/components, `UPPER_SNAKE_CASE` constants, `use*` hooks, `snake_case` DB columns.
- **English only in committed files** — code, comments, docs, and commit messages are English. The one exception is runtime data that legitimately reflects the domain (e.g. Hebrew names, locale catalogs).
- **Errors** — handle explicitly; friendly messages to users, structured context to logs; never silently swallow. No `console.log` in production code.
- **Tests** — Arrange-Act-Assert, descriptive names, isolated (reset mocks in `beforeEach`); Playwright uses deterministic waits, never `waitForTimeout`.

Commit messages: **English, imperative** — e.g. `Add reference call-status tracking`.

---

## 🗺️ Where things live

| Path | What |
|---|---|
| `src/components/atomic-crm/` | Main application code, organised by domain *(the folder name is retained from the upstream fork — it's the internal namespace, not the product name)* |
| `src/components/admin/`, `src/components/ui/` | Mutable framework/UI dependencies — edit directly when needed |
| `supabase/schemas/` | Declarative database schema (source of truth) |
| `supabase/migrations/` | Auto-generated migrations |
| `e2e/` | Playwright end-to-end tests |
| `_bmad-output/planning-artifacts/` | The [PRD](./_bmad-output/planning-artifacts/prds/prd-myshadchan-2026-07-21/prd.md) and [architecture](./_bmad-output/planning-artifacts/architecture/architecture-myshadchan-2026-07-21/ARCHITECTURE-SPINE.md) |

New to the domain vocabulary (shadchan, shidduch, redt…)? There's a
[glossary in the README](./README.md#-glossary).

---

## 📜 Licensing of contributions

By contributing, you agree that your contributions are licensed under the project's
[Functional Source License (FSL-1.1-ALv2)](./LICENSE), which converts to Apache-2.0
two years after each release.

Thank you for helping build something that makes a genuinely hard, emotional process a
little calmer. 🙏
