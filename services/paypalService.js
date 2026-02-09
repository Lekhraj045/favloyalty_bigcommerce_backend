const checkoutNodeJssdk = require('@paypal/checkout-server-sdk');
const axios = require('axios');

/**
 * Returns PayPal HTTP client instance with environment that has access
 * credentials context. Use this instance to invoke PayPal APIs, provided the
 * credentials have access.
 */
function client() {
  return new checkoutNodeJssdk.core.PayPalHttpClient(environment());
}

/**
 * Set up and return PayPal JavaScript SDK environment with PayPal access credentials.
 * This sample uses SandboxEnvironment. In production, use LiveEnvironment.
 */
function environment() {
  const clientId = process.env.PAYPAL_CLIENT_ID?.trim();
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET?.trim();
  const mode = (process.env.PAYPAL_MODE || 'sandbox').trim();

  // Debug logging (remove in production)
  console.log('PayPal Configuration:', {
    hasClientId: !!clientId,
    hasClientSecret: !!clientSecret,
    clientIdLength: clientId?.length,
    clientSecretLength: clientSecret?.length,
    mode: mode,
    clientIdPreview: clientId ? `${clientId.substring(0, 20)}...` : 'Not set'
  });

  if (!clientId || !clientSecret) {
    throw new Error('PayPal credentials are missing. Please check your .env file.');
  }

  // Validate credential format
  if (clientId.length < 20 || clientSecret.length < 20) {
    throw new Error('PayPal credentials appear to be invalid. Please check your .env file.');
  }

  try {
    if (mode === 'live') {
      return new checkoutNodeJssdk.core.LiveEnvironment(clientId, clientSecret);
    } else {
      return new checkoutNodeJssdk.core.SandboxEnvironment(clientId, clientSecret);
    }
  } catch (error) {
    console.error('Error creating PayPal environment:', error);
    throw new Error(`Failed to initialize PayPal environment: ${error.message}`);
  }
}

/**
 * Test PayPal authentication by making a direct API call
 */
async function testAuthentication() {
  const clientId = process.env.PAYPAL_CLIENT_ID?.trim();
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET?.trim();
  const mode = (process.env.PAYPAL_MODE || 'sandbox').trim();
  
  if (!clientId || !clientSecret) {
    throw new Error('PayPal credentials are missing');
  }

  const baseUrl = mode === 'live' 
    ? 'https://api.paypal.com' 
    : 'https://api.sandbox.paypal.com';

  try {
    const response = await axios.post(
      `${baseUrl}/v1/oauth2/token`,
      'grant_type=client_credentials',
      {
        headers: {
          'Accept': 'application/json',
          'Accept-Language': 'en_US',
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        auth: {
          username: clientId,
          password: clientSecret,
        },
      }
    );

    return {
      success: true,
      accessToken: response.data.access_token ? 'Received' : 'Not received',
      tokenType: response.data.token_type,
      expiresIn: response.data.expires_in,
    };
  } catch (error) {
    console.error('PayPal Authentication Test Error:', {
      status: error.response?.status,
      statusText: error.response?.statusText,
      data: error.response?.data,
      message: error.message
    });

    return {
      success: false,
      error: error.response?.data || error.message,
      status: error.response?.status,
    };
  }
}

module.exports = {
  client,
  environment,
  testAuthentication
};
