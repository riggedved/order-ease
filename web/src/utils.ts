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
 * Strips trailing ", case of N" suffix from product name.
 * e.g., "Glucose biscuit 75 g, case of 96" -> "Glucose biscuit 75 g"
 */
export function cleanProductName(name: string): string {
  if (!name) return '';
  return name.replace(/,?\s*case of \d+/i, '').trim();
}

/**
 * Capitalizes the starting letter of each word in a string.
 * e.g., "add 5 more for 1 free" -> "Add 5 More For 1 Free"
 */
export function formatTitleCase(str: string): string {
  if (!str) return '';
  return str.replace(/\b[a-z]/g, (char) => char.toUpperCase());
}

/**
 * Formats a string to sentence case.
 * e.g., "add 5 more cases to get 1 free" -> "Add 5 more cases to get 1 free"
 */
export function toSentenceCase(str: string): string {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1);
}

/**
 * Extracts pack size from product name or code.
 * e.g., "Glucose biscuit 75 g, case of 96" -> "75 g"
 * e.g., "Detergent powder 1 kg, case of 20" -> "1 kg"
 */
export function getPackSize(sku: CatalogueSKU | null | undefined): string {
  if (!sku) return '';
  const match = sku.name.match(/\b(\d+(?:\.\d+)?\s*(?:g|kg|ml|l|gm))\b/i);
  if (match) return match[1];
  if (sku.code.includes('-075')) return '75 g';
  if (sku.code.includes('-150')) return '150 g';
  if (sku.code.includes('-1KG')) return '1 kg';
  if (sku.code.includes('-500')) return '500 g';
  if (sku.code.includes('-250')) return '250 g';
  if (sku.code.includes('-100')) return '100 g';
  return cleanProductName(sku.name);
}

/**
 * Maps SKU code to flat SVG pack illustration in /products/
 */
export function getProductImage(code: string): string {
  switch (code) {
    case 'SKU-BS-075':
      return '/products/biscuit-75g.svg';
    case 'SKU-BS-150':
      return '/products/biscuit-150g.svg';
    case 'SKU-DT-1KG':
      return '/products/detergent-1kg.svg';
    case 'SKU-DT-500':
      return '/products/detergent-500g.svg';
    case 'SKU-TE-250':
      return '/products/tea-250g.svg';
    case 'SKU-TE-100':
      return '/products/tea-100g.svg';
    default:
      return '/products/placeholder.svg';
  }
}

/**
 * Returns exact scheme badge text:
 * "Buy 10 cases, get 1 free" and "3% off on 5+ cases"
 */
export function getSchemeBadgeText(sku: CatalogueSKU, lang: Language): string | null {
  const code = (sku.code || '').toUpperCase();
  const label = (sku.scheme_label || '').toLowerCase();

  // Biscuit 75g or free goods scheme
  if (code === 'SKU-BS-075' || label.includes('free') || label.includes('10')) {
    return lang === 'hi' ? '10 केस खरीदने पर 1 मुफ़्त' : 'Buy 10 cases, get 1 free';
  }

  // Detergent 1kg or slab discount scheme
  if (code === 'SKU-DT-1KG' || label.includes('3%') || label.includes('5')) {
    return lang === 'hi' ? '5+ केस पर 3% छूट' : '3% off on 5+ cases';
  }

  return sku.scheme_label || null;
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
