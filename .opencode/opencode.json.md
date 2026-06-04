# OpenCode — Setup & Reproducibility Reference

> **Key syntax difference from Claude Code:**  
> OpenCode: `{env:ZAI_API_KEY}` · Claude Code (`settings.json`): `${ZAI_API_KEY}`  
> Mixing them up silently fails — the key is never substituted.

---

## Reproduce on a New Machine

### 1. Shell profile (`~/.zshrc` or `~/.bashrc`)

```sh
export ZAI_API_KEY="<your-z-ai-api-key>"
export DEEPSEEK_API_KEY="<your-deepseek-api-key>"
```

### 2. Install OpenCode

```sh
npm install -g opencode-ai
# or
bunx opencode-ai@latest
```

### 3. Global config — `~/.config/opencode/opencode.json`

Put provider credentials and personal preferences here (not tracked in git):

```json
{
  "$schema": "https://opencode.ai/config.json",
  "provider": {
    "my-zai": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "MY-Z.AI",
      "options": {
        "baseURL": "https://api.z.ai/api/coding/paas/v4",
        "apiKey": "{env:ZAI_API_KEY}"
      },
      "models": {
        "glm-5.1":    { "name": "GLM-5.1",    "limit": { "context": 200000,  "output": 131072 } },
        "glm-4.7":    { "name": "GLM-4.7",    "limit": { "context": 200000,  "output": 131072 } },
        "glm-4.5-air":{ "name": "GLM-4.5-Air","limit": { "context": 131072,  "output": 16384  } }
      }
    },
    "my-ds": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "My-DeepSeek",
      "options": {
        "baseURL": "https://api.deepseek.com",
        "apiKey": "{env:DEEPSEEK_API_KEY}",
        "timeout": 600000,
        "setCacheKey": true
      },
      "models": {
        "deepseek-v4-pro":  { "name": "DeepSeek-V4-Pro",  "limit": { "context": 1048576, "output": 393216 } },
        "deepseek-v4-flash":{ "name": "DeepSeek-V4-Flash","limit": { "context": 1048576, "output": 393216 } }
      }
    }
  },
  "mcp": {
    "web-search-prime": {
      "type": "remote",
      "url": "https://api.z.ai/api/mcp/web_search_prime/mcp",
      "headers": { "Authorization": "Bearer {env:ZAI_API_KEY}" }
    },
    "web-reader": {
      "type": "remote",
      "url": "https://api.z.ai/api/mcp/web_reader/mcp",
      "headers": { "Authorization": "Bearer {env:ZAI_API_KEY}" }
    },
    "zread": {
      "type": "remote",
      "url": "https://api.z.ai/api/mcp/zread/mcp",
      "headers": { "Authorization": "Bearer {env:ZAI_API_KEY}" }
    },
    "zai-mcp-server": {
      "type": "local",
      "command": ["bunx", "-y", "@z_ai/mcp-server"],
      "environment": {
        "ZAI_API_KEY": "{env:ZAI_API_KEY}",
        "Z_AI_MODE": "ZAI"
      }
    }
  }
}
```

> Provider + MCP belong in global config so they're available to all projects without being checked into git.

### 4. Project config — `.opencode/opencode.json`

Already tracked in git (`dev_game` repo). Contains agents, permissions, and instructions.  
After cloning: no extra steps — providers are resolved from global config.

### 5. TUI keybinds — `.opencode/tui.json`

Also tracked in git. Current content:

```json
{
  "$schema": "https://opencode.ai/tui.json",
  "keybinds": {
    "command_list": "ctrl+]"
  }
}
```

### 6. Verify setup

```sh
opencode models          # should list my-zai and my-ds models
opencode mcp list        # should list web-search-prime, web-reader, zread, zai-mcp-server
opencode run "hello"     # smoke test with default agent
```

### 7. E2E smoke test

Automated script that checks env vars, provider round-trips, MCP connectivity, and agent loading:

```sh
./scripts/opencode-smoke-test.sh                # all checks
./scripts/opencode-smoke-test.sh --provider my-zai  # provider only
./scripts/opencode-smoke-test.sh --mcp           # MCP only
./scripts/opencode-smoke-test.sh --agent build-my-zai  # single agent
./scripts/opencode-smoke-test.sh --verbose       # debug output
```

Sample output:
```
=== Environment Variables ===
  [PASS] ZAI_API_KEY is set
  [PASS] DEEPSEEK_API_KEY is set

=== Provider: my-zai (my-zai/glm-5.1) ===
  [PASS] provider:my-zai (my-zai/glm-5.1) round-trip OK

=== Provider: my-ds (my-ds/deepseek-v4-pro) ===
  [PASS] provider:my-ds (my-ds/deepseek-v4-pro) round-trip OK

=== Remote MCP Servers ===
  [PASS] mcp:web_search_prime reachable
  [PASS] mcp:web_reader reachable
  [PASS] mcp:zread reachable

=== Local MCP Servers ===
  [PASS] mcp:zai-mcp-server starts via bunx

=== Agent: build-my-zai ===
  [PASS] agent:build-my-zai responds

=== Summary ===
12/12 checks passed

All checks passed.
```

---

## 1. Config File Locations & Precedence

Config sources are loaded in this order (later overrides earlier):

| Priority | Location | Purpose |
|----------|----------|---------|
| 1 (lowest) | Remote `.well-known/opencode` | Org defaults |
| 2 | `~/.config/opencode/opencode.json` | Global user prefs |
| 3 | `OPENCODE_CONFIG` env var | Custom file path |
| 4 | `./opencode.json` (project root) | Project-specific |
| 5 | `./.opencode/opencode.json` | Project .opencode dir |
| 6 | `OPENCODE_CONFIG_CONTENT` env var | Inline JSON override |
| 7 (highest) | Managed config (enterprise) | Admin-enforced |

**Best practice:**
- Global (`~/.config/opencode/opencode.json`): providers, themes, keybinds
- Project (`./.opencode/opencode.json`): agents, models, permissions specific to the project

---

## 2. Provider Configuration

### Use OpenAI-compatible when possible
Most providers support OpenAI-compatible endpoints. Keep it simple.

```json
{
  "provider": {
    "my-zai": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "MY-Z.AI",
      "options": {
        "baseURL": "https://api.z.ai/api/coding/paas/v4",
        "apiKey": "{env:ZAI_API_KEY}"
      },
      "models": {
        "glm-5.1": { "name": "GLM-5.1" },
        "glm-4.7": { "name": "GLM-4.7" },
        "glm-4.5-air": { "name": "GLM-4.5-Air" }
      }
    },
    "my-ds": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "My-DeepSeek",
      "options": {
        "baseURL": "https://api.deepseek.com",
        "apiKey": "{env:DEEPSEEK_API_KEY}",
        "timeout": 600000,
        "setCacheKey": true
      },
      "models": {
        "deepseek-v4-pro": {
          "name": "DeepSeek-V4-Pro",
          "limit": { "context": 1048576, "output": 262144 }
        },
        "deepseek-v4-flash": {
          "name": "DeepSeek-V4-Flash",
          "limit": { "context": 1048576, "output": 262144 }
        }
      }
    }
  }
}
```

### API Key Security
- **Always** use `{env:VAR_NAME}` syntax — never hardcode keys
- Alternative: `{file:~/.secrets/my-key}` for file-based secrets

### Provider Options
```json
{
  "provider": {
    "my-ds": {
      "options": {
        "timeout": 600000,
        "setCacheKey": true
      }
    }
  }
}
```
- `timeout`: Request timeout in ms (default: 300000 = 5min). `false` to disable
- `setCacheKey`: Enable prompt caching for Anthropic/DeepSeek
- `chunkTimeout`: Timeout between streamed chunks

---

## 3. Agent Configuration

### default_agent
Set which primary agent loads on startup. Falls back to `build` if not set.

```json
{
  "default_agent": "build"
}
```

### Multi-provider Agent Strategy
Define agents per provider for flexibility. Use `mode` to control visibility.

```json
{
  "agent": {
    "build-my-zai": {
      "mode": "primary",
      "model": "my-zai/glm-5.1",
      "description": "GLM main coding agent"
    },
    "plan-my-zai": {
      "mode": "primary",
      "model": "my-zai/glm-4.7",
      "description": "GLM planning and analysis",
      "permission": {
        "edit": "deny",
        "bash": "deny"
      }
    },
    "explore-my-zai": {
      "mode": "subagent",
      "model": "my-zai/glm-4.5-air",
      "description": "GLM fast codebase exploration"
    },
    "build-my-ds": {
      "mode": "all",
      "model": "my-ds/deepseek-v4-pro",
      "description": "My-DeepSeek V4 Pro coding agent"
    },
    "explore-my-ds": {
      "mode": "subagent",
      "model": "my-ds/deepseek-v4-flash",
      "description": "DeepSeek V4 Flash exploration"
    }
  }
}
```

### Agent Modes
- `"primary"`: Main agent you interact with (Tab to switch)
- `"subagent"`: Invoked via `@mention` or auto-delegated by primary
- `"all"`: Can be used as both

### Agent `prompt` Field
Load external prompt files to define agent behavior:

```json
{
  "agent": {
    "office-router": {
      "mode": "primary",
      "model": "zai-coding-plan/glm-5.1",
      "prompt": "{file:./agents/office-router.md}",
      "description": "辦公室智能路由",
      "permission": {
        "edit": "deny",
        "bash": "deny",
        "task": {
          "*": "deny",
          "office-ops": "allow",
          "business-reg": "allow"
        }
      }
    }
  }
}
```

The `prompt` field supports `{file:./relative/path}` — resolved relative to the config file location.

### Permissions per Agent
```json
{
  "agent": {
    "plan": {
      "permission": {
        "edit": "deny",
        "bash": "deny"
      }
    },
    "build": {
      "permission": {
        "edit": "allow",
        "bash": "allow",
        "task": {
          "*": "allow"
        }
      }
    }
  }
}
```

Permission values:
- `"allow"`: Always allowed
- `"ask"`: Prompt for approval
- `"deny"`: Completely blocked

Fine-grained `task` permissions:
```json
{
  "permission": {
    "task": {
      "*": "deny",
      "office-ops": "allow",
      "business-reg": "allow"
    }
  }
}
```
This restricts which subagents a primary agent can delegate to.

Fine-grained bash permissions (global):
```json
{
  "permission": {
    "bash": {
      "*": "ask",
      "cargo*": "allow",
      "git*": "allow"
    }
  }
}
```

**Rules are evaluated in order, last matching rule wins.**

---

## 4. Default Model & Small Model

```json
{
  "model": "my-zai/glm-5.1",
  "small_model": "my-zai/glm-4.5-air"
}
```
- `model`: Default model for agents that don't specify their own
- `small_model`: For lightweight tasks (title generation, summaries). Cheaper/faster.

---

## 5. Instructions

Load project-level instructions (like AGENTS.md) for all agents:

```json
{
  "instructions": ["AGENTS.md"]
}
```

---

## 6. Global Permissions

```json
{
  "permission": {
    "edit": "ask",
    "bash": {
      "*": "ask",
      "cargo*": "allow",
      "git*": "allow"
    }
  }
}
```

Common permission keys: `read`, `edit`, `glob`, `grep`, `list`, `bash`, `task`, `webfetch`, `websearch`, `skill`, `lsp`, `todowrite`, `question`, `external_directory`

---

## 7. MCP Servers

```json
{
  "mcp": {
    "web-search-prime": {
      "type": "remote",
      "url": "https://api.z.ai/api/mcp/web_search_prime/mcp",
      "headers": {
        "Authorization": "Bearer {env:ZAI_API_KEY}"
      }
    },
    "web-reader": {
      "type": "remote",
      "url": "https://api.z.ai/api/mcp/web_reader/mcp",
      "headers": {
        "Authorization": "Bearer {env:ZAI_API_KEY}"
      }
    },
    "zread": {
      "type": "remote",
      "url": "https://api.z.ai/api/mcp/zread/mcp",
      "headers": {
        "Authorization": "Bearer {env:ZAI_API_KEY}"
      }
    },
    "zai-mcp-server": {
      "type": "local",
      "command": ["bunx", "-y", "@z_ai/mcp-server"],
      "environment": {
        "ZAI_API_KEY": "{env:ZAI_API_KEY}",
        "Z_AI_MODE": "ZAI"
      }
    }
  }
}
```

- `"type": "remote"`: Connect to a remote MCP server via URL. Supports `headers` with variable substitution.
- `"type": "local"`: Spawn a local process. Use `command` (array) and `environment` for config.

> **Note:** OpenCode uses `{env:ZAI_API_KEY}` for variable substitution. Claude Code (`settings.json`) uses `${ZAI_API_KEY}` — see `scripts/claude-origin.README.md`.

---

## 8. Autoupdate

```json
{
  "autoupdate": true
}
```
- `true`: Auto-update on start
- `"notify"`: Notify but don't auto-update
- `false`: Disable updates

---

## 9. Snapshot (Git Backup)

```json
{
  "snapshot": true
}
```
When enabled, OpenCode creates git snapshots before making changes. Set `false` to disable.

---

## 10. Share

```json
{
  "share": "manual"
}
```
- `"manual"`: Only shared via `/share` command
- `"auto"`: Auto-share sessions
- `"disabled"`: Never share

---

## 11. Enabled/Disabled Providers

```json
{
  "enabled_providers": ["my-zai", "my-ds"],
  "disabled_providers": ["openai", "anthropic"]
}
```
Use to limit which providers are loaded, reducing startup time.

---

## 12. Variable Substitution

> **Syntax difference:** OpenCode uses `{env:VAR}` / `{file:path}`.  
> Claude Code `settings.json` uses `${VAR}`. Never mix them — both fail silently.

```json
{
  "model": "{env:OPENCODE_MODEL}",
  "provider": {
    "openai": {
      "options": {
        "apiKey": "{env:OPENAI_API_KEY}"
      }
    }
  },
  "agent": {
    "my-agent": {
      "prompt": "{file:./agents/my-agent.md}"
    }
  },
  "mcp": {
    "my-server": {
      "headers": {
        "Authorization": "Bearer {env:MY_API_KEY}"
      }
    }
  }
}
```
- `{env:VAR}`: Environment variable
- `{file:path}`: File contents
- `{file:./agents/prompt.md}`: Relative to config file location

---

## 13. Complete Example

```json
{
  "$schema": "https://opencode.ai/config.json",
  "default_agent": "build",
  "provider": {
    "my-zai": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "MY-Z.AI",
      "options": {
        "baseURL": "https://api.z.ai/api/coding/paas/v4",
        "apiKey": "{env:ZAI_API_KEY}"
      },
      "models": {
        "glm-5.1": { "name": "GLM-5.1" },
        "glm-4.7": { "name": "GLM-4.7" },
        "glm-4.5-air": { "name": "GLM-4.5-Air" }
      }
    },
    "my-ds": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "My-DeepSeek",
      "options": {
        "baseURL": "https://api.deepseek.com",
        "apiKey": "{env:DEEPSEEK_API_KEY}",
        "timeout": 600000,
        "setCacheKey": true
      },
      "models": {
        "deepseek-v4-pro": {
          "name": "DeepSeek-V4-Pro",
          "limit": { "context": 1048576, "output": 262144 }
        },
        "deepseek-v4-flash": {
          "name": "DeepSeek-V4-Flash",
          "limit": { "context": 1048576, "output": 262144 }
        }
      }
    }
  },
  "agent": {
    "build-my-zai": {
      "mode": "primary",
      "model": "my-zai/glm-5.1",
      "description": "GLM main coding agent"
    },
    "plan-my-zai": {
      "mode": "primary",
      "model": "my-zai/glm-4.7",
      "description": "GLM planning and analysis",
      "permission": {
        "edit": "deny",
        "bash": "deny"
      }
    },
    "explore-my-zai": {
      "mode": "subagent",
      "model": "my-zai/glm-4.5-air",
      "description": "GLM fast codebase exploration"
    },
    "build-my-ds": {
      "mode": "all",
      "model": "my-ds/deepseek-v4-pro",
      "description": "My-DeepSeek V4 Pro coding agent"
    },
    "plan-my-ds": {
      "mode": "primary",
      "model": "my-ds/deepseek-v4-pro",
      "description": "My-DeepSeek V4 Pro planning and analysis",
      "permission": {
        "edit": "deny",
        "bash": "deny"
      }
    },
    "explore-my-ds": {
      "mode": "subagent",
      "model": "my-ds/deepseek-v4-flash",
      "description": "DeepSeek V4 Flash exploration"
    },
    "office-router": {
      "mode": "primary",
      "model": "zai-coding-plan/glm-5.1",
      "prompt": "{file:./agents/office-router.md}",
      "description": "辦公室智能路由 - 判斷訊息應交給哪個專員，直接轉發",
      "permission": {
        "edit": "deny",
        "bash": "deny",
        "task": {
          "*": "deny",
          "office-ops": "allow",
          "business-reg": "allow",
          "mail-manager": "allow",
          "meeting-room": "allow",
          "contract-mgr": "allow"
        }
      }
    },
    "reviewer-zai": {
      "mode": "primary",
      "model": "zai-coding-plan/glm-5.1",
      "description": "Code reviewer using ZAI GLM-5.1",
      "permission": {
        "edit": "ask",
        "bash": "ask"
      }
    },
    "explore": {
      "mode": "primary",
      "model": "zai-coding-plan/glm-4.5-air",
      "description": "Fast codebase explorer",
      "permission": {
        "edit": "deny",
        "bash": "allow"
      }
    },
    "build": {
      "mode": "primary",
      "model": "zai-coding-plan/glm-5.1",
      "description": "Full-permission build agent",
      "permission": {
        "edit": "allow",
        "bash": "allow",
        "task": { "*": "allow" }
      }
    },
    "plan": {
      "mode": "primary",
      "model": "zai-coding-plan/glm-5.1",
      "description": "Full-permission plan agent",
      "permission": {
        "edit": "allow",
        "bash": "allow",
        "task": { "*": "allow" }
      }
    }
  },
  "mcp": {
    "web-search-prime": {
      "type": "remote",
      "url": "https://api.z.ai/api/mcp/web_search_prime/mcp",
      "headers": {
        "Authorization": "Bearer {env:ZAI_API_KEY}"
      }
    },
    "web-reader": {
      "type": "remote",
      "url": "https://api.z.ai/api/mcp/web_reader/mcp",
      "headers": {
        "Authorization": "Bearer {env:ZAI_API_KEY}"
      }
    },
    "zread": {
      "type": "remote",
      "url": "https://api.z.ai/api/mcp/zread/mcp",
      "headers": {
        "Authorization": "Bearer {env:ZAI_API_KEY}"
      }
    },
    "zai-mcp-server": {
      "type": "local",
      "command": ["bunx", "-y", "@z_ai/mcp-server"],
      "environment": {
        "ZAI_API_KEY": "{env:ZAI_API_KEY}",
        "Z_AI_MODE": "ZAI"
      }
    }
  },
  "instructions": ["AGENTS.md"],
  "permission": {
    "bash": {
      "*": "ask",
      "cargo*": "allow",
      "git*": "allow"
    }
  }
}
```

---

## 14. TUI Keybinds — `tui.json`

Stored alongside `opencode.json` (project-tracked). Schema: `https://opencode.ai/tui.json`.

```json
{
  "$schema": "https://opencode.ai/tui.json",
  "keybinds": {
    "command_list": "ctrl+]"
  }
}
```

Common keybind keys: `command_list`, `submit`, `newline`, `cancel`, `history_prev`, `history_next`, `model_list`, `agent_list`.

---

## 15. Quick Commands

| Command | Purpose |
|---------|---------|
| `opencode models` | List available models |
| `opencode models --refresh` | Refresh model cache |
| `opencode auth login` | Add provider credentials |
| `opencode auth list` | List saved credentials |
| `opencode agent create` | Create new agent interactively |
| `opencode agent list` | List configured agents |
| `opencode mcp add` | Add MCP server |
| `opencode run "prompt"` | Non-interactive execution |

---

## 16. Best Practices Summary

1. **Never hardcode API keys** — use `{env:VAR}` or `{file:path}`
2. **Global config** for providers, themes, keybinds; **Project config** for agents, permissions
3. **Multi-provider agents** with descriptive names (e.g., `build-my-zai`, `build-my-ds`)
4. **Use `default_agent`** to control startup agent
5. **External prompt files** via `prompt: "{file:./agents/...}"` for complex agent behaviors
6. **Use `enabled_providers`** to limit loaded providers for faster startup
7. **Set `small_model`** to save costs on title/summary generation
8. **Fine-grained `task` permissions** to control which subagents a router can delegate to
9. **Keep configs in git** for project sharing (except secrets)
10. **Validate with schema** — `$schema` field enables IDE autocomplete
11. **Test with `opencode`** after each config change
