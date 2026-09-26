<?php

defined( 'ABSPATH' ) || defined( 'PEPEW_WC_TESTING' ) || exit;

final class PEPEW_WC_Order_Identity {
	public static function site_hash( string $site_url ): string {
		$normalized = strtolower( rtrim( trim( $site_url ), '/' ) );
		if ( '' === $normalized ) {
			throw new InvalidArgumentException( 'site_url is required' );
		}

		return substr( hash( 'sha256', $normalized ), 0, 16 );
	}

	public static function merchant_reference( string $site_url, int $order_id ): string {
		self::require_order_id( $order_id );
		return sprintf( 'woo:%s:%d', self::site_hash( $site_url ), $order_id );
	}

	public static function idempotency_key( string $site_url, int $order_id ): string {
		self::require_order_id( $order_id );
		return sprintf( 'woo:create:%s:%d:v1', self::site_hash( $site_url ), $order_id );
	}

	private static function require_order_id( int $order_id ): void {
		if ( $order_id < 1 ) {
			throw new InvalidArgumentException( 'order_id must be positive' );
		}
	}
}
