/**
 * Simple argument parser for MEAO CLI
 */

export interface ParsedArgs {
  command?: string
  args: string[]
  flags: Record<string, boolean | string>
}

export function parseArgs(argv: string[]): ParsedArgs {
  const flags: Record<string, boolean | string> = {}
  const positional: string[] = []

  let i = 0
  while (i < argv.length) {
    const arg = argv[i]

    if (arg.startsWith('--')) {
      const key = arg.slice(2)
      if (key === 'help' || key === 'version') {
        flags[key] = true
      } else if (i + 1 < argv.length && !argv[i + 1].startsWith('-')) {
        flags[key] = argv[i + 1]
        i++
      } else {
        flags[key] = true
      }
    } else if (arg.startsWith('-')) {
      const key = arg.slice(1)
      if (key === 'h') flags.help = true
      else if (key === 'v') flags.version = true
      else flags[key] = true
    } else {
      positional.push(arg)
    }
    i++
  }

  return {
    command: positional[0],
    args: positional.slice(1),
    flags,
  }
}
