import { z } from 'zod'

// Owner configuration
export const OwnerConfigSchema = z.object({
  displayName: z.string().min(1).max(100).default('Owner'),
  timezone: z.string().default('UTC'),
  locale: z.string().default('en-US'),
})

// Server configuration
export const ServerConfigSchema = z.object({
  host: z.string().default('127.0.0.1'),
  port: z.number().int().min(1).max(65535).default(3000),
  tls: z
    .object({
      enabled: z.boolean().default(false),
      cert: z.string().optional(),
      key: z.string().optional(),
    })
    .optional(),
  cors: z
    .object({
      enabled: z.boolean().default(false),
      origins: z.array(z.string()).default([]),
    })
    .optional(),
  rateLimit: z
    .object({
      enabled: z.boolean().default(true),
      requestsPerMinute: z.number().int().positive().default(60),
      requestsPerHour: z.number().int().positive().default(1000),
    })
    .optional(),
  maxRequestSize: z.string().default('1mb'),
  timeout: z.number().int().positive().default(120000),
})

// Channel configuration
export const ChannelConfigSchema = z.object({
  enabled: z.boolean().default(true),
  dmPolicy: z
    .enum(['owner_only', 'allowlist', 'pairing', 'open'])
    .default('owner_only'),
  allowedUsers: z.array(z.string()).optional(),
  rateLimit: z
    .object({
      maxPerMinute: z.number().int().positive().default(30),
      maxPerHour: z.number().int().positive().default(500),
    })
    .optional(),
  botTokenRef: z.string().optional(),
})

// Provider configuration
export const ProviderConfigSchema = z.object({
  primary: z.object({
    type: z.enum(['anthropic', 'openai', 'mock']).default('anthropic'),
    model: z.string().default('claude-sonnet-4-20250514'),
    apiKeyRef: z.string().optional(),
    maxTokens: z.number().int().positive().default(4096),
    temperature: z.number().min(0).max(2).default(0.7),
  }),
  fallback: z
    .object({
      type: z.enum(['anthropic', 'openai', 'mock']).optional(),
      model: z.string().optional(),
      apiKeyRef: z.string().optional(),
    })
    .optional(),
})

// Memory configuration
export const MemoryConfigSchema = z.object({
  workingMemory: z
    .object({
      maxTokens: z.number().int().positive().default(8000),
    })
    .optional(),
  episodic: z
    .object({
      enabled: z.boolean().default(true),
      maxEntries: z.number().int().positive().default(10000),
    })
    .optional(),
  semantic: z
    .object({
      enabled: z.boolean().default(true),
    })
    .optional(),
})

// Sandbox configuration
export const SandboxConfigSchema = z.object({
  type: z.enum(['process', 'container']).default('container'),
  container: z
    .object({
      image: z.string().default('meao-sandbox:latest'),
      memoryLimit: z.string().default('512m'),
      cpuLimit: z.string().default('1'),
      timeout: z.number().int().positive().default(30000),
      networkMode: z.enum(['none', 'host', 'bridge']).default('none'),
    })
    .optional(),
  process: z
    .object({
      timeout: z.number().int().positive().default(30000),
      maxMemory: z.number().int().positive().default(536870912), // 512MB
    })
    .optional(),
})

// Logging configuration
export const LoggingConfigSchema = z.object({
  level: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  format: z.enum(['json', 'text']).default('json'),
  audit: z
    .object({
      enabled: z.boolean().default(true),
      retention: z.number().int().positive().default(90), // days
      hashChain: z.boolean().default(false),
    })
    .optional(),
})

// Tool configuration
export const ToolConfigSchema = z.object({
  enabled: z.boolean().default(true),
  approval: z
    .object({
      level: z.enum(['auto', 'ask', 'deny']).default('ask'),
    })
    .optional(),
})

// Skill configuration
export const SkillConfigSchema = z.object({
  enabled: z.boolean().default(true),
})

// Full application configuration
export const AppConfigSchema = z.object({
  version: z.number().int().positive().default(1),
  owner: OwnerConfigSchema.default({}),
  server: ServerConfigSchema.default({}),
  channels: z.record(ChannelConfigSchema).default({}),
  providers: ProviderConfigSchema.default({
    primary: {
      type: 'anthropic',
      model: 'claude-sonnet-4-20250514',
      maxTokens: 4096,
      temperature: 0.7,
    },
  }),
  memory: MemoryConfigSchema.default({}),
  sandbox: SandboxConfigSchema.default({}),
  logging: LoggingConfigSchema.default({}),
  tools: z.record(ToolConfigSchema).default({}),
  skills: z.record(SkillConfigSchema).default({}),
})

export type AppConfig = z.infer<typeof AppConfigSchema>
export type OwnerConfig = z.infer<typeof OwnerConfigSchema>
export type ServerConfig = z.infer<typeof ServerConfigSchema>
export type ChannelConfig = z.infer<typeof ChannelConfigSchema>
export type ProviderConfig = z.infer<typeof ProviderConfigSchema>
export type MemoryConfig = z.infer<typeof MemoryConfigSchema>
export type SandboxConfig = z.infer<typeof SandboxConfigSchema>
export type LoggingConfig = z.infer<typeof LoggingConfigSchema>
export type ToolConfig = z.infer<typeof ToolConfigSchema>
export type SkillConfig = z.infer<typeof SkillConfigSchema>
