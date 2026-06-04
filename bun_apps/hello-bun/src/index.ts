#!/usr/bin/env bun

/**
 * hello-bun — minimal CLI demo for the harness monorepo.
 *
 * Usage:
 *   bun start                     → prints greeting
 *   bun start --name Alice        → greets Alice
 *   bun start --cwd               → prints the shared workspace root
 *   bun start --upper             → shouts it
 */

function parseArgs(argv: string[]): Record<string, string | boolean> {
  const args: Record<string, string | boolean> = {};
  for (let i = 2; i < argv.length; i++) {
    if (argv[i].startsWith("--")) {
      const key = argv[i].slice(2);
      if (i + 1 < argv.length && !argv[i + 1].startsWith("--")) {
        args[key] = argv[++i];
      } else {
        args[key] = true;
      }
    }
  }
  return args;
}

const args = parseArgs(process.argv);

const name = typeof args.name === "string" ? args.name : "world";
let message = `Hello, ${name}!`;

if (args.upper) {
  message = message.toUpperCase();
}

console.log(message);

if (args.cwd) {
  console.log(`Workspace root (PWD): ${process.cwd()}`);
}
