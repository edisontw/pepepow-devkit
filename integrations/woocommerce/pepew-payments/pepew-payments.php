<?php
/**
 * Plugin Name: PEPEW Payments for WooCommerce
 * Description: Redirect WooCommerce orders to PEPEW Payment Platform / PepewPay.
 * Version: 0.1.0-dev
 * Requires at least: 6.7
 * Requires PHP: 8.0
 * Requires Plugins: woocommerce
 * WC requires at least: 8.2
 * WC tested up to: 11.1.2
 * Text Domain: pepew-payments
 * License: MIT
 */

defined( 'ABSPATH' ) || exit;

define( 'PEPEW_WC_VERSION', '0.1.0-dev' );
define( 'PEPEW_WC_PLUGIN_FILE', __FILE__ );
define( 'PEPEW_WC_PLUGIN_DIR', plugin_dir_path( __FILE__ ) );

require_once PEPEW_WC_PLUGIN_DIR . 'includes/class-pepew-wc-meta.php';
require_once PEPEW_WC_PLUGIN_DIR . 'includes/class-pepew-wc-order-identity.php';
require_once PEPEW_WC_PLUGIN_DIR . 'includes/class-pepew-wc-order-state.php';
require_once PEPEW_WC_PLUGIN_DIR . 'includes/class-pepew-wc-api-client.php';
require_once PEPEW_WC_PLUGIN_DIR . 'includes/class-pepew-wc-webhook-verifier.php';

add_action(
	'before_woocommerce_init',
	static function (): void {
		if ( class_exists( '\\Automattic\\WooCommerce\\Utilities\\FeaturesUtil' ) ) {
			\Automattic\WooCommerce\Utilities\FeaturesUtil::declare_compatibility(
				'cart_checkout_blocks',
				PEPEW_WC_PLUGIN_FILE,
				true
			);
			\Automattic\WooCommerce\Utilities\FeaturesUtil::declare_compatibility(
				'custom_order_tables',
				PEPEW_WC_PLUGIN_FILE,
				true
			);
		}
	}
);

add_filter(
	'woocommerce_currencies',
	static function ( array $currencies ): array {
		$currencies['PEPEW'] = 'PEPEW';
		return $currencies;
	}
);

add_filter(
	'woocommerce_currency_symbol',
	static function ( string $symbol, string $currency ): string {
		return 'PEPEW' === $currency ? 'PEPEW' : $symbol;
	},
	10,
	2
);

add_filter(
	'wc_get_price_decimals',
	static function ( int $decimals ): int {
		return function_exists( 'get_woocommerce_currency' ) && 'PEPEW' === get_woocommerce_currency()
			? 8
			: $decimals;
	}
);

add_action(
	'plugins_loaded',
	static function (): void {
		if ( ! class_exists( 'WC_Payment_Gateway' ) ) {
			return;
		}

		require_once PEPEW_WC_PLUGIN_DIR . 'includes/class-pepew-wc-gateway.php';
		require_once PEPEW_WC_PLUGIN_DIR . 'includes/class-pepew-wc-webhook-handler.php';

		add_action( 'rest_api_init', array( 'PEPEW_WC_Webhook_Handler', 'register_route' ) );

		add_filter(
			'woocommerce_payment_gateways',
			static function ( array $gateways ): array {
				$gateways[] = 'PEPEW_WC_Gateway';
				return $gateways;
			}
		);
	},
	20
);

add_action(
	'woocommerce_blocks_loaded',
	static function (): void {
		if ( ! class_exists( '\\Automattic\\WooCommerce\\Blocks\\Payments\\Integrations\\AbstractPaymentMethodType' ) ) {
			return;
		}

		require_once PEPEW_WC_PLUGIN_DIR . 'includes/class-pepew-wc-blocks.php';

		add_action(
			'woocommerce_blocks_payment_method_type_registration',
			static function ( $payment_method_registry ): void {
				$payment_method_registry->register( new PEPEW_WC_Blocks() );
			}
		);
	}
);
