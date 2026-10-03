import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import test from "node:test";
import { MerchantApiError } from "@pepepow/pepewpay-merchant";

import { discordPaymentCreateFailureText } from "../src/production.mjs";

test("Discord maps Payment Platform address-window conflicts to a user message", () => {
  const conflict = new MerchantApiError(409, "payment_address_in_use");
  assert.match(
    discordPaymentCreateFailureText(conflict),
    /active time window/,
  );

  assert.match(
    discordPaymentCreateFailureText(
      new MerchantApiError(500, "payment_store_error"),
    ),
    /could not be created/,
  );
});


test("Discord production runtime has no global pending-payment gate", async () => {
  const source = await readFile(new URL("../src/production.mjs", import.meta.url), "utf8");
  assert.equal(source.includes("pendingPaymentCount(state) > 0"), false);
  assert.equal(source.includes("paymentCreationInProgress"), false);
  assert.equal(source.includes("A PEPEW payment is already in progress"), false);
});
