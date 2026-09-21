# @pepepow/pepew-js

Protocol utilities shared by PEPEW payment applications.

Current v0.1 scope:

- PEPEPOW P2PKH Base58Check validation
- exact PEPEW amount parsing/formatting with 8 decimal places
- PEPEW Payment URI v1 parsing
- deterministic Payment URI serialization
- shared machine-readable test vectors

## Development

Requires Node.js 20 or newer.

```bash
npm install
npm test
```

The production PEPEW Light host does not need Node.js to run this package. Applications can be built in CI or on a development machine and deployed as static artifacts.

## Example

```js
import {
  formatPaymentUri,
  parsePaymentUri,
} from "@pepepow/pepew-js";

const uri = formatPaymentUri({
  address: "PRfbEeHAKKbz6Voz85WJudrJwTA3ZbHunb",
  amount: "12.34",
  label: "Coffee Shop",
  message: "Order 1234",
});

const payment = parsePaymentUri(uri);
console.log(payment.amountSats); // 1234000000n
```

## Specification

See:

```text
../../specs/payment-uri/v1.md
../../test-vectors/payment-uri-v1.json
```

The package is intentionally marked private during the initial protocol phase. Package publication/versioning can be enabled after the v1 API is reviewed and stabilized.
