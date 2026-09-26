<?php

define( 'PEPEW_WC_TESTING', true );
require_once __DIR__ . '/../pepew-payments/includes/class-pepew-wc-order-state.php';

function expect_same_state( $expected, $actual, string $label ): void {
	if ( $expected !== $actual ) {
		fwrite( STDERR, $label . " failed: expected " . $expected . ", got " . $actual . "\n" );
		exit( 1 );
	}
}

expect_same_state( 'hold', PEPEW_WC_Order_State::action_for( 'paid_unconfirmed', 'pending' ), 'unconfirmed pending' );
expect_same_state( 'complete', PEPEW_WC_Order_State::action_for( 'paid_confirmed', 'on-hold' ), 'confirmed' );
expect_same_state( 'hold_review', PEPEW_WC_Order_State::action_for( 'paid_unconfirmed', 'processing' ), 'processing reorg' );
expect_same_state( 'review', PEPEW_WC_Order_State::action_for( 'paid_unconfirmed', 'completed' ), 'completed reorg' );
expect_same_state( 'fail', PEPEW_WC_Order_State::action_for( 'expired', 'on-hold' ), 'expired unpaid' );
expect_same_state( 'review', PEPEW_WC_Order_State::action_for( 'expired', 'completed' ), 'expired completed' );
expect_same_state( 'review', PEPEW_WC_Order_State::action_for( 'future_status', 'pending' ), 'unknown future state' );
expect_same_state( 'review', PEPEW_WC_Order_State::action_for( 'paid_confirmed', 'cancelled' ), 'cancelled confirmed review' );
expect_same_state( 'review', PEPEW_WC_Order_State::action_for( 'paid_unconfirmed', 'refunded' ), 'refunded unconfirmed review' );
expect_same_state( 'none', PEPEW_WC_Order_State::action_for( 'waiting', 'cancelled' ), 'cancelled waiting unchanged' );
expect_same_state( 'none', PEPEW_WC_Order_State::action_for( 'expired', 'cancelled' ), 'cancelled expired unchanged' );

expect_same_state( '1234000000', PEPEW_WC_Order_State::decimal_to_atoms_string( '12.34' ), 'amount atoms' );
expect_same_state( '1', PEPEW_WC_Order_State::decimal_to_atoms_string( '0.00000001' ), 'one atom' );

echo "WooCommerce order state tests passed.\n";
