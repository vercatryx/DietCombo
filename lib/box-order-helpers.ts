import { OrderConfiguration, BoxConfiguration } from './types';

/**
 * Convert legacy box order format to new boxes[] format
 */
export function migrateLegacyBoxOrder(config: OrderConfiguration): OrderConfiguration {
  if (config.serviceType !== 'Boxes') return config;
  
  // If already in new format, return as-is
  if (config.boxes && config.boxes.length > 0) {
    return config;
  }
  
  // Convert legacy format
  if (config.boxQuantity && config.boxQuantity > 0 && config.boxTypeId) {
    const boxes: BoxConfiguration[] = [];
    const items = config.items || {};
    const itemPrices = config.itemPrices || {};
    
    // Create boxes based on quantity
    for (let i = 1; i <= config.boxQuantity; i++) {
      boxes.push({
        boxNumber: i,
        boxTypeId: config.boxTypeId,
        vendorId: config.vendorId,
        items: { ...items }, // Each box gets same items initially
        itemPrices: { ...itemPrices },
        itemNotes: {}, // Initialize empty item notes
        notes: undefined
      });
    }
    
    return {
      ...config,
      boxes,
      // Keep legacy fields for backward compatibility during transition
      boxQuantity: config.boxQuantity,
      items: config.items,
      itemPrices: config.itemPrices
    };
  }
  
  // No boxes configured yet
  return {
    ...config,
    boxes: []
  };
}

/**
 * Get total number of boxes from order config (supports both formats)
 */
export function getTotalBoxCount(config: OrderConfiguration): number {
  if (config.serviceType !== 'Boxes') return 0;
  if (config.boxes && config.boxes.length > 0) {
    return config.boxes.length;
  }
  return config.boxQuantity || 0;
}

/**
 * Validate box count against authorized amount
 */
export function validateBoxCountAgainstAuthorization(
  boxCount: number,
  authorizedAmount: number | null | undefined,
  boxTypePrice?: number
): { valid: boolean; message?: string } {
  if (!authorizedAmount || authorizedAmount <= 0) {
    return { valid: true }; // No limit if not set
  }
  
  if (!boxTypePrice || boxTypePrice <= 0) {
    return { valid: true }; // Can't validate without price
  }
  
  const totalCost = boxCount * boxTypePrice;
  const maxBoxes = Math.floor(authorizedAmount / boxTypePrice);
  
  if (totalCost > authorizedAmount) {
    return {
      valid: false,
      message: `Total cost ($${totalCost.toFixed(2)}) exceeds authorized amount ($${authorizedAmount.toFixed(2)}). Maximum ${maxBoxes} boxes allowed.`
    };
  }
  
  return { valid: true };
}

/**
 * Get maximum boxes allowed based on authorization
 */
export function getMaxBoxesAllowed(
  authorizedAmount: number | null | undefined,
  boxTypePrice?: number
): number | null {
  if (!authorizedAmount || authorizedAmount <= 0) {
    return null; // Unlimited
  }
  
  if (!boxTypePrice || boxTypePrice <= 0) {
    return null; // Can't calculate without price
  }
  
  return Math.floor(authorizedAmount / boxTypePrice);
}
