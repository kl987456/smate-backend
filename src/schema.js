// backend/src/schema.js
const { gql } = require('apollo-server-express');

const typeDefs = gql`
  scalar DateTime

  type User {
    id: Int!
    auth0Id: String
    email: String!
    name: String
    role: String!
    createdAt: DateTime!
  }

  type Location {
    id: Int!
    name: String!
    lat: Float!
    lng: Float!
    radius: Float!
  }

  type ClockEvent {
    id: Int!
    user: User!
    location: Location!
    type: String!  # "IN" or "OUT"
    lat: Float!
    lng: Float!
    note: String
    timestamp: DateTime!
  }

  type TotalHoursPerStaff {
    userId: Int!
    name: String
    hours: Float!
  }

  type Reports {
    avgHoursPerDay: Float
    peoplePerDay: Int
    totalHoursPerStaff: [TotalHoursPerStaff]
  }

  type Query {
    healthCheck: String!               # ✅ Added health check query
    locations: [Location!]!
    meClockEvents: [ClockEvent!]!
    staffClockedIn: [ClockEvent!]!
    reports: Reports
  }

  type Mutation {
    clockIn(locationId: Int!, lat: Float!, lng: Float!, note: String): ClockEvent!
    clockOut(locationId: Int!, lat: Float!, lng: Float!, note: String): ClockEvent!
    firstLogin: User!
  }
`;

const resolvers = {
  Query: {
    // ✅ Health check resolver
    healthCheck: () => "SMATE GraphQL server is healthy 🚀",

    locations: async (_, __, { prisma }) => prisma.location.findMany(),

    meClockEvents: async (_, __, { prisma, user }) => {
      if (!user) throw new Error("Unauthorized");
      return prisma.clockEvent.findMany({
        where: { userId: user.id },
        orderBy: { timestamp: 'desc' },
        include: { user: true, location: true }
      });
    },

    staffClockedIn: async (_, __, { prisma, user: currentUser }) => {
      if (!currentUser) throw new Error("Unauthorized");
      if (currentUser.role !== "MANAGER") throw new Error("Forbidden");

      const users = await prisma.user.findMany();
      const clockedInEvents = [];

      for (const u of users) {
        const lastEvent = await prisma.clockEvent.findFirst({
          where: { userId: u.id },
          orderBy: { timestamp: 'desc' }
        });

        if (lastEvent && lastEvent.type === "IN") {
          const full = await prisma.clockEvent.findUnique({
            where: { id: lastEvent.id },
            include: { user: true, location: true }
          });
          if (full) clockedInEvents.push(full);
        }
      }
      return clockedInEvents;
    },

    reports: async (_, __, { prisma }) => {
      const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const events = await prisma.clockEvent.findMany({
        where: { timestamp: { gte: since } },
        include: { user: true }
      });

      const byUser = {};
      events.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
      for (const e of events) {
        const uid = e.userId;
        if (!byUser[uid]) {
          byUser[uid] = { name: e.user?.name || e.user?.email, totalMs: 0, lastIn: null };
        }
        if (e.type === "IN") byUser[uid].lastIn = new Date(e.timestamp);
        if (e.type === "OUT" && byUser[uid].lastIn) {
          byUser[uid].totalMs += (new Date(e.timestamp) - byUser[uid].lastIn);
          byUser[uid].lastIn = null;
        }
      }

      const totalHoursPerStaff = Object.keys(byUser).map(uid => ({
        userId: Number(uid),
        name: byUser[uid].name,
        hours: Number((byUser[uid].totalMs / 3600000).toFixed(2))
      }));

      const avgHoursPerDay = totalHoursPerStaff.reduce((s, x) => s + x.hours, 0) / 7;
      const peoplePerDay = new Set(events.map(e => e.userId)).size;

      return {
        avgHoursPerDay: Number((avgHoursPerDay || 0).toFixed(2)),
        peoplePerDay,
        totalHoursPerStaff
      };
    }
  },

  Mutation: {
    firstLogin: async (_, __, { prisma, decoded }) => {
      if (!decoded) throw new Error("Unauthorized");
      const auth0Id = decoded.sub;
      const email = decoded.email || `${auth0Id}@auth.local`;
      const name = decoded.name || decoded.nickname || null;
      const role = decoded['https://smate/role'] || "CARE";

      const u = await prisma.user.upsert({
        where: { auth0Id },
        update: { email, name, role },
        create: { auth0Id, email, name, role }
      });
      return u;
    },

    clockIn: async (_, { locationId, lat, lng, note }, { prisma, user }) => {
      if (!user) throw new Error("Unauthorized");

      const location = await prisma.location.findUnique({ where: { id: locationId } });
      if (!location) throw new Error("Location not found");

      const distance = getDistanceFromLatLonInMeters(lat, lng, location.lat, location.lng);
      if (distance > location.radius) throw new Error("Outside allowed perimeter");

      const lastEvent = await prisma.clockEvent.findFirst({
        where: { userId: user.id },
        orderBy: { timestamp: 'desc' }
      });
      if (lastEvent && lastEvent.type === "IN") throw new Error("Already clocked in");

      return prisma.clockEvent.create({
        data: {
          userId: user.id,
          locationId,
          type: "IN",
          lat,
          lng,
          note
        },
        include: { user: true, location: true }
      });
    },

    clockOut: async (_, { locationId, lat, lng, note }, { prisma, user }) => {
      if (!user) throw new Error("Unauthorized");

      const location = await prisma.location.findUnique({ where: { id: locationId } });
      if (!location) throw new Error("Location not found");

      const distance = getDistanceFromLatLonInMeters(lat, lng, location.lat, location.lng);
      if (distance > location.radius) throw new Error("Outside allowed perimeter");

      const lastEvent = await prisma.clockEvent.findFirst({
        where: { userId: user.id },
        orderBy: { timestamp: 'desc' }
      });
      if (!lastEvent || lastEvent.type !== "IN") throw new Error("Not clocked in");

      return prisma.clockEvent.create({
        data: {
          userId: user.id,
          locationId,
          type: "OUT",
          lat,
          lng,
          note
        },
        include: { user: true, location: true }
      });
    }
  },

  ClockEvent: {
    user: async (parent, _, { prisma }) => prisma.user.findUnique({ where: { id: parent.userId } }),
    location: async (parent, _, { prisma }) => prisma.location.findUnique({ where: { id: parent.locationId } }),
    timestamp: parent => parent.timestamp.toISOString()
  }
};

function getDistanceFromLatLonInMeters(lat1, lon1, lat2, lon2) {
  const R = 6371e3;
  const toRad = deg => deg * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
            Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

module.exports = { typeDefs, resolvers };
