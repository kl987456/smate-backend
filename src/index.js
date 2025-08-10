// backend/src/index.js
const express = require('express');
const cors = require('cors');
const { ApolloServer } = require('apollo-server-express');
const { PrismaClient } = require('@prisma/client');
const dotenv = require('dotenv');
const { typeDefs, resolvers } = require('./schema');
const { verifyToken } = require('./jwtVerify');

dotenv.config();

const prisma = new PrismaClient();

async function start() {
  const app = express();

  const allowedOrigins = [
    process.env.FRONTEND_URL || 'http://localhost:3000'
  ];

  if (!process.env.FRONTEND_URL) {
    console.warn('⚠️ FRONTEND_URL not set, defaulting to http://localhost:3000');
  }

  app.use(cors({
    origin: function (origin, callback) {
      if (!origin) return callback(null, true); // SSR, curl, mobile

      if (process.env.NODE_ENV !== 'production') {
        return callback(null, true); // Dev mode: allow all
      }

      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      console.warn(`🚫 CORS blocked: ${origin}`);
      return callback(new Error('CORS policy violation'));
    },
    credentials: true,
  }));

  app.get('/', (req, res) => res.send('SMATE GraphQL server is running'));

  const server = new ApolloServer({
    typeDefs,
    resolvers,
    context: async ({ req }) => {
      const authHeader = req.headers.authorization || '';
      let user = null;
      let decoded = null;

      if (authHeader.startsWith('Bearer ')) {
        const token = authHeader.slice(7).trim();
        try {
          decoded = await verifyToken(token);
          if (decoded?.sub) {
            user = await prisma.user.findUnique({
              where: { auth0Id: decoded.sub }
            });

            if (!user) {
              const email = decoded.email || `${decoded.sub}@auth.local`;
              const name = decoded.name || decoded.nickname || null;
              user = await prisma.user.create({
                data: { auth0Id: decoded.sub, email, name }
              });
            }
          }
        } catch (err) {
          console.warn('JWT verify failed:', err.message);
        }
      }

      return { prisma, user, decoded };
    }
  });

  await server.start();
  server.applyMiddleware({ app, path: '/graphql' });

  const port = process.env.PORT || 4000;
  app.listen({ port }, () => {
    console.log(`✅ Server ready at http://localhost:${port}${server.graphqlPath}`);
  });
}

process.on('SIGINT', async () => {
  await prisma.$disconnect();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await prisma.$disconnect();
  process.exit(0);
});

start().catch(err => {
  console.error(err);
  process.exit(1);
});
