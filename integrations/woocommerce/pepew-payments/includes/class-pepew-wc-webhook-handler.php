<?php

defined( 'ABSPATH' ) || exit;

final class PEPEW_WC_Webhook_Handler {
	private const LOCK_TTL_SECONDS = 60;

	public static function register_route(): void {
		register_rest_route(
			'pepew/v1',
			'/webhook',
			array(
				'methods'             => 'POST',
				'callback'            => array( self::class, 'handle' ),
				'permission_callback' => '__return_true',
			)
		);
	}

	public static function handle( WP_REST_Request $request ) {
		$settings = get_option( 'woocommerce_pepew_settings', array() );
		$secret   = is_array( $settings ) ? trim( (string) ( $settings['webhook_secret'] ?? '' ) ) : '';

		if ( '' === $secret ) {
			return new WP_Error( 'pepew_webhook_unconfigured', 'Webhook receiver is not configured.', array( 'status' => 503 ) );
		}

		try {
			$event = PEPEW_WC_Webhook_Verifier::verify(
				array(
					'x-pepewpay-event-id'  => $request->get_header( 'x-pepewpay-event-id' ),
					'x-pepewpay-timestamp' => $request->get_header( 'x-pepewpay-timestamp' ),
					'x-pepewpay-signature' => $request->get_header( 'x-pepewpay-signature' ),
				),
				$request->get_body(),
				$secret
			);
		} catch ( PEPEW_WC_Webhook_Verification_Exception $error ) {
			return new WP_Error( 'pepew_webhook_invalid', 'Invalid webhook request.', array( 'status' => 400 ) );
		}

		$lock_name = 'pepew_wc_evt_' . substr( hash( 'sha256', $event['event_id'] ), 0, 40 );
		if ( ! self::claim_event_lock( $lock_name ) ) {
			return new WP_Error( 'pepew_webhook_busy', 'Webhook event is already being processed.', array( 'status' => 409 ) );
		}

		try {
			$result = self::apply_event( $event );
		} catch ( Throwable $error ) {
			return new WP_Error( 'pepew_webhook_processing_failed', 'Webhook event could not be processed.', array( 'status' => 500 ) );
		} finally {
			delete_option( $lock_name );
		}

		return $result;
	}

	private static function claim_event_lock( string $lock_name ): bool {
		$now = time();
		if ( add_option( $lock_name, (string) $now, '', false ) ) {
			return true;
		}

		$started = (int) get_option( $lock_name, 0 );
		if ( $started > 0 && ( $now - $started ) < self::LOCK_TTL_SECONDS ) {
			return false;
		}

		delete_option( $lock_name );
		return add_option( $lock_name, (string) $now, '', false );
	}

	private static function apply_event( array $event ) {
		$reference = (string) $event['data']['merchant_reference'];
		$order_id  = PEPEW_WC_Order_Identity::order_id_from_reference( home_url( '/' ), $reference );
		if ( null === $order_id ) {
			return new WP_Error( 'pepew_webhook_unknown_order', 'Order is not available.', array( 'status' => 409 ) );
		}

		$order = wc_get_order( $order_id );
		if ( ! $order instanceof WC_Order || 'pepew' !== $order->get_payment_method() ) {
			return new WP_Error( 'pepew_webhook_unknown_order', 'Order is not available.', array( 'status' => 409 ) );
		}

		if ( (string) $order->get_meta( PEPEW_WC_Meta::REFERENCE, true ) !== $reference ) {
			return new WP_Error( 'pepew_webhook_reference_conflict', 'Payment reference conflict.', array( 'status' => 409 ) );
		}

		$stored_amount = (string) $order->get_meta( PEPEW_WC_Meta::AMOUNT, true );
		if (
			'' === $stored_amount ||
			PEPEW_WC_Order_State::decimal_to_atoms_string( $stored_amount ) !== (string) $event['data']['amount_sats']
		) {
			return new WP_Error( 'pepew_webhook_amount_conflict', 'Payment amount conflict.', array( 'status' => 409 ) );
		}

		$stored_payment_id = (string) $order->get_meta( PEPEW_WC_Meta::PAYMENT_ID, true );
		if ( '' !== $stored_payment_id && $stored_payment_id !== $event['payment_id'] ) {
			return new WP_Error( 'pepew_webhook_payment_conflict', 'Payment identity conflict.', array( 'status' => 409 ) );
		}

		if ( '' === $stored_payment_id ) {
			$order->update_meta_data( PEPEW_WC_Meta::PAYMENT_ID, $event['payment_id'] );
		}

		$current_version = max( 0, (int) $order->get_meta( PEPEW_WC_Meta::VERSION, true ) );
		$last_event_id   = (string) $order->get_meta( PEPEW_WC_Meta::LAST_EVENT_ID, true );
		$event_version   = (int) $event['payment_version'];

		if ( $last_event_id === $event['event_id'] ) {
			return new WP_REST_Response( null, 204 );
		}

		if ( $event_version < $current_version ) {
			return new WP_REST_Response( null, 204 );
		}

		if ( $event_version === $current_version ) {
			$order->update_meta_data( PEPEW_WC_Meta::LAST_EVENT_ID, $event['event_id'] );
			$order->save();
			return new WP_REST_Response( null, 204 );
		}

		$payment_status = (string) $event['data']['status'];
		$action         = PEPEW_WC_Order_State::action_for( $payment_status, $order->get_status() );

		$order->update_meta_data( PEPEW_WC_Meta::VERSION, $event_version );
		$order->update_meta_data( PEPEW_WC_Meta::STATUS, $payment_status );
		$order->update_meta_data( PEPEW_WC_Meta::LAST_EVENT_ID, $event['event_id'] );

		switch ( $action ) {
			case PEPEW_WC_Order_State::ACTION_COMPLETE:
				$order->delete_meta_data( PEPEW_WC_Meta::REVIEW_REQUIRED );
				if ( ! $order->has_status( array( 'processing', 'completed' ) ) ) {
					$order->payment_complete();
				} else {
					$order->save();
				}
				break;

			case PEPEW_WC_Order_State::ACTION_HOLD:
				$order->delete_meta_data( PEPEW_WC_Meta::REVIEW_REQUIRED );
				$order->update_status( 'on-hold', 'PEPEW payment is awaiting sufficient confirmation.' );
				break;

			case PEPEW_WC_Order_State::ACTION_HOLD_REVIEW:
				$order->update_meta_data( PEPEW_WC_Meta::REVIEW_REQUIRED, 'yes' );
				$order->update_status( 'on-hold', 'PEPEW confirmation was reduced by a later authoritative payment update; review fulfillment before release.' );
				break;

			case PEPEW_WC_Order_State::ACTION_FAIL:
				$order->delete_meta_data( PEPEW_WC_Meta::REVIEW_REQUIRED );
				if ( ! $order->has_status( 'failed' ) ) {
					$order->update_status( 'failed', 'PEPEW payment expired or entered an error state before confirmation.' );
				} else {
					$order->save();
				}
				break;

			case PEPEW_WC_Order_State::ACTION_REVIEW:
				$order->update_meta_data( PEPEW_WC_Meta::REVIEW_REQUIRED, 'yes' );
				$order->save();
				$order->add_order_note( 'PEPEW payment state changed and requires manual review before further fulfillment action.' );
				break;

			default:
				$order->save();
				break;
		}

		return new WP_REST_Response( null, 204 );
	}
}
