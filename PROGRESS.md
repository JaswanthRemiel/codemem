# Progress

## Phases

- [x] Phase 0: Scaffold
- [ ] Phase 1: Scanner, parser, chunker
- [ ] Phase 2: Store and keyword search
- [ ] Phase 3: Embeddings, hybrid retrieval, packer
- [ ] Phase 4: Call graph
- [ ] Phase 5: MCP server and init
- [ ] Phase 6: Memory
- [ ] Phase 7: Incremental indexing, watch, stats
- [ ] Phase 8: Benchmark
- [ ] Phase 9: Release prep

## Done

### Phase 0

- Strict TypeScript, ESLint, Prettier, vitest.
- `codemem --version` and a `codemem doctor` stub (Node.js version check only).
- Em dash and emoji check in `npm run check:chars`, the pre-commit hook, and CI.
- CI matrix: Ubuntu, macOS, Windows with Node 22 and 24.
- MIT license, `DECISIONS.md`, `PROGRESS.md`, `SETUP.md`.

## Next

Phase 1: scanner, parser, chunker, with three fixture repos.

## Known issues

- `npm audit` reports moderate advisories for `minimatch`, pulled in by ESLint 10 and typescript-eslint 8. These are development tools only and are not part of the published package. No fixed release was available on 2026-11-12.
- `README.md` does not exist yet; it is written in a later phase.
