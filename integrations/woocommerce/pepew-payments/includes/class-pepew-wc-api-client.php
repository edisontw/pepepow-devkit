<?php

defined( 'ABSPATH' ) || exit;

class PEPEW_WC_Transport_Exception extends RuntimeException {}

class PEPEW_WC_API_Exception extends RuntimeException {
	public int $http_status;
	public string $api_code;

	public function __construct( int $http_status, string $api_code ) {
		parent::__construct( 'PEPEW Payment API request failed.' );
		$this->http_status = $http_status;
		$this->api_code    = $api_code;
	}
}

final class PEPEW_WC_API_Client {
	private string $api_origin;
	private string $api_key;
	private int $timeout;

	public function __construct( string $api_origin, string $api_key, int $timeout = 10 ) {
		$this->api_origin = self::normalize_https_origin( $api_origin );
		$this->api_key    = trim( $api_key );
		$this->timeout    = max( 1, min( 30, $timeout ) );

		if ( strlen( $this->api_key ) < 32 ) {
			throw new InvalidArgumentException( 'Merchant API key is not configured.' );
		}
	}

	public function create_payment( array $payload, string $idempotency_key ): array {
		return $this->request(
			'POST',
			'/api/v1/payments',
			array(
				'Idempotency-Key' => $idempotency_key,
			),
			$payload
		);
	}

	public function recover_by_reference( string $merchant_reference ): ?array {
		$url = add_query_arg(
			array(
				'merchant_reference' => $merchant_reference,
				'limit'              => 2,
			),
			$this->api_origin . '/api/v1/payments'
		);

		$payload = $this->request_absolute( 'GET', $url, array(), null );

		if ( ! isset( $payload['payments'] ) || ! is_array( $payload['payments'] ) ) {
			throw new PEPEW_WC_API_Exception( 502, 'invalid_payment_list_response' );
		}

		if ( 0 === count( $payload['payments'] ) ) {
			return null;
		}

		if ( 1 !== count( $payload['payments'] ) || ! is_array( $payload['payments'][0] ) ) {
			throw new PEPEW_WC_API_Exception( 502, 'merchant_reference_not_unique' );
		}

		$payment = $this->validate_payment( $payload['payments'][0] );
		if ( $payment['merchant_reference'] !== $merchant_reference ) {
			throw new PEPEW_WC_API_Exception( 502, 'merchant_reference_mismatch' );
		}

		return $payment;
	}

	private function request( string $method, string $path, array $headers, ?array $body ): array {
		return $this->request_absolute( $method, $this->api_origin . $path, $headers, $body );
	}

	private function request_absolute( string $method, string $url, array $headers, ?array $body ): array {
		$headers = array_merge(
			array(
				'Accept'        => 'application/json',
				'Authorization' => 'Bearer ' . $this->api_key,
			),
			$headers
		);

		$args = array(
			'method'              => $method,
			'headers'             => $headers,
			'timeout'             => $this->timeout,
			'redirection'         => 0,
			'reject_unsafe_urls'  => true,
			'limit_response_size' => 262144,
		);

		if ( null !== $body ) {
			$args['headers']['Content-Type'] = 'application/json';
			$args['body']                    = wp_json_encode( $body );
		}

		$response = wp_safe_remote_request( $url, $args );
		if ( is_wp_error( $response ) ) {
			throw new PEPEW_WC_Transport_Exception( 'PEPEW Payment API transport failed.' );
		}

		$status = (int) wp_remote_retrieve_response_code( $response );
		$raw    = (string) wp_remote_retrieve_body( $response );
		$data   = json_decode( $raw, true );

		if ( ! is_array( $data ) ) {
			throw new PEPEW_WC_API_Exception( $status > 0 ? $status : 502, 'invalid_json_response' );
		}

		if ( $status < 200 || $status >= 300 ) {
			$code = 'merchant_api_error';
			if ( isset( $data['error']['code'] ) && is_string( $data['error']['code'] ) ) {
				$code = substr( $data['error']['code'], 0, 96 );
			}
			throw new PEPEW_WC_API_Exception( $status, $code );
		}

		if ( str_ends_with( wp_parse_url( $url, PHP_URL_PATH ) ?: '', '/payments' ) && 'POST' === $method ) {
			return $this->validate_payment( $data );
		}

		return $data;
	}

	private function validate_payment( array $payment ): array {
		if (
			true !== ( $payment['ok'] ?? null ) ||
			! isset( $payment['payment_id'] ) ||
			! is_string( $payment['payment_id'] ) ||
			1 !== preg_match( '/^pay_[A-Za-z0-9_-]{8,92}$/', $payment['payment_id'] ) ||
			! isset( $payment['amount'] ) ||
			! is_string( $payment['amount'] ) ||
			! isset( $payment['merchant_reference'] ) ||
			! is_string( $payment['merchant_reference'] ) ||
			! isset( $payment['status'] ) ||
			! is_string( $payment['status'] ) ||
			! isset( $payment['version'] ) ||
			! is_int( $payment['version'] )
		) {
			throw new PEPEW_WC_API_Exception( 502, 'invalid_payment_response' );
		}

		return $payment;
	}

	private static function normalize_https_origin( string $value ): string {
		$value = trim( $value );
		$parts = wp_parse_url( $value );
		if (
			! is_array( $parts ) ||
			'https' !== ( $parts['scheme'] ?? '' ) ||
			empty( $parts['host'] ) ||
			isset( $parts['user'] ) ||
			isset( $parts['pass'] ) ||
			isset( $parts['query'] ) ||
			isset( $parts['fragment'] ) ||
			( isset( $parts['path'] ) && ! in_array( $parts['path'], array( '', '/' ), true ) )
		) {
			throw new InvalidArgumentException( 'Payment API origin must be a clean HTTPS origin.' );
		}

		return rtrim( $value, '/' );
	}
}
