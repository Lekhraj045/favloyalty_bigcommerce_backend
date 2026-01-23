# BigCommerce FavLoyalty Backend

## Environment Variables

### Database Configuration
- `MONGODB_URI` - Full MongoDB connection string (optional, alternative to individual components)
- `DB_HOST` - MongoDB host (default: localhost)
- `DB_PORT` - MongoDB port (default: 27017)
- `DB_USER` - MongoDB username (optional)
- `DB_PASSWORD` - MongoDB password (optional)
- `DB_NAME` - MongoDB database name (default: bigcommerce_app)

### BigCommerce Configuration
- `CLIENT_ID` - BigCommerce app client ID
- `CLIENT_SECRET` - BigCommerce app client secret
- `AUTH_CALLBACK` - OAuth callback URL
- `FRONTEND_BASE_URL` - Frontend application URL
- `APP_SESSION_SECRET` - Session secret for JWT tokens

### Email Configuration (Required for Background Jobs)
- `EMAIL_SMTP_HOST` - SMTP server host (e.g., email-smtp.us-east-1.amazonaws.com for AWS SES, or smtp.gmail.com)
- `EMAIL_SMTP_PORT` - SMTP port (default: 465 for SSL)
- `EMAIL_SMTP_SECURE` - Use SSL/TLS (default: true, set to "false" for non-SSL)
- `EMAIL_SMTP_USER` - SMTP username/email
- `EMAIL_SMTP_PASSWORD` - SMTP password or app password
- `EMAIL_FROM` - Default sender email address (default: support@favloyalty.com)

### Server Configuration
- `PORT` - Server port (default: 3000)
- `NODE_ENV` - Environment (development/production)

## Background Jobs

The application uses Agenda.js for background job processing:

- **Event Queue**: Processes events scheduled for today (immediate) and future dates
- **Birthday Queue**: Processes birthday points and emails daily at 9:00 AM
- **Transaction Expiration Queue**: Processes expiring points and coupons daily at 1:00 AM
- **Monthly Points Queue**: Sends monthly statements on the 28th of each month at 9:00 AM

All jobs are channel-specific and process customers based on `store_id` and `channel_id`.

## Installation

```bash
npm install
```

## Running

```bash
# Development
npm run dev

# Production
npm start
```
