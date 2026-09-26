<?php

defined( 'ABSPATH' ) || exit;

final class PEPEW_WC_Gateway extends WC_Payment_Gateway {
	public function __construct() {
		$this->id                 = 'pepew';
		$this->method_title       = 'PEPEW';
		$this->method_description = 'Create a PEPEW Payment Platform intent and redirect the customer to PepewPay.';
		$this->has_fields         = false;
		$this->supports           = array( 'products' );

		$this->init_form_fields();
		$this->init_settings();

		$this->title       = (string) $this->get_option( 'title', 'Pay with PEPEW' );
		$this->description = (string) $this->get_option( 'description', 'Pay securely with PEPEW.' );
		$this->enabled     = (string) $this->get_option( 'enabled', 'no' );

		add_action(
			'woocommerce_update_options_payment_gateways_' . $this->id,
			array( $this, 'process_admin_options' )
		);
	}

	public function init_form_fields(): void {
		$this->form_fields = array(
			'enabled' => array(
				'title'   => 'Enable/Disable',
				'type'    => 'checkbox',
				'label'   => 'Enable PEPEW payments',
				'default' => 'no',
			),
			'title' => array(
				'title'   => 'Title',
				'type'    => 'text',
				'default' => 'Pay with PEPEW',
			),
			'description' => array(
				'title'   => 'Description',
				'type'    => 'textarea',
				'default' => 'Pay securely with PEPEW.',
			),
			'api_origin' => array(
				'title'   => 'Payment API origin',
				'type'    => 'url',
				'default' => 'https://pay.pepepow.net',
			),
			'checkout_base_url' => array(
				'title'   => 'PepewPay checkout URL',
				'type'    => 'url',
				'default' => 'https://pay.pepepow.net/',
			),
			'api_key' => array(
				'title'       => 'Merchant API key',
				'type'        => 'password',
				'description' => 'Server-side only. Never expose this value to browser JavaScript or logs.',
			),
			'webhook_secret' => array(
				'title'       => 'Webhook signing secret',
				'type'        => 'password',
				'description' => 'Server-side only. Register this receiver URL with PEPEW Payment Platform: ' . rest_url( 'pepew/v1/webhook' ),
			),
			'receive_address' => array(
				'title' => 'PEPEW receiving address',
				'type'  => 'text',
			),
			'confirmations' => array(
				'title'             => 'Required confirmations',
				'type'              => 'number',
				'default'           => '3',
				'custom_attributes' => array( 'min' => '1', 'max' => '100' ),
			),
			'expires_in' => array(
				'title'             => 'Payment expiry (seconds)',
				'type'              => 'number',
				'default'           => '900',
				'custom_attributes' => array( 'min' => '60', 'max' => '86400' ),
			),
		);
	}

	public function is_available(): bool {
		if ( ! parent::is_available() ) {
			return false;
		}

		if ( 'PEPEW' !== get_woocommerce_currency() ) {
			return false;
		}

		return strlen( trim( (string) $this->get_option( 'api_key', '' ) ) ) >= 32
			&& '' !== trim( (string) $this->get_option( 'receive_address', '' ) );
	}

	public function process_payment( $order_id ): array {
		$order = wc_get_order( $order_id );
		if ( ! $order instanceof WC_Order ) {
			throw new Exception( 'Unable to load WooCommerce order.' );
		}

		if ( 'PEPEW' !== $order->get_currency() ) {
			wc_add_notice( 'PEPEW gateway requires the store/order currency to be PEPEW.', 'error' );
			return array( 'result' => 'failure' );
		}

		try {
			return $this->create_or_reuse_checkout( $order );
		} catch ( Throwable $error ) {
			wc_add_notice(
				'PEPEW payment service is temporarily unavailable. Please retry; the existing order payment identity will be reused.',
				'error'
			);
			return array( 'result' => 'failure' );
		}
	}

	private function create_or_reuse_checkout( WC_Order $order ): array {
		$current_amount      = wc_format_decimal( (string) $order->get_total(), 8 );
		$stored_amount       = (string) $order->get_meta( PEPEW_WC_Meta::AMOUNT, true );
		$existing_payment_id = (string) $order->get_meta( PEPEW_WC_Meta::PAYMENT_ID, true );
		$existing_checkout   = (string) $order->get_meta( PEPEW_WC_Meta::CHECKOUT, true );

		if ( '' !== $existing_payment_id ) {
			if ( '' === $stored_amount || $stored_amount !== $current_amount ) {
				throw new RuntimeException( 'WooCommerce order amount changed after PEPEW payment creation.' );
			}

			$checkout = '' !== $existing_checkout
				? $existing_checkout
				: $this->checkout_url( $existing_payment_id );

			return array(
				'result'   => 'success',
				'redirect' => $checkout,
			);
		}

		if ( '' !== $stored_amount && $stored_amount !== $current_amount ) {
			throw new RuntimeException( 'WooCommerce order amount changed after PEPEW create identity was reserved.' );
		}

		$site_url        = home_url( '/' );
		$order_id        = (int) $order->get_id();
		$reference       = (string) $order->get_meta( PEPEW_WC_Meta::REFERENCE, true );
		$idempotency_key = (string) $order->get_meta( PEPEW_WC_Meta::IDEMPOTENCY, true );

		if ( '' === $reference ) {
			$reference = PEPEW_WC_Order_Identity::merchant_reference( $site_url, $order_id );
			$order->update_meta_data( PEPEW_WC_Meta::REFERENCE, $reference );
		}

		if ( '' === $idempotency_key ) {
			$idempotency_key = PEPEW_WC_Order_Identity::idempotency_key( $site_url, $order_id );
			$order->update_meta_data( PEPEW_WC_Meta::IDEMPOTENCY, $idempotency_key );
		}

		if ( '' === $stored_amount ) {
			$stored_amount = $current_amount;
			$order->update_meta_data( PEPEW_WC_Meta::AMOUNT, $stored_amount );
		}

		// Persist retry/business identity and exact amount before any remote create request.
		$order->save();

		$client = new PEPEW_WC_API_Client(
			(string) $this->get_option( 'api_origin', 'https://pay.pepepow.net' ),
			(string) $this->get_option( 'api_key', '' )
		);

		$payload = array(
			'address'            => trim( (string) $this->get_option( 'receive_address', '' ) ),
			'amount'             => $stored_amount,
			'merchant_reference' => $reference,
			'confirmations'      => max( 1, (int) $this->get_option( 'confirmations', 3 ) ),
			'expires_in'         => max( 60, min( 86400, (int) $this->get_option( 'expires_in', 900 ) ) ),
			'label'              => 'WooCommerce',
		);

		try {
			$payment = $client->create_payment( $payload, $idempotency_key );
		} catch ( PEPEW_WC_Transport_Exception $error ) {
			$payment = $client->recover_by_reference( $reference );
			if ( null === $payment ) {
				throw $error;
			}
		} catch ( PEPEW_WC_API_Exception $error ) {
			if ( 'payment_merchant_reference_conflict' !== $error->api_code ) {
				throw $error;
			}

			$payment = $client->recover_by_reference( $reference );
			if ( null === $payment ) {
				throw $error;
			}
		}

		if ( $payment['merchant_reference'] !== $reference ) {
			throw new RuntimeException( 'Recovered payment does not belong to this WooCommerce order.' );
		}

		if ( (string) $payment['amount'] !== $stored_amount ) {
			throw new RuntimeException( 'PEPEW payment amount does not match the WooCommerce order snapshot.' );
		}

		$checkout = $this->checkout_url( $payment['payment_id'] );

		$order->update_meta_data( PEPEW_WC_Meta::PAYMENT_ID, $payment['payment_id'] );
		$order->update_meta_data( PEPEW_WC_Meta::VERSION, (int) $payment['version'] );
		$order->update_meta_data( PEPEW_WC_Meta::STATUS, (string) $payment['status'] );
		$order->update_meta_data( PEPEW_WC_Meta::CHECKOUT, $checkout );
		$order->save();

		return array(
			'result'   => 'success',
			'redirect' => $checkout,
		);
	}

	private function checkout_url( string $payment_id ): string {
		if ( 1 !== preg_match( '/^pay_[A-Za-z0-9_-]{8,92}$/', $payment_id ) ) {
			throw new InvalidArgumentException( 'Invalid PEPEW payment capability ID.' );
		}

		$base  = trim( (string) $this->get_option( 'checkout_base_url', 'https://pay.pepepow.net/' ) );
		$parts = wp_parse_url( $base );

		if (
			! is_array( $parts ) ||
			'https' !== ( $parts['scheme'] ?? '' ) ||
			empty( $parts['host'] ) ||
			isset( $parts['user'] ) ||
			isset( $parts['pass'] )
		) {
			throw new InvalidArgumentException( 'PepewPay checkout URL must use HTTPS.' );
		}

		return add_query_arg( 'payment_id', $payment_id, $base );
	}
}
