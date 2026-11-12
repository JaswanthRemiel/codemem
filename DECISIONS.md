# Decisions

Each entry: context, options, decision, consequences.

## 001: Node.js 22 minimum, TypeScript pinned to 6.0

- **Context:** The spec said Node.js 20+, but Node 20 reached end of life in April 2026 and the current majors of vitest (5) and commander (15) need Node 22.12+. ESLint 10 needs 22.13+. typescript-eslint 8 does not accept TypeScript 7.
- **Options:** (a) keep Node 20 and pin older majors, (b) raise the minimum to Node 22 and use current majors.
- **Decision:** (b), by owner decision on 2026-11-12. The minimum is Node 22.13.0 and CI tests Node 22 and 24. TypeScript stays on 6.0 until typescript-eslint supports 7.
- **Consequences:** Node 20 users cannot install. Revisit the TypeScript pin when typescript-eslint adds TypeScript 7 support.

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

## 006: Lint and format scripts list the project paths

- **Context:** A working copy can hold local files that are not part of the project, and committed files must not name them.
- **Decision:** `npm run lint`, `npm run format`, and `npm run format:check` list the project paths explicitly (`src`, `test`, `scripts`, `.github`, root `*.js` and `*.json`, and each root Markdown doc by name) instead of scanning the whole directory. There is no `.prettierignore`.
- **Consequences:** A new top-level folder or root Markdown doc must be added to these scripts in `package.json`.
