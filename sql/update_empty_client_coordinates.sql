-- Update empty lat/lng fields in clients table with test location coordinates
-- This updates clients where ALL location fields (latitude, longitude, lat, lng) are NULL
-- Test location: Times Square, New York City (40.7580, -73.9855)

UPDATE clients
SET 
    latitude = 40.7580,
    longitude = -73.9855,
    lat = 40.7580,
    lng = -73.9855,
    geocoded_at = NOW()
WHERE 
    latitude IS NULL 
    AND longitude IS NULL 
    AND lat IS NULL 
    AND lng IS NULL;

-- To verify the update, run:
-- SELECT id, full_name, latitude, longitude, lat, lng 
-- FROM clients 
-- WHERE latitude = 40.7580 AND longitude = -73.9855;
