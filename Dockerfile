# ==========================================
# Stage 1: Build stage
# ==========================================
FROM node:20-alpine AS builder

WORKDIR /usr/src/app

# Set dummy DATABASE_URL for build-time Prisma commands (like prisma generate)
ENV DATABASE_URL=postgresql://dummy:dummy@localhost:5432/dummy


# Copy dependency configuration
COPY package*.json ./
COPY prisma ./prisma/

# Install dependencies (including devDependencies)
RUN npm ci

# Generate Prisma Client
RUN npx prisma generate

# Copy the rest of the application files
COPY . .

# Compile TypeScript and NestJS assets
RUN npm run build

# ==========================================
# Stage 2: Production runner stage
# ==========================================
FROM node:20-alpine AS runner

WORKDIR /usr/src/app

# Set environments
ENV NODE_ENV=production
ENV PORT=3000

# Copy package config and prisma schema for migration running
COPY package*.json ./
COPY prisma ./prisma/

# Install only production dependencies
RUN npm ci --only=production && npm cache clean --force

# Copy Prisma Client generated artifact and dist compiled files from builder
COPY --from=builder /usr/src/app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /usr/src/app/node_modules/@prisma/client ./node_modules/@prisma/client
COPY --from=builder /usr/src/app/dist ./dist

# Expose port (default Elastic Beanstalk maps proxy to port 3000 by default or uses PORT env)
EXPOSE 3000

# Before starting the app, run any pending migrations to keep Postgres database in sync
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/src/main.js"]
