---
name: repos
description: "Manage the kryptonite repo registry. Use this skill when the user wants to add, remove, update, or list repos in their .kryptonite/repos.json. Trigger when: 'add a repo', 'register repo', 'update repo', 'remove repo', 'list repos', 'show repos', 'which repos', or when the user mentions a new codebase they want kryptonite to know about. Also trigger if the user says 'kryptonite repos' or 'manage repos'."
---

# Kryptonite Repos — Repo Registry Management

Manage the project-level repo registry at `.kryptonite/repos.json`. This registry is shared across all epics — define repos once, reference them by name in any story.

## What It Does

- **List** — show all registered repos with their details
- **Add** — register a new repo (interactive: asks for details or auto-detects from path)
- **Update** — modify an existing repo's details
- **Remove** — unregister a repo
- **Detect** — scan a path and auto-fill stack, run, and test commands

## Actions

### List Repos

If the user asks to see repos, read `.kryptonite/repos.json` and present them:

```
Registered repos:

  api       ~/work/my-api           Rails 7, PostgreSQL     bin/rails server -p 3000
  web       ~/work/my-frontend      Next.js 14, TypeScript  npm run dev
  admin     ~/work/admin-panel      Vue 3, Vite             npm run dev -- --port 5173
```

If `repos.json` doesn't exist or is empty:
> "No repos registered yet. Want to add one?"

### Add a Repo

When the user wants to add a repo, gather these fields:

1. **name** — short identifier (kebab-case, unique). Ask: "What should I call this repo? (short name like 'api', 'web', 'admin')"
2. **path** — absolute path to the repo. Ask: "Where is it on disk?"
3. **description** — what code it holds. Ask: "What does this repo do? (one sentence)"
4. **stack** — language/framework. **Try to auto-detect first** (see Auto-Detection below). If detected, confirm: "Looks like [detected stack] — correct?"
5. **run** — how to start the dev server. Auto-detect from package.json/Procfile/Makefile if possible.
6. **test** — how to run tests. Auto-detect if possible.
7. **testing_notes** — free-form testing context. Ask: "Any testing notes? (credentials, URLs, how to seed data, API keys, anything agents need to know when testing against this repo)"

After gathering all fields, write to `.kryptonite/repos.json` (create the file and `.kryptonite/` directory if they don't exist).

### Auto-Detection

When a path is provided, scan it to auto-fill fields:

| File Found | Infer |
|-----------|-------|
| `package.json` | Read `scripts.dev` or `scripts.start` for `run`. Read `scripts.test` for `test`. Check dependencies for framework (next, react, vue, svelte, express). |
| `Gemfile` | Ruby project. Check for `rails` → "Rails + Ruby". `run`: `bin/rails server`. `test`: `bundle exec rspec` or `bin/rails test`. |
| `go.mod` | Go project. `run`: `go run .` or check Makefile. `test`: `go test ./...` |
| `Cargo.toml` | Rust. `run`: `cargo run`. `test`: `cargo test` |
| `requirements.txt` / `pyproject.toml` | Python. Check for Django/Flask/FastAPI. |
| `Makefile` | Check for `dev`, `run`, `test` targets. |
| `docker-compose.yml` | Note: "Uses Docker Compose" in description. `run`: `docker compose up`. |
| `.env` / `.env.example` | Note port if `PORT=` is defined. |

Present detected values and ask user to confirm or adjust.

### Update a Repo

When the user wants to change a repo's details:
1. Show current values
2. Ask what to change
3. Update `.kryptonite/repos.json`

### Remove a Repo

When the user wants to remove a repo:
1. Confirm: "Remove **[name]** from the registry? (This doesn't delete any code — just removes it from kryptonite tracking)"
2. Remove from `repos.json`
3. Warn if any active epic has stories referencing this repo

## File Format

`.kryptonite/repos.json`:
```json
{
  "repos": [
    {
      "name": "api",
      "path": "~/work/my-api",
      "description": "REST API service — handles auth, business logic, database",
      "stack": "Rails 7, PostgreSQL, RSpec",
      "run": "bin/rails server -p 3000",
      "test": "bundle exec rspec",
      "testing_notes": "Base URL: http://localhost:3000\nAdmin: admin@test.com / password123\nTest user: user@test.com / password123\nSeed: bin/rails db:seed\nStripe test key in .env.test\nOAuth: use test app ID from 1Password vault 'Dev'"
    }
  ]
}
```

The `testing_notes` field is **free-form text** — put whatever the QA agent and Coder need to know to test against this repo: credentials, URLs, how to seed data, API keys, external service configs, special env vars, etc. This gets passed to agents when they work on stories in this repo.
```

## Initialization

If `.kryptonite/` doesn't exist when this skill is invoked, create it:
```bash
mkdir -p .kryptonite
echo '{"repos": []}' > .kryptonite/repos.json
```

## Integration with Epics

- Stories reference repos by `name` via the `repo` field
- The kryptonite epic skill reads `repos.json` during Phase 6 (Technical Guidance) 
- Agents (Coder, QA) receive repo details from this registry when dispatched
- The repo registry is the source of truth for paths, commands, and stack info

## Key Behaviors

- **Auto-detect aggressively** — read the repo's files before asking the user to fill in details
- **Confirm, don't assume** — show detected values, let user correct
- **One repo at a time** — if user wants to add multiple, do them sequentially
- **Validate path exists** — before registering, check the path is accessible
- **No duplicates** — reject if a repo with the same name already exists (offer to update instead)
