// Single connection config
const DEFAULT_BASE = 'https://customer.thedietfantasy.com';

/** Set to `true` to always use Unite “Brooklyn” and the light blue theme (hides the Unite dropdown). */
const BROOKLYN_ONLY = true;

let config = { baseUrl: DEFAULT_BASE, apiKey: '' };
let statuses = [];
let navigators = [];

function getConfig() {
    return {
        baseUrl: (config.baseUrl || '').replace(/\/$/, ''),
        apiKey: config.apiKey || ''
    };
}

function isBrooklynOnlyMode() {
    return BROOKLYN_ONLY;
}

function getUniteAccountValue() {
    if (isBrooklynOnlyMode()) return 'Brooklyn';
    const sel = document.getElementById('unite-account');
    return sel ? sel.value : 'Regular';
}

/** Brooklyn-only: blue theme, Unite fixed to Brooklyn (no dropdown). */
function applyBrooklynOnlyUi() {
    const body = document.getElementById('panel-body');
    const brooklyn = isBrooklynOnlyMode();
    if (body) {
        body.classList.remove('theme-main', 'theme-brooklyn-only');
        body.classList.add(brooklyn ? 'theme-brooklyn-only' : 'theme-main');
    }
    const sel = document.getElementById('unite-account');
    const fixed = document.getElementById('unite-account-brooklyn-label');
    if (sel && fixed) {
        if (brooklyn) {
            sel.style.display = 'none';
            sel.removeAttribute('required');
            sel.disabled = true;
            sel.value = 'Brooklyn';
            fixed.style.display = 'block';
            fixed.setAttribute('aria-hidden', 'false');
        } else {
            sel.style.display = '';
            sel.setAttribute('required', '');
            sel.disabled = false;
            fixed.style.display = 'none';
            fixed.setAttribute('aria-hidden', 'true');
            if (sel.value === 'Brooklyn') sel.value = 'Regular';
        }
    }
}

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
    await loadConfig();
    await validateAndInitialize();
    setupEventListeners();
});

// Load configuration from storage (with migration from old multi-connection keys)
async function loadConfig() {
    const result = await chrome.storage.sync.get([
        'config', 'configMain', 'configBrooklyn', 'activeConnection',
        'apiKey', 'baseUrl'
    ]);
    if (result.config && typeof result.config === 'object') {
        config = {
            baseUrl: result.config.baseUrl || DEFAULT_BASE,
            apiKey: result.config.apiKey || ''
        };
    } else if (result.configMain && typeof result.configMain === 'object') {
        config = {
            baseUrl: result.configMain.baseUrl || DEFAULT_BASE,
            apiKey: result.configMain.apiKey || ''
        };
        await chrome.storage.sync.set({ config });
    }
    if (result.apiKey || result.baseUrl) {
        const hasNew = config.apiKey && config.baseUrl;
        if (!hasNew) {
            config = {
                baseUrl: (result.baseUrl || '').trim() || DEFAULT_BASE,
                apiKey: (result.apiKey || '').trim()
            };
            await chrome.storage.sync.set({ config });
        }
    }
    applyBrooklynOnlyUi();
}

// Validate API key and initialize
async function validateAndInitialize() {
    const validationSection = document.getElementById('validation-section');
    const errorSection = document.getElementById('error-section');
    const formSection = document.getElementById('form-section');

    // Show validation spinner
    validationSection.style.display = 'flex';
    errorSection.style.display = 'none';
    formSection.style.display = 'none';

    const { baseUrl, apiKey } = getConfig();

    if (!apiKey || !baseUrl) {
        validationSection.style.display = 'none';
        errorSection.style.display = 'flex';
        document.getElementById('error-text').textContent =
            'Connection is not configured. Please open Settings to set Base URL and API Key.';
        return;
    }

    // Validate API key by trying to fetch statuses
    try {
        const url = `${baseUrl}/api/extension/statuses`;
        console.log('Attempting to connect to:', url);
        
        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            }
        });

        console.log('Response status:', response.status);
        console.log('Response headers:', Object.fromEntries(response.headers.entries()));

        // Check if response is JSON
        const contentType = response.headers.get('content-type');
        if (!contentType || !contentType.includes('application/json')) {
            // Try to get the response text to see what we got
            const text = await response.text();
            console.error('Non-JSON response received:', text.substring(0, 200));
            
            // Got HTML instead of JSON - likely wrong URL or server error
            if (response.status === 404) {
                throw new Error('API endpoint not found. Please check your Base URL is correct.');
            }
            throw new Error('Server returned an error page. Please check your Base URL and ensure the server is running.');
        }

        if (!response.ok) {
            if (response.status === 401) {
                throw new Error('Invalid API key. Please check your API key in Settings.');
            }
            if (response.status === 500) {
                try {
                    const data = await response.json();
                    if (data.error && data.error.includes('not configured')) {
                        throw new Error('API key is not configured on the server. Please contact the administrator.');
                    }
                } catch (e) {
                    // If we can't parse JSON, it's a server error
                    throw new Error('Server error. Please check your Base URL and ensure the server is running.');
                }
            }
            throw new Error(`Failed to validate connection: ${response.statusText}`);
        }

        const data = await response.json();
        if (!data.success) {
            throw new Error(data.error || 'Failed to validate API key');
        }

        // API key is valid, show form and load data
        validationSection.style.display = 'none';
        errorSection.style.display = 'none';
        formSection.style.display = 'block';

        const uniteAccountSelect = document.getElementById('unite-account');
        if (uniteAccountSelect) {
            uniteAccountSelect.value = isBrooklynOnlyMode() ? 'Brooklyn' : 'Regular';
        }
        applyBrooklynOnlyUi();

        await loadStatuses();
        await loadNavigators();
        await loadProduceVendorOptions();

        // Setup form validation after form is visible
        setupFormValidation();
        
        // Setup geocoding (auto + manual fallback)
        setupAutoGeocode();
        setupManualGeocode();
    } catch (error) {
        console.error('Validation error:', error);
        validationSection.style.display = 'none';
        errorSection.style.display = 'flex';
        
        // Handle network errors (no internet)
        if (error.name === 'TypeError' && error.message.includes('fetch')) {
            document.getElementById('error-text').textContent = 
                'No internet connection. Please check your network connection and try again.';
        } else if (error.message.includes('JSON')) {
            // HTML response instead of JSON
            document.getElementById('error-text').textContent = 
                'Invalid response from server. Please check your Base URL is correct and points to the right server.';
        } else {
            document.getElementById('error-text').textContent = error.message;
        }
    }
}

// Setup event listeners
function setupEventListeners() {
    // Settings button
    document.getElementById('settings-btn').addEventListener('click', () => {
        openSettings();
    });

    // Open settings from error section
    document.getElementById('open-settings-btn').addEventListener('click', () => {
        openSettings();
    });

    // Close settings modal
    document.getElementById('close-settings').addEventListener('click', () => {
        closeSettings();
    });

    // Save settings
    document.getElementById('save-settings').addEventListener('click', async () => {
        await saveSettings();
    });

    // Test Main connection
    document.getElementById('test-main').addEventListener('click', async () => {
        await testConnection();
    });

    // Form submission
    document.getElementById('client-form').addEventListener('submit', handleSubmit);

    // Geocode button
    document.getElementById('geocode-btn').addEventListener('click', () => {
        autoGeocode(true);
    });

    // Auto fill button
    document.getElementById('auto-fill-btn').addEventListener('click', handleAutoFill);

    // Show/hide auth units field based on service type (Food only)
    const serviceTypeSelect = document.getElementById('service-type');
    if (serviceTypeSelect) {
        serviceTypeSelect.addEventListener('change', function() {
            const authUnitsGroup = document.getElementById('auth-units-group');
            const authUnitsInput = document.getElementById('auth-units');
            if (authUnitsGroup) {
                if (this.value === 'Food') {
                    authUnitsGroup.style.display = 'block';
                } else {
                    authUnitsGroup.style.display = 'none';
                    if (authUnitsInput) authUnitsInput.value = '';
                }
            }
            // Food → produce vendor: default Delivery off (user can re-check)
            const prev = this.dataset.prevServiceType || 'Food';
            if (prev === 'Food' && this.value.startsWith('produce:')) {
                const deliveryFlag = document.getElementById('flag-delivery');
                if (deliveryFlag) deliveryFlag.checked = false;
            }
            this.dataset.prevServiceType = this.value;
            const form = document.getElementById('client-form');
            if (form && form._validateForm) form._validateForm();
        });
    }

    // Close modal when clicking outside
    document.getElementById('settings-modal').addEventListener('click', (e) => {
        if (e.target.id === 'settings-modal') {
            closeSettings();
        }
    });
}

// Open settings modal
function openSettings() {
    const modal = document.getElementById('settings-modal');
    document.getElementById('settings-main-base-url').value = config.baseUrl || '';
    document.getElementById('settings-main-api-key').value = config.apiKey || '';
    document.getElementById('settings-status').style.display = 'none';
    document.getElementById('settings-main-status').style.display = 'none';
    document.getElementById('settings-main-status').textContent = '';
    modal.style.display = 'flex';
}

// Close settings modal
function closeSettings() {
    document.getElementById('settings-modal').style.display = 'none';
}

// Save settings
async function saveSettings() {
    const baseUrl = document.getElementById('settings-main-base-url').value.trim().replace(/\/$/, '') || DEFAULT_BASE;
    const apiKey = document.getElementById('settings-main-api-key').value.trim();

    config = { baseUrl, apiKey };

    await chrome.storage.sync.set({ config });
    showStatus('settings-status', 'Settings saved! Validating...', 'success');

    setTimeout(async () => {
        closeSettings();
        await validateAndInitialize();
    }, 1000);
}

// Test connection
async function testConnection() {
    const baseId = 'settings-main';
    const testApiKey = document.getElementById(`${baseId}-api-key`).value.trim();
    const testBaseUrl = document.getElementById(`${baseId}-base-url`).value.trim().replace(/\/$/, '');

    if (!testApiKey || !testBaseUrl) {
        showStatus(`${baseId}-status`, 'Please enter both API key and Base URL', 'error');
        document.getElementById(`${baseId}-status`).style.display = 'block';
        return;
    }

    const statusEl = document.getElementById(`${baseId}-status`);
    statusEl.textContent = 'Testing connection...';
    statusEl.className = 'status-message info';
    statusEl.style.display = 'block';

    try {
        const response = await fetch(`${testBaseUrl}/api/extension/statuses`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${testApiKey}`,
                'Content-Type': 'application/json'
            }
        });

        const contentType = response.headers.get('content-type');
        if (!contentType || !contentType.includes('application/json')) {
            if (response.status === 404) {
                throw new Error('API endpoint not found. Check Base URL.');
            }
            throw new Error('Server returned an error page. Check Base URL and server.');
        }

        if (!response.ok) {
            if (response.status === 401) {
                throw new Error('Invalid API key');
            }
            if (response.status === 500) {
                try {
                    const data = await response.json();
                    if (data.error && data.error.includes('not configured')) {
                        throw new Error('API key is not configured on the server');
                    }
                } catch (e) {
                    if (e.message && e.message.includes('not configured')) throw e;
                    throw new Error('Server error. Check Base URL and server.');
                }
            }
            throw new Error(`Connection failed: ${response.statusText}`);
        }

        const data = await response.json();
        if (!data.success) {
            throw new Error(data.error || 'Connection test failed');
        }

        statusEl.textContent = '✓ Connection successful!';
        statusEl.className = 'status-message success';
    } catch (error) {
        console.error('Connection test error:', error);
        if (error.name === 'TypeError' && error.message.includes('fetch')) {
            statusEl.textContent = 'No internet connection.';
        } else if (error.message.includes('JSON') || error.message.includes('DOCTYPE')) {
            statusEl.textContent = 'Invalid response. Check Base URL.';
        } else {
            statusEl.textContent = `Failed: ${error.message}`;
        }
        statusEl.className = 'status-message error';
    }
}

// Load statuses from API
async function loadStatuses() {
    const { baseUrl, apiKey } = getConfig();
    try {
        const response = await fetch(`${baseUrl}/api/extension/statuses`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            }
        });

        // Check if response is JSON
        const contentType = response.headers.get('content-type');
        if (!contentType || !contentType.includes('application/json')) {
            throw new Error('Invalid response from server. Please check your Base URL.');
        }

        if (!response.ok) {
            if (response.status === 401) {
                throw new Error('Invalid API key. Please check your configuration.');
            }
            throw new Error(`Failed to load statuses: ${response.statusText}`);
        }

        const data = await response.json();
        if (data.success && data.statuses) {
            statuses = data.statuses;
            const statusSelect = document.getElementById('status');
            statusSelect.innerHTML = '<option value="">Select a status</option>';
            statuses.forEach(status => {
                const option = document.createElement('option');
                option.value = status.id;
                option.textContent = status.name;
                statusSelect.appendChild(option);
            });
            
            // Set default to "Active" if available
            const activeStatus = statuses.find(s => s.name.toLowerCase() === 'active');
            if (activeStatus) {
                statusSelect.value = activeStatus.id;
                // Trigger validation update
                if (typeof setupFormValidation === 'function') {
                    statusSelect.dispatchEvent(new Event('change', { bubbles: true }));
                }
            }
        } else {
            throw new Error(data.error || 'Failed to load statuses');
        }
    } catch (error) {
        console.error('Error loading statuses:', error);
        if (error.name === 'TypeError' && error.message.includes('fetch')) {
            showStatus('form-status', 'No internet connection. Please check your network.', 'error');
        } else {
            showStatus('form-status', error.message, 'error');
        }
        const statusSelect = document.getElementById('status');
        statusSelect.innerHTML = '<option value="">Error loading statuses</option>';
    }
}

/** Fill service dropdown: Food + active produce vendors from API */
async function loadProduceVendorOptions() {
    const sel = document.getElementById('service-type');
    if (!sel) return;

    const { baseUrl, apiKey } = getConfig();
    try {
        const response = await fetch(`${baseUrl}/api/extension/produce-vendors`, {
            method: 'GET',
            headers: {
                Authorization: `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
            },
        });

        const contentType = response.headers.get('content-type');
        if (!contentType || !contentType.includes('application/json')) {
            throw new Error('Invalid response when loading produce vendors');
        }

        const data = await response.json();
        if (!response.ok || !data.success) {
            throw new Error(data.error || 'Failed to load produce vendors');
        }

        const vendors = data.produceVendors || [];
        sel.innerHTML = '';

        const foodOpt = document.createElement('option');
        foodOpt.value = 'Food';
        foodOpt.textContent = 'Food';
        sel.appendChild(foodOpt);

        vendors.forEach((v) => {
            const o = document.createElement('option');
            o.value = `produce:${v.id}`;
            o.textContent = v.name;
            sel.appendChild(o);
        });

        sel.value = 'Food';
        sel.dataset.prevServiceType = 'Food';
        const authUnitsGroup = document.getElementById('auth-units-group');
        if (authUnitsGroup) authUnitsGroup.style.display = 'block';
        sel.dispatchEvent(new Event('change', { bubbles: true }));
    } catch (err) {
        console.error('loadProduceVendorOptions:', err);
        sel.innerHTML = '';
        const foodOpt = document.createElement('option');
        foodOpt.value = 'Food';
        foodOpt.textContent = 'Food';
        sel.appendChild(foodOpt);
        sel.value = 'Food';
        sel.dataset.prevServiceType = 'Food';
        const authUnitsGroup = document.getElementById('auth-units-group');
        if (authUnitsGroup) authUnitsGroup.style.display = 'block';
        showStatus(
            'form-status',
            (err && err.message) || 'Could not load produce vendors. You can still add Food clients.',
            'error'
        );
    }
}

// Load navigators from API
async function loadNavigators() {
    const { baseUrl, apiKey } = getConfig();
    try {
        const response = await fetch(`${baseUrl}/api/extension/navigators`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            }
        });

        // Check if response is JSON
        const contentType = response.headers.get('content-type');
        if (!contentType || !contentType.includes('application/json')) {
            throw new Error('Invalid response from server. Please check your Base URL.');
        }

        if (!response.ok) {
            if (response.status === 401) {
                throw new Error('Invalid API key. Please check your configuration.');
            }
            throw new Error(`Failed to load navigators: ${response.statusText}`);
        }

        const data = await response.json();
        if (data.success && data.navigators) {
            navigators = data.navigators;
            const navigatorSelect = document.getElementById('navigator');
            navigatorSelect.innerHTML = '<option value="">Select a navigator</option>';
            navigators.forEach(navigator => {
                const option = document.createElement('option');
                option.value = navigator.id;
                option.textContent = navigator.name;
                navigatorSelect.appendChild(option);
            });
            
            // Set default to "Orit Fried" if available
            const oritNavigator = navigators.find(n => n.name.toLowerCase().includes('orit fried'));
            if (oritNavigator) {
                navigatorSelect.value = oritNavigator.id;
                // Trigger validation update
                if (typeof setupFormValidation === 'function') {
                    navigatorSelect.dispatchEvent(new Event('change', { bubbles: true }));
                }
            }
        } else {
            throw new Error(data.error || 'Failed to load navigators');
        }
    } catch (error) {
        console.error('Error loading navigators:', error);
        if (error.name === 'TypeError' && error.message.includes('fetch')) {
            showStatus('form-status', 'No internet connection. Please check your network.', 'error');
        } else {
            showStatus('form-status', error.message, 'error');
        }
        const navigatorSelect = document.getElementById('navigator');
        navigatorSelect.innerHTML = '<option value="">Error loading navigators</option>';
        // Re-validate form after error
        setupFormValidation();
    }
}

// Handle form submission
async function handleSubmit(e) {
    e.preventDefault();

    const submitBtn = document.getElementById('submit-btn');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Submitting...';

    try {
        const serviceRaw = document.getElementById('service-type').value;
        let serviceType;
        let produceVendorIdForApi = null;
        if (serviceRaw === 'Food') {
            serviceType = 'Food';
        } else if (serviceRaw.startsWith('produce:')) {
            serviceType = 'Produce';
            produceVendorIdForApi = serviceRaw.slice('produce:'.length);
        } else {
            throw new Error('Select Food or a produce vendor');
        }

        const depRaw = (document.getElementById('dependents-count') && document.getElementById('dependents-count').value) || '0';
        const dependentCount = Math.min(50, Math.max(0, parseInt(String(depRaw).trim(), 10) || 0));
        
        // Get address components
        const streetAddress = document.getElementById('address').value.trim();
        const apt = document.getElementById('apt').value.trim() || null;
        const city = document.getElementById('city').value.trim();
        const state = document.getElementById('state').value.trim().toUpperCase();
        const zip = document.getElementById('zip').value.trim();
        const county = document.getElementById('county').value.trim() || null;
        
        // Combine address for API (legacy format)
        let fullAddress = streetAddress;
        if (apt) {
            fullAddress += `, ${apt}`;
        }
        if (city) {
            fullAddress += `, ${city}`;
        }
        if (state) {
            fullAddress += `, ${state}`;
        }
        if (zip) {
            fullAddress += ` ${zip}`;
        }
        
        const authorizedAmountValue = document.getElementById('authorized-amount').value.trim();
        const expirationDateValue = document.getElementById('expiration-date').value.trim();
        const dobValue = document.getElementById('dob') && document.getElementById('dob').value
            ? document.getElementById('dob').value.trim()
            : '';

        const formData = {
            fullName: document.getElementById('full-name').value.trim(),
            statusId: document.getElementById('status').value,
            navigatorId: document.getElementById('navigator').value,
            uniteAccount: getUniteAccountValue(),
            address: fullAddress,
            apt: apt,
            city: city,
            state: state,
            zip: zip,
            county: county,
            phone: document.getElementById('phone').value.trim(),
            secondaryPhone: document.getElementById('secondary-phone').value.trim() || null,
            email: document.getElementById('email').value.trim() || null,
            dislikes: document.getElementById('notes').value.trim() || null,
            serviceType: serviceType,
            caseId: document.getElementById('case-url').value.trim(),
            approvedMealsPerWeek: serviceType === 'Food' ? 21 : 0,
            authorizedAmount: authorizedAmountValue ? parseFloat(authorizedAmountValue) : null,
            expirationDate: expirationDateValue || null,
            dob: dobValue || null,
            // Include geocoding coordinates if available
            latitude: window.geocodeLat || null,
            longitude: window.geocodeLng || null,
            lat: window.geocodeLat || null,
            lng: window.geocodeLng || null,
            // Client flags (defaults: paused false, complex false, bill true, delivery true)
            paused: document.getElementById('flag-paused').checked,
            complex: document.getElementById('flag-complex').checked,
            bill: document.getElementById('flag-bill').checked,
            delivery: document.getElementById('flag-delivery').checked,
            dependentCount,
            produceVendorId: produceVendorIdForApi
        };

        // Validate case URL format
        if (!isValidCaseUrl(formData.caseId)) {
            throw new Error('Please make sure you are on the clients open case page or enter the real case url');
        }

        // Validate required fields
        if (!formData.fullName || !formData.statusId || !formData.navigatorId || !formData.uniteAccount || !streetAddress || !city || !state || !zip || !formData.phone || !formData.serviceType || !formData.caseId) {
            throw new Error('Please fill in all required fields (including Unite Account)');
        }

        // Require geocoding before submit
        if (!window.geocodeLat || !window.geocodeLng) {
            throw new Error('Address must be geocoded before submitting. Fill in address, city, state, and ZIP, then wait for geocoding or click "Geocode Address".');
        }

        const { baseUrl, apiKey } = getConfig();
        const response = await fetch(`${baseUrl}/api/extension/create-client`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(formData)
        });

        // Check if response is JSON
        const contentType = response.headers.get('content-type');
        if (!contentType || !contentType.includes('application/json')) {
            if (response.status === 401) {
                throw new Error('Invalid API key. Please check your API key in Settings.');
            }
            throw new Error('Invalid response from server. Please check your Base URL and ensure the server is running.');
        }

        const data = await response.json();

        if (!response.ok) {
            if (response.status === 401) {
                throw new Error('Invalid API key. Please check your API key in Settings.');
            }
            throw new Error(data.error || 'Failed to create client');
        }

        if (data.success) {
            const depN = typeof data.dependentsCreated === 'number' ? data.dependentsCreated : 0;
            const depMsg = depN > 0 ? ` and ${depN} placeholder dependent${depN === 1 ? '' : 's'}` : '';
            showStatus('form-status', `Client "${formData.fullName}" created successfully${depMsg}!`, 'success');
            // Reset form
            document.getElementById('client-form').reset();
            // Clear geocode coordinates and reset geocode UI
            window.geocodeLat = null;
            window.geocodeLng = null;
            hideManualGeocodeFields();
            const manualSection = document.getElementById('manual-geocode-section');
            if (manualSection) manualSection.style.display = 'none';
            updateGeocodeUI('idle', 'Fill address, city, state, and ZIP to geocode');
            // Reset status and navigator dropdowns to defaults
            const statusSelect = document.getElementById('status');
            const navigatorSelect = document.getElementById('navigator');
            
            // Set default status to "Active" if available
            const activeStatus = statuses.find(s => s.name.toLowerCase() === 'active');
            if (activeStatus) {
                statusSelect.value = activeStatus.id;
            } else {
                statusSelect.selectedIndex = 0;
            }
            
            // Set default navigator to "Orit Fried" if available
            const oritNavigator = navigators.find(n => n.name.toLowerCase().includes('orit fried'));
            if (oritNavigator) {
                navigatorSelect.value = oritNavigator.id;
            } else {
                navigatorSelect.selectedIndex = 0;
            }
            // Reset Unite Account to default
            const uniteAccountSelect = document.getElementById('unite-account');
            if (uniteAccountSelect) {
                uniteAccountSelect.value = isBrooklynOnlyMode() ? 'Brooklyn' : 'Regular';
            }
            applyBrooklynOnlyUi();
            // Reset service type + dependents; show auth units when Food
            const serviceTypeEl = document.getElementById('service-type');
            if (serviceTypeEl && serviceTypeEl.querySelector('option[value="Food"]')) {
                serviceTypeEl.value = 'Food';
                serviceTypeEl.dataset.prevServiceType = 'Food';
            }
            const depInput = document.getElementById('dependents-count');
            if (depInput) depInput.value = '0';
            const authUnitsGroup = document.getElementById('auth-units-group');
            if (authUnitsGroup) authUnitsGroup.style.display = 'block';
            // Reset flags to defaults (Paused off, Complex off, Bill on, Delivery on)
            document.getElementById('flag-paused').checked = false;
            document.getElementById('flag-complex').checked = false;
            document.getElementById('flag-bill').checked = true;
            document.getElementById('flag-delivery').checked = true;
            // Re-validate form (will disable submit button)
            setupFormValidation();
        } else {
            throw new Error(data.error || 'Failed to create client');
        }
    } catch (error) {
        console.error('Error creating client:', error);
        
        // Handle network errors (no internet)
        if (error.name === 'TypeError' && error.message.includes('fetch')) {
            showStatus('form-status', 'No internet connection. Please check your network connection and try again.', 'error');
        } else if (error.message.includes('JSON') || error.message.includes('DOCTYPE')) {
            // HTML response instead of JSON
            showStatus('form-status', 'Invalid response from server. Please check your Base URL is correct.', 'error');
        } else {
            showStatus('form-status', error.message, 'error');
        }
    } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Submit';
    }
}

// Show status message
function showStatus(elementId, message, type) {
    const element = document.getElementById(elementId);
    element.textContent = message;
    element.className = `status-message ${type}`;
    element.style.display = 'block';

    // Auto-hide success messages after 5 seconds
    if (type === 'success') {
        setTimeout(() => {
            element.style.display = 'none';
        }, 5000);
    }
}

// Handle auto fill from current page
async function handleAutoFill() {
    const autoFillBtn = document.getElementById('auto-fill-btn');
    autoFillBtn.disabled = true;
    autoFillBtn.textContent = 'Extracting data...';

    try {
        // Get current active tab
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        
        if (!tab || !tab.url) {
            throw new Error('Could not access current tab. Please make sure you are on the correct page.');
        }

        // Extract case ID from URL
        const caseId = tab.url;

        // Use background script to inject and extract data
        const response = await chrome.runtime.sendMessage({
            action: 'extractContactData',
            tabId: tab.id
        });

        if (!response || !response.success) {
            throw new Error(response?.error || 'Could not extract data from the page. Please make sure you are on a page with contact information.');
        }

        const data = response.data;
        
        if (!data) {
            throw new Error('Could not extract data from the page. Please make sure you are on a page with contact information.');
        }

        // Fill in the form fields
        if (data.fullName) {
            document.getElementById('full-name').value = data.fullName;
        }
        
        // Fill address fields
        if (data.address) {
            document.getElementById('address').value = data.address;
        }
        if (data.apt) {
            document.getElementById('apt').value = data.apt;
        }
        if (data.city) {
            document.getElementById('city').value = data.city;
        }
        if (data.state) {
            document.getElementById('state').value = data.state;
        }
        if (data.zip) {
            document.getElementById('zip').value = data.zip;
        }
        if (data.county) {
            document.getElementById('county').value = data.county;
        }
        
        if (data.phone) {
            document.getElementById('phone').value = data.phone;
        }
        if (data.authorizedAmount !== undefined && data.authorizedAmount !== null) {
            document.getElementById('authorized-amount').value = data.authorizedAmount;
        }
        if (data.expirationDate) {
            document.getElementById('expiration-date').value = data.expirationDate;
        }
        if (data.dob) {
            const dobInput = document.getElementById('dob');
            if (dobInput) dobInput.value = data.dob;
        }
        if (caseId) {
            // Validate case URL format
            if (!isValidCaseUrl(caseId)) {
                showStatus('auto-fill-status', 'Please make sure you are on the clients open case page or enter the real case url', 'error');
                return;
            }
            document.getElementById('case-url').value = caseId;
        }

        // Trigger input events to update validation and auto-geocode
        const addressFields = ['full-name', 'address', 'apt', 'city', 'state', 'zip', 'county', 'phone', 'authorized-amount', 'expiration-date', 'dob', 'case-url'];
        addressFields.forEach(id => {
            const input = document.getElementById(id);
            if (input) {
                input.dispatchEvent(new Event('input', { bubbles: true }));
            }
        });
        
        // Auto-geocode after a short delay to allow all fields to be filled
        setTimeout(() => {
            autoGeocode();
        }, 500);

        showStatus('auto-fill-status', 'Data extracted successfully!', 'success');
    } catch (error) {
        console.error('Auto fill error:', error);
        showStatus('auto-fill-status', error.message || 'Failed to extract data from page', 'error');
    } finally {
        autoFillBtn.disabled = false;
        autoFillBtn.innerHTML = 'Auto Fill from Page';
    }
}


// Validate case URL format
function isValidCaseUrl(url) {
    if (!url || typeof url !== 'string') {
        return false;
    }
    
    // Expected format: https://app.uniteus.io/dashboard/cases/open/{uuid}/contact/{uuid}
    const pattern = /^https:\/\/app\.uniteus\.io\/dashboard\/cases\/open\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/contact\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    return pattern.test(url.trim());
}

// Setup form validation to enable/disable submit button (geocoding required)
function setupFormValidation() {
    const form = document.getElementById('client-form');
    const submitBtn = document.getElementById('submit-btn');
    const requiredFields = ['full-name', 'status', 'navigator', 'address', 'city', 'state', 'zip', 'phone', 'case-url', 'service-type'];

    function validateForm() {
        let isValid = true;

        // Check required text inputs
        ['full-name', 'address', 'city', 'state', 'zip', 'phone', 'case-url'].forEach(id => {
            const field = document.getElementById(id);
            if (field && !field.value.trim()) {
                isValid = false;
            }
        });

        // Check status select
        const status = document.getElementById('status');
        if (!status || !status.value) {
            isValid = false;
        }

        // Check navigator select
        const navigator = document.getElementById('navigator');
        if (!navigator || !navigator.value) {
            isValid = false;
        }

        // Check case URL format
        const caseUrl = document.getElementById('case-url');
        if (caseUrl && caseUrl.value.trim()) {
            if (!isValidCaseUrl(caseUrl.value.trim())) {
                isValid = false;
            }
        }

        // Check service type
        const serviceTypeField = document.getElementById('service-type');
        if (!serviceTypeField || !serviceTypeField.value) {
            isValid = false;
        }

        // Require geocoding: must have coordinates when address is complete
        const hasAddress = document.getElementById('address').value.trim() &&
            document.getElementById('city').value.trim() &&
            document.getElementById('state').value.trim() &&
            document.getElementById('zip').value.trim();
        if (hasAddress && (!window.geocodeLat || !window.geocodeLng)) {
            isValid = false;
        }

        submitBtn.disabled = !isValid;
        return isValid;
    }

    // Expose so autoGeocode can re-run validation when geocode completes
    form._validateForm = validateForm;

    // Add event listeners to all form fields
    requiredFields.forEach(fieldId => {
        if (fieldId === 'service-type') {
            const field = document.getElementById('service-type');
            if (field) {
                field.addEventListener('change', validateForm);
            }
        } else {
            const field = document.getElementById(fieldId);
            if (field) {
                field.addEventListener('input', validateForm);
                field.addEventListener('change', validateForm);
                // For case-url, also validate format on blur
                if (fieldId === 'case-url') {
                    field.addEventListener('blur', function() {
                        if (this.value.trim() && !isValidCaseUrl(this.value.trim())) {
                            showStatus('form-status', 'Please make sure you are on the clients open case page or enter the real case url', 'error');
                        } else {
                            validateForm();
                        }
                    });
                }
            }
        }
    });

    // Initial validation
    validateForm();
}

// Update geocode status UI (idle | loading | success | error)
function updateGeocodeUI(state, message) {
    const el = document.getElementById('geocode-status');
    const btn = document.getElementById('geocode-btn');
    const manualSection = document.getElementById('manual-geocode-section');
    if (!el) return;
    el.textContent = message || '';
    el.className = 'geocode-status ' + (state || 'idle');
    const hasAddress = document.getElementById('address').value.trim() &&
        document.getElementById('city').value.trim() &&
        document.getElementById('state').value.trim() &&
        document.getElementById('zip').value.trim();
    btn.disabled = !hasAddress;

    if (manualSection) {
        if (state === 'error') {
            manualSection.style.display = 'block';
        } else if (state === 'success') {
            manualSection.style.display = 'none';
            hideManualGeocodeFields();
        }
    }
}

function hideManualGeocodeFields() {
    const fields = document.getElementById('manual-geocode-fields');
    const toggle = document.getElementById('manual-geocode-toggle');
    if (fields) fields.style.display = 'none';
    if (toggle) toggle.textContent = 'Enter coordinates manually';
    const latInput = document.getElementById('manual-lat');
    const lngInput = document.getElementById('manual-lng');
    if (latInput) latInput.value = '';
    if (lngInput) lngInput.value = '';
}

function isValidCoordinate(val, type) {
    const num = parseFloat(val);
    if (isNaN(num)) return false;
    if (type === 'lat') return num >= -90 && num <= 90;
    if (type === 'lng') return num >= -180 && num <= 180;
    return false;
}

function setupManualGeocode() {
    const toggle = document.getElementById('manual-geocode-toggle');
    const fields = document.getElementById('manual-geocode-fields');
    const latInput = document.getElementById('manual-lat');
    const lngInput = document.getElementById('manual-lng');
    const applyBtn = document.getElementById('manual-geocode-apply');

    if (!toggle || !fields) return;

    toggle.addEventListener('click', () => {
        const isVisible = fields.style.display !== 'none';
        fields.style.display = isVisible ? 'none' : 'block';
        toggle.textContent = isVisible ? 'Enter coordinates manually' : 'Hide manual entry';
    });

    function validateManualInputs() {
        const latValid = isValidCoordinate(latInput.value.trim(), 'lat');
        const lngValid = isValidCoordinate(lngInput.value.trim(), 'lng');
        applyBtn.disabled = !(latValid && lngValid);
    }

    latInput.addEventListener('input', validateManualInputs);
    lngInput.addEventListener('input', validateManualInputs);

    applyBtn.addEventListener('click', () => {
        const lat = parseFloat(latInput.value.trim());
        const lng = parseFloat(lngInput.value.trim());
        if (!isValidCoordinate(latInput.value.trim(), 'lat') || !isValidCoordinate(lngInput.value.trim(), 'lng')) return;

        window.geocodeLat = lat;
        window.geocodeLng = lng;
        updateGeocodeUI('success', `\u2713 Coordinates set manually (${lat}, ${lng})`);
        const form = document.getElementById('client-form');
        if (form._validateForm) form._validateForm();
    });
}

// Clear stored coordinates when address changes (so submit stays disabled until re-geocoded)
function clearGeocodeOnAddressChange() {
    window.geocodeLat = null;
    window.geocodeLng = null;
    hideManualGeocodeFields();
    const manualSection = document.getElementById('manual-geocode-section');
    if (manualSection) manualSection.style.display = 'none';
    const hasAddress = document.getElementById('address').value.trim() &&
        document.getElementById('city').value.trim() &&
        document.getElementById('state').value.trim() &&
        document.getElementById('zip').value.trim();
    if (hasAddress) {
        updateGeocodeUI('idle', 'Address changed — geocode required');
    } else {
        updateGeocodeUI('idle', 'Fill address, city, state, and ZIP to geocode');
    }
    const form = document.getElementById('client-form');
    if (form._validateForm) form._validateForm();
}

// Auto-geocode function (required before submit). manualCall = true when user clicks "Geocode Address"
async function autoGeocode(manualCall) {
    const address = document.getElementById('address').value.trim();
    const city = document.getElementById('city').value.trim();
    const state = document.getElementById('state').value.trim();
    const zip = document.getElementById('zip').value.trim();

    if (!address || !city || !state || !zip) {
        updateGeocodeUI('idle', 'Fill address, city, state, and ZIP to geocode');
        return;
    }

    updateGeocodeUI('loading', 'Geocoding…');
    const geocodeBtn = document.getElementById('geocode-btn');
    if (geocodeBtn) geocodeBtn.disabled = true;

    const { baseUrl } = getConfig();
    try {
        const addressQuery = `${address}, ${city}, ${state} ${zip}`;
        const response = await fetch(`${baseUrl}/api/geocode?q=${encodeURIComponent(addressQuery)}&provider=auto`, {
            method: 'GET'
        });

        const data = await response.json().catch(() => ({}));

        if (response.ok && data.lat != null && data.lng != null) {
            window.geocodeLat = data.lat;
            window.geocodeLng = data.lng;
            updateGeocodeUI('success', '✓ Address geocoded');
            const form = document.getElementById('client-form');
            if (form._validateForm) form._validateForm();
        } else {
            const errMsg = data.error || (response.ok ? 'No coordinates returned' : `Geocode failed (${response.status})`);
            updateGeocodeUI('error', errMsg + ' — click "Geocode Address" to retry');
            window.geocodeLat = null;
            window.geocodeLng = null;
        }
    } catch (error) {
        console.error('Geocoding failed:', error);
        updateGeocodeUI('error', 'Network error — check connection and click "Geocode Address" to retry');
        window.geocodeLat = null;
        window.geocodeLng = null;
    } finally {
        const hasAddress = document.getElementById('address').value.trim() &&
            document.getElementById('city').value.trim() &&
            document.getElementById('state').value.trim() &&
            document.getElementById('zip').value.trim();
        const btn = document.getElementById('geocode-btn');
        if (btn) btn.disabled = !hasAddress;
    }
}

// Setup auto-geocoding on address field changes; clear coords when address changes
function setupAutoGeocode() {
    const addressFields = ['address', 'city', 'state', 'zip'];
    let geocodeTimeout;

    addressFields.forEach(fieldId => {
        const field = document.getElementById(fieldId);
        if (field) {
            field.addEventListener('input', () => {
                clearGeocodeOnAddressChange();
                clearTimeout(geocodeTimeout);
                geocodeTimeout = setTimeout(() => {
                    autoGeocode(false);
                }, 1000);
            });
        }
    });

    // Initial UI state
    updateGeocodeUI('idle', 'Fill address, city, state, and ZIP to geocode');
}
