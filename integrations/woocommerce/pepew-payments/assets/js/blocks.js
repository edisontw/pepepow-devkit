( function () {
	'use strict';

	if (
		! window.wc ||
		! window.wc.wcBlocksRegistry ||
		! window.wc.wcSettings ||
		! window.wp ||
		! window.wp.element
	) {
		return;
	}

	const { registerPaymentMethod } = window.wc.wcBlocksRegistry;
	const { getSetting } = window.wc.wcSettings;
	const { createElement } = window.wp.element;
	const settings = getSetting( 'pepew_data', {} );
	const title = settings.title || 'Pay with PEPEW';
	const description = settings.description || 'Pay securely with PEPEW.';
	const label = createElement( 'span', null, title );
	const content = createElement( 'div', null, description );

	registerPaymentMethod( {
		name: 'pepew',
		paymentMethodId: 'pepew',
		gatewayId: 'pepew',
		label,
		ariaLabel: title,
		content,
		edit: content,
		canMakePayment: ( context ) => {
			const currency = context && context.billing && context.billing.currency;
			const code =
				currency &&
				( currency.code || currency.currency_code || currency.currencyCode );

			return ! code || code === 'PEPEW';
		},
		supports: {
			features: Array.isArray( settings.supports )
				? settings.supports
				: [ 'products' ],
			showSavedCards: false,
			showSaveOption: false,
		},
	} );
} )();
