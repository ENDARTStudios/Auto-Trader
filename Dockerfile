# Dockerfile for Auto Trader CI/test environment
# Uses Node.js 20 LTS on Debian for full Unix socket support
FROM node:20-slim

WORKDIR /app

# Install dependencies
COPY package*.json bun.lock ./
RUN npm ci

# Copy source files
COPY . .

# Generate Prisma client
RUN npx prisma generate

# Build the application
RUN npm run build

# Run tests by default
CMD ["npm", "run", "test:ci"]