# JSON Schema-Driven Spec & Plan Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace freeform HTML spec/plan generation with JSON documents validated against JSON Schema, and build a client-side Alpine.js renderer for both.

**Architecture:** Two JSON schemas (spec-schema.json, plan-schema.json) compose with the existing story-schema.json via $ref. Two validator scripts (validate-spec.js, validate-plan.js) provide schema + semantic validation. The comment-server gains new API endpoints and the UI pages become Alpine.js SPAs that fetch and render JSON.

**Tech Stack:** Node.js ESM, AJV 2020-12, Alpine.js 3, Tailwind/DaisyUI (CDN), existing comment-server patterns.

---

## File Structure

### New Files
| Path | Responsibility |
|------|---------------|
| `skills/kryptonite/references/spec-schema.json` | JSON Schema 2020-12 for spec documents |
| `skills/kryptonite/references/plan-schema.json` | JSON Schema 2020-12 for plan documents |
| `skills/kryptonite/scripts/validate-spec.js` | AJV schema + semantic validation for spec.json |
| `skills/kryptonite/scripts/validate-plan.js` | AJV schema + semantic validation for plan.json |
| `skills/kryptonite/scripts/ui/spec.html` | Alpine.js SPA that renders spec.json |
| `skills/kryptonite/scripts/ui/plan.html` | Alpine.js SPA that renders plan.json |

### Modified Files
| Path | Changes |
|------|---------|
| `skills/kryptonite/scripts/comment-server.js` | Add `/api/spec`, `/api/plan` JSON endpoints; detect JSON vs HTML mode for `/spec` and `/plan` routes |
| `skills/kryptonite/scripts/phase-gates/10.json` | Add spec.json file check alongside existing spec.html check |
| `skills/kryptonite/scripts/phase-gates/11.json` | Add plan.json file check alongside existing plan.html check |
| `skills/kryptonite/scripts/validate-gate.js` | Update Phase 10/11 semantic checks to also check for spec.json/plan.json |

---

## Task 1: Create spec-schema.json

**Files:**
- Create: `skills/kryptonite/references/spec-schema.json`

- [ ] **Step 1: Write the spec schema file**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "KryptoniteSpec",
  "description": "Schema for a fully structured kryptonite project specification. Every section is typed and queryable — no freeform prose.",
  "type": "object",
  "required": [
    "version",
    "generated_at",
    "epic_slug",
    "overview",
    "parties",
    "repos",
    "architecture",
    "data_model",
    "api_boundaries",
    "nfrs",
    "technical_constraints",
    "design_direction",
    "stories"
  ],
  "additionalProperties": false,
  "properties": {
    "version": {
      "type": "string",
      "pattern": "^\\d+\\.\\d+\\.\\d+$",
      "description": "Spec schema version (semver)"
    },
    "generated_at": {
      "type": "string",
      "format": "date-time"
    },
    "epic_slug": {
      "type": "string",
      "minLength": 1
    },
    "overview": {
      "type": "object",
      "required": ["name", "description", "goals", "non_goals", "target_users"],
      "additionalProperties": false,
      "properties": {
        "name": { "type": "string", "minLength": 1 },
        "description": { "type": "string", "minLength": 10 },
        "goals": {
          "type": "array",
          "minItems": 2,
          "maxItems": 5,
          "items": { "type": "string", "minLength": 5 }
        },
        "non_goals": {
          "type": "array",
          "minItems": 1,
          "items": { "type": "string", "minLength": 5 }
        },
        "target_users": {
          "type": "array",
          "minItems": 1,
          "items": { "type": "string", "minLength": 1 }
        }
      }
    },
    "parties": {
      "type": "array",
      "minItems": 1,
      "items": {
        "type": "object",
        "required": ["id", "name", "description", "auth", "boundaries"],
        "additionalProperties": false,
        "properties": {
          "id": { "type": "string", "pattern": "^[a-z][a-z0-9-]*$" },
          "name": { "type": "string", "minLength": 1 },
          "description": { "type": "string", "minLength": 10 },
          "auth": { "type": "string", "minLength": 1 },
          "boundaries": { "type": "string", "minLength": 1 }
        }
      }
    },
    "repos": {
      "type": "array",
      "minItems": 1,
      "items": {
        "type": "object",
        "required": ["id", "name", "stack"],
        "additionalProperties": false,
        "properties": {
          "id": { "type": "string", "pattern": "^[a-z][a-z0-9-]*$" },
          "name": { "type": "string", "minLength": 1 },
          "stack": { "type": "string", "minLength": 1 },
          "path": { "type": "string" }
        }
      }
    },
    "architecture": {
      "type": "object",
      "required": ["components", "interactions", "decisions"],
      "additionalProperties": false,
      "properties": {
        "components": {
          "type": "array",
          "minItems": 1,
          "items": {
            "type": "object",
            "required": ["id", "name", "type", "responsibility", "repo"],
            "additionalProperties": false,
            "properties": {
              "id": { "type": "string", "pattern": "^[a-z][a-z0-9-]*$" },
              "name": { "type": "string", "minLength": 1 },
              "type": { "type": "string", "enum": ["service", "library", "store", "external", "action"] },
              "responsibility": { "type": "string", "minLength": 10 },
              "repo": { "type": "string", "minLength": 1 },
              "key_files": {
                "type": "array",
                "items": { "type": "string", "minLength": 1 }
              }
            }
          }
        },
        "interactions": {
          "type": "array",
          "minItems": 1,
          "items": {
            "type": "object",
            "required": ["from", "to", "protocol", "description"],
            "additionalProperties": false,
            "properties": {
              "from": { "type": "string", "minLength": 1 },
              "to": { "type": "string", "minLength": 1 },
              "protocol": { "type": "string", "enum": ["function_call", "event", "http", "websocket", "ipc", "caldav"] },
              "description": { "type": "string", "minLength": 5 },
              "async": { "type": "boolean", "default": false }
            }
          }
        },
        "decisions": {
          "type": "array",
          "items": {
            "type": "object",
            "required": ["id", "title", "status", "context", "choice", "consequences"],
            "additionalProperties": false,
            "properties": {
              "id": { "type": "string", "pattern": "^ADR-\\d{3}$" },
              "title": { "type": "string", "minLength": 5 },
              "status": { "type": "string", "enum": ["accepted", "superseded", "deprecated"] },
              "context": { "type": "string", "minLength": 10 },
              "choice": { "type": "string", "minLength": 5 },
              "alternatives": {
                "type": "array",
                "items": {
                  "type": "object",
                  "required": ["option", "rejected_because"],
                  "additionalProperties": false,
                  "properties": {
                    "option": { "type": "string", "minLength": 1 },
                    "rejected_because": { "type": "string", "minLength": 5 }
                  }
                }
              },
              "consequences": {
                "type": "array",
                "minItems": 1,
                "items": { "type": "string", "minLength": 5 }
              }
            }
          }
        }
      }
    },
    "data_model": {
      "type": "object",
      "required": ["entities"],
      "additionalProperties": false,
      "properties": {
        "entities": {
          "type": "array",
          "minItems": 1,
          "items": {
            "type": "object",
            "required": ["id", "description", "fields"],
            "additionalProperties": false,
            "properties": {
              "id": { "type": "string", "pattern": "^[A-Z][a-zA-Z0-9]*$" },
              "description": { "type": "string", "minLength": 5 },
              "fields": {
                "type": "array",
                "minItems": 1,
                "items": {
                  "type": "object",
                  "required": ["name", "type"],
                  "additionalProperties": false,
                  "properties": {
                    "name": { "type": "string", "minLength": 1 },
                    "type": { "type": "string", "enum": ["string", "number", "boolean", "Date", "enum", "ref", "array", "object"] },
                    "constraints": {
                      "type": "array",
                      "items": { "type": "string", "enum": ["required", "unique", "indexed", "not_null"] }
                    },
                    "enum_values": {
                      "type": "array",
                      "items": { "type": "string" }
                    },
                    "ref_target": { "type": "string" }
                  }
                }
              },
              "relationships": {
                "type": "array",
                "items": {
                  "type": "object",
                  "required": ["target", "cardinality", "description"],
                  "additionalProperties": false,
                  "properties": {
                    "target": { "type": "string", "minLength": 1 },
                    "cardinality": { "type": "string", "enum": ["one-to-one", "one-to-many", "many-to-one", "many-to-many"] },
                    "description": { "type": "string", "minLength": 5 }
                  }
                }
              }
            }
          }
        }
      }
    },
    "api_boundaries": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["id", "name", "type", "direction", "endpoints"],
        "additionalProperties": false,
        "properties": {
          "id": { "type": "string", "pattern": "^[a-z][a-z0-9-]*$" },
          "name": { "type": "string", "minLength": 1 },
          "type": { "type": "string", "enum": ["rest", "graphql", "caldav", "sdk", "ipc"] },
          "direction": { "type": "string", "enum": ["inbound", "outbound"] },
          "endpoints": {
            "type": "array",
            "minItems": 1,
            "items": {
              "type": "object",
              "required": ["id", "method", "path", "description", "auth"],
              "additionalProperties": false,
              "properties": {
                "id": { "type": "string", "pattern": "^[a-z][a-z0-9-]*$" },
                "method": { "type": "string", "enum": ["GET", "POST", "PUT", "PATCH", "DELETE", "PROPFIND", "REPORT"] },
                "path": { "type": "string", "minLength": 1 },
                "description": { "type": "string", "minLength": 5 },
                "auth": { "type": "string", "enum": ["oauth2", "api_key", "app_password", "none"] },
                "request_shape": {
                  "type": "object",
                  "required": ["fields"],
                  "additionalProperties": false,
                  "properties": {
                    "fields": {
                      "type": "array",
                      "items": {
                        "type": "object",
                        "required": ["name", "type"],
                        "additionalProperties": false,
                        "properties": {
                          "name": { "type": "string" },
                          "type": { "type": "string" },
                          "required": { "type": "boolean" }
                        }
                      }
                    }
                  }
                },
                "response_shape": {
                  "type": "object",
                  "required": ["fields"],
                  "additionalProperties": false,
                  "properties": {
                    "fields": {
                      "type": "array",
                      "items": {
                        "type": "object",
                        "required": ["name", "type"],
                        "additionalProperties": false,
                        "properties": {
                          "name": { "type": "string" },
                          "type": { "type": "string" }
                        }
                      }
                    }
                  }
                },
                "error_cases": {
                  "type": "array",
                  "items": {
                    "type": "object",
                    "required": ["code", "meaning", "handling"],
                    "additionalProperties": false,
                    "properties": {
                      "code": { "type": "integer" },
                      "meaning": { "type": "string", "minLength": 1 },
                      "handling": { "type": "string", "minLength": 1 }
                    }
                  }
                },
                "rate_limit": { "type": ["string", "null"] }
              }
            }
          }
        }
      }
    },
    "nfrs": {
      "type": "array",
      "minItems": 1,
      "items": {
        "type": "object",
        "required": ["id", "category", "requirement", "metric", "target", "measurement_method"],
        "additionalProperties": false,
        "properties": {
          "id": { "type": "string", "pattern": "^NFR-\\d{3}$" },
          "category": { "type": "string", "enum": ["performance", "security", "reliability", "scalability", "usability", "privacy"] },
          "requirement": { "type": "string", "minLength": 10 },
          "metric": { "type": "string", "minLength": 1 },
          "target": { "type": ["string", "number"] },
          "measurement_method": { "type": "string", "minLength": 5 }
        }
      }
    },
    "technical_constraints": {
      "type": "array",
      "minItems": 1,
      "items": {
        "type": "object",
        "required": ["id", "category", "constraint", "impact", "source"],
        "additionalProperties": false,
        "properties": {
          "id": { "type": "string", "pattern": "^TC-\\d{3}$" },
          "category": { "type": "string", "enum": ["platform", "sdk", "provider", "legal", "distribution"] },
          "constraint": { "type": "string", "minLength": 10 },
          "impact": { "type": "string", "minLength": 5 },
          "source": { "type": "string", "minLength": 1 }
        }
      }
    },
    "design_direction": {
      "type": "object",
      "required": ["locked", "style_summary", "color_system", "typography"],
      "additionalProperties": false,
      "properties": {
        "locked": { "type": "boolean" },
        "style_summary": { "type": "string", "minLength": 10 },
        "color_system": {
          "type": "object",
          "required": ["primary", "secondary", "surface", "text"],
          "additionalProperties": false,
          "properties": {
            "primary": { "type": "string", "pattern": "^#[0-9a-fA-F]{6}$" },
            "secondary": { "type": "string", "pattern": "^#[0-9a-fA-F]{6}$" },
            "surface": { "type": "string", "pattern": "^#[0-9a-fA-F]{6}$" },
            "text": { "type": "string", "pattern": "^#[0-9a-fA-F]{6}$" }
          }
        },
        "typography": { "type": "string", "minLength": 5 },
        "approved_mock_ids": {
          "type": "array",
          "items": { "type": "string", "pattern": "^US-\\d{3,}[a-z]?$" }
        }
      }
    },
    "stories": {
      "type": "array",
      "minItems": 1,
      "items": { "$ref": "story-schema.json" }
    },
    "spike_findings": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["story_id", "question", "finding", "decision", "evidence", "impacts"],
        "additionalProperties": false,
        "properties": {
          "story_id": { "type": "string", "pattern": "^US-\\d{3,}[a-z]?$" },
          "question": { "type": "string", "minLength": 10 },
          "finding": { "type": "string", "minLength": 10 },
          "decision": { "type": "string", "minLength": 5 },
          "evidence": { "type": "string", "minLength": 5 },
          "impacts": {
            "type": "array",
            "minItems": 1,
            "items": { "type": "string", "pattern": "^US-\\d{3,}[a-z]?$" }
          }
        }
      }
    },
    "open_questions": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["id", "question", "context", "blocks"],
        "additionalProperties": false,
        "properties": {
          "id": { "type": "string", "pattern": "^OQ-\\d{3}$" },
          "question": { "type": "string", "minLength": 10 },
          "context": { "type": "string", "minLength": 5 },
          "proposed_answer": { "type": ["string", "null"] },
          "blocks": {
            "type": "array",
            "items": { "type": "string", "minLength": 1 }
          }
        }
      }
    }
  }
}
```

- [ ] **Step 2: Validate the schema is valid JSON Schema**

Run: `node -e "import Ajv from 'ajv/dist/2020.js'; import addFormats from 'ajv-formats'; const ajv = new (Ajv.default || Ajv)({strict:false}); addFormats.default ? addFormats.default(ajv) : addFormats(ajv); const schema = JSON.parse(await import('fs').then(m=>m.readFileSync('skills/kryptonite/references/spec-schema.json','utf-8'))); ajv.compile(schema); console.log('PASS: spec-schema.json compiles');" --input-type=module`

Expected: `PASS: spec-schema.json compiles`

- [ ] **Step 3: Commit**

```bash
git add skills/kryptonite/references/spec-schema.json
git commit -m "feat: add spec-schema.json for structured spec validation"
```

---

## Task 2: Create plan-schema.json

**Files:**
- Create: `skills/kryptonite/references/plan-schema.json`

- [ ] **Step 1: Write the plan schema file**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "KryptonitePlan",
  "description": "Schema for a fully structured implementation plan. Tight coupling with spec — every story must appear in exactly one wave.",
  "type": "object",
  "required": [
    "version",
    "generated_at",
    "epic_slug",
    "spec_version",
    "summary",
    "waves",
    "critical_path",
    "parallel_strategy",
    "risks"
  ],
  "additionalProperties": false,
  "properties": {
    "version": {
      "type": "string",
      "pattern": "^\\d+\\.\\d+\\.\\d+$"
    },
    "generated_at": {
      "type": "string",
      "format": "date-time"
    },
    "epic_slug": {
      "type": "string",
      "minLength": 1
    },
    "spec_version": {
      "type": "string",
      "pattern": "^\\d+\\.\\d+\\.\\d+$"
    },
    "summary": {
      "type": "object",
      "required": ["total_stories", "total_waves", "critical_path_depth", "priority_breakdown", "estimated_duration"],
      "additionalProperties": false,
      "properties": {
        "total_stories": { "type": "integer", "minimum": 1 },
        "total_waves": { "type": "integer", "minimum": 1 },
        "critical_path_depth": { "type": "integer", "minimum": 1 },
        "priority_breakdown": {
          "type": "object",
          "required": ["critical", "high", "medium", "low"],
          "additionalProperties": false,
          "properties": {
            "critical": { "type": "integer", "minimum": 0 },
            "high": { "type": "integer", "minimum": 0 },
            "medium": { "type": "integer", "minimum": 0 },
            "low": { "type": "integer", "minimum": 0 }
          }
        },
        "estimated_duration": { "type": "string", "minLength": 1 }
      }
    },
    "waves": {
      "type": "array",
      "minItems": 1,
      "items": {
        "type": "object",
        "required": ["id", "name", "sequence", "theme", "estimated_duration", "parallel_groups", "demo_checkpoint"],
        "additionalProperties": false,
        "properties": {
          "id": { "type": "string", "pattern": "^wave-\\d+$" },
          "name": { "type": "string", "minLength": 1 },
          "sequence": { "type": "integer", "minimum": 0 },
          "theme": { "type": "string", "minLength": 5 },
          "estimated_duration": { "type": "string", "minLength": 1 },
          "prerequisites": {
            "type": "array",
            "items": { "type": "string", "pattern": "^wave-\\d+$" }
          },
          "parallel_groups": {
            "type": "array",
            "minItems": 1,
            "items": {
              "type": "object",
              "required": ["id", "name", "domain", "stories", "tasks"],
              "additionalProperties": false,
              "properties": {
                "id": { "type": "string", "minLength": 1 },
                "name": { "type": "string", "minLength": 1 },
                "domain": { "type": "string", "minLength": 3 },
                "blocking": { "type": "boolean", "default": false },
                "stories": {
                  "type": "array",
                  "minItems": 1,
                  "items": { "type": "string", "pattern": "^US-\\d{3,}[a-z]?$" }
                },
                "tasks": {
                  "type": "array",
                  "minItems": 1,
                  "items": {
                    "type": "object",
                    "required": ["id", "story_ref", "description", "file_paths", "effort"],
                    "additionalProperties": false,
                    "properties": {
                      "id": { "type": "string", "pattern": "^T-\\d{3,}$" },
                      "story_ref": { "type": "string", "pattern": "^US-\\d{3,}[a-z]?$" },
                      "description": { "type": "string", "minLength": 5 },
                      "file_paths": {
                        "type": "array",
                        "minItems": 1,
                        "items": { "type": "string", "minLength": 1 }
                      },
                      "commands": {
                        "type": "array",
                        "items": { "type": "string", "minLength": 1 }
                      },
                      "effort": { "type": "string", "enum": ["S", "M", "L", "XL"] },
                      "depends_on": {
                        "type": "array",
                        "items": { "type": "string", "pattern": "^T-\\d{3,}$" }
                      }
                    }
                  }
                }
              }
            }
          },
          "demo_checkpoint": {
            "type": "object",
            "required": ["description", "validates", "criteria"],
            "additionalProperties": false,
            "properties": {
              "description": { "type": "string", "minLength": 10 },
              "validates": {
                "type": "array",
                "minItems": 1,
                "items": { "type": "string", "pattern": "^US-\\d{3,}[a-z]?$" }
              },
              "criteria": {
                "type": "array",
                "minItems": 1,
                "items": { "type": "string", "minLength": 5 }
              }
            }
          },
          "post_wave_validation": {
            "type": "array",
            "items": {
              "type": "object",
              "required": ["check", "command", "expect"],
              "additionalProperties": false,
              "properties": {
                "check": { "type": "string", "minLength": 5 },
                "command": { "type": "string", "minLength": 1 },
                "expect": { "type": "string", "minLength": 1 }
              }
            }
          }
        }
      }
    },
    "critical_path": {
      "type": "array",
      "minItems": 1,
      "items": {
        "type": "object",
        "required": ["story_id", "wave", "reason"],
        "additionalProperties": false,
        "properties": {
          "story_id": { "type": "string", "pattern": "^US-\\d{3,}[a-z]?$" },
          "wave": { "type": "string", "pattern": "^wave-\\d+$" },
          "blocks": { "type": "string", "pattern": "^US-\\d{3,}[a-z]?$" },
          "reason": { "type": "string", "minLength": 5 }
        }
      }
    },
    "parallel_strategy": {
      "type": "object",
      "required": ["max_concurrent_agents", "file_conflict_rules", "worktree_strategy"],
      "additionalProperties": false,
      "properties": {
        "max_concurrent_agents": { "type": "integer", "minimum": 1, "maximum": 10 },
        "file_conflict_rules": {
          "type": "array",
          "items": {
            "type": "object",
            "required": ["pattern", "exclusive_to", "reason"],
            "additionalProperties": false,
            "properties": {
              "pattern": { "type": "string", "minLength": 1 },
              "exclusive_to": { "type": "string", "minLength": 1 },
              "reason": { "type": "string", "minLength": 5 }
            }
          }
        },
        "worktree_strategy": { "type": "string", "enum": ["per_parallel_group", "per_story"] }
      }
    },
    "risks": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["id", "category", "description", "probability", "impact", "mitigation", "affected_stories"],
        "additionalProperties": false,
        "properties": {
          "id": { "type": "string", "pattern": "^RISK-\\d{3}$" },
          "category": { "type": "string", "enum": ["external_dependency", "complexity", "integration", "timing"] },
          "description": { "type": "string", "minLength": 10 },
          "probability": { "type": "string", "enum": ["low", "medium", "high"] },
          "impact": { "type": "string", "enum": ["low", "medium", "high"] },
          "mitigation": { "type": "string", "minLength": 10 },
          "affected_stories": {
            "type": "array",
            "minItems": 1,
            "items": { "type": "string", "pattern": "^US-\\d{3,}[a-z]?$" }
          }
        }
      }
    }
  }
}
```

- [ ] **Step 2: Validate the schema compiles**

Run: `node -e "import Ajv from 'ajv/dist/2020.js'; import addFormats from 'ajv-formats'; const ajv = new (Ajv.default || Ajv)({strict:false}); addFormats.default ? addFormats.default(ajv) : addFormats(ajv); const schema = JSON.parse(await import('fs').then(m=>m.readFileSync('skills/kryptonite/references/plan-schema.json','utf-8'))); ajv.compile(schema); console.log('PASS: plan-schema.json compiles');" --input-type=module`

Expected: `PASS: plan-schema.json compiles`

- [ ] **Step 3: Commit**

```bash
git add skills/kryptonite/references/plan-schema.json
git commit -m "feat: add plan-schema.json for structured plan validation"
```

---

## Task 3: Create validate-spec.js

**Files:**
- Create: `skills/kryptonite/scripts/validate-spec.js`

- [ ] **Step 1: Write the validator script**

```javascript
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";

const { positionals } = parseArgs({ allowPositionals: true });
const specFile = positionals[0];

if (!specFile) {
  console.error("Usage: node validate-spec.js <path-to-spec.json>");
  process.exit(2);
}

const scriptsDir = path.dirname(new URL(import.meta.url).pathname);
const refsDir = path.join(scriptsDir, "..", "references");

function loadJSON(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf-8"));
}

const spec = loadJSON(specFile);
const specSchema = loadJSON(path.join(refsDir, "spec-schema.json"));
const storySchema = loadJSON(path.join(refsDir, "story-schema.json"));

// --- Layer 1: Schema Validation ---

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
ajv.addSchema(storySchema, "story-schema.json");

const validate = ajv.compile(specSchema);
const valid = validate(spec);

const errors = [];

if (!valid) {
  for (const err of validate.errors) {
    errors.push({
      layer: "schema",
      path: err.instancePath || "/",
      rule: err.keyword,
      message: err.message || "validation failed",
      suggestion: err.params ? JSON.stringify(err.params) : undefined,
    });
  }
}

// --- Layer 2: Semantic Validation ---

function semanticChecks() {
  const componentIds = new Set(spec.architecture.components.map((c) => c.id));
  const repoIds = new Set(spec.repos.map((r) => r.id));
  const partyIds = new Set(spec.parties.map((p) => p.id));
  const entityIds = new Set(spec.data_model.entities.map((e) => e.id));
  const storyIds = new Set(spec.stories.map((s) => s.id));

  // Component connectivity: every component in at least one interaction
  const interactedComponents = new Set();
  for (const i of spec.architecture.interactions) {
    interactedComponents.add(i.from);
    interactedComponents.add(i.to);
  }
  for (const c of spec.architecture.components) {
    if (!interactedComponents.has(c.id)) {
      errors.push({
        layer: "semantic",
        path: `$.architecture.components[${spec.architecture.components.indexOf(c)}]`,
        rule: "component_connectivity",
        message: `Component '${c.id}' does not appear in any interaction`,
        suggestion: `Add an interaction involving '${c.id}' or remove the component`,
      });
    }
  }

  // Interaction refs: from/to must be valid component IDs
  for (const [idx, i] of spec.architecture.interactions.entries()) {
    if (!componentIds.has(i.from)) {
      errors.push({
        layer: "semantic",
        path: `$.architecture.interactions[${idx}].from`,
        rule: "component_reference",
        message: `Interaction references non-existent component '${i.from}'`,
        suggestion: `Available components: ${[...componentIds].join(", ")}`,
      });
    }
    if (!componentIds.has(i.to)) {
      errors.push({
        layer: "semantic",
        path: `$.architecture.interactions[${idx}].to`,
        rule: "component_reference",
        message: `Interaction references non-existent component '${i.to}'`,
        suggestion: `Available components: ${[...componentIds].join(", ")}`,
      });
    }
  }

  // Repo references in components
  for (const [idx, c] of spec.architecture.components.entries()) {
    if (!repoIds.has(c.repo)) {
      errors.push({
        layer: "semantic",
        path: `$.architecture.components[${idx}].repo`,
        rule: "repo_reference",
        message: `Component '${c.id}' references repo '${c.repo}' which does not exist`,
        suggestion: `Available repos: ${[...repoIds].join(", ")}`,
      });
    }
  }

  // Party references in stories
  for (const [idx, s] of spec.stories.entries()) {
    if (!partyIds.has(s.party)) {
      errors.push({
        layer: "semantic",
        path: `$.stories[${idx}].party`,
        rule: "party_reference",
        message: `Story '${s.id}' references party '${s.party}' which does not exist`,
        suggestion: `Available parties: ${[...partyIds].join(", ")}`,
      });
    }
  }

  // Repo references in stories
  for (const [idx, s] of spec.stories.entries()) {
    if (!repoIds.has(s.repo)) {
      errors.push({
        layer: "semantic",
        path: `$.stories[${idx}].repo`,
        rule: "repo_reference",
        message: `Story '${s.id}' references repo '${s.repo}' which does not exist`,
        suggestion: `Available repos: ${[...repoIds].join(", ")}`,
      });
    }
  }

  // Dependency DAG: no cycles
  const visited = new Set();
  const inStack = new Set();
  function dfs(id, chain) {
    if (inStack.has(id)) {
      errors.push({
        layer: "semantic",
        path: `$.stories`,
        rule: "dependency_dag",
        message: `Circular dependency: ${[...chain, id].join(" → ")}`,
        suggestion: "Remove one dependency to break the cycle",
      });
      return;
    }
    if (visited.has(id)) return;
    visited.add(id);
    inStack.add(id);
    const story = spec.stories.find((s) => s.id === id);
    if (story?.dependencies) {
      for (const dep of story.dependencies) {
        if (!storyIds.has(dep)) {
          errors.push({
            layer: "semantic",
            path: `$.stories[${spec.stories.indexOf(story)}].dependencies`,
            rule: "dependency_reference",
            message: `Story '${id}' depends on non-existent story '${dep}'`,
            suggestion: `Available story IDs: ${[...storyIds].slice(0, 10).join(", ")}...`,
          });
        } else {
          dfs(dep, [...chain, id]);
        }
      }
    }
    inStack.delete(id);
  }
  for (const s of spec.stories) dfs(s.id, []);

  // Entity relationship targets
  for (const [eIdx, entity] of spec.data_model.entities.entries()) {
    for (const [rIdx, rel] of (entity.relationships || []).entries()) {
      if (!entityIds.has(rel.target)) {
        errors.push({
          layer: "semantic",
          path: `$.data_model.entities[${eIdx}].relationships[${rIdx}].target`,
          rule: "entity_reference",
          message: `Entity '${entity.id}' relationship targets non-existent entity '${rel.target}'`,
          suggestion: `Available entities: ${[...entityIds].join(", ")}`,
        });
      }
    }
  }

  // Spike coverage: every spike story has a spike_findings entry
  const spikeStories = spec.stories.filter((s) => s.type === "spike");
  const spikeFindings = new Set((spec.spike_findings || []).map((f) => f.story_id));
  for (const spike of spikeStories) {
    if (!spikeFindings.has(spike.id)) {
      errors.push({
        layer: "semantic",
        path: `$.spike_findings`,
        rule: "spike_coverage",
        message: `Spike story '${spike.id}' has no corresponding spike_findings entry`,
        suggestion: `Add a spike_findings entry with story_id: '${spike.id}'`,
      });
    }
  }

  // Open question block references
  for (const [idx, oq] of (spec.open_questions || []).entries()) {
    for (const blockRef of oq.blocks) {
      if (!storyIds.has(blockRef) && !componentIds.has(blockRef)) {
        errors.push({
          layer: "semantic",
          path: `$.open_questions[${idx}].blocks`,
          rule: "open_question_reference",
          message: `Open question '${oq.id}' blocks reference '${blockRef}' which is neither a story nor a component`,
          suggestion: "Use a valid story ID (US-NNN) or component ID",
        });
      }
    }
  }
}

if (errors.length === 0 || errors.every((e) => e.layer === "schema")) {
  // Only run semantic checks if schema basically loaded (stories exist, etc.)
  if (spec.stories && spec.architecture && spec.repos && spec.parties && spec.data_model) {
    semanticChecks();
  }
}

// --- Output ---
const output = { valid: errors.length === 0, errors };
console.log(JSON.stringify(output, null, 2));
process.exit(errors.length === 0 ? 0 : 1);
```

- [ ] **Step 2: Test with a minimal valid spec fixture**

Create a minimal fixture at `skills/kryptonite/scripts/test-fixtures/minimal-spec.json` with one party, one repo, one component, one interaction, one entity, one NFR, one constraint, one story and verify it passes. Run:

```bash
node skills/kryptonite/scripts/validate-spec.js skills/kryptonite/scripts/test-fixtures/minimal-spec.json
```

Expected: `"valid": true`

- [ ] **Step 3: Test with an invalid spec (missing required field)**

Create a fixture missing the `architecture` field. Run the validator. Expected: exit 1 with schema error about missing required property.

- [ ] **Step 4: Test semantic validation (orphan component)**

Create a fixture with a component that appears in zero interactions. Run validator. Expected: exit 1 with `component_connectivity` error.

- [ ] **Step 5: Commit**

```bash
git add skills/kryptonite/scripts/validate-spec.js skills/kryptonite/scripts/test-fixtures/
git commit -m "feat: add validate-spec.js with schema + semantic validation"
```

---

## Task 4: Create validate-plan.js

**Files:**
- Create: `skills/kryptonite/scripts/validate-plan.js`

- [ ] **Step 1: Write the validator script**

```javascript
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";

const { positionals } = parseArgs({ allowPositionals: true });
const planFile = positionals[0];
const specFile = positionals[1];

if (!planFile || !specFile) {
  console.error("Usage: node validate-plan.js <path-to-plan.json> <path-to-spec.json>");
  process.exit(2);
}

const scriptsDir = path.dirname(new URL(import.meta.url).pathname);
const refsDir = path.join(scriptsDir, "..", "references");

function loadJSON(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf-8"));
}

const plan = loadJSON(planFile);
const spec = loadJSON(specFile);
const planSchema = loadJSON(path.join(refsDir, "plan-schema.json"));

// --- Layer 1: Schema Validation ---

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);

const validate = ajv.compile(planSchema);
const valid = validate(plan);

const errors = [];

if (!valid) {
  for (const err of validate.errors) {
    errors.push({
      layer: "schema",
      path: err.instancePath || "/",
      rule: err.keyword,
      message: err.message || "validation failed",
      suggestion: err.params ? JSON.stringify(err.params) : undefined,
    });
  }
}

// --- Layer 2: Semantic Validation (cross-ref against spec) ---

function semanticChecks() {
  const specStoryIds = new Set(spec.stories.map((s) => s.id));
  const deferredStoryIds = new Set(
    spec.stories.filter((s) => s.status === "deferred" || s.status === "cancelled").map((s) => s.id)
  );
  const requiredStoryIds = new Set(
    [...specStoryIds].filter((id) => !deferredStoryIds.has(id))
  );

  // Collect all story IDs referenced in plan
  const planStoryIds = new Set();
  const allTaskIds = new Set();
  const taskWaveMap = new Map(); // taskId -> wave sequence

  for (const wave of plan.waves) {
    for (const pg of wave.parallel_groups) {
      for (const storyId of pg.stories) {
        if (planStoryIds.has(storyId)) {
          errors.push({
            layer: "semantic",
            path: `$.waves[${plan.waves.indexOf(wave)}]`,
            rule: "duplicate_story",
            message: `Story '${storyId}' appears in multiple parallel groups`,
            suggestion: "Each story must appear in exactly one parallel group across all waves",
          });
        }
        planStoryIds.add(storyId);
      }
      for (const task of pg.tasks) {
        if (allTaskIds.has(task.id)) {
          errors.push({
            layer: "semantic",
            path: `$.waves[${plan.waves.indexOf(wave)}]`,
            rule: "duplicate_task_id",
            message: `Task ID '${task.id}' is duplicated`,
            suggestion: "Each task must have a unique ID",
          });
        }
        allTaskIds.add(task.id);
        taskWaveMap.set(task.id, wave.sequence);
      }
    }
  }

  // Story coverage: every required spec story must be in the plan
  for (const storyId of requiredStoryIds) {
    if (!planStoryIds.has(storyId)) {
      errors.push({
        layer: "semantic",
        path: "$.waves",
        rule: "story_coverage",
        message: `Spec story '${storyId}' is not assigned to any wave in the plan`,
        suggestion: "Add this story to an appropriate wave's parallel group",
      });
    }
  }

  // No phantom stories: every plan story must exist in spec
  for (const storyId of planStoryIds) {
    if (!specStoryIds.has(storyId)) {
      errors.push({
        layer: "semantic",
        path: "$.waves",
        rule: "phantom_story",
        message: `Plan references story '${storyId}' which does not exist in spec`,
        suggestion: `Available story IDs: ${[...specStoryIds].slice(0, 10).join(", ")}...`,
      });
    }
  }

  // Wave DAG: prerequisites must reference earlier waves
  const waveSeqMap = new Map(plan.waves.map((w) => [w.id, w.sequence]));
  for (const wave of plan.waves) {
    for (const prereq of wave.prerequisites || []) {
      if (!waveSeqMap.has(prereq)) {
        errors.push({
          layer: "semantic",
          path: `$.waves[${plan.waves.indexOf(wave)}].prerequisites`,
          rule: "wave_dag",
          message: `Wave '${wave.id}' has prerequisite '${prereq}' which does not exist`,
          suggestion: `Available waves: ${[...waveSeqMap.keys()].join(", ")}`,
        });
      } else if (waveSeqMap.get(prereq) >= wave.sequence) {
        errors.push({
          layer: "semantic",
          path: `$.waves[${plan.waves.indexOf(wave)}].prerequisites`,
          rule: "wave_dag",
          message: `Wave '${wave.id}' (seq ${wave.sequence}) has prerequisite '${prereq}' (seq ${waveSeqMap.get(prereq)}) which is not earlier`,
          suggestion: "Prerequisites must have lower sequence numbers",
        });
      }
    }
  }

  // Task DAG: depends_on must reference tasks in prior waves or earlier in same group
  for (const wave of plan.waves) {
    for (const pg of wave.parallel_groups) {
      const taskIdsInGroup = new Set();
      for (const task of pg.tasks) {
        for (const dep of task.depends_on || []) {
          if (!allTaskIds.has(dep)) {
            errors.push({
              layer: "semantic",
              path: `$.waves[${plan.waves.indexOf(wave)}].parallel_groups`,
              rule: "task_dag",
              message: `Task '${task.id}' depends on non-existent task '${dep}'`,
              suggestion: "depends_on must reference an existing task ID",
            });
          } else {
            const depWaveSeq = taskWaveMap.get(dep);
            if (depWaveSeq > wave.sequence) {
              errors.push({
                layer: "semantic",
                path: `$.waves[${plan.waves.indexOf(wave)}].parallel_groups`,
                rule: "task_dag",
                message: `Task '${task.id}' (wave ${wave.sequence}) depends on '${dep}' in later wave (seq ${depWaveSeq})`,
                suggestion: "Tasks can only depend on tasks in prior or same wave",
              });
            } else if (depWaveSeq === wave.sequence && !taskIdsInGroup.has(dep)) {
              errors.push({
                layer: "semantic",
                path: `$.waves[${plan.waves.indexOf(wave)}].parallel_groups`,
                rule: "task_dag",
                message: `Task '${task.id}' depends on '${dep}' which is in the same wave but a different parallel group`,
                suggestion: "Same-wave dependencies must be within the same parallel group (earlier in task order)",
              });
            }
          }
        }
        taskIdsInGroup.add(task.id);
      }
    }
  }

  // File conflict: no two parallel groups in same wave share file_paths
  for (const wave of plan.waves) {
    const groupFiles = new Map(); // pgId -> Set<filePath>
    for (const pg of wave.parallel_groups) {
      const files = new Set();
      for (const task of pg.tasks) {
        for (const fp of task.file_paths) files.add(fp);
      }
      groupFiles.set(pg.id, files);
    }
    const pgIds = [...groupFiles.keys()];
    for (let i = 0; i < pgIds.length; i++) {
      for (let j = i + 1; j < pgIds.length; j++) {
        const filesA = groupFiles.get(pgIds[i]);
        const filesB = groupFiles.get(pgIds[j]);
        for (const f of filesA) {
          if (filesB.has(f)) {
            errors.push({
              layer: "semantic",
              path: `$.waves[${plan.waves.indexOf(wave)}]`,
              rule: "file_conflict",
              message: `Parallel groups '${pgIds[i]}' and '${pgIds[j]}' in wave '${wave.id}' both touch file '${f}'`,
              suggestion: "Move one of the conflicting tasks to a different wave or merge the groups",
            });
          }
        }
      }
    }
  }

  // Demo coverage: validates[] must reference stories in that wave
  for (const wave of plan.waves) {
    const waveStories = new Set();
    for (const pg of wave.parallel_groups) {
      for (const sid of pg.stories) waveStories.add(sid);
    }
    for (const validateId of wave.demo_checkpoint.validates) {
      if (!waveStories.has(validateId)) {
        errors.push({
          layer: "semantic",
          path: `$.waves[${plan.waves.indexOf(wave)}].demo_checkpoint.validates`,
          rule: "demo_coverage",
          message: `Demo checkpoint in wave '${wave.id}' validates story '${validateId}' which is not in this wave`,
          suggestion: `Stories in this wave: ${[...waveStories].join(", ")}`,
        });
      }
    }
  }

  // Risk linkage: affected_stories must exist in spec
  for (const [idx, risk] of plan.risks.entries()) {
    for (const storyId of risk.affected_stories) {
      if (!specStoryIds.has(storyId)) {
        errors.push({
          layer: "semantic",
          path: `$.risks[${idx}].affected_stories`,
          rule: "risk_reference",
          message: `Risk '${risk.id}' references non-existent story '${storyId}'`,
          suggestion: "Use a story ID that exists in spec.json",
        });
      }
    }
  }

  // Task story_ref must match stories in the same parallel group
  for (const wave of plan.waves) {
    for (const pg of wave.parallel_groups) {
      const pgStorySet = new Set(pg.stories);
      for (const task of pg.tasks) {
        if (!pgStorySet.has(task.story_ref)) {
          errors.push({
            layer: "semantic",
            path: `$.waves[${plan.waves.indexOf(wave)}].parallel_groups`,
            rule: "task_story_ref",
            message: `Task '${task.id}' has story_ref '${task.story_ref}' not in its parallel group's stories [${pg.stories.join(", ")}]`,
            suggestion: "task.story_ref must reference a story within the same parallel group",
          });
        }
      }
    }
  }
}

if (spec.stories && plan.waves) {
  semanticChecks();
}

// --- Output ---
const output = { valid: errors.length === 0, errors };
console.log(JSON.stringify(output, null, 2));
process.exit(errors.length === 0 ? 0 : 1);
```

- [ ] **Step 2: Test with minimal valid plan + spec pair**

Create `skills/kryptonite/scripts/test-fixtures/minimal-plan.json` that references the stories from `minimal-spec.json`. Run:

```bash
node skills/kryptonite/scripts/validate-plan.js skills/kryptonite/scripts/test-fixtures/minimal-plan.json skills/kryptonite/scripts/test-fixtures/minimal-spec.json
```

Expected: `"valid": true`

- [ ] **Step 3: Test story coverage failure**

Modify fixture to have a spec story missing from the plan. Expected: exit 1 with `story_coverage` error.

- [ ] **Step 4: Test file conflict detection**

Modify fixture to have two parallel groups touching the same file. Expected: exit 1 with `file_conflict` error.

- [ ] **Step 5: Commit**

```bash
git add skills/kryptonite/scripts/validate-plan.js skills/kryptonite/scripts/test-fixtures/
git commit -m "feat: add validate-plan.js with schema + semantic cross-validation"
```

---

## Task 5: Add JSON API endpoints to comment-server.js

**Files:**
- Modify: `skills/kryptonite/scripts/comment-server.js:680-700` (add new API routes before existing ones)

- [ ] **Step 1: Add `/api/spec` and `/api/plan` endpoints**

Insert after the `/api/repos` handler (line ~700) and before the `/api/epics` handler:

```javascript
  // ─── API: spec.json ──────────────────────────────────────────────────────────
  if (url.pathname === "/api/spec" && req.method === "GET") {
    const epicDir = getEpicDir();
    if (!epicDir) { res.writeHead(404, jsonHeaders); res.end(JSON.stringify({ error: "No epic directory" })); return; }
    const specJsonPath = path.join(epicDir, "spec.json");
    try {
      const data = fs.readFileSync(specJsonPath, "utf-8");
      JSON.parse(data); // validate it's JSON
      res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
      res.end(data);
    } catch {
      res.writeHead(404, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
      res.end(JSON.stringify({ error: "spec.json not found" }));
    }
    return;
  }

  // ─── API: plan.json ──────────────────────────────────────────────────────────
  if (url.pathname === "/api/plan" && req.method === "GET") {
    const epicDir = getEpicDir();
    if (!epicDir) { res.writeHead(404, jsonHeaders); res.end(JSON.stringify({ error: "No epic directory" })); return; }
    const planJsonPath = path.join(epicDir, "plan.json");
    try {
      const data = fs.readFileSync(planJsonPath, "utf-8");
      JSON.parse(data); // validate it's JSON
      res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
      res.end(data);
    } catch {
      res.writeHead(404, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
      res.end(JSON.stringify({ error: "plan.json not found" }));
    }
    return;
  }
```

- [ ] **Step 2: Update `/spec` and `/plan` page routes to detect JSON mode**

Replace the `/plan` route handler (line ~988) with detection logic:

```javascript
  // Plan
  if (url.pathname === "/plan") {
    const epicDir = getEpicDir();
    // JSON mode: serve the SPA renderer
    if (epicDir && fs.existsSync(path.join(epicDir, "plan.json"))) {
      const spaPath = path.join(UI_DIR, "plan.html");
      if (serveStaticFile(spaPath, res)) return;
    }
    // HTML mode: legacy
    if (!planPath) { res.writeHead(404); res.end("Plan not generated yet"); return; }
    try {
      const html = fs.readFileSync(planPath, "utf-8");
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(injectUI(html));
    } catch {
      res.writeHead(404);
      res.end("Plan not generated yet");
    }
    return;
  }
```

Replace the `/spec` route handler (line ~1028) similarly:

```javascript
  // Spec (root) or index.html
  if (url.pathname === "/" || url.pathname === "/spec") {
    if (visualOnly) { res.writeHead(302, { Location: "/visual" }); res.end(); return; }

    // Try serving static index.html first (for "/" only)
    if (url.pathname === "/") {
      const indexPath = path.join(UI_DIR, "index.html");
      if (serveStaticFile(indexPath, res)) return;
    }

    // JSON mode: serve the SPA renderer
    const epicDir = getEpicDir();
    if (epicDir && fs.existsSync(path.join(epicDir, "spec.json"))) {
      const spaPath = path.join(UI_DIR, "spec.html");
      if (serveStaticFile(spaPath, res)) return;
    }

    // HTML mode: legacy
    if (!specPath) { res.writeHead(404); res.end("Spec not generated yet"); return; }
    try {
      const html = fs.readFileSync(specPath, "utf-8");
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(injectUI(html));
    } catch (e) {
      res.writeHead(500);
      res.end("Cannot read spec: " + e.message);
    }
    return;
  }
```

- [ ] **Step 3: Commit**

```bash
git add skills/kryptonite/scripts/comment-server.js
git commit -m "feat: add JSON API endpoints and detection mode to comment-server"
```

---

## Task 6: Create spec.html Alpine.js SPA

**Files:**
- Create: `skills/kryptonite/scripts/ui/spec.html`

- [ ] **Step 1: Write the spec renderer**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Kryptonite — Spec</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link href="https://cdn.jsdelivr.net/npm/daisyui@4/dist/full.min.css" rel="stylesheet">
  <script src="https://cdn.tailwindcss.com"></script>
  <script defer src="https://cdn.jsdelivr.net/npm/alpinejs@3/dist/cdn.min.js"></script>
  <style>
    body { background: #0f172a; color: #e2e8f0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
    .spec-card { background: #1e293b; border: 1px solid #334155; border-radius: 0.75rem; }
    .section-title { color: #10b981; font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.05em; font-weight: 600; }
    .pill { display: inline-block; padding: 0.1rem 0.5rem; border-radius: 9999px; font-size: 0.65rem; font-weight: 600; }
    .pill-critical { background: rgba(239,68,68,0.15); color: #fca5a5; }
    .pill-high { background: rgba(251,191,36,0.15); color: #fde68a; }
    .pill-medium { background: rgba(59,130,246,0.15); color: #93c5fd; }
    .pill-low { background: rgba(148,163,184,0.15); color: #94a3b8; }
    .pill-type { background: rgba(16,185,129,0.15); color: #6ee7b7; }
    .enum-tag { background: #334155; padding: 0.1rem 0.4rem; border-radius: 0.25rem; font-size: 0.7rem; color: #94a3b8; }
    table { width: 100%; border-collapse: collapse; font-size: 0.8rem; }
    th { text-align: left; padding: 0.5rem; color: #64748b; border-bottom: 1px solid #334155; font-size: 0.7rem; text-transform: uppercase; }
    td { padding: 0.5rem; border-bottom: 1px solid #1e293b; vertical-align: top; }
    .sidebar-link { display: block; padding: 0.375rem 1rem; color: #94a3b8; font-size: 0.8rem; border-left: 2px solid transparent; text-decoration: none; }
    .sidebar-link:hover { color: #e2e8f0; background: rgba(255,255,255,0.03); }
    .sidebar-link.active { color: #10b981; border-left-color: #10b981; }
  </style>
</head>
<body x-data="specApp()" x-init="load()">
  <!-- Nav placeholder -->
  <div id="nav-container"></div>

  <div style="display:grid;grid-template-columns:220px 1fr;min-height:calc(100vh - 56px);margin-top:56px;">
    <!-- Sidebar -->
    <aside style="background:#0f172a;border-right:1px solid #1e293b;padding:1rem 0;position:sticky;top:56px;height:calc(100vh - 56px);overflow-y:auto;">
      <div style="padding:0 1rem 0.75rem;border-bottom:1px solid #1e293b;">
        <div style="font-weight:700;font-size:0.9rem;" x-text="spec?.overview?.name || 'Loading...'"></div>
        <div style="font-size:0.7rem;color:#64748b;" x-text="spec ? spec.stories.length + ' stories' : ''"></div>
      </div>
      <nav style="padding:0.5rem 0;">
        <a href="#overview" class="sidebar-link">Overview</a>
        <a href="#parties" class="sidebar-link">Parties</a>
        <a href="#architecture" class="sidebar-link">Architecture</a>
        <a href="#data-model" class="sidebar-link">Data Model</a>
        <a href="#api-boundaries" class="sidebar-link">API Boundaries</a>
        <a href="#nfrs" class="sidebar-link">NFRs</a>
        <a href="#constraints" class="sidebar-link">Constraints</a>
        <a href="#stories" class="sidebar-link">Stories</a>
        <a href="#spike-findings" class="sidebar-link">Spike Findings</a>
        <template x-if="spec?.open_questions?.length > 0">
          <a href="#open-questions" class="sidebar-link">Open Questions</a>
        </template>
      </nav>
    </aside>

    <!-- Content -->
    <main style="padding:2rem 3rem;max-width:1000px;">
      <template x-if="!spec">
        <div style="text-align:center;padding:4rem;color:#64748b;">Loading spec...</div>
      </template>

      <template x-if="spec">
        <div>
          <!-- Overview -->
          <section id="overview" style="margin-bottom:2.5rem;">
            <h1 style="font-size:1.75rem;margin:0 0 0.25rem;" x-text="spec.overview.name"></h1>
            <p style="color:#94a3b8;margin-bottom:1.5rem;" x-text="spec.overview.description"></p>
            <div class="spec-card" style="padding:1.25rem;">
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:1.5rem;">
                <div>
                  <div class="section-title" style="margin-bottom:0.5rem;">Goals</div>
                  <ul style="list-style:none;padding:0;margin:0;">
                    <template x-for="g in spec.overview.goals"><li style="padding:0.2rem 0;font-size:0.8rem;" x-text="'• ' + g"></li></template>
                  </ul>
                </div>
                <div>
                  <div class="section-title" style="margin-bottom:0.5rem;">Non-Goals</div>
                  <ul style="list-style:none;padding:0;margin:0;">
                    <template x-for="ng in spec.overview.non_goals"><li style="padding:0.2rem 0;font-size:0.8rem;color:#94a3b8;" x-text="'• ' + ng"></li></template>
                  </ul>
                </div>
              </div>
            </div>
          </section>

          <!-- Parties -->
          <section id="parties" style="margin-bottom:2.5rem;">
            <h2 style="font-size:1.25rem;margin-bottom:1rem;">Parties & Roles</h2>
            <div style="display:grid;gap:0.75rem;">
              <template x-for="p in spec.parties">
                <div class="spec-card" style="padding:1rem;">
                  <div style="font-weight:600;font-size:0.85rem;margin-bottom:0.25rem;" x-text="p.name"></div>
                  <div style="font-size:0.75rem;color:#94a3b8;margin-bottom:0.5rem;" x-text="p.description"></div>
                  <div style="display:flex;gap:1rem;font-size:0.7rem;">
                    <div><span style="color:#64748b;">Auth:</span> <span x-text="p.auth"></span></div>
                    <div><span style="color:#64748b;">Boundaries:</span> <span x-text="p.boundaries"></span></div>
                  </div>
                </div>
              </template>
            </div>
          </section>

          <!-- Architecture -->
          <section id="architecture" style="margin-bottom:2.5rem;">
            <h2 style="font-size:1.25rem;margin-bottom:1rem;">Architecture</h2>
            <div class="section-title" style="margin-bottom:0.5rem;">Components</div>
            <div class="spec-card" style="overflow:hidden;margin-bottom:1rem;">
              <table>
                <thead><tr><th>Component</th><th>Type</th><th>Repo</th><th>Responsibility</th></tr></thead>
                <tbody>
                  <template x-for="c in spec.architecture.components">
                    <tr>
                      <td style="font-weight:500;" x-text="c.name"></td>
                      <td><span class="enum-tag" x-text="c.type"></span></td>
                      <td><span class="enum-tag" x-text="c.repo"></span></td>
                      <td style="color:#94a3b8;" x-text="c.responsibility"></td>
                    </tr>
                  </template>
                </tbody>
              </table>
            </div>

            <div class="section-title" style="margin-bottom:0.5rem;">Interactions</div>
            <div class="spec-card" style="overflow:hidden;margin-bottom:1rem;">
              <table>
                <thead><tr><th>From</th><th>To</th><th>Protocol</th><th>Description</th></tr></thead>
                <tbody>
                  <template x-for="i in spec.architecture.interactions">
                    <tr>
                      <td x-text="i.from"></td>
                      <td x-text="i.to"></td>
                      <td><span class="enum-tag" x-text="i.protocol"></span></td>
                      <td style="color:#94a3b8;" x-text="i.description"></td>
                    </tr>
                  </template>
                </tbody>
              </table>
            </div>

            <template x-if="spec.architecture.decisions.length > 0">
              <div>
                <div class="section-title" style="margin-bottom:0.5rem;">Architecture Decisions</div>
                <div style="display:grid;gap:0.75rem;">
                  <template x-for="d in spec.architecture.decisions">
                    <div class="spec-card" style="padding:1rem;">
                      <div style="display:flex;align-items:center;gap:0.5rem;margin-bottom:0.25rem;">
                        <span class="enum-tag" x-text="d.id"></span>
                        <span style="font-weight:600;font-size:0.85rem;" x-text="d.title"></span>
                        <span class="pill pill-type" x-text="d.status"></span>
                      </div>
                      <div style="font-size:0.75rem;color:#94a3b8;margin-bottom:0.5rem;" x-text="'Context: ' + d.context"></div>
                      <div style="font-size:0.8rem;margin-bottom:0.5rem;"><strong style="color:#10b981;">Choice:</strong> <span x-text="d.choice"></span></div>
                      <template x-if="d.alternatives && d.alternatives.length > 0">
                        <div style="font-size:0.7rem;color:#64748b;">
                          <template x-for="alt in d.alternatives">
                            <div x-text="'✗ ' + alt.option + ' — ' + alt.rejected_because" style="padding:0.1rem 0;"></div>
                          </template>
                        </div>
                      </template>
                    </div>
                  </template>
                </div>
              </div>
            </template>
          </section>

          <!-- Data Model -->
          <section id="data-model" style="margin-bottom:2.5rem;">
            <h2 style="font-size:1.25rem;margin-bottom:1rem;">Data Model</h2>
            <div style="display:grid;gap:0.75rem;">
              <template x-for="entity in spec.data_model.entities">
                <div class="spec-card" style="padding:1rem;">
                  <div style="font-weight:600;font-size:0.85rem;margin-bottom:0.25rem;" x-text="entity.id"></div>
                  <div style="font-size:0.7rem;color:#94a3b8;margin-bottom:0.75rem;" x-text="entity.description"></div>
                  <table>
                    <thead><tr><th>Field</th><th>Type</th><th>Constraints</th></tr></thead>
                    <tbody>
                      <template x-for="f in entity.fields">
                        <tr>
                          <td style="font-family:monospace;font-size:0.75rem;" x-text="f.name"></td>
                          <td><span class="enum-tag" x-text="f.type"></span></td>
                          <td>
                            <template x-for="c in (f.constraints || [])"><span class="enum-tag" style="margin-right:0.25rem;" x-text="c"></span></template>
                          </td>
                        </tr>
                      </template>
                    </tbody>
                  </table>
                  <template x-if="entity.relationships && entity.relationships.length > 0">
                    <div style="margin-top:0.5rem;font-size:0.7rem;color:#64748b;">
                      <template x-for="rel in entity.relationships">
                        <div x-text="'→ ' + rel.target + ' (' + rel.cardinality + ') — ' + rel.description"></div>
                      </template>
                    </div>
                  </template>
                </div>
              </template>
            </div>
          </section>

          <!-- API Boundaries -->
          <section id="api-boundaries" style="margin-bottom:2.5rem;">
            <h2 style="font-size:1.25rem;margin-bottom:1rem;">API Boundaries</h2>
            <template x-for="boundary in spec.api_boundaries">
              <div class="spec-card" style="padding:1rem;margin-bottom:0.75rem;">
                <div style="display:flex;align-items:center;gap:0.5rem;margin-bottom:0.75rem;">
                  <span style="font-weight:600;font-size:0.85rem;" x-text="boundary.name"></span>
                  <span class="enum-tag" x-text="boundary.type"></span>
                  <span class="enum-tag" x-text="boundary.direction"></span>
                </div>
                <table>
                  <thead><tr><th>Method</th><th>Path</th><th>Auth</th><th>Description</th></tr></thead>
                  <tbody>
                    <template x-for="ep in boundary.endpoints">
                      <tr>
                        <td><span class="pill pill-type" x-text="ep.method"></span></td>
                        <td style="font-family:monospace;font-size:0.75rem;" x-text="ep.path"></td>
                        <td><span class="enum-tag" x-text="ep.auth"></span></td>
                        <td style="color:#94a3b8;" x-text="ep.description"></td>
                      </tr>
                    </template>
                  </tbody>
                </table>
              </div>
            </template>
          </section>

          <!-- NFRs -->
          <section id="nfrs" style="margin-bottom:2.5rem;">
            <h2 style="font-size:1.25rem;margin-bottom:1rem;">Non-Functional Requirements</h2>
            <div class="spec-card" style="overflow:hidden;">
              <table>
                <thead><tr><th>ID</th><th>Category</th><th>Requirement</th><th>Metric</th><th>Target</th></tr></thead>
                <tbody>
                  <template x-for="nfr in spec.nfrs">
                    <tr>
                      <td><span class="enum-tag" x-text="nfr.id"></span></td>
                      <td><span class="enum-tag" x-text="nfr.category"></span></td>
                      <td x-text="nfr.requirement"></td>
                      <td style="color:#94a3b8;" x-text="nfr.metric"></td>
                      <td style="font-weight:500;" x-text="nfr.target"></td>
                    </tr>
                  </template>
                </tbody>
              </table>
            </div>
          </section>

          <!-- Technical Constraints -->
          <section id="constraints" style="margin-bottom:2.5rem;">
            <h2 style="font-size:1.25rem;margin-bottom:1rem;">Technical Constraints</h2>
            <div class="spec-card" style="overflow:hidden;">
              <table>
                <thead><tr><th>ID</th><th>Category</th><th>Constraint</th><th>Impact</th><th>Source</th></tr></thead>
                <tbody>
                  <template x-for="tc in spec.technical_constraints">
                    <tr>
                      <td><span class="enum-tag" x-text="tc.id"></span></td>
                      <td><span class="enum-tag" x-text="tc.category"></span></td>
                      <td x-text="tc.constraint"></td>
                      <td style="color:#94a3b8;" x-text="tc.impact"></td>
                      <td style="color:#64748b;" x-text="tc.source"></td>
                    </tr>
                  </template>
                </tbody>
              </table>
            </div>
          </section>

          <!-- Stories -->
          <section id="stories" style="margin-bottom:2.5rem;">
            <h2 style="font-size:1.25rem;margin-bottom:1rem;">User Stories</h2>
            <div style="display:grid;gap:0.75rem;">
              <template x-for="story in spec.stories">
                <div class="spec-card" style="padding:1rem;">
                  <div style="display:flex;align-items:center;gap:0.5rem;margin-bottom:0.5rem;">
                    <span class="enum-tag" x-text="story.id"></span>
                    <span class="pill" :class="'pill-' + story.priority" x-text="story.priority"></span>
                    <span class="enum-tag" x-text="story.estimated_complexity"></span>
                    <span class="enum-tag" x-text="story.repo"></span>
                  </div>
                  <div style="font-size:0.8rem;margin-bottom:0.5rem;">
                    <strong>As a</strong> <span x-text="story.statement.as_a"></span>,
                    <strong>I want</strong> <span x-text="story.statement.i_want"></span>,
                    <strong>so that</strong> <span x-text="story.statement.so_that"></span>
                  </div>
                  <div style="font-size:0.7rem;color:#94a3b8;">
                    <div class="section-title" style="margin-bottom:0.25rem;">Acceptance Criteria</div>
                    <template x-for="ac in story.acceptance_criteria">
                      <div x-text="'✓ ' + ac" style="padding:0.1rem 0;"></div>
                    </template>
                  </div>
                  <template x-if="story.dependencies && story.dependencies.length > 0">
                    <div style="margin-top:0.5rem;font-size:0.7rem;color:#64748b;" x-text="'Depends on: ' + story.dependencies.join(', ')"></div>
                  </template>
                </div>
              </template>
            </div>
          </section>

          <!-- Spike Findings -->
          <template x-if="spec.spike_findings && spec.spike_findings.length > 0">
            <section id="spike-findings" style="margin-bottom:2.5rem;">
              <h2 style="font-size:1.25rem;margin-bottom:1rem;">Spike Findings</h2>
              <div style="display:grid;gap:0.75rem;">
                <template x-for="sf in spec.spike_findings">
                  <div class="spec-card" style="padding:1rem;">
                    <div style="display:flex;align-items:center;gap:0.5rem;margin-bottom:0.5rem;">
                      <span class="enum-tag" x-text="sf.story_id"></span>
                    </div>
                    <div style="font-size:0.8rem;font-weight:500;margin-bottom:0.25rem;" x-text="sf.question"></div>
                    <div style="font-size:0.75rem;color:#94a3b8;" x-text="sf.finding"></div>
                    <div style="font-size:0.75rem;margin-top:0.5rem;"><strong style="color:#10b981;">Decision:</strong> <span x-text="sf.decision"></span></div>
                  </div>
                </template>
              </div>
            </section>
          </template>

          <!-- Open Questions -->
          <template x-if="spec.open_questions && spec.open_questions.length > 0">
            <section id="open-questions" style="margin-bottom:2.5rem;">
              <h2 style="font-size:1.25rem;margin-bottom:1rem;">Open Questions</h2>
              <div style="display:grid;gap:0.75rem;">
                <template x-for="oq in spec.open_questions">
                  <div class="spec-card" style="padding:1rem;border-left:3px solid #f59e0b;">
                    <div style="display:flex;align-items:center;gap:0.5rem;margin-bottom:0.25rem;">
                      <span class="enum-tag" x-text="oq.id"></span>
                    </div>
                    <div style="font-size:0.8rem;font-weight:500;" x-text="oq.question"></div>
                    <div style="font-size:0.7rem;color:#94a3b8;margin-top:0.25rem;" x-text="oq.context"></div>
                    <template x-if="oq.proposed_answer">
                      <div style="font-size:0.75rem;margin-top:0.5rem;color:#10b981;" x-text="'Proposed: ' + oq.proposed_answer"></div>
                    </template>
                  </div>
                </template>
              </div>
            </section>
          </template>
        </div>
      </template>
    </main>
  </div>

  <script src="/ui/assets/app.js"></script>
  <script>
    function specApp() {
      return {
        spec: null,
        async load() {
          try {
            const res = await fetch('/api/spec');
            if (res.ok) this.spec = await res.json();
          } catch (e) {
            console.error('Failed to load spec:', e);
          }
          loadNav();
        }
      };
    }
  </script>
</body>
</html>
```

- [ ] **Step 2: Verify file renders correctly**

Start the comment-server with a spec.json fixture in the epic directory. Open `http://localhost:3847/spec` in browser. Confirm all sections render, sidebar nav works, data populates.

- [ ] **Step 3: Commit**

```bash
git add skills/kryptonite/scripts/ui/spec.html
git commit -m "feat: add Alpine.js SPA for rendering spec.json"
```

---

## Task 7: Create plan.html Alpine.js SPA

**Files:**
- Create: `skills/kryptonite/scripts/ui/plan.html`

- [ ] **Step 1: Write the plan renderer**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Kryptonite — Plan</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link href="https://cdn.jsdelivr.net/npm/daisyui@4/dist/full.min.css" rel="stylesheet">
  <script src="https://cdn.tailwindcss.com"></script>
  <script defer src="https://cdn.jsdelivr.net/npm/alpinejs@3/dist/cdn.min.js"></script>
  <style>
    body { background: #0f172a; color: #e2e8f0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
    .plan-card { background: #1e293b; border: 1px solid #334155; border-radius: 0.75rem; }
    .section-title { color: #10b981; font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.05em; font-weight: 600; }
    .pill { display: inline-block; padding: 0.1rem 0.5rem; border-radius: 9999px; font-size: 0.65rem; font-weight: 600; }
    .pill-critical { background: rgba(239,68,68,0.15); color: #fca5a5; }
    .pill-high { background: rgba(251,191,36,0.15); color: #fde68a; }
    .pill-medium { background: rgba(59,130,246,0.15); color: #93c5fd; }
    .pill-low { background: rgba(148,163,184,0.15); color: #94a3b8; }
    .pill-effort { background: rgba(16,185,129,0.15); color: #6ee7b7; }
    .enum-tag { background: #334155; padding: 0.1rem 0.4rem; border-radius: 0.25rem; font-size: 0.7rem; color: #94a3b8; }
    .wave-section { border-left: 3px solid #10b981; margin-bottom: 1.5rem; padding-left: 1rem; }
    .pg-block { background: rgba(16,185,129,0.05); border: 1px solid #1e3a2e; border-radius: 0.5rem; padding: 0.75rem; margin-bottom: 0.5rem; }
    .task-item { padding: 0.4rem 0; border-bottom: 1px solid #1e293b; font-size: 0.75rem; }
    .demo-block { background: rgba(16,185,129,0.08); border-left: 3px solid #10b981; padding: 0.75rem 1rem; border-radius: 0 0.5rem 0.5rem 0; margin-top: 0.75rem; }
    .risk-card { border-left: 3px solid; }
    .risk-low { border-left-color: #10b981; }
    .risk-medium { border-left-color: #f59e0b; }
    .risk-high { border-left-color: #ef4444; }
    table { width: 100%; border-collapse: collapse; font-size: 0.8rem; }
    th { text-align: left; padding: 0.5rem; color: #64748b; border-bottom: 1px solid #334155; font-size: 0.7rem; text-transform: uppercase; }
    td { padding: 0.5rem; border-bottom: 1px solid #1e293b; vertical-align: top; }
    .sidebar-link { display: block; padding: 0.375rem 1rem; color: #94a3b8; font-size: 0.8rem; border-left: 2px solid transparent; text-decoration: none; }
    .sidebar-link:hover { color: #e2e8f0; background: rgba(255,255,255,0.03); }
    .sidebar-link.active { color: #10b981; border-left-color: #10b981; }
  </style>
</head>
<body x-data="planApp()" x-init="load()">
  <div id="nav-container"></div>

  <div style="display:grid;grid-template-columns:220px 1fr;min-height:calc(100vh - 56px);margin-top:56px;">
    <!-- Sidebar -->
    <aside style="background:#0f172a;border-right:1px solid #1e293b;padding:1rem 0;position:sticky;top:56px;height:calc(100vh - 56px);overflow-y:auto;">
      <div style="padding:0 1rem 0.75rem;border-bottom:1px solid #1e293b;">
        <div style="font-weight:700;font-size:0.9rem;">Implementation Plan</div>
        <div style="font-size:0.7rem;color:#64748b;" x-text="plan ? plan.summary.total_waves + ' waves · ' + plan.summary.total_stories + ' stories' : ''"></div>
      </div>
      <nav style="padding:0.5rem 0;">
        <a href="#summary" class="sidebar-link">Summary</a>
        <template x-if="plan">
          <div>
            <template x-for="wave in plan.waves">
              <a :href="'#' + wave.id" class="sidebar-link" x-text="'Wave ' + wave.sequence + ' — ' + wave.name"></a>
            </template>
          </div>
        </template>
        <a href="#critical-path" class="sidebar-link">Critical Path</a>
        <a href="#parallel-strategy" class="sidebar-link">Parallel Strategy</a>
        <a href="#risks" class="sidebar-link">Risks</a>
      </nav>
    </aside>

    <!-- Content -->
    <main style="padding:2rem 3rem;max-width:1000px;">
      <template x-if="!plan">
        <div style="text-align:center;padding:4rem;color:#64748b;">Loading plan...</div>
      </template>

      <template x-if="plan">
        <div>
          <!-- Summary -->
          <section id="summary" style="margin-bottom:2.5rem;">
            <h1 style="font-size:1.75rem;margin:0 0 0.5rem;">Implementation Plan</h1>
            <div class="plan-card" style="padding:1.25rem;">
              <div style="display:grid;grid-template-columns:repeat(4, 1fr);gap:1rem;text-align:center;">
                <div>
                  <div style="font-size:1.5rem;font-weight:700;color:#10b981;" x-text="plan.summary.total_waves"></div>
                  <div style="font-size:0.7rem;color:#64748b;">Waves</div>
                </div>
                <div>
                  <div style="font-size:1.5rem;font-weight:700;" x-text="plan.summary.total_stories"></div>
                  <div style="font-size:0.7rem;color:#64748b;">Stories</div>
                </div>
                <div>
                  <div style="font-size:1.5rem;font-weight:700;color:#f59e0b;" x-text="plan.summary.critical_path_depth"></div>
                  <div style="font-size:0.7rem;color:#64748b;">Critical Depth</div>
                </div>
                <div>
                  <div style="font-size:1.5rem;font-weight:700;color:#94a3b8;" x-text="plan.summary.estimated_duration"></div>
                  <div style="font-size:0.7rem;color:#64748b;">Est. Duration</div>
                </div>
              </div>
              <div style="display:flex;gap:0.75rem;justify-content:center;margin-top:1rem;">
                <span class="pill pill-critical" x-text="plan.summary.priority_breakdown.critical + ' critical'"></span>
                <span class="pill pill-high" x-text="plan.summary.priority_breakdown.high + ' high'"></span>
                <span class="pill pill-medium" x-text="plan.summary.priority_breakdown.medium + ' medium'"></span>
                <span class="pill pill-low" x-text="plan.summary.priority_breakdown.low + ' low'"></span>
              </div>
            </div>
          </section>

          <!-- Waves -->
          <template x-for="wave in plan.waves">
            <section :id="wave.id" class="wave-section">
              <div style="display:flex;align-items:center;gap:0.75rem;margin-bottom:0.75rem;">
                <h2 style="font-size:1.1rem;margin:0;" x-text="'Wave ' + wave.sequence + ' — ' + wave.name"></h2>
                <span class="enum-tag" x-text="wave.estimated_duration"></span>
              </div>
              <div style="font-size:0.75rem;color:#94a3b8;margin-bottom:1rem;" x-text="wave.theme"></div>

              <!-- Parallel Groups -->
              <template x-for="pg in wave.parallel_groups">
                <div class="pg-block">
                  <div style="display:flex;align-items:center;gap:0.5rem;margin-bottom:0.5rem;">
                    <span class="section-title" x-text="pg.name"></span>
                    <template x-if="pg.blocking"><span class="pill pill-critical">blocking</span></template>
                    <span style="font-size:0.65rem;color:#64748b;" x-text="pg.domain"></span>
                  </div>
                  <div style="font-size:0.7rem;color:#64748b;margin-bottom:0.5rem;">
                    Stories: <template x-for="sid in pg.stories"><span class="enum-tag" style="margin-right:0.25rem;" x-text="sid"></span></template>
                  </div>
                  <!-- Tasks -->
                  <template x-for="task in pg.tasks">
                    <div class="task-item">
                      <div style="display:flex;align-items:center;gap:0.5rem;">
                        <span class="enum-tag" x-text="task.id"></span>
                        <span class="pill pill-effort" x-text="task.effort"></span>
                        <span style="flex:1;" x-text="task.description"></span>
                      </div>
                      <div style="font-size:0.65rem;color:#64748b;margin-top:0.2rem;">
                        <template x-for="fp in task.file_paths"><span style="font-family:monospace;margin-right:0.5rem;" x-text="fp"></span></template>
                      </div>
                    </div>
                  </template>
                </div>
              </template>

              <!-- Demo Checkpoint -->
              <div class="demo-block">
                <div class="section-title" style="margin-bottom:0.25rem;">Demo Checkpoint</div>
                <div style="font-size:0.8rem;margin-bottom:0.5rem;" x-text="wave.demo_checkpoint.description"></div>
                <ul style="list-style:none;padding:0;margin:0;">
                  <template x-for="c in wave.demo_checkpoint.criteria">
                    <li style="font-size:0.75rem;padding:0.15rem 0;color:#6ee7b7;" x-text="'✓ ' + c"></li>
                  </template>
                </ul>
              </div>
            </section>
          </template>

          <!-- Critical Path -->
          <section id="critical-path" style="margin-bottom:2.5rem;">
            <h2 style="font-size:1.25rem;margin-bottom:1rem;">Critical Path</h2>
            <div class="plan-card" style="padding:1rem;">
              <div style="display:flex;flex-wrap:wrap;align-items:center;gap:0.25rem;">
                <template x-for="(cp, idx) in plan.critical_path">
                  <div style="display:flex;align-items:center;gap:0.25rem;">
                    <span class="enum-tag" x-text="cp.story_id"></span>
                    <template x-if="idx < plan.critical_path.length - 1">
                      <span style="color:#64748b;">→</span>
                    </template>
                  </div>
                </template>
              </div>
            </div>
          </section>

          <!-- Parallel Strategy -->
          <section id="parallel-strategy" style="margin-bottom:2.5rem;">
            <h2 style="font-size:1.25rem;margin-bottom:1rem;">Parallel Strategy</h2>
            <div class="plan-card" style="padding:1rem;">
              <div style="font-size:0.8rem;margin-bottom:0.75rem;">
                Max concurrent agents: <strong x-text="plan.parallel_strategy.max_concurrent_agents"></strong>
                · Worktree: <span class="enum-tag" x-text="plan.parallel_strategy.worktree_strategy"></span>
              </div>
              <template x-if="plan.parallel_strategy.file_conflict_rules.length > 0">
                <div>
                  <div class="section-title" style="margin-bottom:0.5rem;">File Conflict Rules</div>
                  <template x-for="rule in plan.parallel_strategy.file_conflict_rules">
                    <div style="font-size:0.75rem;padding:0.25rem 0;border-bottom:1px solid #1e293b;">
                      <span style="font-family:monospace;color:#10b981;" x-text="rule.pattern"></span>
                      <span style="color:#64748b;" x-text="' — ' + rule.reason"></span>
                    </div>
                  </template>
                </div>
              </template>
            </div>
          </section>

          <!-- Risks -->
          <section id="risks" style="margin-bottom:2.5rem;">
            <h2 style="font-size:1.25rem;margin-bottom:1rem;">Risks</h2>
            <div style="display:grid;gap:0.75rem;">
              <template x-for="risk in plan.risks">
                <div class="plan-card risk-card" :class="'risk-' + risk.impact" style="padding:1rem;">
                  <div style="display:flex;align-items:center;gap:0.5rem;margin-bottom:0.5rem;">
                    <span class="enum-tag" x-text="risk.id"></span>
                    <span class="enum-tag" x-text="risk.category"></span>
                    <span class="pill" :class="'pill-' + (risk.impact === 'high' ? 'critical' : risk.impact === 'medium' ? 'high' : 'low')" x-text="'P:' + risk.probability + ' I:' + risk.impact"></span>
                  </div>
                  <div style="font-size:0.8rem;margin-bottom:0.25rem;" x-text="risk.description"></div>
                  <div style="font-size:0.75rem;color:#10b981;" x-text="'Mitigation: ' + risk.mitigation"></div>
                  <div style="font-size:0.7rem;color:#64748b;margin-top:0.25rem;" x-text="'Affects: ' + risk.affected_stories.join(', ')"></div>
                </div>
              </template>
            </div>
          </section>
        </div>
      </template>
    </main>
  </div>

  <script src="/ui/assets/app.js"></script>
  <script>
    function planApp() {
      return {
        plan: null,
        async load() {
          try {
            const res = await fetch('/api/plan');
            if (res.ok) this.plan = await res.json();
          } catch (e) {
            console.error('Failed to load plan:', e);
          }
          loadNav();
        }
      };
    }
  </script>
</body>
</html>
```

- [ ] **Step 2: Verify plan page renders**

Start comment-server with a plan.json fixture in the epic directory. Open `http://localhost:3847/plan`. Confirm waves, parallel groups, tasks, demo checkpoints, critical path, and risks all render.

- [ ] **Step 3: Commit**

```bash
git add skills/kryptonite/scripts/ui/plan.html
git commit -m "feat: add Alpine.js SPA for rendering plan.json"
```

---

## Task 8: Update phase gates and validate-gate.js

**Files:**
- Modify: `skills/kryptonite/scripts/phase-gates/10.json`
- Modify: `skills/kryptonite/scripts/phase-gates/11.json`
- Modify: `skills/kryptonite/scripts/validate-gate.js:97-103`

- [ ] **Step 1: Update Phase 10 gate to accept spec.json OR spec.html**

Replace the Phase 10 gate schema to not enforce spec.html existence (the semantic check handles file detection):

The existing `checkFileExists("spec.html")` call in validate-gate.js (line ~98) needs to become:

```javascript
  if (phase >= 10) {
    if (!fs.existsSync(path.join(dataPath, "spec.json")) && !fs.existsSync(path.join(dataPath, "spec.html"))) {
      errors.push(`SEMANTIC filesystem: neither "spec.json" nor "spec.html" found — one is required`);
    }
    checkFileExists("spec-versions.json");
  }
```

- [ ] **Step 2: Update Phase 11 gate similarly**

Replace line ~101 `checkFileExists("plan.html")` with:

```javascript
  if (phase >= 11) {
    if (!fs.existsSync(path.join(dataPath, "plan.json")) && !fs.existsSync(path.join(dataPath, "plan.html"))) {
      errors.push(`SEMANTIC filesystem: neither "plan.json" nor "plan.html" found — one is required`);
    }
    checkWaveOrder();
  }
```

- [ ] **Step 3: Run existing gate validation on the test project to confirm no regression**

```bash
node skills/kryptonite/scripts/validate-gate.js --phase 11 --data-path skills/kryptonite/data/d440d6e555c5/agendadeck-launch
```

Expected: `PASS: Phase 11 gate passed.` (existing project has plan.html)

- [ ] **Step 4: Commit**

```bash
git add skills/kryptonite/scripts/validate-gate.js skills/kryptonite/scripts/phase-gates/
git commit -m "feat: update phase gates to accept spec.json/plan.json alongside HTML"
```

---

## Task 9: Create test fixtures for validators

**Files:**
- Create: `skills/kryptonite/scripts/test-fixtures/minimal-spec.json`
- Create: `skills/kryptonite/scripts/test-fixtures/minimal-plan.json`

- [ ] **Step 1: Write minimal valid spec fixture**

```json
{
  "version": "1.0.0",
  "generated_at": "2026-05-27T00:00:00Z",
  "epic_slug": "test-epic",
  "overview": {
    "name": "Test Project",
    "description": "A minimal test project for schema validation",
    "goals": ["Validate spec schema works", "Prove semantic checks pass"],
    "non_goals": ["Building a real product"],
    "target_users": ["Developers"]
  },
  "parties": [
    { "id": "developer", "name": "Developer", "description": "The person building the software", "auth": "none", "boundaries": "Full access to codebase" }
  ],
  "repos": [
    { "id": "main-repo", "name": "main-repo", "stack": "Node.js + TypeScript", "path": "/home/dev/project" }
  ],
  "architecture": {
    "components": [
      { "id": "api-server", "name": "ApiServer", "type": "service", "responsibility": "Handles incoming HTTP requests and routes them", "repo": "main-repo", "key_files": ["src/server.ts"] },
      { "id": "data-store", "name": "DataStore", "type": "store", "responsibility": "Persists and retrieves application data", "repo": "main-repo", "key_files": ["src/store.ts"] }
    ],
    "interactions": [
      { "from": "api-server", "to": "data-store", "protocol": "function_call", "description": "Server reads/writes data through store interface", "async": false }
    ],
    "decisions": [
      {
        "id": "ADR-001",
        "title": "Use file-based storage over database",
        "status": "accepted",
        "context": "Simple project with low data volume, no concurrent writes",
        "choice": "JSON file storage with atomic writes",
        "alternatives": [{ "option": "SQLite", "rejected_because": "Adds dependency for simple key-value needs" }],
        "consequences": ["No concurrent write safety", "Simpler deployment"]
      }
    ]
  },
  "data_model": {
    "entities": [
      {
        "id": "Item",
        "description": "A single work item tracked by the system",
        "fields": [
          { "name": "id", "type": "string", "constraints": ["required", "unique"] },
          { "name": "title", "type": "string", "constraints": ["required"] },
          { "name": "status", "type": "enum", "constraints": ["required"], "enum_values": ["open", "closed"] }
        ],
        "relationships": []
      }
    ]
  },
  "api_boundaries": [
    {
      "id": "http-api",
      "name": "HTTP REST API",
      "type": "rest",
      "direction": "inbound",
      "endpoints": [
        {
          "id": "get-items",
          "method": "GET",
          "path": "/items",
          "description": "List all items in the system",
          "auth": "none",
          "response_shape": { "fields": [{ "name": "items", "type": "array" }] },
          "error_cases": []
        }
      ]
    }
  ],
  "nfrs": [
    { "id": "NFR-001", "category": "performance", "requirement": "API responses must return within 100ms under normal load", "metric": "p99_latency_ms", "target": 100, "measurement_method": "Load test with k6" }
  ],
  "technical_constraints": [
    { "id": "TC-001", "category": "platform", "constraint": "Must run on Node.js 20+ without native dependencies", "impact": "Cannot use native SQLite bindings", "source": "Deployment environment" }
  ],
  "design_direction": {
    "locked": false,
    "style_summary": "Minimal CLI tool, no visual UI needed",
    "color_system": { "primary": "#10b981", "secondary": "#3b82f6", "surface": "#1e293b", "text": "#e2e8f0" },
    "typography": "monospace",
    "approved_mock_ids": []
  },
  "stories": [
    {
      "id": "US-001",
      "type": "feature",
      "party": "developer",
      "repo": "main-repo",
      "statement": { "as_a": "developer", "i_want": "to list all items via CLI", "so_that": "I can see what work exists" },
      "acceptance_criteria": ["Running 'list' shows all items with their status"],
      "definition_of_done": [
        { "description": "CLI list command returns all items", "validation": { "method": "test_suite", "command": "npm test -- --grep US-001", "expect": "PASS" } }
      ],
      "priority": "critical",
      "dependencies": [],
      "estimated_complexity": "simple"
    }
  ],
  "spike_findings": [],
  "open_questions": []
}
```

- [ ] **Step 2: Write minimal valid plan fixture**

```json
{
  "version": "1.0.0",
  "generated_at": "2026-05-27T00:00:00Z",
  "epic_slug": "test-epic",
  "spec_version": "1.0.0",
  "summary": {
    "total_stories": 1,
    "total_waves": 1,
    "critical_path_depth": 1,
    "priority_breakdown": { "critical": 1, "high": 0, "medium": 0, "low": 0 },
    "estimated_duration": "1 day"
  },
  "waves": [
    {
      "id": "wave-0",
      "name": "Foundation",
      "sequence": 0,
      "theme": "Set up the basic project structure and implement core feature",
      "estimated_duration": "1 day",
      "prerequisites": [],
      "parallel_groups": [
        {
          "id": "wave-0/core",
          "name": "core",
          "domain": "src/ — main application logic",
          "blocking": false,
          "stories": ["US-001"],
          "tasks": [
            {
              "id": "T-001",
              "story_ref": "US-001",
              "description": "Implement list command that reads items from store",
              "file_paths": ["src/commands/list.ts", "src/store.ts"],
              "commands": ["npm test"],
              "effort": "S",
              "depends_on": []
            }
          ]
        }
      ],
      "demo_checkpoint": {
        "description": "Running the CLI list command shows items from the data file",
        "validates": ["US-001"],
        "criteria": ["CLI outputs item list in expected format", "Empty state shows helpful message"]
      },
      "post_wave_validation": [
        { "check": "Tests pass", "command": "npm test", "expect": "exit 0" }
      ]
    }
  ],
  "critical_path": [
    { "story_id": "US-001", "wave": "wave-0", "reason": "Only story — is the critical path by definition" }
  ],
  "parallel_strategy": {
    "max_concurrent_agents": 1,
    "file_conflict_rules": [],
    "worktree_strategy": "per_parallel_group"
  },
  "risks": [
    {
      "id": "RISK-001",
      "category": "complexity",
      "description": "File locking on concurrent access could corrupt data store",
      "probability": "low",
      "impact": "medium",
      "mitigation": "Use atomic write pattern (write to tmp, rename) — already standard in the project",
      "affected_stories": ["US-001"]
    }
  ]
}
```

- [ ] **Step 3: Run both validators against fixtures**

```bash
node skills/kryptonite/scripts/validate-spec.js skills/kryptonite/scripts/test-fixtures/minimal-spec.json
node skills/kryptonite/scripts/validate-plan.js skills/kryptonite/scripts/test-fixtures/minimal-plan.json skills/kryptonite/scripts/test-fixtures/minimal-spec.json
```

Expected: Both output `"valid": true` and exit 0.

- [ ] **Step 4: Commit**

```bash
git add skills/kryptonite/scripts/test-fixtures/
git commit -m "test: add minimal spec/plan fixtures for validator testing"
```

---

## Task 10: Integration test — end-to-end validation flow

**Files:**
- No new files. Testing the full pipeline.

- [ ] **Step 1: Test spec validation catches schema error**

Create a temp file with `overview.goals` as an empty array (violates `minItems: 2`). Run validate-spec.js. Confirm exit 1 with schema error pointing to `$.overview.goals`.

- [ ] **Step 2: Test spec validation catches semantic error**

Modify the minimal-spec fixture copy to add a component with `"repo": "nonexistent"`. Run validate-spec.js. Confirm exit 1 with `repo_reference` semantic error.

- [ ] **Step 3: Test plan validation catches story coverage gap**

Remove `US-001` from the plan's parallel_groups.stories while keeping it in the spec. Run validate-plan.js. Confirm exit 1 with `story_coverage` error.

- [ ] **Step 4: Test plan validation catches file conflict**

Add a second parallel group in wave-0 with a task that touches `src/store.ts` (same as the first group). Run validate-plan.js. Confirm exit 1 with `file_conflict` error.

- [ ] **Step 5: Verify comment-server serves JSON API**

Start the server pointing at the test fixtures directory, hit `/api/spec` with curl, confirm valid JSON response.

```bash
# In test epic dir with spec.json present:
curl -s http://localhost:3847/api/spec | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf-8')); console.log('OK:', d.overview.name)"
```

Expected: `OK: Test Project`

- [ ] **Step 6: All tests pass — commit any test helpers or notes**

No code to commit unless fixtures were modified during debugging. This is a verification-only step.
