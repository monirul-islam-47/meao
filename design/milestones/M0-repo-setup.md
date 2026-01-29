# Milestone 0: Repository Setup

**Status:** NOT STARTED
**Scope:** MVP
**Dependencies:** None
**PR:** PR0

---

## Goal

Establish build discipline before writing any business logic. This ensures every subsequent PR has a consistent foundation for testing, linting, and type checking.

---

## Deliverables

```
meao/
├── package.json
├── pnpm-lock.yaml
├── tsconfig.json
├── vitest.config.ts
├── .eslintrc.js
├── .prettierrc
├── .gitignore
├── bin/
│   └── meao                    # CLI entry point (stub)
├── src/
│   └── index.ts               # Main entry (stub)
└── test/
    └── setup.ts               # Test utilities
```

---

## Package.json

```json
{
  "name": "meao",
  "version": "0.1.0",
  "description": "Personal AI Platform",
  "type": "module",
  "bin": {
    "meao": "./bin/meao"
  },
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsup src/index.ts --format esm,cjs --dts",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage",
    "lint": "eslint src test --ext .ts",
    "lint:fix": "eslint src test --ext .ts --fix",
    "typecheck": "tsc --noEmit",
    "format": "prettier --write \"src/**/*.ts\" \"test/**/*.ts\"",
    "check": "pnpm typecheck && pnpm lint && pnpm test"
  },
  "dependencies": {
    "zod": "^3.x"
  },
  "devDependencies": {
    "@types/node": "^20.x",
    "typescript": "^5.x",
    "tsx": "^4.x",
    "tsup": "^8.x",
    "vitest": "^1.x",
    "@vitest/coverage-v8": "^1.x",
    "eslint": "^8.x",
    "@typescript-eslint/eslint-plugin": "^7.x",
    "@typescript-eslint/parser": "^7.x",
    "prettier": "^3.x"
  },
  "engines": {
    "node": ">=20.0.0"
  }
}
```

---

## TypeScript Configuration

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022"],
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "noImplicitAny": true,
    "strictNullChecks": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noImplicitReturns": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

---

## Vitest Configuration

```typescript
// vitest.config.ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      exclude: ['node_modules', 'dist', 'test'],
    },
  },
})
```

---

## ESLint Configuration

```javascript
// .eslintrc.js
module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  plugins: ['@typescript-eslint'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:@typescript-eslint/recommended-requiring-type-checking',
  ],
  parserOptions: {
    project: './tsconfig.json',
  },
  rules: {
    // Strict rules for security-critical code
    '@typescript-eslint/no-explicit-any': 'error',
    '@typescript-eslint/no-unused-vars': 'error',
    '@typescript-eslint/explicit-function-return-type': 'warn',
    'no-console': ['warn', { allow: ['warn', 'error'] }],
  },
  ignorePatterns: ['dist', 'node_modules'],
}
```

---

## Prettier Configuration

```json
{
  "semi": false,
  "singleQuote": true,
  "trailingComma": "es5",
  "printWidth": 100,
  "tabWidth": 2
}
```

---

## Stub Files

### bin/meao

```bash
#!/usr/bin/env node
import('../dist/index.js')
```

### src/index.ts

```typescript
const VERSION = '0.1.0'

function main(): void {
  const args = process.argv.slice(2)

  if (args.includes('--version') || args.includes('-v')) {
    console.log(`meao v${VERSION}`)
    process.exit(0)
  }

  console.log('meao - Personal AI Platform')
  console.log('Run with --help for usage information')
}

main()
```

### test/setup.ts

```typescript
// Global test setup
import { beforeAll, afterAll } from 'vitest'

beforeAll(() => {
  // Setup test environment
})

afterAll(() => {
  // Cleanup
})

// Test utilities
export function createTempDir(): string {
  // Implementation
  return '/tmp/meao-test'
}
```

---

## .gitignore

```
# Dependencies
node_modules/

# Build output
dist/

# Test coverage
coverage/

# IDE
.idea/
.vscode/
*.swp

# OS
.DS_Store
Thumbs.db

# Logs
*.log

# Environment
.env
.env.local

# meao data (don't commit user data)
.meao/
```

---

## Definition of Done

- [ ] `pnpm install` completes without errors
- [ ] `pnpm typecheck` passes
- [ ] `pnpm lint` passes
- [ ] `pnpm test` runs (even with 0 tests)
- [ ] `pnpm build` produces `dist/` output
- [ ] `pnpm check` runs all checks in sequence
- [ ] `./bin/meao --version` prints version
- [ ] Git repository initialized with `.gitignore`

---

## PR Checklist

```markdown
## PR0: Repository Setup

### Changes
- [ ] Initialize Node.js project with pnpm
- [ ] Add TypeScript configuration (strict mode)
- [ ] Add Vitest for testing
- [ ] Add ESLint + Prettier for code quality
- [ ] Add stub entry points

### Verification
- [ ] `pnpm check` passes
- [ ] `./bin/meao --version` works

### Notes
This PR establishes the foundation. All subsequent PRs must pass `pnpm check`.
```

---

## Next Milestone

After completing M0, proceed to [M1: Configuration System](./M1-config.md).

---

*Last updated: 2026-01-29*
