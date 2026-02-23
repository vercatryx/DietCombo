# Chrome Extension Setup Guide

## Overview

A Chrome extension has been created that allows you to add clients to DietCombo directly from Unite Us pages. The extension opens as a **sidebar** (not a popup) and includes:

- Complete client form with all required fields
- Geocoding with multiple provider options (Nominatim, Google, Auto)
- Unite Us link extraction and validation
- API integration with secure authentication

## Files Created

### Extension Files
- `chrome-extension/manifest.json` - Extension configuration
- `chrome-extension/background.js` - Service worker
- `chrome-extension/sidepanel.html` - Main UI
- `chrome-extension/sidepanel.js` - Form logic and API calls
- `chrome-extension/styles.css` - Styling
- `chrome-extension/README.md` - Extension documentation
- `chrome-extension/create-icons.html` - Icon generator tool

### API Updates
- Updated `app/api/extension/create-client/route.ts` to support:
  - All client fields (firstName, lastName, apt, city, state, zip, county, etc.)
  - Geocoding coordinates (latitude, longitude, lat, lng)
  - Additional flags (medicaid, paused, complex, bill, delivery)
  - Unite Us link storage in `case_id_external`
  
- Updated `app/api/geocode/route.ts` to support:
  - Provider parameter (`auto`, `nominatim`, `google`, `none`)
  - Better error handling

## Installation Steps

1. **Create Icons** (Required):
   - Open `chrome-extension/create-icons.html` in a browser
   - Click "Generate Icons"
   - Right-click each canvas and save as:
     - `icon16.png` (16x16)
     - `icon48.png` (48x48)
     - `icon128.png` (128x128)
   - Place all three files in `chrome-extension/icons/` directory

2. **Load Extension in Chrome**:
   - Open Chrome and go to `chrome://extensions/`
   - Enable "Developer mode" (toggle in top right)
   - Click "Load unpacked"
   - Select the `chrome-extension` folder

3. **Configure API**:
   - Click the extension icon to open the sidebar
   - Scroll to "API Configuration" section
   - Enter your API URL (e.g., `https://your-domain.com` or `http://localhost:3000`)
   - Enter your API Key (must match `EXTENSION_API_KEY` environment variable)
   - Configuration is automatically saved

## Environment Variables

Make sure your server has the following environment variable set:

```env
EXTENSION_API_KEY=your-secret-api-key-here
```

## API Endpoints Used

The extension uses these endpoints:

1. **GET /api/extension/statuses** - Get available client statuses
2. **GET /api/extension/navigators** - Get available navigators
3. **GET /api/geocode?q=<address>&provider=<provider>** - Geocode address
4. **POST /api/extension/create-client** - Create new client

All endpoints require `Authorization: Bearer <API_KEY>` header.

## Features

### Geocoding Options
- **Auto**: Tries Nominatim first, falls back to Google
- **Nominatim**: Uses OpenStreetMap (free, no API key needed)
- **Google**: Uses Google Maps API (requires `GOOGLE_MAPS_KEY`)
- **Skip**: No geocoding performed

### Unite Us Integration
- Automatically extracts Unite Us link from current page (if on Unite Us)
- Validates Unite Us URL format
- Stores link in `case_id_external` field

### Form Fields
The form includes all fields from the client schema:
- Basic info (name, email)
- Contact (phone, secondary phone)
- Address (full address with geocoding)
- Service info (type, status, navigator, etc.)
- Unite Us link
- Additional info (notes, dislikes, flags)

## Usage

1. Navigate to a Unite Us case page (optional)
2. Click the extension icon to open sidebar
3. Fill in the form
4. Optionally click "Geocode Address" to get coordinates
5. Click "Create Client" to submit

## Troubleshooting

- **"Error loading statuses/navigators"**: 
  - Check API URL and API Key are correct
  - Verify `EXTENSION_API_KEY` is set on server
  - Check browser console for errors

- **"Geocoding failed"**: 
  - Try a different provider
  - Check internet connection
  - Verify address is complete (city, state, ZIP)

- **Extension not loading**:
  - Make sure icons are in `chrome-extension/icons/` directory
  - Check Chrome extensions page for errors
  - Verify manifest.json is valid

## Development

To modify the extension:
1. Edit files in `chrome-extension/` directory
2. Go to `chrome://extensions/`
3. Click refresh icon on extension card
4. Test changes

## Security Notes

- API key is stored in Chrome's local storage (encrypted by Chrome)
- API key is sent in Authorization header (use HTTPS in production)
- All API endpoints validate the API key before processing requests
