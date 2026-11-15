# codemem

codemem is a local-first MCP server and CLI that indexes a codebase and gives coding agents only the code context they need.

It is under active development and not ready for use yet.

To build and test it from source, see [SETUP.md](SETUP.md).

## Benchmark

How much context does codemem save, and does it find the right code? Each task is a real commit from an open-source repository, described by its commit message; the code is indexed as it was just before that commit, and a strategy is scored on whether it returns the files and symbols the commit went on to change. The baseline imitates an agent that greps for keywords and reads whole files.

<!-- prettier-ignore-start -->
<!-- bench:start -->

Not measured yet.

<!-- bench:end -->
<!-- prettier-ignore-end -->

What these numbers do not show: the tasks are commit messages, which are written after the change and can name the place that was changed, so they are easier than a bug report written beforehand. The test split is 36 tasks, so one task moves a percentage by about three points. The baseline is a simulation, not a real agent. Details and the full method are in [SETUP.md](SETUP.md).
