import { createResponse, createErrorResponse } from '../utils/response.js';
import { validateKey, validateValue, validateNamespace } from '../utils/validation.js';

// KV命名空间映射
const KV_NAMESPACES = {
  'USER_DATA': 'USER_DATA',
  'PRODUCT_DATA': 'PRODUCT_DATA',
  'CONFIG_DATA': 'CONFIG_DATA',
  'CACHE_DATA': 'CACHE_DATA',
  'LOG_DATA': 'LOG_DATA'
};

export async function handleKVOperations(request, env, path, corsHeaders) {
  const pathParts = path.split('/').filter(Boolean);
  const namespace = pathParts[0]?.toUpperCase();
  const key = pathParts[1];
  const method = request.method;

  // 验证命名空间
  if (!namespace || !KV_NAMESPACES[namespace]) {
    return createErrorResponse(
      `Invalid namespace. Available: ${Object.keys(KV_NAMESPACES).join(', ')}`,
      400,
      corsHeaders
    );
  }

  const kvStore = env[KV_NAMESPACES[namespace]];
  if (!kvStore) {
    return createErrorResponse(`KV namespace ${namespace} not found`, 500, corsHeaders);
  }

  try {
    switch (method) {
      case 'GET':
        if (key) {
          return await getKVValue(kvStore, namespace, key, corsHeaders);
        } else {
          return await listKVKeys(request, kvStore, namespace, corsHeaders);
        }

      case 'POST':
        if (pathParts[1] === 'batch') {
          return await batchKVOperations(request, kvStore, namespace, corsHeaders);
        }
        if (!key) {
          return createErrorResponse('Key is required for POST operation', 400, corsHeaders);
        }
        return await setKVValue(request, kvStore, namespace, key, corsHeaders);

      case 'PUT':
        if (!key) {
          return createErrorResponse('Key is required for PUT operation', 400, corsHeaders);
        }
        return await updateKVValue(request, kvStore, namespace, key, corsHeaders);

      case 'DELETE':
        if (!key) {
          return createErrorResponse('Key is required for DELETE operation', 400, corsHeaders);
        }
        return await deleteKVValue(kvStore, namespace, key, corsHeaders);

      default:
        return createErrorResponse('Method not allowed', 405, corsHeaders);
    }
  } catch (error) {
    console.error(`KV operation error [${namespace}:${key}]:`, error);
    return createErrorResponse('KV operation failed', 500, corsHeaders);
  }
}

// 获取单个键值
async function getKVValue(kvStore, namespace, key, corsHeaders) {
  // 验证键名
  const keyValidation = validateKey(key);
  if (!keyValidation.valid) {
    return createErrorResponse(keyValidation.error, 400, corsHeaders);
  }

  try {
    // 获取值和元数据
    const valueWithMetadata = await kvStore.getWithMetadata(key);
    
    if (valueWithMetadata.value === null) {
      return createErrorResponse(`Key '${key}' not found in ${namespace}`, 404, corsHeaders);
    }

    let parsedValue;
    try {
      // 尝试解析JSON
      parsedValue = JSON.parse(valueWithMetadata.value);
    } catch {
      // 如果不是JSON，返回原始字符串
      parsedValue = valueWithMetadata.value;
    }

    return createResponse({
      namespace: namespace,
      key: key,
      value: parsedValue,
      metadata: valueWithMetadata.metadata || {},
      size: new Blob([valueWithMetadata.value]).size,
      retrievedAt: new Date().toISOString()
    }, corsHeaders);

  } catch (error) {
    console.error(`Get KV error [${namespace}:${key}]:`, error);
    return createErrorResponse('Failed to retrieve value', 500, corsHeaders);
  }
}

// 列出所有键
async function listKVKeys(request, kvStore, namespace, corsHeaders) {
  try {
    const url = new URL(request.url);
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '100'), 1000);
    const prefix = url.searchParams.get('prefix') || '';
    const cursor = url.searchParams.get('cursor');

    const listOptions = {
      limit: limit
    };

    if (prefix) {
      listOptions.prefix = prefix;
    }

    if (cursor) {
      listOptions.cursor = cursor;
    }

    const result = await kvStore.list(listOptions);

    // 获取键的详细信息（可选）
    const includeValues = url.searchParams.get('includeValues') === 'true';
    const keys = [];

    if (includeValues && result.keys.length <= 50) { // 限制批量获取数量
      const valuePromises = result.keys.map(async (keyInfo) => {
        try {
          const valueWithMetadata = await kvStore.getWithMetadata(keyInfo.name);
          let parsedValue;
          try {
            parsedValue = JSON.parse(valueWithMetadata.value);
          } catch {
            parsedValue = valueWithMetadata.value;
          }

          return {
            name: keyInfo.name,
            value: parsedValue,
            metadata: valueWithMetadata.metadata || {},
            size: new Blob([valueWithMetadata.value]).size,
            expiration: keyInfo.expiration
          };
        } catch {
          return {
            name: keyInfo.name,
            value: null,
            error: 'Failed to retrieve value',
            expiration: keyInfo.expiration
          };
        }
      });

      const keyResults = await Promise.all(valuePromises);
      keys.push(...keyResults);
    } else {
      keys.push(...result.keys.map(keyInfo => ({
        name: keyInfo.name,
        expiration: keyInfo.expiration,
        metadata: keyInfo.metadata || {}
      })));
    }

    return createResponse({
      namespace: namespace,
      keys: keys,
      count: keys.length,
      pagination: {
        hasMore: !result.list_complete,
        cursor: result.cursor,
        limit: limit
      },
      filters: {
        prefix: prefix || null,
        includeValues: includeValues
      },
      retrievedAt: new Date().toISOString()
    }, corsHeaders);

  } catch (error) {
    console.error(`List KV keys error [${namespace}]:`, error);
    return createErrorResponse('Failed to list keys', 500, corsHeaders);
  }
}

// 设置键值对
async function setKVValue(request, kvStore, namespace, key, corsHeaders) {
  // 验证键名
  const keyValidation = validateKey(key);
  if (!keyValidation.valid) {
    return createErrorResponse(keyValidation.error, 400, corsHeaders);
  }

  try {
    const requestData = await request.json();
    const { value, ttl, metadata } = requestData;

    if (value === undefined) {
      return createErrorResponse('Value is required', 400, corsHeaders);
    }

    // 验证值
    const valueValidation = validateValue(value);
    if (!valueValidation.valid) {
      return createErrorResponse(valueValidation.error, 400, corsHeaders);
    }

    // 序列化值
    const serializedValue = typeof value === 'string' ? value : JSON.stringify(value);

    // 设置选项
    const options = {};
    
    if (metadata && typeof metadata === 'object') {
      options.metadata = {
        ...metadata,
        createdAt: new Date().toISOString(),
        createdBy: 'api'
      };
    }

    if (ttl && typeof ttl === 'number' && ttl > 0) {
      options.expirationTtl = ttl;
    }

    // 存储键值对
    await kvStore.put(key, serializedValue, options);

    return createResponse({
      namespace: namespace,
      key: key,
      value: value,
      metadata: options.metadata || {},
      ttl: ttl || null,
      size: new Blob([serializedValue]).size,
      operation: 'create',
      createdAt: new Date().toISOString()
    }, corsHeaders, 201);

  } catch (error) {
    console.error(`Set KV error [${namespace}:${key}]:`, error);
    return createErrorResponse('Failed to set value', 500, corsHeaders);
  }
}

// 更新键值对
async function updateKVValue(request, kvStore, namespace, key, corsHeaders) {
  // 验证键名
  const keyValidation = validateKey(key);
  if (!keyValidation.valid) {
    return createErrorResponse(keyValidation.error, 400, corsHeaders);
  }

  try {
    // 检查键是否存在
    const existingValue = await kvStore.get(key);
    if (existingValue === null) {
      return createErrorResponse(`Key '${key}' not found in ${namespace}`, 404, corsHeaders);
    }

    const requestData = await request.json();
    const { value, ttl, metadata, merge } = requestData;

    if (value === undefined) {
      return createErrorResponse('Value is required', 400, corsHeaders);
    }

    // 验证值
    const valueValidation = validateValue(value);
    if (!valueValidation.valid) {
      return createErrorResponse(valueValidation.error, 400, corsHeaders);
    }

    let finalValue = value;

    // 如果启用合并模式且现有值是对象
    if (merge === true && typeof value === 'object' && value !== null) {
      try {
        const existingObject = JSON.parse(existingValue);
        if (typeof existingObject === 'object' && existingObject !== null) {
          finalValue = { ...existingObject, ...value };
        }
      } catch {
        // 如果现有值不是有效JSON，使用新值
      }
    }

    // 序列化值
    const serializedValue = typeof finalValue === 'string' ? finalValue : JSON.stringify(finalValue);

    // 设置选项
    const options = {};
    
    if (metadata && typeof metadata === 'object') {
      options.metadata = {
        ...metadata,
        updatedAt: new Date().toISOString(),
        updatedBy: 'api'
      };
    }

    if (ttl && typeof ttl === 'number' && ttl > 0) {
      options.expirationTtl = ttl;
    }

    // 更新键值对
    await kvStore.put(key, serializedValue, options);

    return createResponse({
      namespace: namespace,
      key: key,
      value: finalValue,
      metadata: options.metadata || {},
      ttl: ttl || null,
      size: new Blob([serializedValue]).size,
      operation: 'update',
      merged: merge === true,
      updatedAt: new Date().toISOString()
    }, corsHeaders);

  } catch (error) {
    console.error(`Update KV error [${namespace}:${key}]:`, error);
    return createErrorResponse('Failed to update value', 500, corsHeaders);
  }
}

// 删除键值对
async function deleteKVValue(kvStore, namespace, key, corsHeaders) {
  // 验证键名
  const keyValidation = validateKey(key);
  if (!keyValidation.valid) {
    return createErrorResponse(keyValidation.error, 400, corsHeaders);
  }

  try {
    // 检查键是否存在
    const existingValue = await kvStore.get(key);
    if (existingValue === null) {
      return createErrorResponse(`Key '${key}' not found in ${namespace}`, 404, corsHeaders);
    }

    // 删除键
    await kvStore.delete(key);

    return createResponse({
      namespace: namespace,
      key: key,
      operation: 'delete',
      deletedAt: new Date().toISOString(),
      message: `Key '${key}' deleted successfully from ${namespace}`
    }, corsHeaders);

  } catch (error) {
    console.error(`Delete KV error [${namespace}:${key}]:`, error);
    return createErrorResponse('Failed to delete key', 500, corsHeaders);
  }
}

// 批量操作
async function batchKVOperations(request, kvStore, namespace, corsHeaders) {
  try {
    const { operations } = await request.json();

    if (!Array.isArray(operations)) {
      return createErrorResponse('Operations must be an array', 400, corsHeaders);
    }

    if (operations.length > 100) {
      return createErrorResponse('Maximum 100 operations per batch', 400, corsHeaders);
    }

    const results = [];
    const errors = [];

    for (let i = 0; i < operations.length; i++) {
      const op = operations[i];
      
      try {
        const { operation, key, value, ttl, metadata } = op;

        if (!operation || !key) {
          errors.push({
            index: i,
            error: 'Operation and key are required',
            operation: op
          });
          continue;
        }

        // 验证键名
        const keyValidation = validateKey(key);
        if (!keyValidation.valid) {
          errors.push({
            index: i,
            error: keyValidation.error,
            operation: op
          });
          continue;
        }

        let result = { index: i, key: key, operation: operation };

        switch (operation.toLowerCase()) {
          case 'get':
            const getValue = await kvStore.get(key);
            result.success = getValue !== null;
            result.value = getValue ? (getValue.startsWith('{') || getValue.startsWith('[') ? JSON.parse(getValue) : getValue) : null;
            break;

          case 'set':
          case 'put':
            if (value === undefined) {
              errors.push({
                index: i,
                error: 'Value is required for set/put operation',
                operation: op
              });
              continue;
            }

            const serializedValue = typeof value === 'string' ? value : JSON.stringify(value);
            const options = {};
            
            if (metadata) options.metadata = metadata;
            if (ttl) options.expirationTtl = ttl;

            await kvStore.put(key, serializedValue, options);
            result.success = true;
            result.value = value;
            break;

          case 'delete':
            await kvStore.delete(key);
            result.success = true;
            break;

          default:
            errors.push({
              index: i,
              error: `Unknown operation: ${operation}`,
              operation: op
            });
            continue;
        }

        results.push(result);

      } catch (error) {
        errors.push({
          index: i,
          error: error.message,
          operation: op
        });
      }
    }

    return createResponse({
      namespace: namespace,
      batchResults: {
        total: operations.length,
        successful: results.length,
        failed: errors.length,
        results: results,
        errors: errors
      },
      processedAt: new Date().toISOString()
    }, corsHeaders);

  } catch (error) {
    console.error(`Batch KV operations error [${namespace}]:`, error);
    return createErrorResponse('Failed to process batch operations', 500, corsHeaders);
  }
}
