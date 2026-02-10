# DietCombo Chrome Extension

A Chrome extension that allows you to quickly add clients to DietCombo from Unite Us pages. The extension opens as a sidebar (not a popup) and provides a comprehensive form for entering all client information.

## Features

- **Sidebar Interface**: Opens as a sidebar panel for easy access while browsing
- **Complete Client Form**: All fields needed for creating a client in DietCombo
- **Geocoding Support**: Automatic address geocoding with options for:
  - Auto (tries Nominatim, then Google)
  - Nominatim (OpenStreetMap)
  - Google Maps
  - Skip geocoding
- **Unite Us Integration**: 
  - Extract Unite Us link from current page
  - Validate Unite Us URL format
- **API Integration**: Secure API key authentication
- **Form Validation**: Client-side validation for required fields

## Installation

1. Open Chrome and navigate to `chrome://extensions/`
2. Enable "Developer mode" (toggle in top right)
3. Click "Load unpacked"
4. Select the `chrome-extension` folder from this project

## Configuration

1. Open the extension sidebar
2. Scroll to "API Configuration" section
3. Enter your API URL (e.g., `https://your-domain.com`)
4. Enter your API Key (set `EXTENSION_API_KEY` environment variable on your server)
5. The configuration is automatically saved

## Usage

1. Navigate to a Unite Us case page (optional, for auto-extraction)
2. Click the extension icon to open the sidebar
3. Fill in the client information:
   - **Basic Information**: Name, email
   - **Contact Information**: Phone numbers
   - **Address Information**: Full address with geocoding
   - **Service Information**: Service type, status, navigator, etc.
   - **Unite Us Information**: Case link (can be extracted from current page)
   - **Additional Information**: Notes, dislikes, flags
4. Click "Geocode Address" to get coordinates (optional)
5. Click "Create Client" to submit

## API Requirements

The extension requires the following API endpoints:

- `POST /api/extension/create-client` - Create a new client
- `GET /api/extension/statuses` - Get available statuses
- `GET /api/extension/navigators` - Get available navigators
- `GET /api/geocode?q=<address>&provider=<provider>` - Geocode an address

All endpoints require API key authentication via `Authorization: Bearer <API_KEY>` header.

## Environment Variables

On your server, set:
- `EXTENSION_API_KEY` - API key for extension authentication

## Icon Files

The extension requires icon files at:
- `icons/icon16.png` (16x16 pixels)
- `icons/icon48.png` (48x48 pixels)
- `icons/icon128.png` (128x128 pixels)

You can create simple placeholder icons or use a design tool to create proper icons.

## Development

To modify the extension:

1. Edit files in `chrome-extension/` directory
2. Go to `chrome://extensions/`
3. Click the refresh icon on the extension card
4. Test your changes

## Troubleshooting

- **"Error loading statuses/navigators"**: Check that your API URL and API Key are correct
- **"Geocoding failed"**: Check your internet connection and try a different provider
- **"Invalid Unite Us URL"**: Make sure you're using a valid Unite Us case URL format

## Support

For issues or questions, please contact the development team.
