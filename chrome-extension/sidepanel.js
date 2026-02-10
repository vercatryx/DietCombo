// Configuration
let apiKey = '';
let baseUrl = '';
let statuses = [];
let navigators = [];

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
    await loadConfig();
    await validateAndInitialize();
    setupEventListeners();
});

// Load configuration from storage
async function loadConfig() {
    const result = await chrome.storage.sync.get(['apiKey', 'baseUrl']);
    if (result.apiKey) {
        apiKey = result.apiKey;
    }
    if (result.baseUrl) {
        baseUrl = result.baseUrl;
    }
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

    // Check if API key and base URL are configured
    if (!apiKey || !baseUrl) {
        validationSection.style.display = 'none';
        errorSection.style.display = 'flex';
        document.getElementById('error-text').textContent = 
            'API key or Base URL is not configured. Please open Settings to configure them.';
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
        
        await loadStatuses();
        await loadNavigators();
        
        // Setup form validation after form is visible
        setupFormValidation();
        
        // Setup auto-geocoding
        setupAutoGeocode();
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

    // Test connection
    document.getElementById('test-connection').addEventListener('click', async () => {
        await testConnection();
    });

    // Form submission
    document.getElementById('client-form').addEventListener('submit', handleSubmit);

    // Auto fill button
    document.getElementById('auto-fill-btn').addEventListener('click', handleAutoFill);

    // Show/hide auth units field based on service type
    const serviceTypeRadios = document.querySelectorAll('input[name="service-type"]');
    serviceTypeRadios.forEach(radio => {
        radio.addEventListener('change', function() {
            const authUnitsGroup = document.getElementById('auth-units-group');
            if (this.value === 'Food') {
                authUnitsGroup.style.display = 'block';
            } else {
                authUnitsGroup.style.display = 'none';
                document.getElementById('auth-units').value = '';
            }
            // Trigger validation update
            if (typeof setupFormValidation === 'function') {
                const validateForm = () => {
                    const submitBtn = document.getElementById('submit-btn');
                    const requiredFields = ['full-name', 'status', 'navigator', 'address', 'city', 'state', 'zip', 'phone', 'case-url', 'service-type'];
                    let isValid = true;

                    requiredFields.forEach(fieldId => {
                        if (fieldId === 'service-type') {
                            const serviceType = document.querySelector('input[name="service-type"]:checked');
                            if (!serviceType) isValid = false;
                        } else {
                            const field = document.getElementById(fieldId);
                            if (field && !field.value.trim()) isValid = false;
                        }
                    });

                    const caseUrl = document.getElementById('case-url');
                    if (caseUrl && caseUrl.value.trim() && !isValidCaseUrl(caseUrl.value.trim())) {
                        isValid = false;
                    }

                    submitBtn.disabled = !isValid;
                };
                validateForm();
            }
        });
    });

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
    document.getElementById('settings-api-key').value = apiKey;
    document.getElementById('settings-base-url').value = baseUrl;
    document.getElementById('settings-status').style.display = 'none';
    modal.style.display = 'flex';
}

// Close settings modal
function closeSettings() {
    document.getElementById('settings-modal').style.display = 'none';
}

// Save settings
async function saveSettings() {
    const newApiKey = document.getElementById('settings-api-key').value.trim();
    const newBaseUrl = document.getElementById('settings-base-url').value.trim();

    if (!newApiKey) {
        showStatus('settings-status', 'Please enter an API key', 'error');
        return;
    }

    if (!newBaseUrl) {
        showStatus('settings-status', 'Please enter a base URL', 'error');
        return;
    }

    apiKey = newApiKey;
    baseUrl = newBaseUrl.replace(/\/$/, ''); // Remove trailing slash

    await chrome.storage.sync.set({ apiKey, baseUrl });
    showStatus('settings-status', 'Settings saved! Validating...', 'success');

    // Close modal and revalidate
    setTimeout(async () => {
        closeSettings();
        await validateAndInitialize();
    }, 1000);
}

// Test connection
async function testConnection() {
    const testApiKey = document.getElementById('settings-api-key').value.trim();
    const testBaseUrl = document.getElementById('settings-base-url').value.trim().replace(/\/$/, '');

    if (!testApiKey || !testBaseUrl) {
        showStatus('settings-status', 'Please enter both API key and Base URL', 'error');
        return;
    }

    showStatus('settings-status', 'Testing connection...', 'info');

    try {
        const response = await fetch(`${testBaseUrl}/api/extension/statuses`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${testApiKey}`,
                'Content-Type': 'application/json'
            }
        });

        // Check if response is JSON
        const contentType = response.headers.get('content-type');
        if (!contentType || !contentType.includes('application/json')) {
            // Got HTML instead of JSON - likely wrong URL or server error
            if (response.status === 404) {
                throw new Error('API endpoint not found. Please check your Base URL is correct.');
            }
            throw new Error('Server returned an error page. Please check your Base URL and ensure the server is running.');
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
                    // If we can't parse JSON, it's a server error
                    throw new Error('Server error. Please check your Base URL and ensure the server is running.');
                }
            }
            throw new Error(`Connection failed: ${response.statusText}`);
        }

        const data = await response.json();
        if (!data.success) {
            throw new Error(data.error || 'Connection test failed');
        }

        showStatus('settings-status', '✓ Connection successful!', 'success');
    } catch (error) {
        console.error('Connection test error:', error);
        
        // Handle network errors (no internet)
        if (error.name === 'TypeError' && error.message.includes('fetch')) {
            showStatus('settings-status', 'No internet connection. Please check your network connection.', 'error');
        } else if (error.message.includes('JSON') || error.message.includes('DOCTYPE')) {
            // HTML response instead of JSON
            showStatus('settings-status', 'Invalid response from server. Please check your Base URL is correct.', 'error');
        } else {
            showStatus('settings-status', `Connection failed: ${error.message}`, 'error');
        }
    }
}

// Load statuses from API
async function loadStatuses() {
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

// Load navigators from API
async function loadNavigators() {
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
        const serviceType = document.querySelector('input[name="service-type"]:checked').value;
        const authUnits = document.getElementById('auth-units').value.trim();
        
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
        
        const formData = {
            fullName: document.getElementById('full-name').value.trim(),
            statusId: document.getElementById('status').value,
            navigatorId: document.getElementById('navigator').value,
            address: fullAddress,
            apt: apt,
            city: city,
            state: state,
            zip: zip,
            county: county,
            phone: document.getElementById('phone').value.trim(),
            secondaryPhone: document.getElementById('secondary-phone').value.trim() || null,
            email: document.getElementById('email').value.trim() || null,
            notes: document.getElementById('notes').value.trim() || null,
            dislikes: document.getElementById('dislikes').value.trim() || null,
            serviceType: serviceType,
            caseId: document.getElementById('case-url').value.trim(),
            approvedMealsPerWeek: serviceType === 'Food' && authUnits ? parseInt(authUnits, 10) : 0,
            authorizedAmount: authorizedAmountValue ? parseFloat(authorizedAmountValue) : null,
            expirationDate: expirationDateValue || null,
            // Include geocoding coordinates if available
            latitude: window.geocodeLat || null,
            longitude: window.geocodeLng || null,
            lat: window.geocodeLat || null,
            lng: window.geocodeLng || null,
            // Client flags (defaults: paused false, complex false, bill true, delivery true)
            paused: document.getElementById('flag-paused').checked,
            complex: document.getElementById('flag-complex').checked,
            bill: document.getElementById('flag-bill').checked,
            delivery: document.getElementById('flag-delivery').checked
        };

        // Validate case URL format
        if (!isValidCaseUrl(formData.caseId)) {
            throw new Error('Please make sure you are on the clients open case page or enter the real case url');
        }

        // Validate required fields
        if (!formData.fullName || !formData.statusId || !formData.navigatorId || !streetAddress || !city || !state || !zip || !formData.phone || !formData.serviceType || !formData.caseId) {
            throw new Error('Please fill in all required fields');
        }

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
            showStatus('form-status', `Client "${formData.fullName}" created successfully!`, 'success');
            // Reset form
            document.getElementById('client-form').reset();
            // Clear geocode coordinates
            window.geocodeLat = null;
            window.geocodeLng = null;
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
            // Show auth units field when default is Food
            const authUnitsGroup = document.getElementById('auth-units-group');
            authUnitsGroup.style.display = 'block';
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
        if (caseId) {
            // Validate case URL format
            if (!isValidCaseUrl(caseId)) {
                showStatus('auto-fill-status', 'Please make sure you are on the clients open case page or enter the real case url', 'error');
                return;
            }
            document.getElementById('case-url').value = caseId;
        }

        // Trigger input events to update validation and auto-geocode
        const addressFields = ['full-name', 'address', 'apt', 'city', 'state', 'zip', 'county', 'phone', 'authorized-amount', 'expiration-date', 'case-url'];
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

// Setup form validation to enable/disable submit button
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

        // Check service type radio
        const serviceType = document.querySelector('input[name="service-type"]:checked');
        if (!serviceType) {
            isValid = false;
        }

        submitBtn.disabled = !isValid;
        return isValid;
    }

    // Add event listeners to all form fields
    requiredFields.forEach(fieldId => {
        if (fieldId === 'service-type') {
            const radios = document.querySelectorAll('input[name="service-type"]');
            radios.forEach(radio => {
                radio.addEventListener('change', validateForm);
            });
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

// Auto-geocode function
async function autoGeocode() {
    const address = document.getElementById('address').value.trim();
    const city = document.getElementById('city').value.trim();
    const state = document.getElementById('state').value.trim();
    const zip = document.getElementById('zip').value.trim();
    
    // Only geocode if we have minimum required fields
    if (!address || !city || !state || !zip) {
        return;
    }
    
    // Don't geocode if we already have coordinates
    if (window.geocodeLat && window.geocodeLng) {
        return;
    }
    
    try {
        // Build address query
        let addressQuery = address;
        if (city) addressQuery += `, ${city}`;
        if (state) addressQuery += `, ${state}`;
        if (zip) addressQuery += ` ${zip}`;
        
        // Call geocoding API
        const response = await fetch(`${baseUrl}/api/geocode?q=${encodeURIComponent(addressQuery)}&provider=auto`, {
            method: 'GET'
        });
        
        if (!response.ok) {
            return; // Silently fail - geocoding is optional
        }
        
        const data = await response.json();
        
        if (data.lat && data.lng) {
            // Store coordinates for form submission
            window.geocodeLat = data.lat;
            window.geocodeLng = data.lng;
            console.log('Auto-geocoded:', data.lat, data.lng);
        }
    } catch (error) {
        // Silently fail - geocoding is optional
        console.log('Auto-geocoding failed (optional):', error);
    }
}

// Setup auto-geocoding on address field changes
function setupAutoGeocode() {
    const addressFields = ['address', 'city', 'state', 'zip'];
    let geocodeTimeout;
    
    addressFields.forEach(fieldId => {
        const field = document.getElementById(fieldId);
        if (field) {
            field.addEventListener('input', () => {
                // Debounce geocoding - wait 1 second after user stops typing
                clearTimeout(geocodeTimeout);
                geocodeTimeout = setTimeout(() => {
                    autoGeocode();
                }, 1000);
            });
        }
    });
}
