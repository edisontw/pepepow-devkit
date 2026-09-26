<?php

defined( 'WP_UNINSTALL_PLUGIN' ) || exit;

// Remove server-side merchant credentials/settings on explicit uninstall.
// Historical order payment metadata is intentionally preserved for merchant
// reconciliation and audit continuity.
delete_option( 'woocommerce_pepew_settings' );
