import React from 'react';
import { getProductImage } from '../utils';

interface ProductImageProps {
  skuCode?: string | null;
  className?: string;
  alt?: string;
  grayscale?: boolean;
}

/**
 * Shared ProductImage component using exclusively the flat SVG pack illustrations
 * in /products/ (web/public/products/).
 * No other image source, no photos, no fallback artwork.
 */
export const ProductImage: React.FC<ProductImageProps> = ({
  skuCode,
  className = 'w-full h-full object-contain',
  alt = '',
  grayscale = false,
}) => {
  const src = getProductImage(skuCode || '');

  return (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      className={`${className} ${grayscale ? 'filter grayscale opacity-60' : ''}`}
      onError={(e) => {
        (e.currentTarget as HTMLImageElement).src = '/products/placeholder.svg';
      }}
    />
  );
};

