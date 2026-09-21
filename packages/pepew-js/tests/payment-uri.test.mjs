import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  PaymentUriError,
  formatPaymentUri,
  formatPepewAmount,
  isValidPepewAddress,
  parsePaymentUri,
  parsePepewAmount,
} from "../dist/index.js";

const vectorsUrl = new URL("../../../test-vectors/payment-uri-v1.json", import.meta.url);
const vectors = JSON.parse(fs.readFileSync(vectorsUrl, "utf8"));

test("known production fixture address validates", () => {
  assert.equal(isValidPepewAddress(vectors.knownAddress), true);
  assert.equal(isValidPepewAddress("1BoatSLRHtKNngkdXEeobR76b53LETtpyT"), false);
});

test("amount handling is exact at eight decimals", () => {
  assert.equal(parsePepewAmount("1"), 100000000n);
  assert.equal(parsePepewAmount("0.00000001"), 1n);
  assert.equal(parsePepewAmount("12.34000000"), 1234000000n);
  assert.equal(formatPepewAmount(1234000000n), "12.34");
  assert.throws(() => parsePepewAmount("0"));
  assert.throws(() => parsePepewAmount("1e-8"));
  assert.throws(() => parsePepewAmount("0.000000001"));
});

for (const vector of vectors.valid) {
  test(`valid vector: ${vector.name}`, () => {
    const parsed = parsePaymentUri(vector.uri);

    assert.equal(parsed.address, vectors.knownAddress);
    assert.equal(parsed.amountSats?.toString() ?? null, vector.amountSats);

    if ("label" in vector) {
      assert.equal(parsed.label, vector.label);
    }
    if ("message" in vector) {
      assert.equal(parsed.message, vector.message);
    }
    if ("extras" in vector) {
      assert.deepEqual(parsed.extras, vector.extras);
    }

    assert.equal(formatPaymentUri(parsed), vector.canonical);
  });
}

for (const vector of vectors.invalid) {
  test(`invalid vector: ${vector.name}`, () => {
    assert.throws(
      () => parsePaymentUri(vector.uri),
      (error) => error instanceof PaymentUriError && error.code === vector.code,
    );
  });
}

test("serializer has deterministic known-field and sorted-extra ordering", () => {
  const uri = formatPaymentUri({
    address: vectors.knownAddress,
    amount: "5.00000000",
    label: "Shop",
    message: "Invoice 42",
    extras: {
      zeta: "last",
      alpha: "first",
    },
  });

  assert.equal(
    uri,
    "pepew:PRfbEeHAKKbz6Voz85WJudrJwTA3ZbHunb?amount=5&label=Shop&message=Invoice%2042&alpha=first&zeta=last",
  );
});
