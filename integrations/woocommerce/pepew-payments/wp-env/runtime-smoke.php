<?php

if ( ! defined( 'ABSPATH' ) ) {
	fwrite( STDERR, "WordPress runtime is required.\n" );
	exit( 1 );
}

if ( ! defined( 'WC_VERSION' ) || '11.1.2' !== WC_VERSION ) {
	fwrite( STDERR, 'Unexpected WooCommerce version: ' . ( defined( 'WC_VERSION' ) ? WC_VERSION : 'missing' ) . "\n" );
	exit( 1 );
}

if ( '7.1.2' !== get_bloginfo( 'version' ) ) {
	fwrite( STDERR, 'Unexpected WordPress version: ' . get_bloginfo( 'version' ) . "\n" );
	exit( 1 );
}

$expected_storage = (string) get_option( 'pepew_test_expected_hpos', '' );
$actual_storage   = \Automattic\WooCommerce\Utilities\OrderUtil::custom_orders_table_usage_is_enabled()
	? 'hpos'
	: 'legacy';

if ( $expected_storage !== $actual_storage ) {
	fwrite( STDERR, "Storage mode mismatch: expected {$expected_storage}, got {$actual_storage}\n" );
	exit( 1 );
}

update_option( 'woocommerce_currency', 'PEPEW' );
update_option(
	'woocommerce_pepew_settings',
	array(
		'enabled'           => 'yes',
		'title'             => 'Pay with PEPEW',
		'description'       => 'Pay securely with PEPEW.',
		'api_origin'        => 'https://pay.pepepow.net',
		'checkout_base_url' => 'https://pay.pepepow.net/',
		'api_key'           => str_repeat( 'a', 40 ),
		'receive_address'   => 'PRfbEeHAKKbz6Voz85WJudrJwTA3ZbHunb',
		'webhook_secret'    => str_repeat( 'b', 40 ),
		'confirmations'     => '3',
		'expires_in'        => '900',
	)
);

$gateways = WC()->payment_gateways()->payment_gateways();
if ( ! isset( $gateways['pepew'] ) || ! $gateways['pepew'] instanceof PEPEW_WC_Gateway ) {
	fwrite( STDERR, "PEPEW gateway is not registered.\n" );
	exit( 1 );
}

if ( ! $gateways['pepew']->is_available() ) {
	fwrite( STDERR, "PEPEW gateway is not available in runtime smoke.\n" );
	exit( 1 );
}

if ( ! class_exists( '\Automattic\WooCommerce\Blocks\Payments\Integrations\AbstractPaymentMethodType' ) ) {
	fwrite( STDERR, "WooCommerce Blocks payment integration base class is unavailable.\n" );
	exit( 1 );
}

if ( ! class_exists( 'PEPEW_WC_Blocks' ) ) {
	require_once PEPEW_WC_PLUGIN_DIR . 'includes/class-pepew-wc-blocks.php';
}

$blocks = new PEPEW_WC_Blocks();
$blocks->initialize();

if ( ! $blocks->is_active() ) {
	fwrite( STDERR, "PEPEW Blocks payment method is not active.\n" );
	exit( 1 );
}

$handles = $blocks->get_payment_method_script_handles();
if ( array( 'pepew-wc-blocks' ) !== $handles || ! wp_script_is( 'pepew-wc-blocks', 'registered' ) ) {
	fwrite( STDERR, "PEPEW Blocks script is not registered correctly.\n" );
	exit( 1 );
}

$data = $blocks->get_payment_method_data();
if ( 'Pay with PEPEW' !== ( $data['title'] ?? '' ) || array( 'products' ) !== ( $data['supports'] ?? array() ) ) {
	fwrite( STDERR, "PEPEW Blocks settings payload is invalid.\n" );
	exit( 1 );
}

$product = new WC_Product_Simple();
$product->set_name( 'PEPEW runtime test product' );
$product->set_regular_price( '12.34' );
$product->set_status( 'publish' );
$product_id = $product->save();

$order = wc_create_order();
$order->add_product( wc_get_product( $product_id ), 1 );
$order->set_currency( 'PEPEW' );
$order->set_payment_method( 'pepew' );
$order->calculate_totals();

$reference = PEPEW_WC_Order_Identity::merchant_reference( home_url( '/' ), (int) $order->get_id() );
$order->update_meta_data( PEPEW_WC_Meta::REFERENCE, $reference );
$order->update_meta_data( PEPEW_WC_Meta::IDEMPOTENCY, PEPEW_WC_Order_Identity::idempotency_key( home_url( '/' ), (int) $order->get_id() ) );
$order->update_meta_data( PEPEW_WC_Meta::AMOUNT, wc_format_decimal( (string) $order->get_total(), 8 ) );
$order->save();

$reloaded = wc_get_order( $order->get_id() );
if ( ! $reloaded instanceof WC_Order ) {
	fwrite( STDERR, "WooCommerce order CRUD reload failed.\n" );
	exit( 1 );
}

if ( $reference !== (string) $reloaded->get_meta( PEPEW_WC_Meta::REFERENCE, true ) ) {
	fwrite( STDERR, "WooCommerce order meta did not persist through {$actual_storage}.\n" );
	exit( 1 );
}

$reloaded->payment_complete( 'pepew-runtime-test' );
$reloaded = wc_get_order( $reloaded->get_id() );

if ( ! $reloaded->get_date_paid() || 'pepew-runtime-test' !== $reloaded->get_transaction_id() ) {
	fwrite( STDERR, "WooCommerce payment_complete() did not persist through {$actual_storage}.\n" );
	exit( 1 );
}

$reloaded->delete( true );
wp_delete_post( $product_id, true );

echo "PEPEW WooCommerce runtime smoke passed: WordPress 7.1.2 / WooCommerce 11.1.2 / {$actual_storage}.\n";
