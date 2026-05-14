# DietCombo — features & system changes

### Routes and labels workflow (stops, numbering, city, unrouted, complex cases)

### Dependent label and Excel export with R2 links

### Geocoding for routing and addresses

### Chrome extension and server-side automation

### Routes page sorting and navigation fixes

### Proxy layer and billing-related API groundwork

### Admin meal plan edits page with Excel and PDF export

### Portal meal plan date-range filtering and async conversion fixes

### Admin create orders — scheduled delivery date picker

### Dependent flags, auto-pause, and scheduled housekeeping cron

### Dashboard export — expiration date and authorized amount per client

### Exclude paused clients from produce list and produce label export

### Produce vendor management, client/vendor UI, extension and middleware

### Admin client portal route, LayoutShell, ClientInfoShelf, SavedMealPlanMonth, and related actions

### Portal meal allowance counts only Food clients (excludes Produce)

### Unite Account and History on clients; Brooklyn tab; Brooklyn admin role and import script; extension requires Unite account

### Service Type exports include produce vendor (e.g. produce-rockland); extension updates

### Bill API, expired meal planner orders, meal-plan-edits, admin settings, and billing automation

### Supabase row-limit and truncation fixes; service_type comparison fixes

### Dependent history notes on info shelf; Excel uses parent expiration and parent Unite Account for dependents

### Vendor meal plan label PDF and driver page-break handling

### Route/mobile API merge fixes (fetchAllRows and produce filtering)

### Navigator column on Needs Attention and driver page updates

### Supabase publishable/secret keys, SSR helpers, script credential cleanup

### Driver and route stop counts aligned with driver_route_order; assignment sync, revert, and deduplication

### Produce voucher amount field (consolidated from an earlier multi-field model)

### Pause-expiring-clients notifications to multiple recipients

### Bill API pagination for large client sets

### Portal UX — save bar, mismatch days with jump links, aggregate errors with dates, quantities scaled to household size

### Weekly cron — pause dependents when primary authorization expires

### Multi-account login and portal/billing automation improvements

### Date of birth on main client sidebar (ClientInfoShelf)

### Billing rules — all dependants in bill export; flat per-person rate in /api/bill

### Bill API uses client Unite Us link consistently

### Open link for pending and accepted submissions

### Client created timestamp shown in New York timezone

### Orders list rows as links; delivery proof thumbnails on orders

### Timestamp stamping on uploaded proof images (safe for JPEG/PNG)

### Delivery UI — view uploaded proof image; signature entry path adjusted

### Fast get_routes_for_date RPC and client audit log

### Produce vendor export includes city, state, zip; vendor page stability and bulk actions

### API routes skip role redirects; produce service type and detail updates

### Extension — produce vendors API, DOB, dependents, Unite account fixes

### Brooklyn notification email and BROOKLYN_ONLY extension toggle

### Routes — delivery status, dietary notes, and delivery eligibility surfacing

### Attestation PDF title wraps within page width

### Bill API includes createdAt for primary and dependants

### Meal planner admin defaults and template number-input UX

### Resizable client grid columns and expanded shelf layout

### Bill API excludes households where the primary client is not billable

### Date of birth included in Excel export

### Routes map search, geocode fallbacks, and route diagnostics

### Pending screenings queue with Eastern timezone for screening timestamps

### Brooklyn new-client notification recipients cleaned up

### Server-side dashboard search with household expansion

### Client soft-delete with archivedAt, deleted-mode list performance, audit trail, and archive notification to support

### Verify-order flow — edits, signatures, proof capture, geocode updates

### Multiple delivery proof URLs with lightbox, download, and storage proxy for previews

### Import and migration — some clients missing or wrong parent/dependent structure after import

### Import and migration — active client present in old system but missing in new

### Import and migration — produce assignments not imported; only one produce client visible

### Staff login failure for specific user account after creation

### Dependent-level food and produce service requests and preferences

### Independent delivery address and notes per dependent

### Unclear error state on client page

### Dependents omitted from label printing

### Dependent labels missing full notes or clear truncation

### Dependents not modeled as routable stops for drivers

### Unrouted count understated versus actual unrouted dependents and clients

### Dependents lacking addresses for geocoding and routing

### Duplicate or inflated label and bag counts versus eligible orders

### Produce-marked clients still receiving food labels or meals

### No-delivery and produce clients appearing in inappropriate food delivery workflows

### Existing food orders and labels not reconciled after switching client to produce

### Brooklyn routes — mismatched bags, orders, and printed labels

### Delivery marked complete using proof photos from a prior date or order

### Delivery proof upload failures on poor connectivity

### Uploaded proof not reflected in order status until refresh or retry

### Map stops showing incorrect geocoded locations

### Clients flagged for geocoding missing from geocode workflow screens

### Customer portal showed all clients instead of one household

### Portal links 404 with extra path segments

### One email unable to drive multiple separate household logins cleanly

### Household meal selection total overstated vs eligible food members only

### Mixed food and produce household allowed incorrect food meal totals

### Portal save errors without pinpointing date or member causing mismatch

### Invalid default menu or zero-quantity days causing portal errors

### Produce-only primary blocking portal access for food dependents

### Portal household view hiding food dependents behind produce-only primary

### Extension blocked submission when geocoding failed despite valid Unite address

### Extension submit disabled without indicating which required field was missing

### Brooklyn profile save failures when setting amount, Unite link, and expiration together

### Dashboard or profile load failures after a problematic deployment

### Dashboard slow when loading full client list

### Notes save failures

### New household member creation errors in dashboard or extension

### Database downtime related to a security response

### Supermarket/vendor list intermittently empty until refresh

### Phone number missing on scanned label or QR compared to in-app view

### Nutrition or verification links opening wrong domain

### Some delivery labels missing QR codes

### Address matching failures due to spacing or formatting differences

### Automatic import of authorization and expiration dates

### Customer login via email one-time code instead of password

### Host customer portal on customer.thedietfantasy.com with customer-facing link only

### Staff-editable email on customer accounts for portal access

### Dependents treated like full clients for operations while billing stays on the primary case

### Dependent service type visible next to each dependent

### Pause delivery for an individual dependent

### Complex-client flag independently on dependents

### Phone numbers stored and shown for dependents for vendors and drivers

### Parent expiration copied onto dependent profiles and export rows

### Automatic change history — who changed what and when

### Full menu catalog for meal selection

### Meal selection cutoff window with portal messaging

### Per-member item or point limits in the portal

### Kitchen-facing totals of menu items ordered

### Staff date picker showing all clients and line items for that delivery date

### Cooking list or PDF generated from selections

### Clearer portal save errors naming the exact fix

### Dashboard loads clients on demand instead of always loading everyone

### Explicit “load all clients” control before heavy operations like export

### Orders page search by customer name including proofs

### Dietary preference choices (e.g. gluten-free, sugar-free, dairy-free) with notes sync

### Nutrition assessment workflow with signoff

### Admin-configured nutritionist email

### Nutrition and verification deep links from profile and orders

### Admin indicators for manual versus automated profile changes

### Named produce vendor types beyond generic produce

### Vendor-scoped links so each supermarket sees only assigned clients

### Brooklyn or produce vendors configured as vendor specials inside one system

### Needs Attention or expiration-focused list with sortable dates

### Historical Brooklyn standalone deployment merged into the main app with Brooklyn-only admin scope

### Extension creates Brooklyn profiles and captures Unite account after merge

### Allow extension referral submit without geocode success; staff completes coordinates later

### Manual latitude and longitude entry when geocoding fails

### Improved driver route quality and sequencing

### Reset incorrect geocoding and re-geocode stops

### Custom driver colors on route views

### Capture delivery photos offline and upload when connectivity returns

### Pause and change notification emails also sent to [customersupport@thedietfantasy.com](mailto:customersupport@thedietfantasy.com)