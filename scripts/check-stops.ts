import { query } from '../lib/mysql';

async function checkStops() {
    try {
        // Get a few stops to see their ID format
        const stops = await query<any>('SELECT id, name, day FROM stops LIMIT 5');
        
        console.log(`\nSample stops (showing ID format):\n`);
        stops.forEach((stop: any) => {
            console.log(`Stop ID: ${stop.id} (type: ${typeof stop.id})`);
            console.log(`  Name: ${stop.name}`);
            console.log(`  Day: ${stop.day}`);
            console.log(`  Is UUID: ${/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(stop.id)}`);
            console.log(`  As Number: ${Number(stop.id)} (isFinite: ${Number.isFinite(Number(stop.id))})`);
            console.log('---');
        });
        
    } catch (error) {
        console.error('Error checking stops:', error);
    } finally {
        process.exit(0);
    }
}

checkStops();

