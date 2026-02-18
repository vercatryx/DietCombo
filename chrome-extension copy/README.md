# Diet Fantasy Client Manager Chrome Extension

A Chrome extension that allows you to quickly add clients to the Diet Fantasy system. The extension opens as a side panel for a better user experience.

## Setup

### 1. Server Configuration

Add the following environment variable to your `.env` file (or your environment configuration):

```
EXTENSION_API_KEY=your-secret-api-key-here
```

Replace `your-secret-api-key-here` with a strong, random API key. This key will be used to authenticate requests from the Chrome extension.

### 2. Install the Extension

1. Open Chrome and navigate to `chrome://extensions/`
2. Enable "Developer mode" (toggle in the top right)
3. Click "Load unpacked"
4. Select the `chrome-extension` folder from this project
5. The extension icon should now appear in your Chrome toolbar

### 3. Configure the Extension

1. Click the extension icon in your Chrome toolbar to open the side panel
2. If this is your first time, you'll see a settings button at the bottom
3. Click the "Settings" button (⚙️) at the bottom of the side panel
4. Enter your API key (the same one you set in `EXTENSION_API_KEY`)
5. Enter your base URL (e.g., `https://your-site.com` or `http://localhost:3000` for local development)
6. Click "Test Connection" to verify your settings work
7. Click "Save Settings" to save your configuration
8. The extension will automatically validate your API key and show the form if valid

## Usage

1. Click the extension icon to open the side panel
2. The extension will automatically validate your API key on load
3. If validation fails, you'll see an error message with instructions
4. Once validated, fill in the client information:
   - **Full Name** (required)
   - **Status** (required) - Select from available statuses
   - **Assigned Navigator** (optional) - Select from available navigators
   - **Address** (required)
   - **Phone** (required)
   - **Email** (optional)
   - **General Notes** (optional)
   - **Service Type** (required) - Choose "Food" or "Boxes"
   - **Case ID** (optional) - Enter case ID for food or boxes
5. Click "Submit" to create the client
6. You'll see a success message if the client was created successfully

## Features

- **Side Panel Interface** - Opens as a side panel instead of a popup for better usability
- **API Key Validation** - Automatically validates your API key on load
- **Settings Modal** - Easy access to settings via the Settings button at the bottom
- **Connection Testing** - Test your API key and base URL before saving
- **Error Handling** - Clear error messages if API key is invalid or configuration is missing
- **Auto-load Data** - Automatically loads available statuses and navigators when API key is valid

## Features

- API key authentication for security
- Fetches available statuses and navigators from your site
- Validates required fields before submission
- Stores configuration in Chrome sync storage
- Clean, modern UI

## API Endpoints

The extension uses the following API endpoints:

- `GET /api/extension/statuses` - Get available statuses
- `GET /api/extension/navigators` - Get available navigators
- `POST /api/extension/create-client` - Create a new client

All endpoints require the API key to be sent in the `Authorization` header as `Bearer <API_KEY>`.

## Security Notes

- The API key is stored in Chrome's sync storage (encrypted by Chrome)
- All API requests include the API key in the Authorization header
- The extension only works with the configured API key
- Make sure to use a strong, random API key in production

