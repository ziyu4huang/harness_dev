# hello_bun v0.23.0 — Agentic Chat AI UX Overhaul

## Summary

Transform Chat AI from a basic page-replacing Q&A bubble into a **persistent slide-right agent panel** with tool result visualization, incremental DOM rendering, multi-turn sessions, and polished UX.

## Implementation Plan (5 files changed + 1 CSS file)

### 1. `src/frontend/layout.html` — Add Chat Panel Div

Add after `.main` div, inside `.content`:

```html
<!-- Chat Panel -->
<div class="chat-panel" id="chat-panel">
  <div class="chat-panel-header">
    <span class="chat-panel-title">AI Agent</span>
    <div class="chat-panel-header-actions">
      <select id="chat-model">...</select>
      <button id="chat-clear" title="Clear">Clear</button>
      <button id="chat-close" onclick="toggleChatPanel()">&times;</button>
    </div>
  </div>
  <div id="chat-auth-row" style="display:none">...</div>
  <div class="chat-msgs" id="chat-msgs">
    <!-- Empty state with suggested chips -->
  </div>
  <div class="chat-input-row">
    <textarea id="chat-input" ...></textarea>
    <button id="chat-send">Send</button>
    <button id="chat-stop" style="display:none">Stop</button>
  </div>
</div>
```

Sidebar nav change: `showChatPage()` → `toggleChatPanel()`

### 2. `src/frontend/styles/components.css` — Chat Panel Styles

Replace all chat CSS (lines 49–76) with:

```css
/* --- chat panel --- */
.chat-panel {
  width: 400px; min-width: 320px; display: none; flex-direction: column;
  border-left: 1px solid var(--border-0); background: var(--bg-0);
  overflow: hidden;
}
.chat-panel.open { display: flex; }

.chat-panel-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 8px 12px; border-bottom: 1px solid var(--border-0);
  background: var(--bg-1); gap: 8px;
}
.chat-panel-title { font-size: 13px; font-weight: 700; color: var(--accent); white-space: nowrap; }
.chat-panel-header-actions { display: flex; align-items: center; gap: 6px; }
.chat-model-select {
  padding: 3px 6px; border: 1px solid var(--border-0); border-radius: 4px;
  font-size: 11px; background: var(--bg-0); color: var(--text-1); max-width: 120px;
}
.chat-header-btn {
  padding: 3px 8px; border: 1px solid var(--border-0); border-radius: 4px;
  font-size: 11px; background: var(--bg-0); color: var(--text-3); cursor: pointer;
}
.chat-header-btn:hover { background: var(--bg-2); }
.chat-close-btn { font-size: 14px; padding: 2px 6px; border: none; background: none; }
.chat-close-btn:hover { color: var(--danger); }

.chat-auth-row {
  display: flex; gap: 6px; padding: 6px 12px; border-bottom: 1px solid var(--border-0);
  background: var(--bg-1);
}
.chat-token-input {
  flex: 1; padding: 3px 8px; border: 1px solid var(--border-0); border-radius: 4px;
  font-size: 11px; background: var(--bg-0); color: var(--text-1);
}

.chat-msgs {
  flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 8px;
  padding: 12px;
}

/* empty state */
.chat-empty { text-align: center; padding: 40px 20px; }
.chat-empty-icon { font-size: 40px; margin-bottom: 12px; opacity: 0.6; }
.chat-empty-text { font-size: 12px; color: var(--text-4); margin-bottom: 20px; }

.chat-suggestions { display: flex; flex-direction: column; gap: 8px; align-items: center; }
.chat-chip {
  padding: 8px 16px; border: 1px solid var(--border-0); border-radius: 8px;
  font-size: 12px; background: var(--bg-1); color: var(--text-2); cursor: pointer;
  text-align: left; width: 100%; max-width: 300px; transition: border-color 0.15s, background 0.15s;
}
.chat-chip:hover { border-color: var(--accent); background: var(--accent-hover); }
.chat-chip-icon { margin-right: 6px; }

/* message bubbles */
.chat-msg { max-width: 90%; padding: 10px 14px; border-radius: 12px; font-size: 13px; line-height: 1.5; word-wrap: break-word; }
.chat-msg.user { align-self: flex-end; background: var(--accent); color: #fff; border-bottom-right-radius: 4px; }
.chat-msg.assistant { align-self: flex-start; background: var(--bg-1); border: 1px solid var(--border-0); border-bottom-left-radius: 4px; }
.chat-msg-header { display: flex; align-items: center; gap: 6px; margin-bottom: 6px; }
.chat-msg-role { font-size: 11px; font-weight: 600; color: var(--text-4); }
.chat-msg-time { font-size: 10px; color: var(--text-4); margin-left: auto; }
.chat-msg-content { color: var(--text-1); }
.chat-msg-content p { margin-bottom: 6px; }
.chat-msg-content code { background: var(--bg-2); padding: 1px 4px; border-radius: 3px; font-size: 12px; }
.chat-msg-content pre {
  background: var(--bg-code); color: var(--text-code); padding: 10px; border-radius: 6px;
  font-size: 12px; line-height: 1.5; overflow-x: auto; margin: 6px 0; position: relative;
}
.chat-msg-content pre .copy-btn {
  position: absolute; top: 4px; right: 4px; padding: 2px 6px; border: 1px solid var(--border-1);
  border-radius: 3px; font-size: 10px; background: var(--bg-2); color: var(--text-3); cursor: pointer;
}
.chat-msg-content pre .copy-btn:hover { background: var(--bg-0); color: var(--text-1); }

/* thinking */
.chat-thinking { margin: 4px 0; font-size: 11px; color: var(--text-4); }
.chat-thinking summary { cursor: pointer; font-style: italic; }
.chat-thinking-body {
  margin-top: 4px; padding: 8px; background: var(--bg-2); border-radius: 4px;
  font-family: monospace; font-size: 11px; max-height: 160px; overflow-y: auto; white-space: pre-wrap;
}

/* tool cards */
.chat-tool { border: 1px solid var(--border-0); border-radius: 6px; margin: 6px 0; font-size: 12px; overflow: hidden; }
.chat-tool-header { display: flex; align-items: center; gap: 6px; padding: 6px 10px; background: var(--bg-1); cursor: pointer; }
.chat-tool-header:hover { background: var(--bg-2); }
.chat-tool-icon { font-size: 12px; width: 16px; text-align: center; }
.chat-tool-icon.running { color: var(--accent); }
.chat-tool-icon.done { color: var(--success); }
.chat-tool-icon.error { color: var(--danger); }
.chat-tool-name { font-weight: 600; color: var(--text-2); }
.chat-tool-status { font-size: 10px; margin-left: auto; }
.chat-tool-status.running { color: var(--accent); }
.chat-tool-status.done { color: var(--success); }
.chat-tool-status.error { color: var(--danger); }
.chat-tool-body { padding: 8px 10px; border-top: 1px solid var(--border-0); display: none; }
.chat-tool.open .chat-tool-body { display: block; }
.chat-tool-args { font-family: monospace; font-size: 11px; color: var(--text-3); white-space: pre-wrap; margin-bottom: 6px; }
.chat-tool-result {
  font-family: monospace; font-size: 11px; color: var(--text-2); white-space: pre-wrap;
  max-height: 200px; overflow-y: auto; background: var(--bg-code); color: var(--text-code);
  padding: 8px; border-radius: 4px;
}
.chat-tool-result.error { color: var(--danger); background: var(--danger-hover); }

/* streaming indicator */
.chat-streaming { display: flex; align-items: center; gap: 4px; padding: 4px 0; }
.chat-streaming-dot {
  width: 6px; height: 6px; border-radius: 50%; background: var(--accent);
  animation: chat-bounce 1.4s infinite ease-in-out both;
}
.chat-streaming-dot:nth-child(1) { animation-delay: -0.32s; }
.chat-streaming-dot:nth-child(2) { animation-delay: -0.16s; }
@keyframes chat-bounce {
  0%, 80%, 100% { transform: scale(0); }
  40% { transform: scale(1); }
}

/* input row */
.chat-input-row { display: flex; gap: 6px; padding: 8px 12px; border-top: 1px solid var(--border-0); background: var(--bg-1); }
.chat-input-row textarea {
  flex: 1; padding: 8px 12px; border: 1px solid var(--border-0); border-radius: 8px;
  font-size: 13px; resize: none; font-family: inherit; background: var(--bg-0); color: var(--text-1);
  min-height: 38px; max-height: 120px;
}
.chat-input-row textarea:focus { outline: none; border-color: var(--accent); }
.chat-btn { padding: 8px 16px; border: none; border-radius: 8px; font-size: 13px; cursor: pointer; font-weight: 600; }
.chat-btn.send { background: var(--accent); color: #fff; }
.chat-btn.send:hover { background: var(--accent-dark); }
.chat-btn.stop { background: var(--danger); color: #fff; }
.chat-btn.stop:hover { background: var(--danger-dark); }
```

### 3. `src/frontend/styles/layout.css` — Content Grid

When chat panel is open, main content shrinks. Add at end:
```css
/* When chat panel is open, adjust main area */
.content.has-chat .main { flex: 1; }
```

### 4. `src/frontend/modules/chat.ts` — Complete Rewrite (235→~320 lines)

Key architecture changes:

**From page-replacing to panel:**
- Remove `showChatPage()` (replaces viewer)
- Add `toggleChatPanel()` — toggles `#chat-panel` visibility, adds `.has-chat` to `.content`
- `wireChat()` runs once on init, not per-page-show

**Incremental DOM rendering (anti-jank):**
- `appendMessage(msg)` — inserts new message node once, returns DOM ref
- `updateMessage(msg, el)` — mutates only the streaming message's DOM
- `addToolCard(msg, tool)` — inserts tool card into message, returns ref
- `updateToolCard(card, status)` — updates tool card status/results
- **Never** calls `innerHTML` rebuild on streaming messages

**Tool result visualization:**
- Tool cards show: name, status (running/done/error), args (collapsible), result (collapsible)
- Results displayed in monospace code block, truncated to 2000 chars with "Show all" toggle
- Streaming indicator dots during tool execution

**New UX features:**
- Suggested chips in empty state (click → fills input + auto-sends)
- Copy button on code blocks in assistant messages
- Timestamps on messages (relative: "just now", "2m ago")
- Auto-scroll to bottom on new content
- Auth token input in panel header (shown when `requiresAuth`)
- Keyboard: Ctrl+Enter to send, Shift+Enter for newline

### 5. `src/agent/serialize.ts` — Include Tool Results

```typescript
if (event.type === "tool_execution_end") {
    return {
      type: event.type,
      toolCallId: event.toolCallId,
      toolName: event.toolName,
      isError: event.isError,
      result: truncateResult(event.result ?? event.content ?? ""),
    };
  }
```

Where `truncateResult()` limits to 2000 chars for safe SSE transmission.

Also add:
```typescript
if (event.type === "tool_execution_update") {
    return {
      type: event.type,
      toolCallId: event.toolCallId,
      content: truncateResult(event.content ?? ""),
    };
  }
```

### 6. `src/frontend/modules/main.ts` — Add toggleChatPanel

Add to imports and window bindings:
```typescript
import { toggleChatPanel } from "./chat.js";
// ...
window.toggleChatPanel = toggleChatPanel;
```

In mode.ts, change chat nav to use `toggleChatPanel()` instead of `showChatPage()`.

### 7. `src/server/routes/chat.ts` — Multi-Turn Session Support

```typescript
const sessions = new Map<string, { agent: any; lastActivity: number }>();
const SESSION_TTL = 300_000; // 5 min

// Periodic cleanup
setInterval(() => {
  const now = Date.now();
  for (const [id, s] of sessions) {
    if (now - s.lastActivity > SESSION_TTL) sessions.delete(id);
  }
}, 60_000);

export async function handleChat(req: Request, corsHdr: Record<string, string>): Promise<Response> {
  const body = await req.json();
  const sessionId = body.sessionId || crypto.randomUUID();
  
  let entry = sessions.get(sessionId);
  if (!entry) {
    entry = { agent: createAgent(), lastActivity: Date.now() };
    sessions.set(sessionId, entry);
  }
  entry.lastActivity = Date.now();
  
  // ... rest of handler uses entry.agent instead of new createAgent()
  // Include sessionId in first SSE event so client stores it
}
```

## CSS-only changes

### layout.css — panel spacer
Replace `.content { display: flex; flex: 1; overflow: hidden; }` content keeps main flexible.

### Mode bar agent indicator
In layout.html mode bar, add agent status dot:
```html
<span class="agent-dot" id="agent-dot" title="AI Agent available"></span>
```

## Build Impact

- `dist/index.html` grows ~5 KB (new CSS + panel HTML + incremental chat JS)
- `dist/server.js` grows ~5 KB (session store + result serialization)
- Build time unchanged (~200ms)

## Test Impact

- Existing 313 tests should pass unchanged (chat.ts tests check serialize/agent config, not UI)
- New chat.ts structure needs updated tests for `toggleChatPanel`, incremental DOM helpers

## Order of Implementation

1. layout.html — add panel div
2. components.css — replace chat CSS entirely
3. chat.ts — rewrite with panel mode + incremental DOM + tool results
4. serialize.ts — include tool results
5. main.ts — add toggleChatPanel binding
6. server/routes/chat.ts — session support
7. Test: `bun test src/`
8. Build: `bun run build:all`
9. Restart server + Playwright verify
