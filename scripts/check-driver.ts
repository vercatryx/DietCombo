import { query } from '../lib/mysql';

async function checkDriver() {
    try {
        // Get all drivers
        const drivers = await query<any>('SELECT * FROM drivers ORDER BY name');
        
        console.log(`\nFound ${drivers.length} driver(s) in database:\n`);
        
        for (const driver of drivers) {
            console.log(`Driver ID: ${driver.id}`);
            console.log(`Name: ${driver.name}`);
            console.log(`Day: ${driver.day}`);
            console.log(`Color: ${driver.color || '(none)'}`);
            console.log(`stop_ids (raw):`, driver.stop_ids);
            
            // Parse stop_ids
            let stopIds: any[] = [];
            if (driver.stop_ids) {
                if (Array.isArray(driver.stop_ids)) {
                    stopIds = driver.stop_ids;
                } else if (typeof driver.stop_ids === 'string') {
                    try {
                        stopIds = JSON.parse(driver.stop_ids);
                    } catch (e) {
                        console.log(`  ⚠️  Error parsing stop_ids JSON:`, e);
                    }
                }
            }
            
            console.log(`stop_ids (parsed):`, stopIds);
            console.log(`Number of stop_ids: ${stopIds.length}`);
            
            // Check if stops exist
            if (stopIds.length > 0) {
                const stopIdStrings = stopIds.map(id => String(id));
                const placeholders = stopIdStrings.map(() => '?').join(',');
                const existingStops = await query<any>(
                    `SELECT id FROM stops WHERE id IN (${placeholders})`,
                    stopIdStrings
                );
                console.log(`Existing stops in stops table: ${existingStops.length} out of ${stopIds.length}`);
                
                if (existingStops.length === 0) {
                    console.log(`  ⚠️  WARNING: Driver has stop_ids but none exist in stops table!`);
                    console.log(`  This driver will NOT appear in the UI because it has no valid stops.`);
                }
            } else {
                console.log(`  ⚠️  WARNING: Driver has no stop_ids!`);
                console.log(`  This driver will NOT appear in the UI because it has no stops.`);
            }
            
            console.log('---\n');
        }
        
        // Also check what the API would return
        console.log('\n=== What /api/mobile/routes would return ===\n');
        const testResponse = await fetch('http://localhost:3000/api/mobile/routes').catch(() => null);
        if (testResponse) {
            const data = await testResponse.json();
            console.log(`API returns ${data.length} driver(s):`);
            data.forEach((d: any) => {
                console.log(`  - ${d.name} (ID: ${d.id}, Stops: ${d.totalStops})`);
            });
        } else {
            console.log('Could not test API endpoint (server may not be running)');
        }
        
    } catch (error) {
        console.error('Error checking drivers:', error);
    } finally {
        process.exit(0);
    }
}

checkDriver();

