import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const pkg = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'));
const onDisk = (relative) => existsSync(fileURLToPath(new URL(relative, root)));

describe('package entry points', () => {
  test('every exports target resolves to a file on disk', () => {
    for (const [subpath, entry] of Object.entries(pkg.exports)) {
      const targets = typeof entry === 'string' ? { default: entry } : entry;
      for (const [condition, target] of Object.entries(targets)) {
        assert.ok(onDisk(target), `exports["${subpath}"].${condition} -> ${target} is missing`);
      }
    }
  });

  test('every subpath ships types alongside its implementation', () => {
    for (const [subpath, entry] of Object.entries(pkg.exports)) {
      if (subpath === './package.json') continue;
      assert.ok(entry.types, `exports["${subpath}"] has no types condition`);
      // TypeScript resolves "types" only when it precedes "default".
      assert.equal(Object.keys(entry)[0], 'types', `types must be first in exports["${subpath}"]`);
    }
  });

  test('main and types resolve and agree with the "." export', () => {
    assert.ok(onDisk(pkg.main));
    assert.ok(onDisk(pkg.types));
    assert.equal(pkg.exports['.'].default, `./${pkg.main}`);
    assert.equal(pkg.exports['.'].types, `./${pkg.types}`);
  });

  test('sideEffects is not disabled', () => {
    // Components register via customElements.define() on import. A `false` here
    // lets bundlers drop `import "pkg/lorum-ipsum"` and silently skip the tag.
    assert.notEqual(pkg.sideEffects, false);
  });

  test('a license file backs the declared license', () => {
    assert.equal(pkg.license, 'Apache-2.0');
    assert.ok(onDisk('LICENSE'), 'Apache-2.0 requires the license text to ship');
    assert.match(readFileSync(new URL('LICENSE', root), 'utf8'), /Apache License\s+Version 2\.0/);
  });
});

describe('published tarball', () => {
  let files;
  before(() => {
    const out = execFileSync('npm', ['pack', '--dry-run', '--json'], {
      cwd: fileURLToPath(root),
      encoding: 'utf8'
    });
    files = JSON.parse(out)[0].files.map((f) => f.path);
  });

  test('ships each entry point and its declarations', () => {
    for (const expected of [
      'index.js',
      'index.d.ts',
      'src/wc/machvive-lorum-ipsum/machvive-lorum-ipsum.js',
      'src/wc/machvive-lorum-ipsum/machvive-lorum-ipsum.d.ts',
      'src/wc/machvive-webmcp-polyfill/machvive-webmcp-polyfill.js',
      'src/wc/machvive-webmcp-polyfill/machvive-webmcp-polyfill.d.ts'
    ]) {
      assert.ok(files.includes(expected), `${expected} is missing from the tarball`);
    }
  });

  test('ships README and LICENSE', () => {
    assert.ok(files.includes('README.md'));
    assert.ok(files.includes('LICENSE'));
  });

  test('excludes tests and agent instructions', () => {
    const leaked = files.filter((f) => f.startsWith('test/') || f === 'CLAUDE.md');
    assert.deepEqual(leaked, [], `these should not be published: ${leaked.join(', ')}`);
  });
});

describe('bulk import', () => {
  test('registers every component tag', async () => {
    await import('../index.js');
    for (const tag of ['machvive-lorum-ipsum', 'machvive-webmcp-polyfill']) {
      assert.ok(customElements.get(tag), `${tag} was not registered`);
    }
  });

  test('re-exports exactly what index.d.ts declares', async () => {
    const index = await import('../index.js');
    assert.deepEqual(Object.keys(index).sort(), [
      'MachviveLorumIpsum',
      'MachviveWebmcpPolyfill',
      'TOOLS_CHANGED_EVENT',
      'installWebmcpPolyfill'
    ]);

    const declared = readFileSync(
      new URL('index.d.ts', root), 'utf8'
    ).match(/^\s*(\w+)[,\s]*$/gm).map((s) => s.trim().replace(',', ''));
    for (const name of ['MachviveWebmcpPolyfill', 'installWebmcpPolyfill', 'TOOLS_CHANGED_EVENT']) {
      assert.ok(declared.includes(name), `index.d.ts does not declare ${name}`);
    }
  });

  test('each exported class is wired to its tag', async () => {
    const index = await import('../index.js');
    assert.equal(customElements.get('machvive-lorum-ipsum'), index.MachviveLorumIpsum);
    assert.equal(customElements.get('machvive-webmcp-polyfill'), index.MachviveWebmcpPolyfill);
  });
});
