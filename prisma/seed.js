// backend/prisma/seed.js
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('Seeding database...');

  // Location
  await prisma.location.upsert({
    where: { id: 1 },
    update: {},
    create: {
      id: 1,
      name: "Main Hospital",
      lat: 37.7749,
      lng: -122.4194,
      radius: 2000
    }
  });

  // Manager placeholder (auth0Id placeholder)
  await prisma.user.upsert({
    where: { auth0Id: "auth0|manager-placeholder" },
    update: {},
    create: {
      auth0Id: "auth0|manager-placeholder",
      email: "manager@local.test",
      name: "Manager",
      role: "MANAGER"
    }
  });

  // Care worker placeholder
  await prisma.user.upsert({
    where: { auth0Id: "auth0|care-placeholder" },
    update: {},
    create: {
      auth0Id: "auth0|care-placeholder",
      email: "care@local.test",
      name: "Care Worker",
      role: "CARE"
    }
  });

  console.log('Seed finished.');
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
