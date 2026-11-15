# Releasing

How to publish a version. Version 0.1.0 was released this way on 2026-11-15: publish first, then tag and release once the version is visible on npm.

## One-time setup

1. **Trusted publishing on npm.** The release workflow publishes without a stored token: npm accepts the publish because it comes from this repository's `release.yml`. Set that up once on npmjs.com, in the settings of the `remimem` package, under Trusted Publisher, GitHub Actions:

   | Field                | Value            |
   | -------------------- | ---------------- |
   | Organization or user | `JaswanthRemiel` |
   | Repository           | `remimem`        |
   | Workflow filename    | `release.yml`    |
   | Environment name     | leave empty      |

   The values are case-sensitive, and npm does not check them until a publish is attempted. Once a release has gone through this way, the `NPM_TOKEN` repository secret is no longer used and can be deleted.

2. **Repository topics.** Already set: `mcp`, `rag`, `ai-agents`, `code-search`, `developer-tools`. To change them:

   ```sh
   gh repo edit JaswanthRemiel/remimem --add-topic <topic>
   ```

3. **The demo.** `docs/demo.gif` is generated from `docs/demo.tape` with [VHS](https://github.com/charmbracelet/vhs) (`brew install vhs`). Re-record it when the output it shows changes:

   ```sh
   npm run build
   vhs docs/demo.tape
   ```

   Check that the recording shows the `context` answer in full before committing it.

## Every release

Set the version being released once, and the commands below use it:

```sh
VERSION=0.2.0
```

1. Make sure `main` is green in CI and the working tree is clean.

2. Set the version in `package.json`:

   ```sh
   npm version "$VERSION" --no-git-tag-version
   ```

3. In `CHANGELOG.md`, add a section for the version with today's date, and write the release notes in `docs/releases/v$VERSION.md`. Commit:

   ```sh
   git add -A
   git commit -m "chore(release): $VERSION"
   ```

4. Run the checks and look at what will be published:

   ```sh
   npm ci
   npm run lint && npm run format:check && npm run typecheck && npm run check:chars && npm run coverage
   npm publish --dry-run
   ```

   Expected from the dry run: `package.json`, `README.md`, `LICENSE`, files under `dist/` (none under `dist/bench/`), and files under `grammars/`. Nothing else. The dry run publishes nothing.

5. Push, and wait for CI to be green on that commit:

   ```sh
   git push origin main
   gh run watch "$(gh run list --workflow ci.yml --commit "$(git rev-parse HEAD)" --json databaseId -q '.[0].databaseId')" --exit-status
   ```

6. Publish. This is a workflow, started by hand, because trusted publishing and provenance only work from a CI run:

   ```sh
   gh workflow run release.yml --ref main
   gh run watch "$(gh run list --workflow release.yml --limit 1 --json databaseId -q '.[0].databaseId')" --exit-status
   ```

   The workflow runs the checks again, publishes, and then waits until this exact version can be read back from npm. Do not publish from a laptop: that carries no provenance.

7. Confirm the exact version is live before tagging anything. For a minute or two after a publish, npm shows a placeholder version (`0.0.0-stage` on a first publish) while it processes the package, so checking that the package merely exists is not enough:

   ```sh
   until [ "$(npm view "remimem@$VERSION" version 2>/dev/null)" = "$VERSION" ]; do sleep 15; done
   npm view remimem dist-tags.latest
   ```

   Expected: the loop ends, and the second command prints the version. The workflow in step 6 does the same wait, so this normally returns at once. If the publish failed, stop here: there is no tag or release to undo.

8. Tag the commit that was published, and push the tag:

   ```sh
   git tag -a "v$VERSION" -m "remimem $VERSION"
   git push origin "v$VERSION"
   ```

9. Create the GitHub release:

   ```sh
   gh release create "v$VERSION" --verify-tag --title "remimem $VERSION" --notes-file "docs/releases/v$VERSION.md"
   ```

10. Check the published package from a clean directory:

    ```sh
    cd "$(mktemp -d)" && npx -y "remimem@$VERSION" --version
    ```

    Expected: the version.

## Versioning

Semantic versioning, starting at 0.1.0. Below 1.0.0, a minor version may break things; say so in the changelog. A change to the index layout needs a new migration in `src/store/index.ts`, and a change to what the parser or chunker stores needs a bump of `INDEX_FORMAT` in `src/indexer/index.ts`, so existing indexes rebuild themselves.
