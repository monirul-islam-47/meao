import { main as cliMain } from './cli/index.js'

export { main } from './cli/index.js'

// Re-export core modules for programmatic use
export * from './orchestrator/index.js'
export * from './provider/index.js'
export * from './tools/index.js'
export * from './sandbox/index.js'
export * from './channel/cli.js'
export * from './audit/index.js'
export * from './security/index.js'

// Run CLI if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  cliMain().catch((error) => {
    console.error('Fatal error:', error)
    process.exit(1)
  })
}
