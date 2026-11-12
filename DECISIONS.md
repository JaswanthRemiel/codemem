# Decisions

Each entry: context, options, decision, consequences.

## 001: Pin tool majors that still support Node.js 20

- **Context:** The spec targets Node.js 20+ and CI runs Node 20 and 22. On 2026-11-12 the latest majors of several tools had dropped Node 20: vitest 5 and commander 15 need Node 22.12+, and typescript-eslint 8 does not accept TypeScript 7.
- **Options:** (a) raise the minimum to Node 22, (b) pin the newest majors that still support Node 20.
- **Decision:** (b). vitest 4, commander 14, TypeScript 6.0, `@types/node` 20. The minimum is Node 20.19.0 because ESLint 10 requires it.
- **Consequences:** We are one major behind on three tools. Revisit when the Node 20 requirement is dropped.

## 002: Git hooks without a hook manager

- **Context:** The em dash and emoji check must run before every commit.
- **Options:** (a) husky or a similar dependency, (b) a tracked `.githooks/` folder enabled with `git config core.hooksPath`.
- **Decision:** (b). The `prepare` script sets `core.hooksPath` on `npm install`.
- **Consequences:** No extra dependency. A contributor who never runs `npm install` has no hook, but CI runs the same check.

## 003: Em dash and emoji check definition

- **Context:** Hard rule 5 bans em dashes and emojis in every tracked file.
- **Decision:** `scripts/check-chars.mjs` scans `git ls-files` for U+2014 and any character with the Unicode `Extended_Pictographic` property. Files that contain a NUL byte are treated as binary and skipped.
- **Consequences:** `Extended_Pictographic` also covers a few symbols such as the copyright and trademark signs, so those are banned too. Plain digits, `#` and `*` are allowed.

## 004: ESLint without `@eslint/js` or `eslint-config-prettier`

- **Context:** Both are common additions that the tech stack table does not list.
- **Decision:** Use only `typescript-eslint` (strict preset). It has no formatting rules, so nothing conflicts with Prettier.
- **Consequences:** Plain JavaScript files (config and scripts) get the TypeScript-aware rules only, not the core recommended set.

## 005: Two tsconfig files

- **Context:** Tests live in `test/` and must be typechecked but not emitted to `dist/`.
- **Decision:** `tsconfig.json` typechecks `src` and `test` with `noEmit`; `tsconfig.build.json` extends it and emits `src` to `dist`.
- **Consequences:** `npm run typecheck` and `npm run build` use different configs on purpose.
