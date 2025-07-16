export function validateKey(key) {
    if (!key || typeof key !== 'string') {
      return { valid: false, error: 'Key must be a non-empty string' };
    }
  
    if (key.length > 256) {
      return { valid: false, error: 'Key length cannot exceed 256 characters' };
    }
  
    // 检查特殊字符
    const invalidChars = /[\x00-\x1f\x7f]/;
    if (invalidChars.test(key)) {
      return { valid: false, error: 'Key contains invalid control characters' };
    }
  
    return { valid: true };
  }
  
  export function validateValue(value) {
    if (value === null || value === undefined) {
      return { valid: false, error: 'Value cannot be null or undefined' };
    }
  
    // 序列化后检查大小
    const serialized = typeof value === 'string' ? value : JSON.stringify(value);
    const size = new Blob([serialized]).size;
  
    if (size > 10 * 1024 * 1024) { // 25MB limit
      return { valid: false, error: 'Value size exceeds 10MB limit' };
    }
  
    return { valid: true };
  }
  
  export function validateNamespace(namespace) {
    const validNamespaces = ['USER_DATA', 'PRODUCT_DATA', 'CONFIG_DATA', 'CACHE_DATA', 'LOG_DATA'];
    
    if (!namespace || !validNamespaces.includes(namespace.toUpperCase())) {
      return { 
        valid: false, 
        error: `Invalid namespace. Must be one of: ${validNamespaces.join(', ')}` 
      };
    }
  
    return { valid: true };
  }
  