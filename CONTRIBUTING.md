# Contributing

## Setup

[mise](https://mise.jdx.dev/) provisions Node and runs every task.

```shell
mise install
pnpm install
```

## Tasks

```shell
mise run check       # format-check, type-check, lint, test. The pre-commit gate.
mise run test-watch  # tests in watch mode
mise run format      # fix formatting
mise run lint-fix    # fix most lint violations
```

`mise.toml` has the rest.

## Planning

Behavior changes are planned as
[OpenSpec](https://github.com/Fission-AI/OpenSpec) changes under
`openspec/changes/`. A small fix does not need one.

## Before you open a pull request

1. `mise run check` passes.
2. New behavior has a test.
3. If the work has an OpenSpec change, its tasks are checked off and
   `openspec validate "<name>"` passes.
4. Commit messages follow
   [Conventional Commits](https://www.conventionalcommits.org/).
5. `AGENTS.md` has the conventions the linters do not enforce.
