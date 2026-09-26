<?php

define( 'PEPEW_WC_TESTING', true );
require_once __DIR__ . '/../pepew-payments/includes/class-pepew-wc-webhook-verifier.php';

function expect_verification_failure( callable $fn, string $label ): void {
	try {
		$fn();
		fwrite( STDERR, $label . " did not fail\n" );
		exit( 1 );
	} catch ( PEPEW_WC_Webhook_Verification_Exception $expected ) {
	}
}

$secret    = 'test_webhook_secret_0123456789_abcdef';
$event_id  = 'evt_' . str_repeat( 'a', 64 );
$timestamp = 1800000100;
$event     = array(
	'schema_version'  => 1,
	'event_id'        => $event_id,
	'event_type'      => 'payment.paid_confirmed',
	'payment_id'      => 'pay_mock00000001',
	'payment_version' => 3,
	'created_at'      => $timestamp,
	'data'            => array(
		'status'             => 'paid_confirmed',
		'merchant_reference' => 'woo:0123456789abcdef:123',
		'amount_sats'        => 1234000000,
	),
);
$body      = json_encode( $event, JSON_UNESCAPED_SLASHES );
$signature = 'v1=' . hash_hmac( 'sha256', $timestamp . '.' . $event_id . '.' . $body, $secret );
$headers   = array(
	'X-PepewPay-Event-Id'  => $event_id,
	'X-PepewPay-Timestamp' => (string) $timestamp,
	'X-PepewPay-Signature' => $signature,
);

$verified = PEPEW_WC_Webhook_Verifier::verify( $headers, $body, $secret, $timestamp );
if ( $verified['payment_version'] !== 3 || $verified['data']['status'] !== 'paid_confirmed' ) {
	fwrite( STDERR, "valid webhook failed\n" );
	exit( 1 );
}


$big_event_id = 'evt_' . str_repeat( 'c', 64 );
$big_body     = str_replace(
	'"amount_sats":1234000000',
	'"amount_sats":999999999999999999999999',
	str_replace(
		$event_id,
		$big_event_id,
		$body
	)
);
$big_signature = 'v1=' . hash_hmac( 'sha256', $timestamp . '.' . $big_event_id . '.' . $big_body, $secret );
$big_headers   = array(
	'X-PepewPay-Event-Id'  => $big_event_id,
	'X-PepewPay-Timestamp' => (string) $timestamp,
	'X-PepewPay-Signature' => $big_signature,
);
$big_verified = PEPEW_WC_Webhook_Verifier::verify( $big_headers, $big_body, $secret, $timestamp );
if ( (string) $big_verified['data']['amount_sats'] !== '999999999999999999999999' ) {
	fwrite( STDERR, "large amount webhook failed\n" );
	exit( 1 );
}

expect_verification_failure(
	static fn() => PEPEW_WC_Webhook_Verifier::verify( $headers, $body . ' ', $secret, $timestamp ),
	'tampered body'
);

expect_verification_failure(
	static fn() => PEPEW_WC_Webhook_Verifier::verify( $headers, $body, $secret, $timestamp + 301 ),
	'stale timestamp'
);

$bad_headers                         = $headers;
$bad_headers['X-PepewPay-Event-Id'] = 'evt_' . str_repeat( 'b', 64 );
expect_verification_failure(
	static fn() => PEPEW_WC_Webhook_Verifier::verify( $bad_headers, $body, $secret, $timestamp ),
	'event id mismatch'
);

echo "WooCommerce webhook verifier tests passed.\n";
