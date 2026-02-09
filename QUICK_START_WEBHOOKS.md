# Quick Start: Subscribe to Webhooks

**Auto-subscribe on install:** The backend subscribes to `store/order/statusUpdated` and `store/customer/created` when the merchant **installs** the app (OAuth callback). On **uninstall**, all webhooks for that store are removed from BigCommerce. You only need to subscribe manually if install-time subscription failed.

## ✅ Step 1: Verify Environment Variable

Your `.env` file should have:

```
WEBHOOK_BASE_URL=https://favbigcommerce.share.zrok.io
```

✅ Already done!

## ✅ Step 2: Subscribe to Webhook

### Option A: Using cURL (Quick Test)

```bash
curl -X POST https://favbigcommerce.share.zrok.io/api/webhooks/subscribe \
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"scope": "store/order/statusUpdated"}'
```

**To get your session token:**

1. Log in to your frontend app
2. Open browser DevTools → Application → Local Storage
3. Copy the value of `bc_session_token`

### Option B: Using the Script

**Subscribe to order status webhook:**

```bash
cd favloyalty_bigcommerce_backend
node scripts/subscribeWebhook.js <store_hash> <access_token> store/order/statusUpdated
```

**Subscribe to customer created webhook:**

```bash
cd favloyalty_bigcommerce_backend
node scripts/subscribeWebhook.js <store_hash> <access_token> store/customer/created
```

**Or use .env credentials** (add `STORE_HASH` and `ACCESS_TOKEN` to `.env`), then:

```bash
node scripts/subscribeWebhook.js store/customer/created
```

**To get store hash and access token:**

- Check your MongoDB database in the `stores` collection
- Or check your BigCommerce OAuth callback logs

### Option C: Using Postman

1. **POST** `https://favbigcommerce.share.zrok.io/api/webhooks/subscribe`
2. **Headers:**
   - `Authorization: Bearer YOUR_SESSION_TOKEN`
   - `Content-Type: application/json`
3. **Body:**
   ```json
   {
     "scope": "store/order/statusUpdated"
   }
   ```

## ✅ Step 3: Verify Subscription

```bash
curl -X GET https://favbigcommerce.share.zrok.io/api/webhooks \
  -H "Authorization: Bearer YOUR_SESSION_TOKEN"
```

You should see your webhook in the response with:

- `scope: "store/order/statusUpdated"`
- `destination: "https://favbigcommerce.share.zrok.io/api/webhooks/receive"`
- `is_active: true`

## ✅ Step 4: Test the Webhook

1. Go to your BigCommerce admin panel
2. Navigate to **Orders**
3. Open any order
4. Change the order status (e.g., from "Pending" to "Awaiting Payment")
5. The webhook will be triggered automatically!

## ✅ Step 5: View Webhook Data in Database

### Using MongoDB Compass or CLI:

```javascript
use bigcommerce_app

// View latest webhook logs
db.webhooklogs.find().sort({ createdAt: -1 }).limit(10).pretty()

// View order status update webhooks
db.webhooklogs.find({ webhookScope: "store/order/statusUpdated" }).sort({ createdAt: -1 }).pretty()

// View the webhook payload
db.webhooklogs.findOne({ webhookScope: "store/order/statusUpdated" })
```

### Using API:

```bash
curl -X GET "https://favbigcommerce.share.zrok.io/api/webhooks/logs?scope=store/order/statusUpdated&limit=10" \
  -H "Authorization: Bearer YOUR_SESSION_TOKEN"
```

## 📊 What You'll See in the Database

Each webhook log entry contains:

```json
{
  "_id": "...",
  "endpoint": "/api/webhooks/receive",
  "method": "POST",
  "status": "success",
  "store_id": ObjectId("..."),
  "webhookType": "bigcommerce",
  "webhookScope": "store/order/statusUpdated",
  "requestBody": {
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
    "hash": "...",
    "created_at": 1561479335,
    "producer": "stores/{store_hash}"
  },
  "processingTime": 45,
  "createdAt": ISODate("2026-01-29T..."),
  "updatedAt": ISODate("2026-01-29T...")
}
```

## 🎯 Next Steps

1. ✅ Subscribe to webhook (done above)
2. ✅ Test by updating an order status
3. ✅ Check database for webhook logs
4. 🔄 Add your business logic in `controllers/webhookController.js` → `processOrderStatusUpdatedWebhook()` function

## 🆘 Troubleshooting

**Not receiving any order webhooks?**

1. **Subscription must be registered**  
   The app subscribes to `store/order/statusUpdated` and `store/customer/created` when the merchant **installs** the app (OAuth callback). If the subscribe call failed during install (e.g. WEBHOOK_BASE_URL not set), run the script or POST `/api/webhooks/subscribe` once (see Step 2 above).

2. **`WEBHOOK_BASE_URL` must be a public HTTPS URL**  
   BigCommerce sends webhooks from their servers to your backend. If this is `http://localhost:3000` or a private URL, they cannot reach it. Use a tunnel (e.g. ngrok, zrok) or your deployed backend URL and set it in `.env` as `WEBHOOK_BASE_URL` or `BACKEND_URL`.

3. **Order webhook fires on status *change***  
   `store/order/statusUpdated` is sent when an order’s **status is updated** (e.g. Pending → Shipped). Creating a new order alone may not trigger it until you change the status in BigCommerce admin.

4. **Store must exist in your DB**  
   The receive endpoint looks up the store by hash from the webhook payload. If the store isn’t in your `stores` collection, the request returns 404 (and BigCommerce may retry).

**Webhook not appearing in database?**

- Check if webhook subscription was successful (GET `/api/webhooks` with auth)
- Verify `WEBHOOK_BASE_URL` is correct and publicly reachable
- Check backend server logs for errors
- Ensure MongoDB connection is working

**Webhook subscription fails?**

- Verify your session token is valid
- Check if store exists in database
- Verify access token is correct
- Check BigCommerce API rate limits

**Need help?**

- Check `WEBHOOK_GUIDE.md` for detailed documentation
- Review server console logs
- Check MongoDB for webhook logs with `status: "error"`
