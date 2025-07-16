export function createResponse(data, corsHeaders = {}, status = 200) {
    const headers = {
      'Content-Type': 'application/json',
      ...corsHeaders
    };
  
    return new Response(JSON.stringify(data, null, 2), {
      status: status,
      headers: headers
    });
  }
  
  export function createErrorResponse(message, status = 500, corsHeaders = {}, details = null) {
    const headers = {
      'Content-Type': 'application/json',
      ...corsHeaders
    };
  
    const errorData = {
      error: true,
      message: message,
      status: status,
      timestamp: new Date().toISOString()
    };
  
    if (details) {
      errorData.details = details;
    }
  
    return new Response(JSON.stringify(errorData, null, 2), {
      status: status,
      headers: headers
    });
  }
  