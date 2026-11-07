import type { CatalogueSKU } from './types';
import type { Language } from './i18n';

/**
 * Formats a monetary value using Indian numbering grouping:
 * e.g., 2928 -> ₹2,928.00
 * e.g., 100000 -> ₹1,00,000.00
 */
export function formatINR(val: number | string | null | undefined): string {
  if (val === null || val === undefined) return '₹0.00';
  const num = typeof val === 'string' ? parseFloat(val) : val;
  if (isNaN(num)) return '₹0.00';

  const parts = num.toFixed(2).split('.');
  let intPart = parts[0];
  const decPart = parts[1];
  const isNegative = intPart.startsWith('-');
  if (isNegative) intPart = intPart.substring(1);

  let last3 = intPart.slice(-3);
  const otherDigits = intPart.slice(0, -3);
  if (otherDigits !== '') {
    last3 = ',' + last3;
  }
  const formattedInt = otherDigits.replace(/\B(?=(\d{2})+(?!\d))/g, ',') + last3;
  return (isNegative ? '-₹' : '₹') + formattedInt + '.' + decPart;
}

/**
 * Derives product category from SKU name / code dynamically.
 */
export function getProductCategory(sku: CatalogueSKU): string {
  const name = (sku.name || '').toLowerCase();
  const code = (sku.code || '').toUpperCase();

  if (name.includes('biscuit') || code.includes('-BS-')) {
    return 'Biscuits';
  }
  if (name.includes('detergent') || code.includes('-DT-')) {
    return 'Detergent';
  }
  if (name.includes('tea') || code.includes('-TE-')) {
    return 'Tea';
  }

  // Fallback to first word of product name
  const words = sku.name.trim().split(/\s+/);
  if (words.length > 0 && words[0]) {
    const first = words[0];
    return first.charAt(0).toUpperCase() + first.slice(1).toLowerCase();
  }
  return 'Other';
}

/**
 * Derives unique list of categories from the loaded catalogue SKUs.
 * "All" is always first.
 */
export function deriveCategoriesFromCatalogue(skus: CatalogueSKU[]): string[] {
  const categories = new Set<string>();
  for (const sku of skus) {
    categories.add(getProductCategory(sku));
  }
  return ['All', ...Array.from(categories)];
}

/**
 * Localized label for categories
 */
export function getCategoryLabel(category: string, lang: Language): string {
  if (category === 'All') return lang === 'hi' ? 'सभी' : 'All';
  if (category === 'Biscuits') return lang === 'hi' ? 'बिस्कुट' : 'Biscuits';
  if (category === 'Detergent') return lang === 'hi' ? 'डिटर्जेंट' : 'Detergent';
  if (category === 'Tea') return lang === 'hi' ? 'चाय' : 'Tea';
  return category;
}
