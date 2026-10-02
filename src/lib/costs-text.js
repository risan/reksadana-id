// Runs both at build time and in the browser, so it must not import Node modules.
// The costs of a fund (see costs.js) as text for the fund page and the compare table.
import * as m from '../paraglide/messages.js';
import { formatFeeRange } from './costs.js';
import { currencyPrefix, formatNumber, formatPercent } from './format.js';

const FEE_LABELS = {
  subscription: () => m.detail_fee_subscription(),
  redemption: () => m.detail_fee_redemption(),
  switch: () => m.detail_fee_switch(),
};

const SOURCE_NAMES = { bibit: 'Bibit', makmur: 'Makmur', bareksa: 'Bareksa' };

// What Bareksa gives for minimums and fees is the prospectus value, and the label says so.
function sourceLabel(source) {
  return source === 'bareksa' ? m.cost_source_bareksa() : SOURCE_NAMES[source];
}

// Missing parts stay null or empty, so a caller shows "not in our sources", never zero.
export function describeCosts(costs, locale) {
  const feeWords = { free: m.cost_fee_free(), upTo: (value) => m.cost_fee_up_to({ value }), from: (value) => m.cost_fee_from({ value }) };
  const money = ({ amount }) => `${currencyPrefix(costs.currency)} ${formatNumber(amount, locale)}`;
  const withSource = (item, text) => (item === null ? null : { text, source: sourceLabel(item.source) });

  return {
    expenseRatio: withSource(costs.expense_ratio, costs.expense_ratio && formatPercent(costs.expense_ratio.value, locale)),
    minPurchases: costs.min_purchase.map((item) => withSource(item, money(item))),
    minTopup: withSource(costs.min_topup, costs.min_topup && money(costs.min_topup)),
    minRedemption: withSource(costs.min_redemption, costs.min_redemption && money(costs.min_redemption)),
    fees: Object.entries(costs.max_fees)
      .filter(([, range]) => range !== null)
      .map(([kind, range]) => ({ label: FEE_LABELS[kind](), ...withSource(range, formatFeeRange(range, locale, feeWords)) })),
    custodian: costs.custodian && { text: costs.custodian.name, source: SOURCE_NAMES[costs.custodian.source] },
  };
}
