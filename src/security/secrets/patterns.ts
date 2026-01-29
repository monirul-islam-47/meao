import type { SecretPattern, SecretFinding } from './types.js'

/**
 * DEFINITE patterns - structure alone proves it's a secret.
 * Always redact these.
 */
export const DEFINITE_PATTERNS: SecretPattern[] = [
  // Private Keys
  {
    name: 'private_key_pem',
    type: 'private_key',
    pattern:
      /-----BEGIN (?:RSA |EC |DSA |OPENSSH |ENCRYPTED )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |DSA |OPENSSH |ENCRYPTED )?PRIVATE KEY-----/g,
  },
  {
    name: 'pgp_private_key',
    type: 'private_key',
    pattern:
      /-----BEGIN PGP PRIVATE KEY BLOCK-----[\s\S]*?-----END PGP PRIVATE KEY BLOCK-----/g,
  },

  // OpenAI
  {
    name: 'openai_api_key',
    type: 'api_key',
    service: 'openai',
    pattern: /sk-[A-Za-z0-9]{48}/g,
  },
  {
    name: 'openai_project_key',
    type: 'api_key',
    service: 'openai',
    pattern: /sk-proj-[A-Za-z0-9]{48}/g,
  },

  // Anthropic
  {
    name: 'anthropic_api_key',
    type: 'api_key',
    service: 'anthropic',
    pattern: /sk-ant-api[A-Za-z0-9-]{95}/g,
  },

  // AWS
  {
    name: 'aws_access_key',
    type: 'api_key',
    service: 'aws',
    pattern: /AKIA[A-Z0-9]{16}/g,
  },

  // GitHub
  {
    name: 'github_pat',
    type: 'api_key',
    service: 'github',
    pattern: /ghp_[A-Za-z0-9]{36}/g,
  },
  {
    name: 'github_oauth',
    type: 'api_key',
    service: 'github',
    pattern: /gho_[A-Za-z0-9]{36}/g,
  },
  {
    name: 'github_fine_grained',
    type: 'api_key',
    service: 'github',
    pattern: /github_pat_[A-Za-z0-9]{22}_[A-Za-z0-9]{59}/g,
  },

  // GitLab
  {
    name: 'gitlab_pat',
    type: 'api_key',
    service: 'gitlab',
    pattern: /glpat-[A-Za-z0-9-]{20}/g,
  },

  // Stripe
  {
    name: 'stripe_secret_key',
    type: 'api_key',
    service: 'stripe',
    pattern: /sk_live_[A-Za-z0-9]{24}/g,
  },
  {
    name: 'stripe_restricted_key',
    type: 'api_key',
    service: 'stripe',
    pattern: /rk_live_[A-Za-z0-9]{24}/g,
  },

  // Slack
  {
    name: 'slack_bot_token',
    type: 'api_key',
    service: 'slack',
    pattern: /xoxb-[0-9]{10,13}-[0-9]{10,13}-[A-Za-z0-9]{24}/g,
  },
  {
    name: 'slack_webhook',
    type: 'webhook',
    service: 'slack',
    pattern:
      /https:\/\/hooks\.slack\.com\/services\/T[A-Z0-9]+\/B[A-Z0-9]+\/[A-Za-z0-9]+/g,
  },

  // Discord
  {
    name: 'discord_bot_token',
    type: 'api_key',
    service: 'discord',
    pattern: /[MN][A-Za-z0-9]{23,}\.[A-Za-z0-9_-]{6}\.[A-Za-z0-9_-]{27}/g,
  },
  {
    name: 'discord_webhook',
    type: 'webhook',
    service: 'discord',
    pattern:
      /https:\/\/discord(?:app)?\.com\/api\/webhooks\/\d+\/[A-Za-z0-9_-]+/g,
  },

  // Telegram
  {
    name: 'telegram_bot_token',
    type: 'api_key',
    service: 'telegram',
    pattern: /[0-9]{8,10}:[A-Za-z0-9_-]{35}/g,
  },

  // Twilio
  {
    name: 'twilio_api_key',
    type: 'api_key',
    service: 'twilio',
    pattern: /SK[A-Za-z0-9]{32}/g,
  },

  // SendGrid
  {
    name: 'sendgrid_api_key',
    type: 'api_key',
    service: 'sendgrid',
    pattern: /SG\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}/g,
  },

  // Mailchimp
  {
    name: 'mailchimp_api_key',
    type: 'api_key',
    service: 'mailchimp',
    pattern: /[a-f0-9]{32}-us\d{1,2}/g,
  },

  // Firebase
  {
    name: 'firebase_api_key',
    type: 'api_key',
    service: 'firebase',
    pattern: /AIza[A-Za-z0-9_-]{35}/g,
  },

  // npm
  {
    name: 'npm_token',
    type: 'api_key',
    service: 'npm',
    pattern: /npm_[A-Za-z0-9]{36}/g,
  },

  // PyPI
  {
    name: 'pypi_token',
    type: 'api_key',
    service: 'pypi',
    pattern: /pypi-AgEIcHlwaS5vcmc[A-Za-z0-9_-]{50,}/g,
  },
]

/**
 * PROBABLE patterns - high confidence but may have edge cases.
 * Redact + warn.
 */
export const PROBABLE_PATTERNS: SecretPattern[] = [
  // Database URLs with embedded credentials
  {
    name: 'postgres_url',
    type: 'database_url',
    service: 'postgres',
    pattern: /postgres(?:ql)?:\/\/[^:]+:[^@]+@[^/\s]+/g,
  },
  {
    name: 'mongodb_url',
    type: 'database_url',
    service: 'mongodb',
    pattern: /mongodb(?:\+srv)?:\/\/[^:]+:[^@]+@[^/\s]+/g,
  },
  {
    name: 'redis_url',
    type: 'database_url',
    service: 'redis',
    pattern: /redis:\/\/:[^@]+@[^/\s]+/g,
  },
  {
    name: 'mysql_url',
    type: 'database_url',
    service: 'mysql',
    pattern: /mysql:\/\/[^:]+:[^@]+@[^/\s]+/g,
  },

  // Authorization headers
  {
    name: 'bearer_token',
    type: 'auth_header',
    pattern: /Bearer\s+[A-Za-z0-9._-]{20,}/g,
  },
  {
    name: 'basic_auth',
    type: 'auth_header',
    pattern: /Basic\s+[A-Za-z0-9+/=]{20,}/g,
  },

  // Password assignments (various formats)
  {
    name: 'password_assignment',
    type: 'password',
    pattern: /(?:password|passwd|pwd)\s*[=:]\s*['"]?[^\s'"]{8,}['"]?/gi,
  },
  {
    name: 'api_key_assignment',
    type: 'api_key',
    pattern: /(?:api[_-]?key|apikey)\s*[=:]\s*['"]?[^\s'"]{16,}['"]?/gi,
  },
  {
    name: 'secret_assignment',
    type: 'secret',
    pattern: /(?:secret|token)\s*[=:]\s*['"]?[^\s'"]{16,}['"]?/gi,
  },

  // JWT tokens (3 base64 segments)
  {
    name: 'jwt_token',
    type: 'jwt',
    pattern: /eyJ[A-Za-z0-9_-]*\.eyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]*/g,
  },

  // SSH keys (public, but often sensitive)
  {
    name: 'ssh_public_key',
    type: 'ssh_key',
    pattern: /ssh-(?:rsa|dss|ed25519|ecdsa)\s+AAAA[A-Za-z0-9+/=]+/g,
  },
]

/**
 * POSSIBLE patterns - context-dependent, high false positive potential.
 * Warn only, don't redact by default.
 */
export const POSSIBLE_PATTERNS: SecretPattern[] = [
  // Long base64 - only flag if near secret keywords
  {
    name: 'long_base64_contextual',
    type: 'encoded_blob',
    pattern: null,
    customDetector: (content: string): SecretFinding[] => {
      const findings: SecretFinding[] = []
      const contextKeywords =
        /(?:key|secret|token|password|credential|auth)/i

      // Skip data URIs (images, fonts, etc.)
      const cleanContent = content.replace(/data:[^;]+;base64,[A-Za-z0-9+/=]+/g, '')

      const base64Pattern = /[A-Za-z0-9+/=]{64,}/g
      let match
      while ((match = base64Pattern.exec(cleanContent)) !== null) {
        // Check surrounding context (50 chars before)
        const start = Math.max(0, match.index - 50)
        const context = cleanContent.slice(start, match.index)

        if (contextKeywords.test(context)) {
          findings.push({
            confidence: 'possible',
            type: 'encoded_blob',
            location: { start: match.index, end: match.index + match[0].length },
          })
        }
      }
      return findings
    },
  },

  // Hex strings that might be secrets
  {
    name: 'long_hex_contextual',
    type: 'encoded_blob',
    pattern: null,
    customDetector: (content: string): SecretFinding[] => {
      const findings: SecretFinding[] = []
      const contextKeywords = /(?:key|secret|hash|digest|salt)/i

      const hexPattern = /[0-9a-f]{40,}/gi
      let match
      while ((match = hexPattern.exec(content)) !== null) {
        const start = Math.max(0, match.index - 50)
        const context = content.slice(start, match.index)

        if (contextKeywords.test(context)) {
          findings.push({
            confidence: 'possible',
            type: 'encoded_blob',
            location: { start: match.index, end: match.index + match[0].length },
          })
        }
      }
      return findings
    },
  },
]

/**
 * Get all patterns by confidence level.
 */
export function getPatternsByConfidence(confidence: 'definite' | 'probable' | 'possible'): SecretPattern[] {
  switch (confidence) {
    case 'definite':
      return DEFINITE_PATTERNS
    case 'probable':
      return PROBABLE_PATTERNS
    case 'possible':
      return POSSIBLE_PATTERNS
  }
}
