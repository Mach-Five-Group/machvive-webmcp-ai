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

**This package makes no network requests.** Nothing in it contacts a remote host,
and it contains no external URLs — a test asserts that shipped code has none, so
one cannot appear unnoticed.

`machvive-m5t-magnet` bridges a hosted [MachFive Magnet](https://machfivemagnet.com/)
widget, but it does not decide where that widget comes from. You supply the origin
at runtime:

```html
<machvive-m5t-magnet app-guid="..." src="https://your-magnet-host/m5t/v5/coreSnippet">
</machvive-m5t-magnet>
```

Or load the magnet snippet yourself and the element bridges what is already there,
injecting nothing:

```html
<script src="https://your-magnet-host/...?appguid=..." async></script>
<machvive-m5t-magnet></machvive-m5t-magnet>
```

Once the magnet snippet loads, it is vendor code running under its own origin and
policy, communicating with its own backend to capture leads. That traffic is the
magnet's, governed by your magnet configuration, and is not something this package
originates or can see.
