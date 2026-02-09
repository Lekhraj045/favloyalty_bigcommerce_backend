# BigCommerce Webhook Integration Guide

This guide explains how to subscribe to BigCommerce webhooks and view webhook data in your database.

## Prerequisites

1. ✅ `WEBHOOK_BASE_URL` is set in your `.env` file:

   ```
   WEBHOOK_BASE_URL=https://favbigcommerce.share.zrok.io
   ```

2. ✅ Your backend server is running and accessible at the `WEBHOOK_BASE_URL`

3. ✅ You have a valid BigCommerce store with access token

## Method 1: Subscribe via API Endpoint (Recommended)

### Using cURL

```bash
curl -X POST https://favbigcommerce.share.zrok.io/api/webhooks/subscribe \
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "scope": "store/order/statusUpdated",
    "channelId": "optional_channel_id"
  }'
```

### Using JavaScript/TypeScript (Frontend)

```typescript
import { subscribeWebhook } from "@/utils/api";

// Subscribe to order status updated webhook
try {
  const result = await subscribeWebhook("store/order/statusUpdated");
  console.log("Webhook subscribed:", result);
} catch (error) {
  console.error("Failed to subscribe:", error);
}
```

### Using Postman

1. **Method**: POST
2. **URL**: `https://favbigcommerce.share.zrok.io/api/webhooks/subscribe`
3. **Headers**:
   - `Authorization: Bearer YOUR_SESSION_TOKEN`
   - `Content-Type: application/json`
4. **Body** (JSON):
   ```json
   {
     "scope": "store/order/statusUpdated",
     "channelId": "optional_channel_id"
   }
   ```

## Method 2: Subscribe via Script

Use the provided script to subscribe directly:

```bash
# Navigate to backend directory
cd favloyalty_bigcommerce_backend

# Run the script
node scripts/subscribeWebhook.js <store_hash> <access_token> [scope]

# Example:
node scripts/subscribeWebhook.js abc123 xyz789 store/order/statusUpdated
```

**To get your store hash and access token:**

- Store hash: Check your BigCommerce store URL or database
- Access token: Found in your Store model in the database, or from BigCommerce OAuth flow

## Method 3: Direct BigCommerce API Call

You can also subscribe directly using BigCommerce API:

```bash
curl -X POST https://api.bigcommerce.com/stores/{store_hash}/v2/hooks \
  -H "X-Auth-Token: YOUR_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "scope": "store/order/statusUpdated",
    "destination": "https://favbigcommerce.share.zrok.io/api/webhooks/receive",
    "is_active": true
  }'
```

## Verify Webhook Subscription

### Check All Webhooks

```bash
# Via API
curl -X GET https://favbigcommerce.share.zrok.io/api/webhooks \
  -H "Authorization: Bearer YOUR_SESSION_TOKEN"

# Or using frontend
import { getAllWebhooks } from '@/utils/api';
const webhooks = await getAllWebhooks();
console.log(webhooks);
```

### Check Webhook Logs

```bash
# Via API
curl -X GET "https://favbigcommerce.share.zrok.io/api/webhooks/logs?scope=store/order/statusUpdated&limit=50" \
  -H "Authorization: Bearer YOUR_SESSION_TOKEN"

# Or using frontend
import { getWebhookLogs } from '@/utils/api';
const logs = await getWebhookLogs({
  scope: 'store/order/statusUpdated',
  limit: 50
});
console.log(logs);
```

## View Webhook Data in Database

### Using MongoDB Compass or CLI

```javascript
// Connect to your MongoDB database
use bigcommerce_app

// View all webhook logs
db.webhooklogs.find().sort({ createdAt: -1 }).limit(50)

// View webhook logs for a specific scope
db.webhooklogs.find({ webhookScope: "store/order/statusUpdated" }).sort({ createdAt: -1 })

// View webhook logs for a specific store
db.webhooklogs.find({ store_id: ObjectId("YOUR_STORE_ID") }).sort({ createdAt: -1 })

// View successful webhooks only
db.webhooklogs.find({ status: "success" }).sort({ createdAt: -1 })

// View failed webhooks
db.webhooklogs.find({ status: "error" }).sort({ createdAt: -1 })
```

### Using the API

The webhook logs are automatically stored in the `webhooklogs` collection when:

- You subscribe to a webhook (subscription is logged)
- BigCommerce sends a webhook to your endpoint (receipt is logged)

## Testing the Webhook

1. **Subscribe to the webhook** (using any method above)

2. **Trigger a webhook event** in BigCommerce:
   - Go to your BigCommerce admin panel
   - Navigate to Orders
   - Change an order's status (e.g., from "Pending" to "Awaiting Payment")
   - This will trigger the `store/order/statusUpdated` webhook

3. **Check the webhook logs**:

   ```bash
   # Via API
   GET /api/webhooks/logs?scope=store/order/statusUpdated

   # Or check database directly
   db.webhooklogs.find({ webhookScope: "store/order/statusUpdated" }).sort({ createdAt: -1 }).limit(1)
   ```

4. **Verify the webhook payload**:
   The webhook log will contain:
   - `requestBody`: The full webhook payload from BigCommerce
   - `status`: "success" if processed successfully
   - `processingTime`: Time taken to process
   - `metadata`: Additional processing information

## Webhook Payload Structure

When an order status is updated, BigCommerce sends:

```json
{
  "scope": "store/order/statusUpdated",
  "store_id": "1025646",
  "data": {
    "type": "order",
    "id": 250,
    "status": {
      "previous_status_id": 0,
      "new_status_id": 11
    }
  },
  "hash": "7ee67cd1cf2ca60bc1aa9e5fe957d2de373be4ca",
  "created_at": 1561479335,
  "producer": "stores/{store_hash}"
}
```

This payload is stored in the `requestBody` field of the `WebhookLog` document.

## Troubleshooting

### Webhook not being received

1. **Check webhook subscription**:

   ```bash
   GET /api/webhooks
   ```

   Verify the webhook exists and `is_active` is `true`

2. **Check webhook destination URL**:
   The destination should be: `https://favbigcommerce.share.zrok.io/api/webhooks/receive`

3. **Check server logs**:
   Look for webhook receipt logs in your backend console

4. **Check database**:
   Look for webhook logs with `status: "error"` to see what went wrong

### Webhook subscription fails

1. **Verify access token**: Make sure your store's access token is valid
2. **Check BigCommerce API limits**: Ensure you haven't exceeded rate limits
3. **Verify webhook scope**: The scope must be valid (e.g., `store/order/statusUpdated`)

### Webhook logs not appearing

1. **Check database connection**: Ensure MongoDB is connected
2. **Check WebhookLog model**: Verify the model is registered in `server.js`
3. **Check error logs**: Look for database errors in server console

## Next Steps

1. ✅ Subscribe to `store/order/statusUpdated` webhook
2. ✅ Test by updating an order status in BigCommerce
3. ✅ Check webhook logs in database
4. ✅ Add business logic in `processOrderStatusUpdatedWebhook()` function
5. ✅ Subscribe to additional webhooks as needed

## Available Webhook Scopes

For a complete list of available webhook scopes, visit:
https://developer.bigcommerce.com/docs/integrations/webhooks/events

Some common scopes:

- `store/order/statusUpdated` - Order status changes
- `store/order/created` - New order created
- `store/customer/created` - New customer created
- `store/product/updated` - Product updated
- `store/cart/created` - Cart created
