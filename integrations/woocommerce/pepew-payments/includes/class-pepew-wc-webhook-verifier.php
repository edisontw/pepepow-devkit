<?php

defined( 'ABSPATH' ) || defined( 'PEPEW_WC_TESTING' ) || exit;

final class PEPEW_WC_Webhook_Verification_Exception extends RuntimeException {
	public string $verification_code;

	public function __construct( string $verification_code ) {
		parent::__construct( 'PEPEW webhook verification failed.' );
		$this->verification_code = $verification_code;
	}
}

final class PEPEW_WC_Webhook_Verifier {
	private const EVENT_ID_RE = '/^evt_[0-9a-f]{64}$/';
	private const PAYMENT_ID_RE = '/^pay_[A-Za-z0-9_-]{8,92}$/';
	private const SIGNATURE_RE = '/^v1=[0-9a-f]{64}$/';

	public static function verify(
		array $headers,
		string $raw_body,
		string $signing_secret,
		?int $now_seconds = null,
		int $replay_window_seconds = 300
	): array {
		if ( '' === $signing_secret ) {
			throw new PEPEW_WC_Webhook_Verification_Exception( 'missing_secret' );
		}

		if ( strlen( $raw_body ) > 65536 ) {
			throw new PEPEW_WC_Webhook_Verification_Exception( 'body_too_large' );
		}

		$event_id  = self::header( $headers, 'x-pepewpay-event-id' );
		$timestamp = self::header( $headers, 'x-pepewpay-timestamp' );
		$signature = self::header( $headers, 'x-pepewpay-signature' );

		if (
			1 !== preg_match( self::EVENT_ID_RE, $event_id ) ||
			! ctype_digit( $timestamp ) ||
			1 !== preg_match( self::SIGNATURE_RE, $signature )
		) {
			throw new PEPEW_WC_Webhook_Verification_Exception( 'invalid_headers' );
		}

		$timestamp_int = (int) $timestamp;
		$now           = $now_seconds ?? time();
		if ( $timestamp_int <= 0 || abs( $now - $timestamp_int ) > $replay_window_seconds ) {
			throw new PEPEW_WC_Webhook_Verification_Exception( 'stale_timestamp' );
		}

		$expected = 'v1=' . hash_hmac(
			'sha256',
			$timestamp . '.' . $event_id . '.' . $raw_body,
			$signing_secret
		);

		if ( ! hash_equals( $expected, $signature ) ) {
			throw new PEPEW_WC_Webhook_Verification_Exception( 'signature_mismatch' );
		}

		$event = json_decode( $raw_body, true, 512, JSON_BIGINT_AS_STRING );
		if ( ! is_array( $event ) || JSON_ERROR_NONE !== json_last_error() ) {
			throw new PEPEW_WC_Webhook_Verification_Exception( 'invalid_json' );
		}

		if (
			1 !== ( $event['schema_version'] ?? null ) ||
			! isset( $event['event_id'] ) ||
			! is_string( $event['event_id'] ) ||
			$event['event_id'] !== $event_id ||
			! isset( $event['event_type'] ) ||
			! is_string( $event['event_type'] ) ||
			! str_starts_with( $event['event_type'], 'payment.' ) ||
			! isset( $event['payment_id'] ) ||
			! is_string( $event['payment_id'] ) ||
			1 !== preg_match( self::PAYMENT_ID_RE, $event['payment_id'] ) ||
			! isset( $event['payment_version'] ) ||
			! is_int( $event['payment_version'] ) ||
			$event['payment_version'] < 1 ||
			! isset( $event['data'] ) ||
			! is_array( $event['data'] ) ||
			! isset( $event['data']['status'] ) ||
			! is_string( $event['data']['status'] ) ||
			'' === $event['data']['status']
		) {
			throw new PEPEW_WC_Webhook_Verification_Exception( 'invalid_envelope' );
		}

		if (
			! array_key_exists( 'merchant_reference', $event['data'] ) ||
			! is_string( $event['data']['merchant_reference'] ) ||
			'' === $event['data']['merchant_reference']
		) {
			throw new PEPEW_WC_Webhook_Verification_Exception( 'missing_merchant_reference' );
		}

		if ( ! array_key_exists( 'amount_sats', $event['data'] ) ) {
			throw new PEPEW_WC_Webhook_Verification_Exception( 'invalid_amount' );
		}

		$amount_sats = $event['data']['amount_sats'];
		if (
			( ! is_int( $amount_sats ) && ! is_string( $amount_sats ) ) ||
			1 !== preg_match( '/^[1-9][0-9]*$/', (string) $amount_sats )
		) {
			throw new PEPEW_WC_Webhook_Verification_Exception( 'invalid_amount' );
		}

		if ( 'overpaid' === $event['data']['status'] ) {
			if ( ! array_key_exists( 'policy_confirmed_sats', $event['data'] ) ) {
				throw new PEPEW_WC_Webhook_Verification_Exception( 'missing_policy_confirmed_sats' );
			}

			$policy_confirmed_sats = $event['data']['policy_confirmed_sats'];
			if (
				( ! is_int( $policy_confirmed_sats ) && ! is_string( $policy_confirmed_sats ) ) ||
				1 !== preg_match( '/^(0|[1-9][0-9]*)$/', (string) $policy_confirmed_sats )
			) {
				throw new PEPEW_WC_Webhook_Verification_Exception( 'invalid_policy_confirmed_sats' );
			}
		}

		return $event;
	}

	private static function header( array $headers, string $name ): string {
		foreach ( $headers as $key => $value ) {
			if ( strtolower( (string) $key ) !== $name ) {
				continue;
			}

			if ( is_array( $value ) ) {
				$value = $value[0] ?? '';
			}

			return is_string( $value ) ? trim( $value ) : '';
		}

		return '';
	}
}
