<?php

defined( 'ABSPATH' ) || defined( 'PEPEW_WC_TESTING' ) || exit;

final class PEPEW_WC_Meta {
	public const REFERENCE       = '_pepew_merchant_reference';
	public const IDEMPOTENCY     = '_pepew_idempotency_key';
	public const PAYMENT_ID      = '_pepew_payment_id';
	public const VERSION         = '_pepew_payment_version';
	public const STATUS          = '_pepew_payment_status';
	public const CHECKOUT        = '_pepew_checkout_url';
	public const AMOUNT          = '_pepew_amount';
	public const LAST_EVENT_ID   = '_pepew_last_event_id';
	public const REVIEW_REQUIRED = '_pepew_review_required';
}
