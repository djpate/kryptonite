# Kryptonite

Spec-driven development for Claude Code. Takes you from idea to implementation through structured user story gathering, automated DOD validation, and multi-agent parallel execution.

## What It Does

Kryptonite is a Claude Code plugin that adds a structured development workflow:

1. **You describe what you want to build** — in plain language
2. **It interviews you** — one question at a time, probing gaps, defining parties, running research spikes
3. **It produces a spec** — a branded HTML document with inline commenting
4. **It plans the implementation** — stories grouped into parallel waves with dependency enforcement
5. **It executes** — dispatching specialized agents (Coder, QA, Reviewer) with a state machine that won't let stories pass without verified DODs

## Install

```bash
claude plugin marketplace add /path/to/kryptonite
claude plugin install kryptonite
```

Or add via GitHub:
```bash
claude plugin marketplace add https://github.com/djpate/kryptonite
claude plugin install kryptonite
```

## Skills

### `kryptonite` — Main workflow

Trigger by saying: "let's build...", "I want to build...", "spec this out", "new project", "plan this", or any description of something you want to build.

**12 phases:**

| Phase | What happens |
|-------|-------------|
| 1. General Description | Describe the big picture |
| 2. User Story Braindump | Dump all your stories in any format |
| 3. Gap Analysis | Thorough probing for missing flows and edge cases |
| 4. Party Definition | Define who the actors are |
| 5. Spikes | Execute research tasks immediately |
| 6. Re-scope | Integrate spike findings, user decides scope |
| 7. Technical Guidance | Repos, stack, constraints |
| 8. DOD & Mocks | Definition of Done with automated validation + visual mockups |
| 9. Schema Validation | Every story passes the JSON schema before proceeding |
| 10. Spec Generation | Branded HTML spec reviewed by Spec Critic before you see it |
| 11. Implementation Plan | Wave-grouped plan reviewed by Plan Critic before you see it |
| 12. Execution | Parallel agent dispatch with state-machine-enforced DOD gates |

### `repos` — Repo registry management

Trigger by saying: "add a repo", "list repos", "manage repos"

Manages `.kryptonite/repos.json` — the shared registry of all repositories your projects use. Auto-detects stack, run commands, and test commands from the repo's files.

## Architecture

```
.kryptonite/
├── repos.json          (shared repo registry — persists across epics)
├── active              (slug of active epic)
└── {epic-slug}/
    ├── epic.json       (parties, tech context, current_phase, design direction)
    ├── state.json      (stories, waves, execution state)
    ├── comments.json   (persisted review comments)
    ├── spec.html       (branded spec document)
    ├── plan.html       (implementation plan)
    ├── spikes/         (research findings)
    └── mocks/          (visual mockups + screenshots)
```

## Agents

| Agent | Role |
|-------|------|
| **Orchestrator** | Main session — coordinates everything, enforces state machine |
| **Interviewer** | Instructions for Phases 1-11 (main session follows these) |
| **Designer** | Visual mockups with progressive direction locking |
| **Researcher** | Spike execution — produces decision documents |
| **Coder** | TDD implementation, repo-aware, commits per story |
| **QA** | Automated DOD validation (curl, Chrome MCP, test suite) + per-wave UAT |
| **Reviewer** | Spec compliance + code quality review |
| **Spec Critic** | Reviews spec for gaps, contradictions, weak DODs |
| **Plan Critic** | Reviews plan for conflicts, ordering issues, infra gaps |

## Key Features

- **Multi-repo support** — epics span multiple repos, each story assigned to one
- **Cross-repo auto-split** — stories touching 2+ repos become linked sub-stories
- **Automated DOD validation** — every DOD item must be verifiable via curl, Chrome MCP, test suite, or file check
- **State machine enforcement** — stories cannot be marked "done" without passing QA AND review (invariants checked on every state write)
- **Visual mocks with compare view** — fullscreen side-by-side at `/compare`, click to pick
- **Spike-first workflow** — research runs before DODs are written, preventing scope explosions
- **Persistent state** — resume any epic where you left off across sessions
- **Comment server** — branded HTML served locally with inline comments, dashboard, mocks gallery
- **Critic agents** — spec and plan are reviewed for issues before you see them
- **Per-wave UAT** — user acceptance testing after each wave, not just at the end
- **Granular commits** — every phase transition and validated story produces a commit

## Comment Server

During spec review, a local server runs at `http://localhost:3847`:

- `/` — Commentable spec
- `/plan` — Commentable implementation plan
- `/dashboard` — Live progress tracking
- `/mocks` — Mock gallery with approved/pending status
- `/compare` — Fullscreen mock comparison with click-to-pick

## Requirements

- Claude Code with subagent support
- Node.js 18+ (for the comment server)
- Chrome DevTools MCP (for `chrome_mcp` DOD validation and UAT)

## License

MIT
