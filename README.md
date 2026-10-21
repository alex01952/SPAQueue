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

## Tournament registrations

Roster gender requirements include the member sending the invitations:

- Mens Doubles: two male players.
- Mixed Doubles: one male and one female player; either player can send the invitation.
- Womens Doubles: two female players.
- Team Tournament: four players, exactly two male and two female.

Tournament slot counts include approved teams only (statuses **Approved**, **Payment Submitted**, and **Paid**). **Invitation Pending** and **Pending Approval** entries are shown separately as pending and do not reserve slots. New registrations remain open until approved teams reach the maximum; admins cannot approve additional teams once that limit is reached. Declined entries count toward neither total.

Tournament definitions and team registrations are stored in Azure Tables using the member storage account. Configure `TOURNAMENTS_AZURE_TABLE` (default `Tournaments`) and `TOURNAMENT_REGISTRATIONS_AZURE_TABLE` (default `TournamentRegistrations`) alongside `MEMBERS_AZURE_STORAGE_ACCOUNT` and the existing member-table settings. Both tables must exist before members use tournament registration.

Admins can attach an optional terms and conditions PDF (up to 10 MB) when creating a tournament. The document uses the same private blob storage and managed-identity configuration as payment proofs and is viewable by authenticated members through a link that opens in a separate browser tab/window. When terms exist, the sender and every invited player must select **I Agree** before submitting or accepting; the API enforces agreement and stores each player's acceptance timestamp. Declining does not require agreement. Existing tournaments and new tournaments without a document do not require agreement. Terms cannot be replaced after creation.

Payment-proof uploads use the existing `OP_PARTICIPATION_AZURE_STORAGE_ACCOUNT` and `OP_PARTICIPATION_AZURE_CONTAINER` settings with managed-identity credentials. After approval, every roster member may upload a PDF, JPEG, or PNG up to 10 MB. Each player has one current proof; a replacement updates only that player's proof. Other members may still upload after the first submission. Proofs are served through an authenticated API endpoint for team members and admins, so the blob container need not be public. Existing single-proof registrations remain viewable.

In **Tournament management → View registrations & payments**, admins can view each uploaded proof and mark an approved registration **Paid** at any time, with zero, some, or all proofs present. Uploading a proof sets **Payment Submitted**, not **Paid**. Only admins can confirm payment. Once Paid, players cannot upload/replace proofs or cancel; admins may still remove the registration after confirmation (this does not issue a refund).

Before payment is confirmed, any team member can cancel an active registration, including one with submitted proofs. The confirmation warns that leaving cancels the registration for the entire team. Cancellation removes the entry, releases its slot, and allows all members to register again.

Admins can close and reopen registration from **Tournament management** (`PATCH /admin/tournaments/:tournamentId/registration-status`). While closed, new registrations and invitation acceptance are blocked; declining invitations and admin actions still work.

Once registration is closed, confirmed participants (registrations that are Approved, Payment Submitted, or Paid) can open the tournament roster (`GET /tournaments/:tournamentId/roster`), which lists confirmed teams with each player's name and gender. Admins can view the roster at any time and can remove a team or replace a player from the roster. Replacement candidates must be approved members who are neither registered nor invited for that tournament, and must preserve the category’s gender composition. From the roster, a confirmed participant may protest a player on another team (`POST /tournaments/:tournamentId/protests`, multipart) by choosing the eligibility or terms requirement not met, giving a detailed reason, and attaching 1–5 evidence files (PDF, JPEG, PNG, DOC, or DOCX, up to 10 MB each). Players cannot protest themselves or teammates, and only one open protest per player pair is allowed. Protests are stored in the Azure Table configured by `TOURNAMENT_PROTESTS_AZURE_TABLE` (default `TournamentProtests`; the API creates it when the first protest is filed); evidence uses the payment-proof blob storage. Admins review protests on **/tournament-protests** (`GET /admin/tournament-protests`), view evidence, and mark each protest **Upheld** or **Dismissed** with an optional note (`PATCH /admin/tournaments/:tournamentId/protests/:protestId`).

Cross-origin cancellation requires `DELETE` in the API's allowed CORS methods. An `OPTIONS` preflight returning `204 No Content` is normal; its allowed-methods header must include `DELETE` for the browser to send the cancellation request.

## Tournament pools and scheduling

Administrators can choose **Plan pools & schedule** from tournament management or the tournament roster. The planner starts with the existing confirmed teams (Approved, Payment Submitted, and Paid); it never rematches partners and supports both doubles and four-player Team Tournament rosters.

Choose the number of pools, then **Randomize pools** to distribute teams evenly. Each pool must contain at least two teams. Choose the number of courts and **Generate schedule** for one round-robin match per pair within each pool. A team never plays twice in the same time slot; resting teams are preferred when possible. Equally sized pools use dedicated courts when the court and pool counts match. Time slots represent match order, not clock times.

Both steps save immediately and are shared across administrator sessions. Re-randomizing pools clears the saved schedule; replacing a saved draw or schedule requires confirmation. Roster changes invalidate the saved draw, requiring fresh pools before generating another schedule. Concurrent administrator updates return a conflict instead of silently overwriting a newer draw; use **Reload saved draw** to refresh.

The admin-only endpoints are `GET /admin/tournaments/:tournamentId/planning`, `POST /admin/tournaments/:tournamentId/planning/pools` (`poolCount`, `version`), and `POST /admin/tournaments/:tournamentId/planning/schedule` (`courtCount`, `version`). Draw JSON uses the existing private tournament-document blob storage under `tournament-draws/`; the existing tournaments table stores its blob reference (`DrawBlobName`). No new table or credentials are required.

## Tournament archive and permanent deletion

Administrators can **Archive** or **Delete permanently** from tournament management. Both actions require confirmation and block repeat clicks while processing; neither issues refunds.

Archiving copies the tournament and all registration/payment metadata and protest records into `TournamentArchive`, then removes their original rows from `Tournaments`, `TournamentRegistrations`, and `TournamentProtests`. Uploaded terms, payment proofs, protest evidence and saved pool/schedule blobs are retained. Configure `TOURNAMENT_ARCHIVE_AZURE_TABLE` to override the default `TournamentArchive` table, which must exist in the member storage account. The existing managed identity needs read/write/delete table access and blob read/list/delete access.

Use **View archived tournaments** on tournament management (`/tournament-archive`) for admin-only, read-only tournament details, registrations, confirmed roster, payment proofs, protests/evidence, pools and schedules. Archive records cannot be approved, paid, edited, cancelled or protested through active tournament endpoints. Permanent deletion is also available on the archive page.

Permanent deletion removes the tournament's active and archived rows, related registration/protest rows, and every blob under its terms, payment-proof, protest-evidence and draw prefixes, including superseded/orphaned uploads, snapshots and versions. Azure soft-delete retention, backups, legal holds and immutable storage policies remain governed by the storage account; the application cannot erase retained service backups or bypass retention. No unrelated member profiles or other tournaments are deleted.

Cross-table/blob operations cannot use one atomic Azure transaction. A lifecycle marker blocks new active mutations, copies are completed before source rows are removed, and failures return an explicit error. Retry the same action to resume an interrupted operation; the original tournament row remains until cleanup completes. Operations already in flight when archival/deletion starts should be allowed to finish before retrying.

Endpoints: `POST /admin/tournaments/:id/archive`, `DELETE /admin/tournaments/:id`, `GET /admin/tournament-archive`, `GET /admin/tournament-archive/:id`, and `DELETE /admin/tournament-archive/:id`. Private archive document endpoints are administrator-only.

## Player profile validations

Club officers can open **Player Validations** to review members of clubs they manage, visit each member profile, and validate a member's listed profile and statistics. A validation is permitted only when both the officer and player currently belong to the same club; officers cannot validate themselves. Each officer has one validation record per player and club, so validating again refreshes the validation date. The profile shows every validation with the officer name, club, and validation date. When a player changes a skill rating or DUPR ID, the edit page requires confirmation and the API removes their existing officer validations after the profile update succeeds. Configure `PLAYER_REVIEWS_AZURE_TABLE` when a different Azure Table name is required; it defaults to `PlayerReviews`, which must exist alongside the other member tables.

## Email verification

New registrations receive a single-use verification link that expires after `EMAIL_VERIFICATION_TTL_MINUTES` (60 minutes by default; minimum 5 minutes). A pending, unverified registrant can enter their email on the login page to request a replacement link. Resending invalidates their older verification links before sending the new one. Administrators cannot approve a registration until its email has been verified.

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