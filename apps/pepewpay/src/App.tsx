import { useEffect, useMemo, useState } from "react";
import QRCode from "qrcode";
import { PaymentUriError } from "@pepepow/pepew-js";

import {
  DEFAULT_WEB_WALLET_URL,
  buildPaymentUri,
  buildWebWalletHandoffUrl,
  paymentInputFromSearch,
  paymentInputToShareUrl,
} from "./lib/handoff";
import {
  DEFAULT_PAYMENT_API_BASE_URL,
  PAYMENT_STATUS_POLL_MS,
  PaymentStatusError,
  fetchPaymentStatus,
  paymentIdFromSearch,
  paymentProgressPercent,
  paymentStatusPresentation,
  paymentStatusShareUrl,
  type PersistedPaymentStatus,
} from "./lib/payment-status";

type CopyState = "idle" | "copied" | "failed";

function paymentErrorMessage(error: unknown): string {
  if (error instanceof PaymentUriError) {
    if (error.code === "invalid_address") return "Enter a valid PEPEW address.";
    if (error.code === "invalid_amount") return "Enter a PEPEW amount greater than zero with at most 8 decimals.";
    return error.message;
  }
  return error instanceof Error ? error.message : "Unable to create payment request.";
}

function statusErrorMessage(error: unknown): string {
  if (error instanceof PaymentStatusError) {
    if (error.code === "invalid_payment_id") return "This payment link is invalid.";
    if (error.code === "payment_not_found") return "This persisted payment could not be found.";
    if (error.code === "payment_api_disabled") return "Persisted payment status is not enabled on the server yet.";
    return "Payment status is temporarily unavailable.";
  }
  return "Payment status is temporarily unavailable.";
}

const initialCheckout = (() => {
  if (typeof window === "undefined") {
    return {
      capabilityRequested: false,
      paymentId: undefined as string | undefined,
      capabilityError: "",
      input: { address: "", amount: undefined, label: undefined, message: undefined },
    };
  }

  const capabilityRequested = new URLSearchParams(window.location.search).has("payment_id");
  try {
    return {
      capabilityRequested,
      paymentId: paymentIdFromSearch(window.location.search),
      capabilityError: "",
      input: paymentInputFromSearch(window.location.search),
    };
  } catch (error) {
    return {
      capabilityRequested,
      paymentId: undefined,
      capabilityError: statusErrorMessage(error),
      input: { address: "", amount: undefined, label: undefined, message: undefined },
    };
  }
})();

export default function App() {
  const managedMode = initialCheckout.capabilityRequested;
  const paymentId = initialCheckout.paymentId;
  const paymentApiBaseUrl =
    import.meta.env.VITE_PAYMENT_API_BASE_URL || DEFAULT_PAYMENT_API_BASE_URL;

  const [address, setAddress] = useState(initialCheckout.input.address);
  const [amount, setAmount] = useState(initialCheckout.input.amount ?? "");
  const [label, setLabel] = useState(initialCheckout.input.label ?? "");
  const [message, setMessage] = useState(initialCheckout.input.message ?? "");
  const [persisted, setPersisted] = useState<PersistedPaymentStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(Boolean(paymentId));
  const [statusError, setStatusError] = useState(initialCheckout.capabilityError);
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [copyState, setCopyState] = useState<CopyState>("idle");

  const payment = useMemo(() => ({
    address: address.trim(),
    amount: amount.trim() || undefined,
    label: label.trim() || undefined,
    message: message.trim() || undefined,
  }), [address, amount, label, message]);

  const uriResult = useMemo(() => {
    try {
      return { uri: buildPaymentUri(payment), error: "" };
    } catch (error) {
      return { uri: "", error: paymentErrorMessage(error) };
    }
  }, [payment]);

  const webWalletUrl = useMemo(() => {
    if (!uriResult.uri) return "";
    try {
      return buildWebWalletHandoffUrl(
        payment,
        import.meta.env.VITE_PEPEW_WEB_WALLET_URL || DEFAULT_WEB_WALLET_URL,
      );
    } catch {
      return "";
    }
  }, [payment, uriResult.uri]);

  const shareUrl = useMemo(() => {
    if (!uriResult.uri || typeof window === "undefined") return "";
    if (paymentId) return paymentStatusShareUrl(paymentId, window.location.href);
    return paymentInputToShareUrl(payment, window.location.href);
  }, [payment, paymentId, uriResult.uri]);

  useEffect(() => {
    if (!paymentId) return;

    let cancelled = false;
    let inFlight = false;
    let controller: AbortController | null = null;

    const refresh = async () => {
      if (cancelled || inFlight || document.visibilityState === "hidden") return;
      inFlight = true;
      controller = new AbortController();

      try {
        const next = await fetchPaymentStatus(
          paymentId,
          paymentApiBaseUrl,
          controller.signal,
        );
        if (cancelled) return;

        setPersisted(next);
        setAddress(next.address);
        setAmount(next.amount);
        setLabel(next.label ?? "");
        setMessage(next.message ?? "");
        setStatusError("");
      } catch (error) {
        if (!cancelled && !(error instanceof DOMException && error.name === "AbortError")) {
          setStatusError(statusErrorMessage(error));
        }
      } finally {
        if (!cancelled) setStatusLoading(false);
        inFlight = false;
      }
    };

    void refresh();
    const timer = window.setInterval(() => {
      void refresh();
    }, PAYMENT_STATUS_POLL_MS);

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      cancelled = true;
      controller?.abort();
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [paymentApiBaseUrl, paymentId]);

  useEffect(() => {
    let cancelled = false;
    if (!uriResult.uri) {
      setQrDataUrl("");
      return;
    }

    void QRCode.toDataURL(uriResult.uri, {
      width: 320,
      margin: 2,
      errorCorrectionLevel: "M",
    }).then((dataUrl) => {
      if (!cancelled) setQrDataUrl(dataUrl);
    }).catch(() => {
      if (!cancelled) setQrDataUrl("");
    });

    return () => {
      cancelled = true;
    };
  }, [uriResult.uri]);

  useEffect(() => {
    setCopyState("idle");
  }, [uriResult.uri]);

  const copyUri = async () => {
    if (!uriResult.uri) return;
    try {
      await navigator.clipboard.writeText(uriResult.uri);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
  };

  const share = async () => {
    if (!shareUrl || !uriResult.uri) return;
    try {
      if (navigator.share) {
        await navigator.share({
          title: label || "PEPEW payment request",
          text: uriResult.uri,
          url: shareUrl,
        });
        return;
      }
      await navigator.clipboard.writeText(shareUrl);
      setCopyState("copied");
    } catch {
      // User cancellation or unavailable clipboard should not alter payment state.
    }
  };

  const statusView = persisted ? paymentStatusPresentation(persisted) : null;
  const progress = persisted ? paymentProgressPercent(persisted) : 0;

  return (
    <main className="page-shell">
      <header className="brand-row">
        <div className="brand-mark">P</div>
        <div>
          <div className="brand-name">PepewPay</div>
          <div className="brand-subtitle">Non-custodial PEPEW payment handoff</div>
        </div>
      </header>

      <section className="hero">
        <div>
          <span className="eyebrow">
            {managedMode ? "Persisted PEPEW checkout" : "PEPEW Payment URI v1"}
          </span>
          <h1>{managedMode ? "Complete your PEPEW payment" : "Create a payment request"}</h1>
          <p>
            {managedMode
              ? "This checkout reads transaction-level payment state from the Payment/Event Gateway. Wallet signing remains entirely client-side."
              : "Generate a standard PEPEW payment URI and QR code. PepewPay never asks for a mnemonic or private key and never signs transactions."}
          </p>
        </div>
        <div className="security-chip">
          {managedMode ? "Transaction-level status" : "Public payment data only"}
        </div>
      </section>

      <div className="content-grid">
        <section className="panel form-panel">
          <h2>{managedMode ? "Persisted payment details" : "Payment details"}</h2>

          <label>
            <span>Receiving address</span>
            <input
              autoComplete="off"
              spellCheck={false}
              value={address}
              onChange={(event) => setAddress(event.target.value)}
              placeholder={managedMode && statusLoading ? "Loading…" : "P..."}
              readOnly={managedMode}
            />
          </label>

          <label>
            <span>Amount (PEPEW)</span>
            <input
              inputMode="decimal"
              autoComplete="off"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              placeholder={managedMode && statusLoading ? "Loading…" : "12.34"}
              readOnly={managedMode}
            />
          </label>

          <div className="two-column">
            <label>
              <span>Label <small>optional</small></span>
              <input
                value={label}
                onChange={(event) => setLabel(event.target.value)}
                placeholder="Merchant or recipient"
                readOnly={managedMode}
              />
            </label>

            <label>
              <span>Message <small>optional</small></span>
              <input
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                placeholder="Order 1234"
                readOnly={managedMode}
              />
            </label>
          </div>

          {managedMode ? (
            statusError ? (
              <div className="notice error" role="alert">{statusError}</div>
            ) : (
              <div className="notice">
                These fields come from the persisted payment record and cannot be edited in checkout mode.
              </div>
            )
          ) : uriResult.error ? (
            <div className="notice error" role="alert">{uriResult.error}</div>
          ) : (
            <div className="notice">
              Address and amount are validated locally in the browser using <code>pepew-js</code>.
            </div>
          )}
        </section>

        <section className="panel checkout-panel">
          <div className="checkout-heading">
            <div>
              <span className="eyebrow">Checkout</span>
              <h2>{label || "PEPEW payment"}</h2>
            </div>
            <div className="amount-display">{amount || "—"} <small>PEPEW</small></div>
          </div>

          {uriResult.uri ? (
            <>
              <div className="qr-wrap">
                {qrDataUrl
                  ? <img src={qrDataUrl} alt="PEPEW Payment URI QR code" />
                  : <div className="qr-placeholder">Generating QR…</div>}
              </div>

              <div className="uri-box">
                <span>Payment URI</span>
                <code>{uriResult.uri}</code>
              </div>

              <div className="action-grid">
                <a className="button primary" href={uriResult.uri}>Open wallet app</a>
                {webWalletUrl && <a className="button" href={webWalletUrl}>Open PEPEW web wallet</a>}
                <button className="button" type="button" onClick={copyUri}>
                  {copyState === "copied" ? "Copied" : copyState === "failed" ? "Copy failed" : "Copy URI"}
                </button>
                <button className="button" type="button" onClick={() => void share()}>
                  Share request
                </button>
              </div>

              <div className="handoff-note">
                The native button uses the <code>pepew:</code> URI. The web-wallet fallback opens
                PEPEW Light with only the recipient address and amount. Signing stays in the wallet.
              </div>
            </>
          ) : (
            <div className="empty-state">
              {managedMode
                ? statusLoading
                  ? "Loading persisted checkout…"
                  : statusError || "Unable to create the checkout QR."
                : "Enter a valid address and amount to generate the checkout QR."}
            </div>
          )}
        </section>
      </div>

      <section className={`panel status-panel ${statusView ? `status-${statusView.tone}` : ""}`}>
        {managedMode ? (
          statusLoading && !persisted ? (
            <>
              <div>
                <span className="eyebrow">Payment status</span>
                <h2>Loading persisted status</h2>
                <p>Reading the transaction-level payment record from the Payment/Event Gateway.</p>
              </div>
              <div className="status-badge">Loading</div>
            </>
          ) : persisted && statusView ? (
            <>
              <div className="status-content">
                <span className="eyebrow">Payment status</span>
                <h2>{statusView.title}</h2>
                <p>{statusView.detail}</p>

                <div className="progress-track" aria-label="Payment amount progress">
                  <div className="progress-fill" style={{ width: `${progress}%` }} />
                </div>

                <div className="status-facts">
                  <span><strong>{persisted.received}</strong> PEPEW received</span>
                  <span><strong>{persisted.policy_confirmed}</strong> PEPEW confirmed by policy</span>
                  <span><strong>{persisted.confirmations_required}</strong> confirmations required</span>
                  <span>Version <strong>{persisted.version}</strong></span>
                </div>

                <p className="capability-note">
                  Status link is a read-only capability. Anyone with this checkout URL can view this payment status.
                </p>
              </div>
              <div className="status-badge">{persisted.status.replaceAll("_", " ")}</div>
            </>
          ) : (
            <>
              <div>
                <span className="eyebrow">Payment status</span>
                <h2>Status unavailable</h2>
                <p>{statusError || "The persisted payment status could not be loaded."}</p>
              </div>
              <div className="status-badge">Unavailable</div>
            </>
          )
        ) : (
          <>
            <div>
              <span className="eyebrow">Payment status</span>
              <h2>Standalone request</h2>
              <p>
                This local mode only creates Payment URI/QR data. Merchant checkout links use a high-entropy
                <code> payment_id </code> to display authoritative persisted transaction status.
              </p>
            </div>
            <div className="status-badge">Local only</div>
          </>
        )}
      </section>

      <footer>
        <span>PepewPay does not hold funds or wallet secrets.</span>
        <span>{managedMode ? "Transaction-level checkout" : "PEPEW Payment URI v1"}</span>
      </footer>
    </main>
  );
}
