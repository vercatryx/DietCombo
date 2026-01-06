
const { getClients } = require('./lib/actions');
const { checkEmailIdentity } = require('./lib/auth-actions');

async function test() {
    console.log('Fetching clients...');
    try {
        const clients = await getClients();
        console.log(`Found ${clients.length} clients.`);
        if (clients.length > 0) {
            const email = clients[0].email;
            console.log(`Testing with email: ${email}`);

            const result = await checkEmailIdentity(email);
            console.log('Identity Check Result:', result);
        } else {
            console.log('No clients found in DB to test with.');
        }
    } catch (e) {
        console.error('Error:', e);
    }
}

test();
