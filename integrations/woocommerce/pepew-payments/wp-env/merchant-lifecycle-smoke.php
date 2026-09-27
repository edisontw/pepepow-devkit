<?php

defined( 'ABSPATH' ) || exit;

function pepew_i54_fail( string $message ): void {
	fwrite( STDERR, $message . "\n" );
	exit( 1 );
}

function pepew_i54_response( array $payload, int $code = 200 ): array {
	return array(
		'headers'  => array( 'content-type' => 'application/json' ),
		'body'     => wp_json_encode( $payload ),
		'response' => array( 'code' => $code, 'message' => 'OK' ),
		'cookies'  => array(),
		'filename' => null,
	);
}

function pepew_i54_order( string $price ): WC_Order {
	$product = new WC_Product_Simple();
	$product->set_name( 'PEPEW I5.4 lifecycle product' );
	$product->set_regular_price( $price );
	$product->set_status( 'publish' );
	$product_id = $product->save();

	$order = wc_create_order();
	$order->add_product( wc_get_product( $product_id ), 1 );
	$order->set_currency( 'PEPEW' );
	$order->set_payment_method( 'pepew' );
	$order->calculate_totals();
	$order->save();

	return $order;
}

function pepew_i54_event( WC_Order $order, string $event_id, int $version, string $status, string $secret, ?string $policy_confirmed_sats = null ): WP_REST_Response {
	$reference = (string) $order->get_meta( PEPEW_WC_Meta::REFERENCE, true );
	$payment_id = (string) $order->get_meta( PEPEW_WC_Meta::PAYMENT_ID, true );
	$amount = (string) $order->get_meta( PEPEW_WC_Meta::AMOUNT, true );
	$timestamp = time();

	$event = array(
		'schema_version'  => 1,
		'event_id'        => $event_id,
		'event_type'      => 'payment.' . $status,
		'payment_id'      => $payment_id,
		'payment_version' => $version,
		'created_at'      => $timestamp,
		'data'            => array(
			'status'             => $status,
			'merchant_reference' => $reference,
			'amount_sats'        => (int) PEPEW_WC_Order_State::decimal_to_atoms_string( $amount ),
			'policy_confirmed_sats' => null === $policy_confirmed_sats
				? ( 'paid_confirmed' === $status ? PEPEW_WC_Order_State::decimal_to_atoms_string( $amount ) : '0' )
				: $policy_confirmed_sats,
		),
	);

	$body = wp_json_encode( $event );
	$signature = 'v1=' . hash_hmac(
		'sha256',
		$timestamp . '.' . $event_id . '.' . $body,
		$secret
	);

	$request = new WP_REST_Request( 'POST', '/pepew/v1/webhook' );
	$request->set_body( $body );
	$request->set_header( 'X-PepewPay-Event-Id', $event_id );
	$request->set_header( 'X-PepewPay-Timestamp', (string) $timestamp );
	$request->set_header( 'X-PepewPay-Signature', $signature );

	$response = rest_do_request( $request );
	if ( 204 !== $response->get_status() ) {
		pepew_i54_fail( 'Webhook lifecycle smoke returned HTTP ' . $response->get_status() );
	}

	return $response;
}

update_option( 'woocommerce_currency', 'PEPEW' );
$webhook_secret = 'runtime-webhook-secret-0123456789abcdef';
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
		'webhook_secret'    => $webhook_secret,
		'confirmations'     => '3',
		'expires_in'        => '900',
	)
);

$gateway = new PEPEW_WC_Gateway();

// Retry/back-button semantics: the second checkout for the same order must reuse
// the persisted payment capability without issuing a second create request.
$order = pepew_i54_order( '12.34' );
$create_calls = 0;
$create_filter = static function ( $preempt, array $args, string $url ) use ( &$create_calls, $order ) {
	if ( 'POST' !== ( $args['method'] ?? 'GET' ) || ! str_ends_with( wp_parse_url( $url, PHP_URL_PATH ) ?: '', '/api/v1/payments' ) ) {
		return $preempt;
	}

	++$create_calls;
	$body = json_decode( (string) ( $args['body'] ?? '' ), true );
	return pepew_i54_response(
		array(
			'ok'                 => true,
			'payment_id'         => 'pay_i54retry0001',
			'merchant_reference' => $body['merchant_reference'],
			'amount'             => rtrim( rtrim( (string) $body['amount'], '0' ), '.' ),
			'status'             => 'waiting',
			'version'            => 1,
		),
		201
	);
};
add_filter( 'pre_http_request', $create_filter, 10, 3 );

$first = $gateway->process_payment( $order->get_id() );
$second = $gateway->process_payment( $order->get_id() );
remove_filter( 'pre_http_request', $create_filter, 10 );

if (
	1 !== $create_calls ||
	'success' !== ( $first['result'] ?? '' ) ||
	$first['redirect'] !== ( $second['redirect'] ?? null )
) {
	pepew_i54_fail( 'Repeated checkout did not reuse the existing PEPEW payment.' );
}

$order = wc_get_order( $order->get_id() );

// Webhook duplicate/stale/reorg lifecycle.
pepew_i54_event( $order, 'evt_' . str_repeat( '1', 64 ), 2, 'paid_unconfirmed', $webhook_secret );
$order = wc_get_order( $order->get_id() );
if ( 'on-hold' !== $order->get_status() || 2 !== (int) $order->get_meta( PEPEW_WC_Meta::VERSION, true ) ) {
	pepew_i54_fail( 'paid_unconfirmed did not move the order to on-hold.' );
}

pepew_i54_event( $order, 'evt_' . str_repeat( '2', 64 ), 3, 'paid_confirmed', $webhook_secret );
$order = wc_get_order( $order->get_id() );
if ( ! $order->has_status( array( 'processing', 'completed' ) ) || 3 !== (int) $order->get_meta( PEPEW_WC_Meta::VERSION, true ) ) {
	pepew_i54_fail( 'paid_confirmed did not complete WooCommerce payment handling.' );
}

pepew_i54_event( $order, 'evt_' . str_repeat( '3', 64 ), 2, 'paid_unconfirmed', $webhook_secret );
$order = wc_get_order( $order->get_id() );
if ( 3 !== (int) $order->get_meta( PEPEW_WC_Meta::VERSION, true ) ) {
	pepew_i54_fail( 'Stale webhook overwrote a newer payment version.' );
}

$reorg_event = 'evt_' . str_repeat( '4', 64 );
pepew_i54_event( $order, $reorg_event, 4, 'paid_unconfirmed', $webhook_secret );
$order = wc_get_order( $order->get_id() );
if (
	'on-hold' !== $order->get_status() ||
	'yes' !== (string) $order->get_meta( PEPEW_WC_Meta::REVIEW_REQUIRED, true ) ||
	4 !== (int) $order->get_meta( PEPEW_WC_Meta::VERSION, true )
) {
	pepew_i54_fail( 'Higher-version confirmation rollback did not enter review/on-hold.' );
}

pepew_i54_event( $order, $reorg_event, 4, 'paid_unconfirmed', $webhook_secret );
$order = wc_get_order( $order->get_id() );
if ( 4 !== (int) $order->get_meta( PEPEW_WC_Meta::VERSION, true ) ) {
	pepew_i54_fail( 'Duplicate webhook changed payment version state.' );
}

// Overpayment must still obey the configured confirmation policy. An unconfirmed
// overpayment remains on hold; only policy-confirmed value may complete the order.
$overpaid_order = pepew_i54_order( '0.10' );
$overpaid_filter = static function ( $preempt, array $args, string $url ) {
	if ( 'POST' !== ( $args['method'] ?? 'GET' ) || ! str_ends_with( wp_parse_url( $url, PHP_URL_PATH ) ?: '', '/api/v1/payments' ) ) {
		return $preempt;
	}

	$body = json_decode( (string) ( $args['body'] ?? '' ), true );
	return pepew_i54_response(
		array(
			'ok'                 => true,
			'payment_id'         => 'pay_i54overpaid01',
			'merchant_reference' => $body['merchant_reference'],
			'amount'             => '0.1',
			'status'             => 'waiting',
			'version'            => 1,
		),
		201
	);
};
add_filter( 'pre_http_request', $overpaid_filter, 10, 3 );
$overpaid_result = $gateway->process_payment( $overpaid_order->get_id() );
remove_filter( 'pre_http_request', $overpaid_filter, 10 );

if ( 'success' !== ( $overpaid_result['result'] ?? '' ) ) {
	pepew_i54_fail( 'Overpayment fixture payment could not be created.' );
}

$overpaid_order = wc_get_order( $overpaid_order->get_id() );
pepew_i54_event(
	$overpaid_order,
	'evt_' . str_repeat( '5', 64 ),
	2,
	'overpaid',
	$webhook_secret,
	'0'
);
$overpaid_order = wc_get_order( $overpaid_order->get_id() );
if ( 'on-hold' !== $overpaid_order->get_status() ) {
	pepew_i54_fail( 'Unconfirmed overpayment bypassed the confirmation policy.' );
}

pepew_i54_event(
	$overpaid_order,
	'evt_' . str_repeat( '6', 64 ),
	3,
	'overpaid',
	$webhook_secret,
	PEPEW_WC_Order_State::decimal_to_atoms_string( '0.10' )
);
$overpaid_order = wc_get_order( $overpaid_order->get_id() );
if ( ! $overpaid_order->has_status( array( 'processing', 'completed' ) ) ) {
	pepew_i54_fail( 'Confirmed overpayment did not complete WooCommerce payment handling.' );
}

// Uncertain create recovery: a transport failure followed by exact-reference
// lookup must bind the recovered payment rather than create a second identity.
$recovery_order = pepew_i54_order( '1.25' );
$recovery_post_calls = 0;
$recovery_get_calls = 0;
$recovery_filter = static function ( $preempt, array $args, string $url ) use ( &$recovery_post_calls, &$recovery_get_calls ) {
	$method = (string) ( $args['method'] ?? 'GET' );
	$path = wp_parse_url( $url, PHP_URL_PATH ) ?: '';

	if ( 'POST' === $method && str_ends_with( $path, '/api/v1/payments' ) ) {
		++$recovery_post_calls;
		return new WP_Error( 'simulated_transport_loss', 'Simulated response loss after create.' );
	}

	if ( 'GET' === $method && str_ends_with( $path, '/api/v1/payments' ) ) {
		++$recovery_get_calls;
		parse_str( (string) wp_parse_url( $url, PHP_URL_QUERY ), $query );
		$reference = (string) ( $query['merchant_reference'] ?? '' );

		return pepew_i54_response(
			array(
				'payments' => array(
					array(
						'ok'                 => true,
						'payment_id'         => 'pay_i54recover01',
						'merchant_reference' => $reference,
						'amount'             => '1.25',
						'status'             => 'waiting',
						'version'            => 1,
					),
				),
			)
		);
	}

	return $preempt;
};
add_filter( 'pre_http_request', $recovery_filter, 10, 3 );
$recovered = $gateway->process_payment( $recovery_order->get_id() );
remove_filter( 'pre_http_request', $recovery_filter, 10 );

$recovery_order = wc_get_order( $recovery_order->get_id() );
if (
	'success' !== ( $recovered['result'] ?? '' ) ||
	1 !== $recovery_post_calls ||
	1 !== $recovery_get_calls ||
	'pay_i54recover01' !== (string) $recovery_order->get_meta( PEPEW_WC_Meta::PAYMENT_ID, true )
) {
	pepew_i54_fail( 'Uncertain create recovery did not recover the exact merchant payment.' );
}

$order->delete( true );
$overpaid_order->delete( true );
$recovery_order->delete( true );

echo "PEPEW WooCommerce I5.4 merchant lifecycle smoke passed.\n";
