export const nonemptyString = (value) => typeof value === 'string' && value.length > 0;
export const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
export const deliveryStatuses = new Set(['sent', 'delivered', 'failed']);
