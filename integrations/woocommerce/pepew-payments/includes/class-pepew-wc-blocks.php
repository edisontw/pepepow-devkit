<?php

defined( 'ABSPATH' ) || exit;

use Automattic\WooCommerce\Blocks\Payments\Integrations\AbstractPaymentMethodType;

final class PEPEW_WC_Blocks extends AbstractPaymentMethodType {
	protected $name = 'pepew';

	public function initialize(): void {
		$settings       = get_option( 'woocommerce_pepew_settings', array() );
		$this->settings = is_array( $settings ) ? $settings : array();
	}

	public function is_active(): bool {
		return 'yes' === (string) $this->get_setting( 'enabled', 'no' )
			&& function_exists( 'get_woocommerce_currency' )
			&& 'PEPEW' === get_woocommerce_currency()
			&& strlen( trim( (string) $this->get_setting( 'api_key', '' ) ) ) >= 32
			&& '' !== trim( (string) $this->get_setting( 'receive_address', '' ) );
	}

	public function get_payment_method_script_handles(): array {
		$handle = 'pepew-wc-blocks';

		wp_register_script(
			$handle,
			plugins_url( 'assets/js/blocks.js', PEPEW_WC_PLUGIN_FILE ),
			array( 'wc-blocks-registry', 'wc-settings', 'wp-element' ),
			PEPEW_WC_VERSION,
			true
		);

		return array( $handle );
	}

	public function get_payment_method_script_handles_for_admin(): array {
		return $this->get_payment_method_script_handles();
	}

	public function get_payment_method_data(): array {
		return array(
			'title'       => (string) $this->get_setting( 'title', 'Pay with PEPEW' ),
			'description' => (string) $this->get_setting( 'description', 'Pay securely with PEPEW.' ),
			'supports'    => array( 'products' ),
		);
	}
}
