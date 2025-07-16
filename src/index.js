import { handleKVOperations } from './handlers/kvHandler.js';
import { createResponse, createErrorResponse } from './utils/response.js';

export default {
  async fetch(request, env, ctx) {
    try {
      // CORS处理
      const corsHeaders = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-KV-Namespace',
        'Access-Control-Max-Age': '86400'
      };

      if (request.method === 'OPTIONS') {
        return new Response(null, { headers: corsHeaders });
      }

      const url = new URL(request.url);
      const path = url.pathname;

      // 健康检查
      if (path === '/health' || path === '/') {
        return createResponse({
          status: 'healthy',
          version: env.API_VERSION || 'v1',
          environment: env.ENVIRONMENT || 'development',
          timestamp: new Date().toISOString(),
          availableNamespaces: [
            'USER_DATA',
            'PRODUCT_DATA', 
            'CONFIG_DATA',
            'CACHE_DATA',
            'LOG_DATA'
          ]
        }, corsHeaders);
      }

      // API路由处理
      const apiPrefix = `/api/${env.API_VERSION || 'v1'}`;
      if (path.startsWith(apiPrefix + '/kv')) {
        const kvPath = path.replace(apiPrefix + '/kv', '');
        return await handleKVOperations(request, env, kvPath, corsHeaders);
      }

      // 文档路由
      if (path === '/docs' || path === '/api-docs') {
        return createResponse({
          title: "Cloudflare Workers KV CRUD API",
          version: env.API_VERSION || 'v1',
          description: "Complete CRUD operations for multiple KV namespaces",
          endpoints: {
            "GET /api/v1/kv/{namespace}": "List all keys in namespace",
            "GET /api/v1/kv/{namespace}/{key}": "Get value by key",
            "POST /api/v1/kv/{namespace}/{key}": "Create/Update key-value pair",
            "PUT /api/v1/kv/{namespace}/{key}": "Update key-value pair",
            "DELETE /api/v1/kv/{namespace}/{key}": "Delete key",
            "POST /api/v1/kv/{namespace}/batch": "Batch operations"
          },
          namespaces: [
            "USER_DATA", "PRODUCT_DATA", "CONFIG_DATA", "CACHE_DATA", "LOG_DATA"
          ],
          examples: {
            "create": "POST /api/v1/kv/USER_DATA/user123 with JSON body",
            "read": "GET /api/v1/kv/USER_DATA/user123",
            "update": "PUT /api/v1/kv/USER_DATA/user123 with JSON body",
            "delete": "DELETE /api/v1/kv/USER_DATA/user123",
            "list": "GET /api/v1/kv/USER_DATA?limit=10&prefix=user"
          }
        }, corsHeaders);
      }

      return createErrorResponse('Endpoint not found', 404, corsHeaders);

    } catch (error) {
      console.error('Global error:', error);
      return createErrorResponse(
        env.DEBUG === 'true' ? error.message : 'Internal server error',
        500,
        corsHeaders
      );
    }
  }
};
