import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
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

  test('declares no runtime dependencies', () => {
    // The package is dependency-free by design, and the specific failure this
    // guards against is a self-reference: an `npm install <this package>` run
    // with the repo as its working directory adds one silently, and `git add -A`
    // then ships it. Consumers are unaffected (npm dedupes it) but npmjs.org
    // renders the package as depending on itself.
    assert.equal(pkg.dependencies, undefined, `unexpected dependencies: ${JSON.stringify(pkg.dependencies)}`);
    assert.equal(pkg.peerDependencies, undefined);
    assert.equal(pkg.optionalDependencies, undefined);
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
    // npm 11 reports an array of package objects; npm 12 reports an object keyed
    // by package name. Accept either, or this test passes locally and fails in
    // CI purely because the runner has a different npm.
    const parsed = JSON.parse(out);
    const entry = Array.isArray(parsed) ? parsed[0] : Object.values(parsed)[0];
    assert.ok(entry?.files, `unrecognized npm pack --json shape: ${out.slice(0, 120)}`);
    files = entry.files.map((f) => f.path);
  });

  test('ships each entry point and its declarations', () => {
    for (const expected of [
      'index.js',
      'index.d.ts',
      'src/wc/machvive-lorum-ipsum/machvive-lorum-ipsum.js',
      'src/wc/machvive-lorum-ipsum/machvive-lorum-ipsum.d.ts',
      'src/wc/machvive-webmcp-polyfill/machvive-webmcp-polyfill.js',
      'src/wc/machvive-webmcp-polyfill/machvive-webmcp-polyfill.d.ts',
      'src/wc/machvive-webmcp-inspect/machvive-webmcp-inspect.js',
      'src/wc/machvive-webmcp-inspect/machvive-webmcp-inspect.d.ts',
      'src/wc/machvive-webmcp-analytics/machvive-webmcp-analytics.js',
      'src/wc/machvive-webmcp-analytics/machvive-webmcp-analytics.d.ts',
      'src/wc/machvive-m5t-magnet/machvive-m5t-magnet.js',
      'src/wc/machvive-m5t-magnet/machvive-m5t-magnet.d.ts'
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
    for (const tag of [
      'machvive-lorum-ipsum',
      'machvive-webmcp-polyfill',
      'machvive-webmcp-inspect',
      'machvive-webmcp-analytics',
      'machvive-webmcp-products',
      'machvive-m5t-magnet'
    ]) {
      assert.ok(customElements.get(tag), `${tag} was not registered`);
    }
  });

  test('re-exports exactly what index.d.ts declares', async () => {
    const index = await import('../index.js');
    assert.deepEqual(Object.keys(index).sort(), [
      'CALL_EVENT',
      'CallLog',
      'LANGUAGES',
      'MachviveLorumIpsum',
      'MachviveM5tMagnet',
      'MachviveWebmcpAnalytics',
      'MachviveWebmcpInspect',
      'MachviveWebmcpPolyfill',
      'MachviveWebmcpProducts',
      'PRODUCT_TOOLS',
      'TOOLS_CHANGED_EVENT',
      'WORD_BANKS',
      'callLog',
      'collectProducts',
      'facetsOf',
      'installAnalytics',
      'installWebmcpPolyfill',
      'loremIpsum',
      'loremSentence',
      'normalizeProduct',
      'readDocumentJsonLd'
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

describe('network surface', () => {
  test('shipped runtime code contains no external URLs', () => {
    // The package reaches nowhere on its own. Where a hosted magnet is served
    // from is the integrator's runtime configuration, not something this package
    // embeds — so shipped code should contain no external URL at all, and an
    // audit should find nothing to ask about.
    const found = new Set();

    const walk = (dir) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = `${dir}/${entry.name}`;
        if (entry.isDirectory()) { walk(full); continue; }
        if (!entry.name.endsWith('.js')) continue;
        for (const line of readFileSync(full, 'utf8').split('\n')) {
          const code = line.trim();
          // Doc links in comments are not a runtime network surface.
          if (code.startsWith('*') || code.startsWith('//') || code.startsWith('/*')) continue;
          for (const m of line.matchAll(/https?:\/\/[^\s'"`)]+/g)) found.add(m[0]);
        }
      }
    };
    walk(fileURLToPath(new URL('src', root)));
    for (const m of readFileSync(fileURLToPath(new URL('index.js', root)), 'utf8').matchAll(/https?:\/\/[^\s'"`)]+/g)) {
      found.add(m[0]);
    }

    assert.deepEqual([...found], [], `shipped code must contain no external URLs: ${[...found].join(', ')}`);
  });
});
