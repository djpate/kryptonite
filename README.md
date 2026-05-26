<div align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/banner-dark.svg">
    <source media="(prefers-color-scheme: light)" srcset="assets/banner-light.svg">
    <img alt="Kryptonite" src="assets/banner-dark.svg" width="800">
  </picture>

  <br/><br/>

  [![Claude Code Plugin](https://img.shields.io/badge/Claude_Code-Plugin-7c3aed?style=flat-square)](https://github.com/djpate/kryptonite)
  [![Version](https://img.shields.io/badge/version-0.1.0-10b981?style=flat-square)](https://github.com/djpate/kryptonite/releases)
  [![License: MIT](https://img.shields.io/badge/license-MIT-64748b?style=flat-square)](LICENSE)
  [![Agents](https://img.shields.io/badge/agents-9-6366f1?style=flat-square)](#agent-architecture)
  [![Phases](https://img.shields.io/badge/phases-12-f59e0b?style=flat-square)](#how-it-works)

</div>

<br/>

You describe what you want to build. Kryptonite interviews you, identifies gaps, runs research spikes, generates a branded spec with inline commenting, plans parallel execution waves, then dispatches specialized agents to implement — with automated DOD validation that won't let anything pass without proof.

> **Think:** Project management on steroids for AI-assisted development.

---

## Key Features

| | Feature | What It Means |
|:---:|:---|:---|
| 🔄 | **12-Phase Workflow** | Structured path from "I want to build X" to deployed code |
| 🤖 | **9 Specialized Agents** | Each agent has a single job and does it well |
| ✅ | **Automated DOD Validation** | Every story proven done via curl, Chrome MCP, or test suite |
| 🔒 | **State Machine Enforcement** | Stories cannot skip QA or review — invariants enforced on every write |
| 📦 | **Multi-Repo Support** | Epics span multiple repos with cross-repo auto-splitting |
| 🔬 | **Spike-First Research** | Questions answered before DODs are written — no scope explosions |
| 🎨 | **Visual Mocks + Compare** | Side-by-side mock comparison with click-to-pick |
| 💬 | **Branded Comment Server** | Inline commenting on spec/plan at localhost:3847 |
| 🔁 | **Persistent State** | Resume any epic across sessions — picks up exactly where you left off |
| ⚡ | **Parallel Execution** | Independent stories run simultaneously within waves |

---

## How It Works

```mermaid
graph TD
    subgraph GATHER ["Requirements Gathering"]
        P1["1. General Description"]
        P2["2. Story Braindump"]
        P3["3. Gap Analysis"]
        P4["4. Party Definition"]
    end

    subgraph RESEARCH ["Research & Scope"]
        P5["5. Spikes"]
        P6["6. Re-scope"]
        P7["7. Technical Guidance"]
    end

    subgraph SPEC ["Specification"]
        P8["8. DOD & Mocks"]
        P9{"9. Schema Validation"}
        P10["10. Spec Generation"]
        P11["11. Implementation Plan"]
    end

    subgraph EXEC ["Execution"]
        P12["12. Parallel Agent Dispatch"]
    end

    P1 --> P2 --> P3 --> P4
    P4 --> P5 --> P6 --> P7
    P7 --> P8 --> P9
    P9 -->|Pass| P10 --> P11
    P9 -->|Fail| P8
    P11 --> P12
```

---

## Agent Architecture

```mermaid
graph LR
    O["Orchestrator"]

    subgraph interview ["Phases 1-11"]
        I["Interviewer"]
    end

    subgraph exec ["Phase 12 — Dispatched"]
        R["Researcher"]
        D["Designer"]
        C["Coder"]
        Q["QA"]
        RV["Reviewer"]
    end

    subgraph gates ["Quality Gates"]
        SC["Spec Critic"]
        PC["Plan Critic"]
    end

    O --> I
    O --> R & D & C
    C --> Q --> RV
    Q -->|Fail| C
    RV -->|Reject| C
    O --> SC & PC
```

| Agent | Role |
|:------|:-----|
| **Orchestrator** | Coordinates everything, enforces the state machine |
| **Interviewer** | Guides Phases 1-11 — one question at a time |
| **Designer** | Visual mockups with progressive direction locking |
| **Researcher** | Spike execution, produces decision documents |
| **Coder** | TDD implementation, repo-aware, commits per story |
| **QA** | Automated DOD validation + per-wave UAT |
| **Reviewer** | Spec compliance + code quality review |
| **Spec Critic** | Reviews spec for gaps, contradictions, weak DODs |
| **Plan Critic** | Reviews plan for conflicts, ordering, infra gaps |

---

## Quick Start

### Install

```bash
claude plugin install kryptonite --url https://github.com/djpate/kryptonite
```

### Trigger

Say any of these to Claude Code:

<kbd>let's build...</kbd>&nbsp;&nbsp;<kbd>I want to build...</kbd>&nbsp;&nbsp;<kbd>spec this out</kbd>&nbsp;&nbsp;<kbd>new project</kbd>&nbsp;&nbsp;<kbd>plan this</kbd>

Or just describe what you want to build — Kryptonite activates automatically.

> [!TIP]
> Manage your repo registry independently with:
> <kbd>add a repo</kbd>&nbsp;&nbsp;<kbd>list repos</kbd>&nbsp;&nbsp;<kbd>manage repos</kbd>

---

## Why Kryptonite?

| Concern | Typical AI Coding | Kryptonite |
|:--------|:-----------------|:-----------|
| Requirements | "Just build it" | 12-phase structured gathering |
| Validation | Trust the AI | Automated DOD proof (curl, tests, Chrome MCP) |
| Quality gates | None | QA + Reviewer must both approve |
| Multi-repo | One file at a time | Cross-repo auto-split with dependency tracking |
| Research | Hope for the best | Spike-first workflow before planning |
| State | Lost between sessions | Persistent state with exact-phase resume |

---

<details>
<summary><strong>State Machine & Execution Loop</strong></summary>
<br/>

```mermaid
stateDiagram-v2
    [*] --> pending
    pending --> in_progress : deps met
    in_progress --> qa_validation : Coder done
    qa_validation --> in_review : QA passes
    qa_validation --> in_progress : QA fails
    in_review --> done : Reviewer approves
    in_review --> in_progress : Reviewer rejects
    in_progress --> blocked : 3 failures
    done --> [*]
```

**Invariants enforced on every state write:**

1. Cannot reach `done` without `dod_validation.all_passed === true`
2. Cannot reach `done` without `review_status === "approved"`
3. Cannot enter `in_review` without passing QA
4. Cannot enter `in_progress` without all dependencies met

</details>

<details>
<summary><strong>Project Structure</strong></summary>
<br/>

```
.kryptonite/
├── repos.json          # Shared repo registry (persists across epics)
├── active              # Slug of the active epic
└── {epic-slug}/
    ├── epic.json       # Parties, tech context, current phase, design direction
    ├── state.json      # Stories, waves, execution state
    ├── comments.json   # Persisted review comments
    ├── spec.html       # Branded spec document
    ├── plan.html       # Implementation plan
    ├── spikes/         # Research findings
    └── mocks/          # Visual mockups + screenshots
```

</details>

<details>
<summary><strong>Comment Server & Live Dashboard</strong></summary>
<br/>

During spec review, a local server runs at `http://localhost:3847`:

| Route | Purpose |
|:------|:--------|
| `/` | Commentable spec with inline annotations |
| `/plan` | Commentable implementation plan |
| `/dashboard` | Live progress — waves, DOD checklists, agent attribution |
| `/mocks` | Mock gallery with approved/pending status |
| `/compare` | Fullscreen side-by-side mock comparison (click to pick) |

> [!NOTE]
> The comment server is ephemeral — it runs during review and shuts down when execution completes.

</details>

---

## Requirements

> [!IMPORTANT]
> - **Claude Code** with subagent support
> - **Node.js 18+** (for the comment server)
> - **Chrome DevTools MCP** (for `chrome_mcp` DOD validation and UAT)

---

<div align="center">

**MIT License** · Built by [@djpate](https://github.com/djpate)

*Structured development. Automated validation. No hand-waving.*

</div>
