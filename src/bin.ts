#!/usr/bin/env node
/**
 * The executable entry point of the `waverune` command.
 *
 * `cli.ts` holds the logic and exports `main` for tests. This file only
 * hands over the arguments. It sets `process.exitCode` instead of calling
 * `process.exit`, because piped stdout is asynchronous on some platforms and
 * an immediate exit could cut the last line of output.
 */
import { main } from '~/cli';

process.exitCode = await main(process.argv.slice(2));
