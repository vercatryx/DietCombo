/**
 * Import a full backup JSON file into the database.
 *
 * Usage:
 *   node scripts/import-backup.js [--replace] <path-to-backup.json>
 *
 * --replace  Delete all existing data in User, Signature, Schedule, Route, Driver, Stop, RouteRun before importing.
 *            Use with caution (full replace).
 */

require("dotenv").config({ path: ".env.local" });
const fs = require("fs");
const path = require("path");
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

const USER_FIELDS = [
  "id", "first", "last", "address", "apt", "city", "dislikes", "county", "zip", "state",
  "phone", "medicaid", "paused", "complex", "clientId", "caseId", "billings",
  "latitude", "longitude", "geocodedAt", "lat", "lng", "visits", "sign_token",
  "createdAt", "updatedAt", "bill", "delivery",
];

function pick(obj, keys) {
  const out = {};
  for (const k of keys) {
    if (obj.hasOwnProperty(k)) out[k] = obj[k];
  }
  return out;
}

function scheduleCreate(schedule) {
  if (!schedule || typeof schedule !== "object") return undefined;
  return {
    create: {
      monday: schedule.monday !== false,
      tuesday: schedule.tuesday !== false,
      wednesday: schedule.wednesday !== false,
      thursday: schedule.thursday !== false,
      friday: schedule.friday !== false,
      saturday: schedule.saturday !== false,
      sunday: schedule.sunday !== false,
    },
  };
}

async function main() {
  const args = process.argv.slice(2);
  const replace = args[0] === "--replace";
  const filePath = replace ? args[1] : args[0];

  if (!filePath) {
    console.error("Usage: node scripts/import-backup.js [--replace] <path-to-backup.json>");
    process.exit(1);
  }

  const absPath = path.isAbsolute(filePath) ? filePath : path.join(process.cwd(), filePath);
  if (!fs.existsSync(absPath)) {
    console.error("File not found:", absPath);
    process.exit(1);
  }

  console.log("Reading backup from:", absPath);
  const raw = fs.readFileSync(absPath, "utf8");
  let backup;
  try {
    backup = JSON.parse(raw);
  } catch (e) {
    console.error("Invalid JSON:", e.message);
    process.exit(1);
  }

  const users = Array.isArray(backup.users) ? backup.users : [];
  const signatures = Array.isArray(backup.signatures) ? backup.signatures : [];
  const routes = Array.isArray(backup.routes) ? backup.routes : [];
  const drivers = Array.isArray(backup.drivers) ? backup.drivers : [];
  const stops = Array.isArray(backup.stops) ? backup.stops : [];
  const routeRuns = Array.isArray(backup.routeRuns) ? backup.routeRuns : [];

  console.log("Backup contains:", {
    users: users.length,
    signatures: signatures.length,
    routes: routes.length,
    drivers: drivers.length,
    stops: stops.length,
    routeRuns: routeRuns.length,
  });

  if (replace) {
    console.log("--replace: clearing existing data...");
    await prisma.signature.deleteMany();
    await prisma.schedule.deleteMany();
    await prisma.user.deleteMany();
    await prisma.route.deleteMany();
    await prisma.driver.deleteMany();
    await prisma.stop.deleteMany();
    await prisma.routeRun.deleteMany();
    console.log("Cleared.");
  }

  // 1. Users (with schedule)
  for (const u of users) {
    const schedule = scheduleCreate(u.schedule);
    const userFields = pick(u, USER_FIELDS);
    const createData = {
      ...userFields,
      ...(schedule ? { schedule } : {}),
    };
    await prisma.user.upsert({
      where: { id: u.id },
      create: createData,
      update: userFields,
    });
  }
  console.log("Imported", users.length, "users.");

  // 2. Signatures (id in backup is string; Prisma BigInt)
  for (const s of signatures) {
    const id = BigInt(s.id);
    await prisma.signature.upsert({
      where: { id },
      create: {
        id,
        userId: s.userId,
        slot: s.slot,
        strokes: s.strokes ?? [],
        signedAt: s.signedAt ? new Date(s.signedAt) : new Date(),
        ip: s.ip ?? null,
        userAgent: s.userAgent ?? null,
      },
      update: {
        userId: s.userId,
        slot: s.slot,
        strokes: s.strokes ?? [],
        signedAt: s.signedAt ? new Date(s.signedAt) : new Date(),
        ip: s.ip ?? null,
        userAgent: s.userAgent ?? null,
      },
    });
  }
  console.log("Imported", signatures.length, "signatures.");

  // 3. Routes
  for (const r of routes) {
    await prisma.route.upsert({
      where: { id: r.id },
      create: { id: r.id, name: r.name, color: r.color ?? null, stopIds: r.stopIds ?? [] },
      update: { name: r.name, color: r.color ?? null, stopIds: r.stopIds ?? [] },
    });
  }
  console.log("Imported", routes.length, "routes.");

  // 4. Drivers (stopIds is Json in Prisma)
  for (const d of drivers) {
    await prisma.driver.upsert({
      where: { id: d.id },
      create: {
        id: d.id,
        day: d.day,
        name: d.name,
        color: d.color,
        stopIds: d.stopIds ?? [],
        createdAt: d.createdAt ? new Date(d.createdAt) : undefined,
        updatedAt: d.updatedAt ? new Date(d.updatedAt) : undefined,
      },
      update: {
        day: d.day,
        name: d.name,
        color: d.color,
        stopIds: d.stopIds ?? [],
        updatedAt: d.updatedAt ? new Date(d.updatedAt) : new Date(),
      },
    });
  }
  console.log("Imported", drivers.length, "drivers.");

  // 5. Stops
  for (const s of stops) {
    await prisma.stop.upsert({
      where: { id: s.id },
      create: {
        id: s.id,
        day: s.day,
        userId: s.userId ?? null,
        order: s.order ?? null,
        name: s.name,
        address: s.address,
        apt: s.apt ?? null,
        city: s.city,
        state: s.state,
        zip: s.zip,
        phone: s.phone ?? null,
        dislikes: s.dislikes ?? null,
        lat: s.lat ?? null,
        lng: s.lng ?? null,
        completed: s.completed === true,
        proofUrl: s.proofUrl ?? null,
        assignedDriverId: s.assignedDriverId ?? null,
        createdAt: s.createdAt ? new Date(s.createdAt) : undefined,
        updatedAt: s.updatedAt ? new Date(s.updatedAt) : undefined,
      },
      update: {
        day: s.day,
        userId: s.userId ?? null,
        order: s.order ?? null,
        name: s.name,
        address: s.address,
        apt: s.apt ?? null,
        city: s.city,
        state: s.state,
        zip: s.zip,
        phone: s.phone ?? null,
        dislikes: s.dislikes ?? null,
        lat: s.lat ?? null,
        lng: s.lng ?? null,
        completed: s.completed === true,
        proofUrl: s.proofUrl ?? null,
        assignedDriverId: s.assignedDriverId ?? null,
        updatedAt: s.updatedAt ? new Date(s.updatedAt) : new Date(),
      },
    });
  }
  console.log("Imported", stops.length, "stops.");

  // 6. RouteRuns
  for (const r of routeRuns) {
    await prisma.routeRun.upsert({
      where: { id: r.id },
      create: {
        id: r.id,
        day: r.day,
        createdAt: r.createdAt ? new Date(r.createdAt) : new Date(),
        snapshot: r.snapshot ?? [],
      },
      update: {
        day: r.day,
        createdAt: r.createdAt ? new Date(r.createdAt) : new Date(),
        snapshot: r.snapshot ?? [],
      },
    });
  }
  console.log("Imported", routeRuns.length, "route runs.");

  // Reset PostgreSQL sequences so next auto-id is correct
  try {
    const tables = [
      { name: "User", col: "id" },
      { name: "Signature", col: "id" },
      { name: "Route", col: "id" },
      { name: "Driver", col: "id" },
      { name: "Stop", col: "id" },
      { name: "RouteRun", col: "id" },
    ];
    for (const { name, col } of tables) {
      const q = `SELECT setval(pg_get_serial_sequence('"${name}"', '${col}'), (SELECT COALESCE(MAX("${col}"), 1) FROM "${name}"))`;
      await prisma.$executeRawUnsafe(q);
    }
    console.log("Reset sequences.");
  } catch (e) {
    console.warn("Could not reset sequences (non-PostgreSQL or no serial?):", e.message);
  }

  console.log("Done.");
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => {
    console.error(e);
    prisma.$disconnect();
    process.exit(1);
  });
