# Build an Agent in 60 Minutes

A step-by-step guide to creating your first agent on the meao platform.

---

## What You'll Build

A simple personal assistant agent that:
- Has its own identity and personality
- Responds to greetings with context from memory
- Fetches weather data via `web_fetch` (MVP-compatible)
- Demonstrates the full agent framework

---

## Prerequisites

- meao platform running (M8+ completed)
- Agent Framework (M12) and Skills Framework (M12.5) completed
- Memory system (M10) working
- At least one channel configured (CLI or Telegram)

---

## Step 1: Define Your Agent Identity (5 minutes)

Create `src/agents/my-assistant/identity.ts`:

```typescript
import type { AgentIdentity } from '../../agent'

export const MY_ASSISTANT_IDENTITY: AgentIdentity = {
  id: 'my-assistant',
  name: 'Alex',

  // Core personality (loaded in system prompt)
  personality: {
    traits: ['helpful', 'concise', 'friendly'],
    communication: 'Clear and direct. Uses simple language.',
    boundaries: 'Focuses on tasks, avoids personal opinions.',
  },

  // Memory namespace isolation
  memoryNamespace: 'my-assistant',
}
```

---

## Step 2: Configure Agent Capabilities (10 minutes)

Create `src/agents/my-assistant/config.ts`:

```typescript
import type { AgentConfig } from '../../agent'

export const MY_ASSISTANT_CONFIG: AgentConfig = {
  identity: MY_ASSISTANT_IDENTITY,

  // Tools this agent can use (MVP built-ins only)
  tools: ['web_fetch', 'read'],

  // Skills this agent can invoke
  skills: ['greeting', 'weather_check'],

  // Bootstrap categories to load before conversations
  bootstrapCategories: [
    { name: 'identity', priority: 1, maxTokens: 100 },
    { name: 'preferences', priority: 2, maxTokens: 200 },
  ],

  // Autonomy rules (canonical format)
  autonomy: {
    autoApprove: [
      'web_fetch:get',        // GET requests to allowlisted hosts
      'read:file',            // Read files in project
    ],
    requireApproval: [
      'web_fetch:post',       // Writes require approval
    ],
  },
}
```

---

## Step 3: Create a Simple Skill (15 minutes)

Create `src/agents/my-assistant/skills/greeting.ts`:

```typescript
import type { Skill, SkillContext, SkillResult } from '../../../skills'

export const greetingSkill: Skill = {
  id: 'greeting',
  name: 'Greeting',
  description: 'Responds to greetings with personalized context',

  // Triggers that activate this skill
  triggers: [
    { type: 'keyword', patterns: ['hello', 'hi', 'hey', 'good morning'] },
  ],

  // Skill execution
  async execute(context: SkillContext): Promise<SkillResult> {
    // Get user preferences from memory
    const prefs = await context.memory.query({
      namespace: context.agent.memoryNamespace,
      category: 'preferences',
      requesterId: context.userId,
      limit: 5,
    })

    // Build context for response
    const userContext = prefs.length > 0
      ? `User preferences: ${prefs.map(p => p.content).join(', ')}`
      : 'No stored preferences yet.'

    // Return prompt augmentation (no tools needed)
    return {
      promptAugmentation: `
The user is greeting you. Respond warmly and briefly.
${userContext}

Keep your response under 50 words.
`,
    }
  },
}
```

---

## Step 4: Register Your Agent (10 minutes)

Create `src/agents/my-assistant/index.ts`:

```typescript
import { Agent } from '../../agent'
import { MY_ASSISTANT_CONFIG } from './config'
import { greetingSkill } from './skills/greeting'

export function createMyAssistant(): Agent {
  const agent = new Agent(MY_ASSISTANT_CONFIG)

  // Register skills
  agent.registerSkill(greetingSkill)

  return agent
}

// Export for registry
export { MY_ASSISTANT_CONFIG }
```

Add to the agent registry in `src/agents/index.ts`:

```typescript
import { createMyAssistant, MY_ASSISTANT_CONFIG } from './my-assistant'

export const AGENT_REGISTRY = {
  'my-assistant': {
    config: MY_ASSISTANT_CONFIG,
    create: createMyAssistant,
  },
  // ... other agents
}
```

---

## Step 5: Wire Up to a Channel (10 minutes)

Bind your agent to a channel. In your channel configuration:

```typescript
// src/channels/cli/config.ts
export const CLI_CHANNEL_CONFIG = {
  // ... other config

  // Route to your agent
  defaultAgentId: 'my-assistant',
}
```

Or for Telegram with user-specific routing:

```typescript
// src/channels/telegram/config.ts
export const TELEGRAM_CHANNEL_CONFIG = {
  // ... other config

  // Route specific users to agents
  agentRouting: {
    default: 'my-assistant',
    // Can add user-specific overrides later
  },
}
```

---

## Step 6: Test Your Agent (10 minutes)

### Unit Test

Create `test/agents/my-assistant/greeting.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { greetingSkill } from '../../../src/agents/my-assistant/skills/greeting'

describe('greetingSkill', () => {
  const mockContext = {
    agent: { memoryNamespace: 'my-assistant' },
    userId: 'test-user',
    memory: {
      query: vi.fn().mockResolvedValue([]),
    },
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('triggers on greeting keywords', () => {
    expect(greetingSkill.triggers[0].patterns).toContain('hello')
    expect(greetingSkill.triggers[0].patterns).toContain('good morning')
  })

  it('returns prompt augmentation', async () => {
    const result = await greetingSkill.execute(mockContext as any)

    expect(result.promptAugmentation).toContain('greeting you')
    expect(result.promptAugmentation).toContain('under 50 words')
  })

  it('includes user preferences when available', async () => {
    mockContext.memory.query.mockResolvedValueOnce([
      { content: 'prefers formal language' },
    ])

    const result = await greetingSkill.execute(mockContext as any)

    expect(result.promptAugmentation).toContain('prefers formal language')
  })
})
```

### Integration Test

```typescript
describe('MyAssistant Golden Path', () => {
  it('handles greeting end-to-end', async () => {
    const agent = createMyAssistant()
    const channel = createMockCLIChannel()

    await agent.handleMessage({
      userId: 'test-user',
      content: 'Hello!',
    }, channel)

    expect(channel.lastResponse).toBeDefined()
    expect(channel.lastResponse.length).toBeLessThan(200) // Concise
  })
})
```

### Manual Test

```bash
# Start the CLI channel
pnpm run cli

# Test greeting
> Hello!
Alex: Hi there! How can I help you today?

# Test weather via web_fetch (uses allowlisted weather API)
> What's the weather like?
Alex: Let me check... [uses web_fetch to api.open-meteo.com]
```

---

## What's Next?

### Add More Skills

```typescript
// Weather skill - uses web_fetch to allowlisted weather API
export const weatherCheckSkill: Skill = {
  id: 'weather_check',
  triggers: [
    { type: 'keyword', patterns: ['weather', 'temperature', 'forecast'] },
  ],
  async execute(context) {
    // Open-Meteo is on the default allowlist (free, no API key)
    return {
      promptAugmentation: `User wants weather info. Use web_fetch to get data:
URL: https://api.open-meteo.com/v1/forecast?latitude=40.7128&longitude=-74.0060&current_weather=true

Parse the JSON response and summarize the current conditions.`,
      suggestedTools: ['web_fetch'],
    }
  },
}

// Research skill - uses web_fetch tool
export const researchSkill: Skill = {
  id: 'research',
  triggers: [
    { type: 'keyword', patterns: ['look up', 'search for', 'find info'] },
  ],
  async execute(context) {
    return {
      promptAugmentation: 'User wants you to research something. Use web_fetch tool.',
      suggestedTools: ['web_fetch'],
    }
  },
}
```

### Add Memory Storage

Store facts after conversations:

```typescript
// In your agent's postConversation hook
async postConversation(context: ConversationContext) {
  const facts = await extractFacts(context.messages)

  for (const fact of facts) {
    await context.memory.add({
      namespace: this.config.identity.memoryNamespace,
      category: fact.category,
      content: fact.content,
      visibility: 'owner', // Only owner can see
    })
  }
}
```

### Add Background Scout

Monitor something proactively:

```typescript
// In src/agents/my-assistant/scouts/reminder.ts
export const reminderScout: Scout = {
  id: 'reminder',
  schedule: '0 9 * * *', // Every day at 9am

  async check(context) {
    const reminders = await context.memory.query({
      category: 'reminders',
      filter: { dueDate: { lte: new Date() } },
    })

    if (reminders.length > 0) {
      return {
        urgency: 'MEDIUM',
        message: `You have ${reminders.length} reminder(s) due today.`,
      }
    }
    return null
  },
}
```

---

## Common Patterns

### Canonical Tool Actions

Always use the format `<tool>:<action>` or `<tool>:<category>:<action>`:

```typescript
autonomy: {
  autoApprove: [
    'web_fetch:get',             // tool:action (MVP built-in)
    'read:file',                 // tool:action (MVP built-in)
    'home_assistant:lights:on',  // tool:category:action (plugin)
  ],
  requireApproval: [
    'web_fetch:post',            // Writes always need approval
    'bash:execute',              // Shell execution needs approval
    'home_assistant:lock:unlock',
  ],
}
```

**MVP Built-in Tools:** `read`, `write`, `bash`, `web_fetch`
**Plugin Tools (Phase 3+):** `weather`, `gmail`, `calendar`, `home_assistant`, etc.

### Memory Visibility

Always set visibility when storing memories:

```typescript
await context.memory.add({
  content: 'User prefers dark mode',
  visibility: 'owner',     // Only owner can query
  // or: 'family'          // Family members can query
  // or: 'user:uuid'       // Specific user can query
  // or: 'agent'           // Only this agent can query
})
```

### Bootstrap Categories

Order matters - load identity first:

```typescript
bootstrapCategories: [
  { name: 'identity', priority: 1, maxTokens: 100 },    // Who am I?
  { name: 'family', priority: 2, maxTokens: 150 },      // Who do I know?
  { name: 'preferences', priority: 3, maxTokens: 200 }, // What do they like?
  { name: 'recent', priority: 4, maxTokens: 250 },      // What happened recently?
]
```

---

## Safety & Logging Rules

**These rules apply to ALL agents. Violations will be caught by platform guardrails.**

### Never Log Content

The platform enforces NEVER_LOG on these paths:
- `metadata.message.content` - User messages
- `metadata.tool.output` - Tool results
- `metadata.file.content` - File contents

Your agent code should never manually log these either. Use structured metadata instead.

### Sanitize Error Messages

Error messages can leak sensitive data. Always sanitize before surfacing:

```typescript
// BAD: Leaks file contents in error
throw new Error(`Failed to parse: ${fileContent}`)

// GOOD: Sanitize and use metadata
const sanitized = secretDetector.redact(errorDetails)
throw new AgentError('Parse failed', { path: filePath })
```

### Approvals are Default-Deny

Unknown tool actions require approval by default. Your autonomy config only *allows* actions, never *bypasses* platform policy.

```typescript
// This CANNOT override platform security:
autonomy: {
  autoApprove: ['*'],  // Platform still enforces sandbox, network rules
}
```

### Label Propagation

When combining data from multiple sources, the result inherits:
- **Lowest trust level** (untrusted < user < verified)
- **Highest data class** (public < internal < sensitive < secret)

---

## Troubleshooting

### Agent not responding
- Check agent is registered in `AGENT_REGISTRY`
- Check channel has correct `defaultAgentId`
- Check agent config has required tools

### Skill not triggering
- Check trigger patterns match user input
- Check skill is registered with `agent.registerSkill()`
- Add debug logging in skill's `execute()`

### Memory not loading
- Check `memoryNamespace` matches stored memories
- Check `bootstrapCategories` includes the category
- Check visibility allows the requesting user

### Tool not working
- Check tool is in agent's `tools` array
- Check autonomy rules allow the action
- Check tool is registered in ToolExecutor

---

## Reference

- [Agent Framework (M12)](../milestones/M12-agent-framework.md)
- [Skills Framework (M12.5)](../milestones/M12.5-skills.md)
- [Memory System (M10)](../milestones/M10-memory.md)
- [Doris Reference Agent (M18)](../IMPLEMENTATION.md#milestone-18-doris-agent)

---

*Last updated: 2026-01-29 (v1.1 - Applied codex review fixes)*
