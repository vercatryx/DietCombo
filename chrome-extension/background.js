// Open side panel when extension icon is clicked
chrome.action.onClicked.addListener((tab) => {
    chrome.sidePanel.open({ windowId: tab.windowId });
});

// Handle script injection requests from side panel
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'extractContactData') {
        chrome.scripting.executeScript({
            target: { tabId: request.tabId },
            func: extractContactData
        }).then(results => {
            sendResponse({ success: true, data: results[0]?.result });
        }).catch(error => {
            sendResponse({ success: false, error: error.message });
        });
        return true; // Indicates we will send a response asynchronously
    }
});

// Function to extract contact data (runs in page context)
function extractContactData() {
    const data = {};

    // Extract Full Name
    const nameElement = document.querySelector('.contact-column__name');
    if (nameElement) {
        data.fullName = nameElement.textContent.trim();
    }

    // Extract Address - Parse into separate fields
    const addressDetails = document.querySelector('.address__details');
    if (addressDetails) {
        const paragraphs = addressDetails.querySelectorAll('p');
        let streetAddress = '';
        let city = '';
        let state = '';
        let zip = '';
        let county = '';
        
        paragraphs.forEach((p, index) => {
            const text = p.textContent.trim();
            const isItalic = p.classList.contains('italic');
            const isCounty = p.classList.contains('county');
            
            // Skip "Primary" label
            if (isItalic && text === 'Primary') {
                return;
            }
            
            // County field
            if (isCounty) {
                county = text;
                return;
            }
            
            // First non-italic paragraph is usually street address
            if (!streetAddress && !isItalic && !isCounty) {
                streetAddress = text;
            }
            
            // Look for city, state, zip pattern (usually has <span> and <abbr>)
            const span = p.querySelector('span');
            const abbr = p.querySelector('abbr');
            if (span && abbr) {
                // Extract city from span text (before comma)
                const spanText = span.textContent.trim();
                const cityMatch = spanText.match(/^([^,]+),/);
                if (cityMatch) {
                    city = cityMatch[1].trim();
                }
                
                // Extract state from abbr
                state = abbr.textContent.trim();
                
                // Extract ZIP (usually after the span)
                const zipMatch = text.match(/\b(\d{5}(?:-\d{4})?)\b/);
                if (zipMatch) {
                    zip = zipMatch[1];
                }
            }
        });
        
        // Parse street address to separate apt/unit
        let apt = '';
        if (streetAddress) {
            // Look for patterns like "UNIT 112", "APT 112", "#112", etc.
            const aptMatch = streetAddress.match(/\b(?:UNIT|APT|APARTMENT|#|NO\.?)\s*([A-Z0-9\-]+)\b/i);
            if (aptMatch) {
                apt = aptMatch[1];
                // Remove apt from street address
                streetAddress = streetAddress.replace(/\b(?:UNIT|APT|APARTMENT|#|NO\.?)\s*[A-Z0-9\-]+\b/gi, '').trim();
            }
        }
        
        // Store parsed address components
        data.address = streetAddress;
        data.apt = apt;
        data.city = city;
        data.state = state;
        data.zip = zip;
        data.county = county;
    }

    // Extract Phone
    const phoneLink = document.querySelector('a[href^="tel:"]');
    if (phoneLink) {
        const phoneSpan = phoneLink.querySelector('span[data-test-element="phone-numbers_number_0"]');
        if (phoneSpan) {
            data.phone = phoneSpan.textContent.trim();
        } else {
            // Fallback: extract from href
            const href = phoneLink.getAttribute('href');
            if (href) {
                const phoneMatch = href.match(/tel:\+?(\d+)/);
                if (phoneMatch) {
                    const digits = phoneMatch[1];
                    // Format as (XXX) XXX-XXXX
                    if (digits.length === 10) {
                        data.phone = `(${digits.substring(0, 3)}) ${digits.substring(3, 6)}-${digits.substring(6)}`;
                    } else {
                        data.phone = digits;
                    }
                }
            }
        }
    }

    // Extract Authorized Amount
    // Try primary selector: span.dollar-amount with empty data-test-element
    let dollarAmountElement = document.querySelector('span.dollar-amount[data-test-element=""]');
    
    // Fallback: try any span.dollar-amount if the first doesn't work
    if (!dollarAmountElement) {
        dollarAmountElement = document.querySelector('span.dollar-amount');
    }
    
    // Fallback: try XPath approach (navigate through table structure)
    if (!dollarAmountElement) {
        try {
            // XPath: /html/body/div[2]/div[2]/main/div/section/div/div[2]/div/div[1]/div[1]/div[2]/div[3]/div/div[1]/div/table/tbody/tr[2]/td[2]/span
            const xpath = '/html/body/div[2]/div[2]/main/div/section/div/div[2]/div/div[1]/div[1]/div[2]/div[3]/div/div[1]/div/table/tbody/tr[2]/td[2]/span';
            const result = document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
            dollarAmountElement = result.singleNodeValue;
        } catch (e) {
            // XPath evaluation failed, continue without it
        }
    }
    
    if (dollarAmountElement) {
        const amountText = dollarAmountElement.textContent.trim();
        // Remove $ and commas, then parse as float
        const amountValue = amountText.replace(/[$,]/g, '');
        const parsedAmount = parseFloat(amountValue);
        if (!isNaN(parsedAmount)) {
            data.authorizedAmount = parsedAmount;
        }
    }

    // Extract Expiration Date (second date from "Authorized service delivery date(s)")
    // Try direct ID selector first
    let dateCell = document.getElementById('basic-table-authorized-service-delivery-date-s-value');
    
    // Fallback: try CSS selector
    if (!dateCell) {
        dateCell = document.querySelector('td#basic-table-authorized-service-delivery-date-s-value');
    }
    
    // Fallback: try XPath approach
    if (!dateCell) {
        try {
            // XPath: /html/body/div[2]/div[2]/main/div/section/div/div[2]/div/div[1]/div[1]/div[2]/div[3]/div/div[1]/div/table/tbody/tr[3]/td[2]
            const xpath = '/html/body/div[2]/div[2]/main/div/section/div/div[2]/div/div[1]/div[1]/div[2]/div[3]/div/div[1]/div/table/tbody/tr[3]/td[2]';
            const result = document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
            dateCell = result.singleNodeValue;
        } catch (e) {
            // XPath evaluation failed, continue without it
        }
    }
    
    // Fallback: Look for the table row with "Authorized service delivery date(s)" label
    if (!dateCell) {
        const tableRows = document.querySelectorAll('tr.basic-table__row');
        for (const row of tableRows) {
            const labelCell = row.querySelector('td.basic-table__text--label');
            if (labelCell && labelCell.textContent.trim() === 'Authorized service delivery date(s)') {
                const valueCell = row.querySelector('td.basic-table__text');
                if (valueCell) {
                    dateCell = valueCell;
                    break;
                }
            }
        }
    }
    
    if (dateCell) {
        const dateRange = dateCell.textContent.trim();
        // Parse date range like "12/8/2025 - 6/7/2026" and get the second date
        const dateParts = dateRange.split(' - ');
        if (dateParts.length >= 2) {
            const expirationDateStr = dateParts[1].trim(); // Get second date (e.g., "6/7/2026")
            // Convert from MM/DD/YYYY to YYYY-MM-DD format
            const dateMatch = expirationDateStr.match(/(\d+)\/(\d+)\/(\d+)/);
            if (dateMatch) {
                const month = dateMatch[1].padStart(2, '0');
                const day = dateMatch[2].padStart(2, '0');
                const year = dateMatch[3];
                data.expirationDate = `${year}-${month}-${day}`;
            }
        }
    }

    return data;
}
