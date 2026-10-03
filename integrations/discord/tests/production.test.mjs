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
