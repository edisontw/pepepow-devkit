#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
ARCHIVE="${1:-${ROOT_DIR}/dist/pepew-payments.zip}"

test -f "${ARCHIVE}"
unzip -tq "${ARCHIVE}" >/dev/null

LIST="$(unzip -Z1 "${ARCHIVE}")"

for required in   pepew-payments/pepew-payments.php   pepew-payments/uninstall.php   pepew-payments/README.md   pepew-payments/LICENSE   pepew-payments/assets/js/blocks.js   pepew-payments/includes/class-pepew-wc-gateway.php   pepew-payments/includes/class-pepew-wc-webhook-handler.php; do
  grep -Fxq "${required}" <<<"${LIST}" || {
    echo "Missing required package entry: ${required}" >&2
    exit 1
  }
done

if grep -E '(^|/)(wp-env|tests|scripts|dist|node_modules)(/|$)|(^|/)\.git|\.env($|/)' <<<"${LIST}"; then
  echo "Development/test-only files leaked into WooCommerce plugin ZIP." >&2
  exit 1
fi

if grep -v '^pepew-payments/' <<<"${LIST}" | grep -q .; then
  echo "Plugin ZIP contains entries outside the pepew-payments/ root." >&2
  exit 1
fi

HEADER="$(unzip -p "${ARCHIVE}" pepew-payments/pepew-payments.php | head -n 40)"
grep -Fq 'Requires Plugins: woocommerce' <<<"${HEADER}"
grep -Fq 'WC tested up to: 11.1.2' <<<"${HEADER}"
grep -Fq 'License: MIT' <<<"${HEADER}"

echo "WooCommerce plugin package verification passed."
