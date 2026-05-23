# Pickleball Queue

This workspace is set up as a production-capable prototype for a pickleball queueing app.

## Chosen stack

- Frontend: Angular
- Backend: NestJS
- Current storage: in-memory data in the API service
- Recommended next storage layer: PostgreSQL with Prisma

This keeps the first version easy to change while preserving an API shape you can keep when you move to a real database.

## Current MVP behavior

- Lists registered players with DUPR ratings
- Lets you check players in and out as ready for the next game
- Tracks ongoing games and excludes those players from the next selection
- Shows a suggested next game from the ready, non-playing players
- Tracks recent completed games

## Run locally

Start the API:

```powershell
cd api
npm run start:dev
```

Start the frontend in a second terminal:

```powershell
cd frontend
npm start
```

Frontend runs on http://localhost:4200 and the API runs on http://localhost:3000.

## Suggested next steps

1. Replace in-memory arrays with PostgreSQL and Prisma models for players, games, courts, and check-ins.
2. Add a queue policy layer so you can evolve selection rules without changing controllers.
3. Add authentication and saved venues if the app will be shared across clubs or sessions.