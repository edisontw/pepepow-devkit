<?php

defined( 'ABSPATH' ) || defined( 'PEPEW_WC_TESTING' ) || exit;

final class PEPEW_WC_Order_State {
	public const ACTION_NONE        = 'none';
	public const ACTION_HOLD        = 'hold';
	public const ACTION_HOLD_REVIEW = 'hold_review';
	public const ACTION_COMPLETE    = 'complete';
	public const ACTION_FAIL        = 'fail';
	public const ACTION_REVIEW      = 'review';

	public static function action_for( string $payment_status, string $order_status ): string {
		if ( in_array( $payment_status, array( 'paid_confirmed', 'overpaid' ), true ) ) {
			if ( in_array( $order_status, array( 'cancelled', 'refunded' ), true ) ) {
				return self::ACTION_REVIEW;
			}

			return self::ACTION_COMPLETE;
		}

		if ( 'waiting' === $payment_status ) {
			if ( 'cancelled' === $order_status ) {
				return self::ACTION_NONE;
			}

			if ( 'completed' === $order_status || 'refunded' === $order_status ) {
				return self::ACTION_REVIEW;
			}

			if ( 'processing' === $order_status ) {
				return self::ACTION_HOLD_REVIEW;
			}

			if ( in_array( $order_status, array( 'pending', 'failed', 'on-hold' ), true ) ) {
				return self::ACTION_HOLD;
			}

			return self::ACTION_REVIEW;
		}

		if ( in_array( $payment_status, array( 'seen_in_mempool', 'partial', 'paid_unconfirmed' ), true ) ) {
			if ( in_array( $order_status, array( 'completed', 'cancelled', 'refunded' ), true ) ) {
				return self::ACTION_REVIEW;
			}

			if ( 'processing' === $order_status ) {
				return self::ACTION_HOLD_REVIEW;
			}

			if ( in_array( $order_status, array( 'pending', 'failed', 'on-hold' ), true ) ) {
				return self::ACTION_HOLD;
			}

			return self::ACTION_REVIEW;
		}

		if ( in_array( $payment_status, array( 'expired', 'error' ), true ) ) {
			if ( 'cancelled' === $order_status ) {
				return self::ACTION_NONE;
			}

			if ( in_array( $order_status, array( 'processing', 'completed', 'refunded' ), true ) ) {
				return self::ACTION_REVIEW;
			}

			if ( in_array( $order_status, array( 'pending', 'on-hold', 'failed' ), true ) ) {
				return self::ACTION_FAIL;
			}

			return self::ACTION_REVIEW;
		}

		return self::ACTION_REVIEW;
	}

	public static function action_for_event(
		string $payment_status,
		string $order_status,
		string $amount_sats,
		?string $policy_confirmed_sats
	): string {
		if ( 'overpaid' === $payment_status ) {
			if (
				null === $policy_confirmed_sats ||
				! self::atomic_string_gte( $policy_confirmed_sats, $amount_sats )
			) {
				return self::action_for( 'paid_unconfirmed', $order_status );
			}
		}

		return self::action_for( $payment_status, $order_status );
	}

	public static function atomic_string_gte( string $left, string $right ): bool {
		$left  = self::normalize_atomic_string( $left );
		$right = self::normalize_atomic_string( $right );

		if ( strlen( $left ) !== strlen( $right ) ) {
			return strlen( $left ) > strlen( $right );
		}

		return 0 <= strcmp( $left, $right );
	}

	private static function normalize_atomic_string( string $value ): string {
		$value = trim( $value );
		if ( 1 !== preg_match( '/^(0|[1-9][0-9]*)$/', $value ) ) {
			throw new InvalidArgumentException( 'Invalid atomic PEPEW amount.' );
		}

		$value = ltrim( $value, '0' );
		return '' === $value ? '0' : $value;
	}

	public static function decimal_to_atoms_string( string $amount ): string {
		$amount = trim( $amount );
		if ( 1 !== preg_match( '/^(0|[1-9][0-9]*)(?:\.([0-9]{1,8}))?$/', $amount, $matches ) ) {
			throw new InvalidArgumentException( 'Invalid PEPEW decimal amount.' );
		}

		$whole    = ltrim( $matches[1], '0' );
		$whole    = '' === $whole ? '0' : $whole;
		$fraction = $matches[2] ?? '';
		$digits   = $whole . str_pad( $fraction, 8, '0' );
		$digits   = ltrim( $digits, '0' );

		return '' === $digits ? '0' : $digits;
	}
}
