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

  app.use(cors({
    origin: function (origin, callback) {
      // Allow no-origin requests (SSR, curl, mobile apps)
      if (!origin) return callback(null, true);

      // ✅ Dev mode: allow any origin
      if (process.env.NODE_ENV !== 'production') {
        return callback(null, true);
      }

      // ✅ Prod mode: strict check
      if (allowedOrigins.some(allowed => origin.startsWith(allowed))) {
        return callback(null, true);
      }

      console.warn(`🚫 CORS blocked: ${origin}`);
      return callback(new Error('CORS policy violation'));
    },
    credentials: true,
  }));

  // Health check
  app.get('/', (req, res) => res.send('SMATE GraphQL server is running'));

  const server = new ApolloServer({
    typeDefs,
    resolvers,
    context: async ({ req }) => {
      const auth = req.headers.authorization || '';
      let user = null;
      let decoded = null;

      if (auth.startsWith('Bearer ') && auth.length > 7) {
        const token = auth.split(' ')[1];
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
        } catch (e) {
          console.warn('JWT verify failed:', e.message);
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

start().catch(err => {
  console.error(err);
  process.exit(1);
});
