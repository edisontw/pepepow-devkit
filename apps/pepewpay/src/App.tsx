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

type CopyState = "idle" | "copied" | "failed";

const initialInput = typeof window === "undefined"
  ? { address: "", amount: undefined, label: undefined, message: undefined }
  : paymentInputFromSearch(window.location.search);

function errorMessage(error: unknown): string {
  if (error instanceof PaymentUriError) {
    if (error.code === "invalid_address") return "Enter a valid PEPEW address.";
    if (error.code === "invalid_amount") return "Enter a PEPEW amount greater than zero with at most 8 decimals.";
    return error.message;
  }
  return error instanceof Error ? error.message : "Unable to create payment request.";
}

export default function App() {
  const [address, setAddress] = useState(initialInput.address);
  const [amount, setAmount] = useState(initialInput.amount ?? "");
  const [label, setLabel] = useState(initialInput.label ?? "");
  const [message, setMessage] = useState(initialInput.message ?? "");
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
      return { uri: "", error: errorMessage(error) };
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
    return paymentInputToShareUrl(payment, window.location.href);
  }, [payment, uriResult.uri]);

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
  };

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
          <span className="eyebrow">PEPEW Payment URI v1</span>
          <h1>Create a payment request</h1>
          <p>
            Generate a standard PEPEW payment URI and QR code. PepewPay never asks for a
            mnemonic or private key and never signs transactions.
          </p>
        </div>
        <div className="security-chip">Public payment data only</div>
      </section>

      <div className="content-grid">
        <section className="panel form-panel">
          <h2>Payment details</h2>

          <label>
            <span>Receiving address</span>
            <input
              autoComplete="off"
              spellCheck={false}
              value={address}
              onChange={(event) => setAddress(event.target.value)}
              placeholder="P..."
            />
          </label>

          <label>
            <span>Amount (PEPEW)</span>
            <input
              inputMode="decimal"
              autoComplete="off"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              placeholder="12.34"
            />
          </label>

          <div className="two-column">
            <label>
              <span>Label <small>optional</small></span>
              <input
                value={label}
                onChange={(event) => setLabel(event.target.value)}
                placeholder="Merchant or recipient"
              />
            </label>

            <label>
              <span>Message <small>optional</small></span>
              <input
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                placeholder="Order 1234"
              />
            </label>
          </div>

          {uriResult.error ? (
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
              <span className="eyebrow">Checkout preview</span>
              <h2>{label || "PEPEW payment"}</h2>
            </div>
            <div className="amount-display">{amount || "—"} <small>PEPEW</small></div>
          </div>

          {uriResult.uri ? (
            <>
              <div className="qr-wrap">
                {qrDataUrl ? <img src={qrDataUrl} alt="PEPEW Payment URI QR code" /> : <div className="qr-placeholder">Generating QR…</div>}
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
                the existing PEPEW Light send page with only the recipient address and amount.
              </div>
            </>
          ) : (
            <div className="empty-state">
              Enter a valid address and amount to generate the checkout QR.
            </div>
          )}
        </section>
      </div>

      <section className="panel status-panel">
        <div>
          <span className="eyebrow">Payment status</span>
          <h2>Gateway connection comes next</h2>
          <p>
            This Phase C shell currently creates payment intent and wallet handoff only.
            Authoritative persisted payment state will come from the transaction-level
            Payment/Event Gateway, not from the address balance monitor.
          </p>
        </div>
        <div className="status-badge">Not connected</div>
      </section>

      <footer>
        <span>PepewPay does not hold funds or wallet secrets.</span>
        <span>PEPEW Payment URI v1</span>
      </footer>
    </main>
  );
}
