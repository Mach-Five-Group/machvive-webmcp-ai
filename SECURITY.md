# Security Policy

## Supported versions

The latest published version receives security fixes. Older versions are not
patched — upgrade to the current release.

## Reporting a vulnerability

Report privately via [GitHub Security Advisories](https://github.com/Mach-Five-Group/machvive-webmcp-ai/security/advisories/new).
Please do not open a public issue for a security report.

We aim to acknowledge within 3 business days.

## Supply chain

- **Zero runtime dependencies.** The published package pulls in nothing at
  install time; a test asserts the manifest declares no runtime, peer, or
  optional dependencies, and `prepublishOnly` runs it.
- **Published with provenance.** Releases are built and published by
  [a GitHub Actions workflow](.github/workflows/publish.yml) using npm trusted
  publishing, so every tarball carries a signed attestation linking it to the
  exact commit and workflow run that produced it. Verify with:

  ```bash
  npm audit signatures
  ```

- **No install scripts.** The package defines no `preinstall`, `install`, or
  `postinstall` hooks, so installing it executes no code.
- **Browser-only.** The components touch `navigator`, `customElements`, and
  IndexedDB. The analytics component stores captured tool calls in the visitor's
  own IndexedDB and pushes to `window.dataLayer` only when the `datalayer`
  attribute is set explicitly.

## Network behaviour

Most of this package makes **no network requests of any kind** — the polyfill,
inspector, analytics, and lorum-ipsum components are entirely local and send no
telemetry.

One component is different, by design:

**`machvive-m5t-magnet` loads a remote script.** It bridges a hosted
[MachFive Magnet](https://machfivemagnet.com/) widget, so it injects that
widget's snippet:

```
https://machfivemagnet-saas.onrender.com/m5t/v5/coreSnippet?appguid=<your-guid>
```

This is the only external URL in the package's runtime code, and automated
scanners will flag it — correctly. Three things bound it:

- It runs **only if you use that component** and give it an `app-guid`. Importing
  the package, or any other component, fetches nothing.
- The origin is overridable with the `src` attribute, so a self-hosted or
  proxied magnet never contacts the default host.
- If your page already carries a `coreSnippet` tag, the component uses it rather
  than loading a second copy.

Once loaded, the magnet snippet is vendor code running under its own origin and
policy; it communicates with its own backend to capture leads. That traffic is
the magnet's, not this package's, and is governed by your magnet configuration.

A test asserts that this remains the only external URL in shipped runtime code,
so a new one cannot appear unnoticed.
