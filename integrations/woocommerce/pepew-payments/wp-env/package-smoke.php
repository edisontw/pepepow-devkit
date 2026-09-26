<?php

defined( 'ABSPATH' ) || exit;

$settings = get_option( 'woocommerce_pepew_settings', array() );
if (
	! is_array( $settings ) ||
	'upgrade-secret' !== ( $settings['api_key'] ?? null ) ||
	'upgrade-webhook-secret' !== ( $settings['webhook_secret'] ?? null )
) {
	fwrite( STDERR, "WooCommerce PEPEW settings were not preserved across package overwrite.\n" );
	exit( 1 );
}

$plugin_file = 'pepew-payments/pepew-payments.php';
if ( ! is_plugin_active( $plugin_file ) ) {
	fwrite( STDERR, "PEPEW plugin is not active after package overwrite.\n" );
	exit( 1 );
}

echo "PEPEW package upgrade/settings smoke passed.\n";
