# PEPEW SDK First npm Release

Last updated: 2026-10-01

This runbook closes Phase I / I1 by publishing the first public SDK releases:

```text
@pepepow/pepew-js             0.1.0
@pepepow/pepewpay-merchant    0.1.0
```

The first publish is intentionally interactive. Do not create a long-lived npm
write token only to bootstrap these packages. After the packages exist, switch
future releases to npm trusted publishing through GitHub Actions OIDC.

## 1. Security boundary

Never put any of the following in GitHub, chat, shell command arguments, package
contents, CI logs, or documentation examples:

- npm password
- npm OTP / 2FA recovery code
- npm session or access token
- merchant API key or webhook signing secret
- wallet mnemonic or private key

Use npm's normal interactive login and 2FA prompt on a trusted operator machine
for the first publish.

## 2. npm account / scope prerequisite

Before creating release tags:

1. sign in to npmjs.com with the intended maintainer account;
2. enable account-level 2FA;
3. confirm that the maintainer controls the npm organization/scope `@pepepow`;
4. if the organization does not exist, create npm organization `pepepow` using the public-packages plan;
5. do not change the package names to an unrelated scope merely to bypass this ownership gate.

Scoped public packages must be published with public access.

## 3. Release source prerequisite

GitHub `main` is the source of truth.

Before first publish:

- both package versions must still be `0.1.0`;
- DevKit CI for the selected commit must be green;
- distribution tests must pass, including `npm pack`, clean temporary install, and public import smoke;
- the working tree used for interactive publish must be the exact tagged commit;
- do not publish from an uncommitted or locally modified tree.

Release tags for the first publish:

```text
pepew-js-v0.1.0
pepewpay-merchant-v0.1.0
```

Both tags may point to the same tested release-preparation commit.

## 4. Interactive first publish

On a trusted operator machine with Node.js 20+ and current npm:

```bash
npm login
npm whoami
```

Confirm the `@pepepow` organization membership/control in npm before continuing.

Check out the exact release tag, then verify the tree is clean.

For `pepew-js`:

```bash
git checkout pepew-js-v0.1.0
git status --porcelain

cd packages/pepew-js
npm install --no-audit --no-fund
npm test
npm pack --dry-run
npm publish --access public
```

For the merchant SDK:

```bash
git checkout pepewpay-merchant-v0.1.0
git status --porcelain

cd packages/pepewpay-merchant
npm install --no-audit --no-fund
npm test
npm pack --dry-run
npm publish --access public
```

Allow npm to request 2FA interactively. Do not pass an OTP on the command line.

If either publish reports that the scope is not owned or the package cannot be created, stop. Do not rename the package, create a token workaround, or publish under another account without updating the project distribution decision.

## 5. Registry verification

After each successful publish, verify the public registry from a clean directory.

```bash
tmp_dir="$(mktemp -d)"
cd "$tmp_dir"
npm init -y

npm install --no-audit --no-fund @pepepow/pepew-js@0.1.0
node --input-type=module --eval '
  import { formatPaymentUri } from "@pepepow/pepew-js";
  const value = formatPaymentUri({
    address: "PRfbEeHAKKbz6Voz85WJudrJwTA3ZbHunb",
    amount: "1"
  });
  if (!value.includes("amount=1")) process.exit(1);
'

npm install --no-audit --no-fund @pepepow/pepewpay-merchant@0.1.0
node --input-type=module --eval '
  import { buildCheckoutUrl } from "@pepepow/pepewpay-merchant";
  if (buildCheckoutUrl("pay_abcdefgh") !==
      "https://pay.pepepow.net/?payment_id=pay_abcdefgh") process.exit(1);
'
```

Also verify that both npm package pages show version `0.1.0` and public visibility.

## 6. Configure trusted publishing after first publish

The repository contains:

```text
.github/workflows/npm-release.yml
```

After each package exists on npm, configure that package's Trusted Publisher:

```text
Provider: GitHub Actions
GitHub owner/user: edisontw
Repository: pepepow-devkit
Workflow filename: npm-release.yml
Allowed action: npm publish
```

The repository is currently private. Trusted publishing can still provide OIDC authentication, but npm provenance is not generated for a private source repository. Repository visibility is a separate security decision; do not make the repository public only to obtain provenance.

The workflow intentionally contains no `NODE_AUTH_TOKEN` / npm write token. It uses GitHub-hosted runners with `id-token: write`, Node 24, and a current npm 11 release.

## 7. Future release procedure

For a later package version:

1. update only the intended package version and release notes;
2. merge to `main` and require green CI;
3. create a package-specific exact version tag;
4. manually run **npm release (trusted publishing)** and supply that tag and package;
5. the workflow verifies tag/version correspondence, reruns package tests, and publishes through OIDC;
6. verify a clean registry install/import;
7. update DevKit README and the canonical Payment Platform roadmap.

Do not reuse a released npm version. npm package versions are immutable.
