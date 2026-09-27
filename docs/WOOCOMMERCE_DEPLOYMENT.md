# PEPEW Payments for WooCommerce — Install and Production Acceptance

Last updated: 2026-09-26

Status: **I5.4 packaging/runtime acceptance implemented; staging/live paid E2E remains the final production-ready gate**

## Install

Use the CI-built artifact:

```text
pepew-payments.zip
```

In WordPress:

1. install and activate WooCommerce first
2. Plugins -> Add Plugin -> Upload Plugin
3. upload `pepew-payments.zip`
4. activate PEPEW Payments for WooCommerce
5. set the WooCommerce store currency to `PEPEW`
6. open WooCommerce -> Settings -> Payments -> PEPEW

WordPress 6.5+ reads the plugin's `Requires Plugins: woocommerce` dependency.
The plugin must not be activated as a working payment gateway without
WooCommerce.

## Required merchant settings

Configure server-side only:

- Payment API origin
- PepewPay checkout base URL
- merchant API key
- merchant PEPEW receiving address
- webhook signing secret
- required confirmations
- payment expiry

Never expose the merchant API key or webhook signing secret to browser code,
order notes, public logs, screenshots, or support tickets.

## Webhook registration

Register exactly:

```text
https://<shop-host>/wp-json/pepew/v1/webhook
```

The endpoint must be public HTTPS so PEPEW Payment Platform can deliver events.

Store the endpoint signing secret returned at registration in the PEPEW gateway
setting. Secret rotation is a coordinated operation:

1. create/register the replacement webhook endpoint/secret on Payment Platform
2. update the Woo gateway secret immediately
3. verify delivery with a new payment
4. retire the old endpoint/secret only after the new path is confirmed

Do not place webhook secrets in URLs.

## Upgrade

Plugin upgrades must preserve:

- `woocommerce_pepew_settings`
- Woo order PEPEW payment metadata
- current payment/version/review state

CI force-installs the built ZIP over the installed copy and verifies that the
merchant settings survive.

Before a production upgrade:

1. back up WordPress database/files using the merchant's normal site procedure
2. keep the current plugin ZIP available for rollback
3. install the new tested ZIP
4. verify PEPEW remains enabled and settings are present
5. perform an unpaid checkout smoke before accepting customer traffic

## Deactivate vs uninstall

Deactivation preserves settings and all order metadata.

Explicit uninstall/delete removes the gateway settings option, including the
merchant API key and webhook signing secret.

Historical order PEPEW metadata is intentionally preserved on uninstall. It is
merchant reconciliation/audit data and must not be silently destroyed by
deleting the integration plugin.

## Automated package acceptance

CI verifies:

- ZIP integrity
- exactly one `pepew-payments/` root
- required runtime PHP/JS files, README and MIT license
- no `wp-env`, tests, scripts, dist, node_modules, git, or env files inside the ZIP
- WordPress/WooCommerce version/dependency headers
- clean WordPress ZIP installation
- activation with WooCommerce present
- upgrade/overwrite preserves merchant settings
- activation is rejected while required WooCommerce is inactive
- activation succeeds again after WooCommerce is restored
- explicit uninstall deletes merchant settings/secrets
- merchant lifecycle runtime smoke for repeated checkout, uncertain-create recovery, duplicate/stale webhook handling, confirmed payment and higher-version reorg rollback

## Final staging/live acceptance gate

Do not call the plugin production-ready until one externally reachable staging
or merchant WooCommerce site completes this checklist against the real Payment
Platform:

- [ ] install the exact CI-built ZIP
- [ ] HTTPS storefront and REST webhook endpoint are externally reachable
- [ ] configure a dedicated merchant API key and receiving address
- [ ] register the staging Woo webhook endpoint and store its signing secret
- [ ] create a small PEPEW-priced product/order
- [ ] use the current Checkout Block path
- [ ] before paying, retry/back-forward once and confirm the same Woo order reuses the same payment capability
- [ ] open PepewPay and hand off to a non-custodial wallet
- [ ] wallet signs locally; WordPress/Payment Platform never receives mnemonic/private key
- [ ] use a payer address that differs from the merchant receiving address; the current PEPEW Light web wallet returns change to the sender address, so self-payment to the same merchant address can produce both a payment output and a change output to the invoice address and is not a representative acceptance test
- [ ] broadcast one small real transaction
- [ ] observe authoritative payment state reach `paid_unconfirmed`
- [ ] if an overpayment occurs, verify Woo remains on-hold until `policy_confirmed_sats` reaches the requested amount; unconfirmed overpayment must not bypass the configured confirmation policy
- [ ] observe a signed webhook move the Woo order to on-hold
- [ ] after required confirmations, observe `paid_confirmed`
- [ ] observe WooCommerce `payment_complete()` transition the order to processing/completed as appropriate
- [ ] confirm no API key/webhook secret appears in browser source, URLs, Woo order notes, or application logs
- [ ] record payment ID, Woo order ID, timestamps and final result in the acceptance record without recording secrets

Reorg/duplicate-event behavior is covered by deterministic and real Woo runtime
tests. Do not manufacture fake production webhooks against a real merchant
order merely to force a reorg scenario.

## Rollback

If the staging/live paid E2E fails:

- disable the PEPEW gateway in WooCommerce
- do not delete the order or its PEPEW metadata
- do not rotate/delete secrets until the failure mode is understood unless a secret is suspected compromised
- inspect WordPress/PHP logs, Payment Platform event/webhook state, and the exact Woo order/payment IDs
- keep Payment Platform authoritative; do not manually mark a blockchain payment confirmed based only on Woo state

Host-specific deployment or production inspection should be performed on the
merchant/staging host, not on VM-A/VM-B unless that host actually serves the
WooCommerce site.
