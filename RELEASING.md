# Releasing

This runbook is for maintainers publishing `@psycharch/weread` from
`PsychArch/weread-cli`.

## Before the first release

1. Reconfirm that `pnpm view @psycharch/weread` returns HTTP 404.
2. Create the public GitHub repository and push `main`.
3. Run the complete local gate:

   ```bash
   pnpm install --frozen-lockfile
   pnpm run verify
   WEREAD_API_KEY="wrk-..." pnpm run test:live
   pnpm dlx npm@11.18.0 publish --dry-run --access public
   ```

4. Publish `0.1.0` once from an npm account with two-factor authentication:

   ```bash
   pnpm publish --access public
   ```

   Supply the one-time password interactively when prompted. Never commit an
   npm token or place one in a command that will remain in shell history.

5. In the npm package settings, add a GitHub Actions trusted publisher for:

   - organization: `PsychArch`
   - repository: `weread-cli`
   - workflow: `publish.yml`
   - environment: leave blank

The bootstrap publish is necessary because trusted-publisher settings belong
to an existing npm package.

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
