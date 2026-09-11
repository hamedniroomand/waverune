/**
 * Print the benchmark source hash of the working tree, or of a git ref.
 *
 * Usage: bun bench/source-hash.ts            # the working tree
 *        bun bench/source-hash.ts v0.2.0     # the files as committed there
 */
import { sourceHash, sourceHashAtRef } from './lib';

const ref = Bun.argv[2];
console.log(ref ? await sourceHashAtRef(ref) : await sourceHash());
