#!/usr/bin/env node
/**
 * The executable entry point of the `waverune` command.
 *
 * `cli/index.ts` holds the logic and exports `main` for tests. This file sets
 * `process.exitCode` instead of calling `process.exit`. A piped stdout is
 * asynchronous on some platforms, and an immediate exit can cut the last line.
 */
import { main } from '~/cli';

process.exitCode = await main(process.argv.slice(2));
