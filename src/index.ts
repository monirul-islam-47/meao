export function main(): void {
  // Stub main. Later this will bootstrap Config -> Audit -> Tools -> Channel -> Orchestrator.
  const args = process.argv.slice(2)
  if (args.includes('--help') || args.includes('-h')) {
    console.log(`meao

Usage:
  meao --version
  meao --help
`)
    return
  }

  // For now, no-op.
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main()
}
