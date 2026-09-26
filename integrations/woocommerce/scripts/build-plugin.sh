#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
PLUGIN_DIR="${ROOT_DIR}/pepew-payments"
DIST_DIR="${ROOT_DIR}/dist"
ARCHIVE="${DIST_DIR}/pepew-payments.zip"

rm -rf "${DIST_DIR}"
mkdir -p "${DIST_DIR}"

STAGE_DIR="$(mktemp -d)"
trap 'rm -rf "${STAGE_DIR}"' EXIT

TARGET="${STAGE_DIR}/pepew-payments"
mkdir -p "${TARGET}"

cp "${PLUGIN_DIR}/pepew-payments.php" "${TARGET}/"
cp "${PLUGIN_DIR}/uninstall.php" "${TARGET}/"
cp "${PLUGIN_DIR}/README.md" "${TARGET}/"
cp "${PLUGIN_DIR}/LICENSE" "${TARGET}/"
cp -R "${PLUGIN_DIR}/assets" "${TARGET}/assets"
cp -R "${PLUGIN_DIR}/includes" "${TARGET}/includes"

(
  cd "${STAGE_DIR}"
  zip -X -q -r "${ARCHIVE}" pepew-payments
)

(
  cd "${DIST_DIR}"
  sha256sum pepew-payments.zip > pepew-payments.zip.sha256
)

echo "Built ${ARCHIVE}"
