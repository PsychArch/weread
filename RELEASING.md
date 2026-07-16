# Releasing

This runbook is for maintainers publishing `@psycharch/weread` from
`PsychArch/weread`.

## Bootstrap status

`@psycharch/weread@0.1.0` is public on npm with the `latest` tag, and the public
source repository is `PsychArch/weread`. The bootstrap release was published
locally, so it does not have a provenance attestation.

In the npm package settings, add a GitHub Actions trusted publisher for:

- organization: `PsychArch`
- repository: `weread`
- workflow: `publish.yml`
- environment: leave blank

This enables future releases to publish with short-lived OIDC credentials and
provenance instead of a long-lived npm token.

## Subsequent releases

1. Update `package.json`, `pnpm-lock.yaml`, and `CHANGELOG.md` to the same
   version.
2. Run `pnpm install --frozen-lockfile` and `pnpm run verify` on a clean `main`.
3. Commit and push the release changes.
4. Create and publish a GitHub release tagged exactly `v<package-version>`.

Publishing the GitHub release runs `.github/workflows/publish.yml`. The workflow
checks the tag/version match and invokes a pinned npm 11 CLI through pnpm. npm's
trusted-publishing exchange then uses short-lived OIDC credentials; no
long-lived npm token is required.

Verify the result:

```bash
pnpm view @psycharch/weread version dist-tags --json
```
