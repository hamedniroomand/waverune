import { expect, test } from 'bun:test';

import { VERSION } from '~/version';

import pkg from '../package.json';

test('the version constant matches package.json', () => {
  expect(VERSION).toBe(pkg.version);
});
