/**
 * Test script: send an SMS via Telnyx API.
 *
 * Set in .env.local (or env):
 *   TELNYX_API_KEY=your_api_key
 *   TELNYX_FROM_NUMBER=+1XXXXXXXXXX   (your purchased Telnyx number, E.164)
 *
 * Run:
 *   npm run test-telnyx-sms
 * Or:
 *   npx ts-node --compiler-options '{"module":"CommonJS","moduleResolution":"node"}' scripts/test-telnyx-sms.ts
 */
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

const TELNYX_API_KEY = process.env.TELNYX_API_KEY;
const TELNYX_FROM_NUMBER = process.env.TELNYX_FROM_NUMBER;
const TO_NUMBER = "+13472150400";
const MESSAGE_TEXT = "Hello World";

async function main() {
  if (!TELNYX_API_KEY) {
    console.error("Missing TELNYX_API_KEY. Set it in .env.local or env.");
    process.exit(1);
  }
  if (!TELNYX_FROM_NUMBER) {
    console.error("Missing TELNYX_FROM_NUMBER (your purchased number, e.g. +15551234567). Set it in .env.local or env.");
    process.exit(1);
  }

  console.log("Sending SMS via Telnyx...");
  console.log("  From:", TELNYX_FROM_NUMBER);
  console.log("  To:", TO_NUMBER);
  console.log("  Text:", MESSAGE_TEXT);

  const res = await fetch("https://api.telnyx.com/v2/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${TELNYX_API_KEY}`,
    },
    body: JSON.stringify({
      from: TELNYX_FROM_NUMBER,
      to: TO_NUMBER,
      text: MESSAGE_TEXT,
    }),
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    console.error("Telnyx API error:", res.status, data);
    process.exit(1);
  }

  const status = data.data?.to?.[0]?.status ?? "unknown";
  console.log("\nTelnyx accepted the request (message queued).");
  console.log("Delivery status:", status, "— this is NOT 'delivered'; check Telnyx portal or webhooks for final outcome.");
  console.log("\nFull response:", JSON.stringify(data, null, 2));
  if (data.data?.id) {
    console.log("\nMessage ID:", data.data.id, "(use this in Telnyx portal to see delivery/failure)");
  }
}

main();
