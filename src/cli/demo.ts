/**
 * Demo workflows for MEAO
 */

import { startSession } from './session.js'

interface Demo {
  name: string
  title: string
  description: string
  validates: string[]
  prompt: string
}

const demos: Demo[] = [
  {
    name: 'golden-path',
    title: 'Golden Path',
    description: 'Validate the full request pipeline: provider -> web_fetch -> audit -> response',
    validates: [
      'Provider integration with Anthropic API',
      'Tool calling with web_fetch',
      'Network allowlist enforcement',
      'Automatic audit logging',
      'Streaming response display',
    ],
    prompt: `Fetch the README from https://raw.githubusercontent.com/lodash/lodash/main/README.md and summarize the key features of lodash.`,
  },
  {
    name: 'repo-assistant',
    title: 'Repo Assistant',
    description: 'Scan a local repository and generate a summary report',
    validates: [
      'File reading with path security',
      'Sandboxed command execution',
      'Approval flow for bash commands',
      'Output sanitization',
      'Multi-step tool orchestration',
    ],
    prompt: `Scan this repository for TODO comments and list any failing tests. Write a brief status report.`,
  },
  {
    name: 'file-ops',
    title: 'Safe File Operations',
    description: 'Read a file, transform it, and write output within security boundaries',
    validates: [
      'Path traversal protection',
      'Symlink escape prevention',
      'Secret redaction in outputs',
      'Approval flow for write operations',
      'Output labeling',
    ],
    prompt: `Read package.json, extract the version number, and write it to version.txt`,
  },
]

export function listDemos(): void {
  console.log('Available demos:\n')
  for (const demo of demos) {
    console.log(`  ${demo.name.padEnd(16)} ${demo.title}`)
    console.log(`  ${' '.repeat(16)} ${demo.description}\n`)
  }
  console.log('Use "meao demo show <name>" for details')
  console.log('Use "meao demo run <name>" to run interactively')
}

export function showDemo(name?: string): void {
  if (!name) {
    console.error('Error: demo name required')
    console.log('Usage: meao demo show <name>')
    listDemos()
    return
  }

  const demo = demos.find(d => d.name === name)
  if (!demo) {
    console.error(`Error: unknown demo "${name}"`)
    listDemos()
    return
  }

  console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Demo: ${demo.title}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

${demo.description}

What It Validates:
${demo.validates.map(v => `  • ${v}`).join('\n')}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Prompt (copy/paste this into MEAO):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

${demo.prompt}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Run with: meao demo run ${demo.name}
`)
}

export async function runDemo(
  name?: string,
  flags: Record<string, boolean | string> = {}
): Promise<void> {
  if (!name) {
    console.error('Error: demo name required')
    console.log('Usage: meao demo run <name>')
    listDemos()
    return
  }

  const demo = demos.find(d => d.name === name)
  if (!demo) {
    console.error(`Error: unknown demo "${name}"`)
    listDemos()
    return
  }

  console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Running Demo: ${demo.title}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

${demo.description}

Sending prompt:
> ${demo.prompt}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`)

  // Start session with the demo prompt
  await startSession({
    ...flags,
    demoPrompt: demo.prompt,
  })
}

export function getDemo(name: string): Demo | undefined {
  return demos.find(d => d.name === name)
}

export function getDemoPrompt(name: string): string | undefined {
  return demos.find(d => d.name === name)?.prompt
}
