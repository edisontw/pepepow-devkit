<?php

define( 'PEPEW_WC_TESTING', true );
require_once __DIR__ . '/../pepew-payments/includes/class-pepew-wc-order-identity.php';

function expect_same( $expected, $actual, string $label ): void {
	if ( $expected !== $actual ) {
		fwrite( STDERR, $label . " failed\nExpected: " . var_export( $expected, true ) . "\nActual: " . var_export( $actual, true ) . "\n" );
		exit( 1 );
	}
}

$site_a = 'https://shop.example/';
$site_b = 'https://other.example/';

$hash_a = PEPEW_WC_Order_Identity::site_hash( $site_a );
expect_same( 16, strlen( $hash_a ), 'site hash length' );
expect_same( $hash_a, PEPEW_WC_Order_Identity::site_hash( 'https://SHOP.example' ), 'site hash normalization' );

$reference = PEPEW_WC_Order_Identity::merchant_reference( $site_a, 1234 );
$key       = PEPEW_WC_Order_Identity::idempotency_key( $site_a, 1234 );

expect_same( 'woo:' . $hash_a . ':1234', $reference, 'merchant reference' );
expect_same( 'woo:create:' . $hash_a . ':1234:v1', $key, 'idempotency key' );

if ( PEPEW_WC_Order_Identity::merchant_reference( $site_b, 1234 ) === $reference ) {
	fwrite( STDERR, "site isolation failed\n" );
	exit( 1 );
}

try {
	PEPEW_WC_Order_Identity::merchant_reference( $site_a, 0 );
	fwrite( STDERR, "invalid order id was accepted\n" );
	exit( 1 );
} catch ( InvalidArgumentException $expected ) {
	// Expected.
}

echo "WooCommerce identity tests passed.\n";
