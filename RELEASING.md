# Releasing

How to publish a version. Nothing in this file has been run: the commands are prepared for the repository owner. No tag, GitHub release, or npm package exists yet.

## Before the first release

1. **Rename the GitHub repository** to `remimem` (Settings, General, Repository name). The links in `package.json`, the README, and the docs already point at `github.com/JaswanthRemiel/remimem`. GitHub redirects the old URL, and an existing clone keeps working; update it with:

   ```sh
   git remote set-url origin https://github.com/JaswanthRemiel/remimem.git
   ```

2. **Check the npm name is still free.** It was on 2026-11-15:

   ```sh
   npm view remimem
   ```

   Expected: a 404 error. If it prints a package, stop: the name has been taken.

3. **Re-record the demo if the output changed.** `docs/demo.gif` is generated from `docs/demo.tape` with [VHS](https://github.com/charmbracelet/vhs) (`brew install vhs`):

   ```sh
   npm run build
   vhs docs/demo.tape
   ```

   Check that the recording shows the `context` answer in full before committing it.

4. **Give npm a way to trust the publish.** Either add an npm access token as the repository secret `NPM_TOKEN` (Settings, Secrets and variables, Actions), or set up trusted publishing for this repository and the `release.yml` workflow in the package settings on npmjs.com once the package exists.

5. **Set the repository topics.** With the GitHub CLI:

   ```sh
   gh repo edit JaswanthRemiel/remimem \
     --add-topic mcp --add-topic rag --add-topic ai-agents \
     --add-topic code-search --add-topic developer-tools
   ```

## Every release

Replace `0.1.0` with the version being released.

1. Make sure `main` is green in CI and the working tree is clean.

2. Set the version (skip for 0.1.0, which is already in `package.json`):

   ```sh
   npm version 0.1.0 --no-git-tag-version
   ```

3. In `CHANGELOG.md`, replace "(not released yet)" with the date, and write `docs/releases/v0.1.0.md` (the 0.1.0 notes are already there). Commit:

   ```sh
   git commit -am "chore(release): 0.1.0"
   ```

4. Run the checks and look at what will be published:

   ```sh
   npm ci
   npm run lint && npm run format:check && npm run typecheck && npm run check:chars && npm run coverage
   npm publish --dry-run
   ```

   Expected from the dry run: `package.json`, `README.md`, `LICENSE`, files under `dist/` (none under `dist/bench/`), and files under `grammars/`. Nothing else.

5. Tag and push:

   ```sh
   git push origin main
   git tag -a v0.1.0 -m "remimem 0.1.0"
   git push origin v0.1.0
   ```

6. Publish to npm with provenance. Provenance can only be produced by a CI run, so this is a workflow, started by hand:

   ```sh
   gh workflow run release.yml --ref v0.1.0
   ```

   or use Actions, Release, Run workflow, and pick the tag. The workflow runs the checks again and then:

   ```sh
   npm publish --provenance --access public
   ```

   Without the GitHub CLI or the workflow, a publish from a laptop works but carries no provenance: `npm publish --access public`.

7. Create the GitHub release:

   ```sh
   gh release create v0.1.0 --title "remimem 0.1.0" --notes-file docs/releases/v0.1.0.md
   ```

8. Check the result:

   ```sh
   npm view remimem version
   cd "$(mktemp -d)" && npx -y remimem --version
   ```

   Expected: `0.1.0` twice.

## Versioning

Semantic versioning, starting at 0.1.0. Below 1.0.0, a minor version may break things; say so in the changelog. A change to the index layout needs a new migration in `src/store/index.ts`, and a change to what the parser or chunker stores needs a bump of `INDEX_FORMAT` in `src/indexer/index.ts`, so existing indexes rebuild themselves.
