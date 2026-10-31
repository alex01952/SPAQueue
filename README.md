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

## Reclub Names

Registration and profile editing display **Reclub Name**, while API payloads still use `reClubId` and existing Azure Table member entities still store `ReclubId`. Enter the name used in Reclub, not an identifier. If another account here already uses that name, players must update their name in Reclub to a unique name and use it here. The application does not change or verify names on Reclub itself.

Both forms check availability as the name is entered and block submission while the check is pending, fails, or finds a duplicate. Registration retains its required field; the edit form still allows an empty name. Comparisons are **case-sensitive** and ignore surrounding whitespace: `Alex` and `alex` are different, but ` Alex ` and `Alex` are the same. Profile checks exclude the signed-in member's own record, so keeping your name is allowed unless another account also has it.

`GET /members/reclub-name-availability?name=...` returns only `{ available }` for registration. `GET /members/me/reclub-name-availability?name=...` requires a member session and excludes only that session's member ID. Both disable caching. The registration and profile-save APIs repeat the check and return `409 Conflict` for duplicate names; storage failures block saving rather than treating the name as available. Checks include all member statuses, not only approved accounts.

This uses the existing table without schema changes, reservation entities, or database uniqueness constraints. Each nonempty-name check reads `RowKey` and `ReclubId` from the `members` partition and trims existing values for compatibility. It is not an atomic uniqueness guarantee: simultaneous submissions or direct storage edits can still introduce duplicates. Existing duplicates are not migrated automatically.

## Balance staff and email reminders

The `balance-staff` account role can open **Member balances** (`/member-balances`) and list, add, edit and delete member balances, and send balance reminder emails. It does not grant other administrator pages or APIs; normal member features remain available. Administrators retain all balance permissions. To assign/revoke access, sign in as an admin, open **Member balances**, select the staff member and choose **Grant balance staff access** or **Remove balance staff access**. These controls are only shown for regular member/balance-staff accounts, not admins or club owners. Roles are mutually exclusive, and only admins can change them through `PATCH /members/:memberId/role`.

Select a member and click **Remind by email** to email all current unpaid balance records, dates, types, amounts and the total in PHP. Existing balances have no paid flag: settled records should be removed or adjusted using the existing controls. Credits/negative adjustments are included in the total; reminders require a positive outstanding total. The email uses the member's stored email address and existing Mailgun configuration (`MAILGUN_API_KEY`, `MAILGUN_DOMAIN`, `EMAIL_FROM`, optional `MAILGUN_BASE_URL`), and links to **My balances** using the existing public application URL.

Each member can receive at most one reminder trigger in any **24-hour period**, shared across all admins, staff, tabs and API instances. The next allowed time is displayed in the staff member's local time. `GET /members/:memberId/balance-reminder` reads the cooldown; `POST /members/:memberId/balance-reminder` triggers delivery. Both require admin/balance-staff access. Reminder reservations are stored in the existing members table, partition `balance-reminders`, row key equal to the member ID; no new table or credentials are needed. Atomic creation/ETag updates prevent simultaneous triggers. The reservation is saved **before** contacting Mailgun, so a failed or uncertain delivery attempt also consumes the 24-hour window to prevent accidental duplicate emails. Delivery errors are surfaced explicitly and never reported as successful. Reload reminder status after an interrupted request to check its cooldown.

## Manual member points

Admins and `balance-staff` can open **Member points** from Member Home (`/member-points`). Select a member to review their balance and paginated award history. Only members with currently active Gold membership can receive new awards; history remains accessible to staff after expiry. This first release has no member self-service points page, automatic awards, redemption, editing, deletion, or reversals.

The existing storage account setting `MEMBERS_AZURE_STORAGE_ACCOUNT` is used with `DefaultAzureCredential`. Set `MEMBER_POINTS_AZURE_TABLE=MemberPoints` (also the default); create the table before use and grant the API identity **Storage Table Data Contributor** access. No changes are made to member entities. Configure these case-sensitive environment variables as positive whole numbers, then restart/redeploy the API:

```dotenv
Open_Play_Point=10
Court_Rental_Point=5
```

These are illustrative values, not application defaults. Missing values disable that standard award type; invalid configured values are reported explicitly. A Custom Award still works with absent standard settings. Standard amounts come only from the server configuration; the actual awarded amount is stored permanently in the ledger, so subsequent configuration changes do not alter history.

Three manual sources are supported:

- **Open Play Participation:** date earned and schedule name, using `Open_Play_Point`. Each member can earn once per date + schedule name. Leading/trailing spaces, repeated whitespace, and capitalization are normalized for duplicate detection. Different sessions on one date must have distinct names. Renaming a session creates a different identity, so staff must use consistent names.
- **Court Rental:** date earned, start hour (`0`–`23`), and positive whole-number court number, using `Court_Rental_Point`. Each slot is exactly one hour; `16` means 4–5 PM, and `23` means 11 PM–midnight the next day. Enter each hour of a multi-hour rental separately. Duplicate detection uses member + date + hour + court.
- **Custom Award:** date earned, a positive whole-number amount and a required reason (up to 1,000 characters). This is a separate source, not a way to override a standard activity's duplicate check. Its request ID prevents retry duplicates; staff must check history to avoid entering the same discretionary award again as a new request.

Activity dates are `YYYY-MM-DD` dates in **Asia/Manila**, with no future dates. They must be on or before Gold expiry. Current Gold eligibility follows the application's existing inclusive UTC expiry-date rule. A membership start date is not stored, so historical awards are not validated against when Gold membership began. Separate UTC audit timestamps record when staff entered the award, along with their member ID and name.

API endpoints (admin/balance-staff session required):

- `GET /member-points/config` returns `{ openPlayPoints, courtRentalPoints }`.
- `GET /member-points/:memberId?continuation=...` returns `{ memberId, memberName, goldMembershipExpiresOn, balance, awards, continuationToken }`, with up to 50 awards per page, newest activity date first. Same-day activities have deterministic key ordering, not entry-time ordering.
- `POST /member-points/:memberId` accepts `{ requestId, source, activityDate, scheduleName? , startHour?, courtNumber?, points?, reason? }`. Use a UUID request ID. Retry the same request with unchanged details after an uncertain response; do not generate a new ID. Reusing an ID with different details or awarding a duplicate standard activity returns `409 Conflict`. Successful retries return the original award, including its original amount.

`MemberPoints` uses the member ID as `PartitionKey`. Each immutable `award:...` ledger entity stores `TransactionType=Earn`, the source, activity details, points, reason, request ID and actor audit fields. A `request:...` entity tracks idempotency, and a `balance` entity maintains the total. These three writes occur in a single Azure Table transaction; ETag checks and bounded conflict retries prevent lost balance updates. A duplicate award never increments the balance. Missing-table and permission failures are surfaced, not treated as an empty history.

The UI prevents double submission and reuses an unconfirmed request ID while the page remains open. Check history before reloading or leaving after an uncertain submission, especially for Custom Awards: a new page session generates a new request ID. Staff should verify all details before awarding because correction and redemption workflows are intentionally deferred.

## Gold (paid) memberships

Admins can open a member from **Members / Club directory** and use **Gold membership** on their profile to grant, renew, or remove paid membership. This is separate from account roles and does not grant administrator or staff permissions.

The default **1 year from today** term sets expiry to the same calendar date next year (February 29 becomes February 28 in a non-leap year). **Custom expiry date** accepts today or a later date. Renewals start from today, not from the previous expiry. Dates are UTC calendar dates, inclusive through the end of the selected day. Active members have a gold photo/card frame and a **Gold member** label in the directory (including search results) and member profiles, including embedded profile views. Expired members retain their saved expiry date but render without the gold frame.

`PATCH /members/:memberId/gold-membership` requires an admin member session. Send `{}` for one year, `{ "expiresOn": "2027-10-28" }` for a custom date, or `{ "expiresOn": null }` to remove it. The response is `{ memberId, goldMembershipExpiresOn }`. The optional `GoldMembershipExpiresOn` property is merged into the existing Azure Table member record; no migration, new table, or credentials are required. Existing members without this field remain regular members. Member profiles, sessions, account responses, and the directory include `goldMembershipExpiresOn` when set; membership is active only through that date, without needing a scheduled expiration job.

### Gold membership email templates

The admin profile form lists `.html` blobs under `email-templates/` in the container configured by `OP_PARTICIPATION_AZURE_CONTAINER` (`spa`) in `OP_PARTICIPATION_AZURE_STORAGE_ACCOUNT` (`seeturtlesphsa`). This path is relative to the container root, not the participation year prefix. Upload or replace templates there without redeploying, then select **Reload email templates**. Filenames (including any subfolders) appear in the selector. `GET /admin/gold-membership/email-templates` requires an admin session and returns `{ name, displayName }[]` with caching disabled.

Select **Do not send an email** to preserve the existing save-only behavior, or choose a template to submit an email when saving or renewing membership. The PATCH body accepts an optional `"emailTemplate": "email-templates/gold-membership-beta.html"` alongside the expiry settings. Removing membership never sends email. Delivery uses the member's stored, verified email and the existing Mailgun configuration. The API reads blobs using `DefaultAzureCredential`; grant the application's identity blob read/list access (for example, **Storage Blob Data Reader** on the container). Public blob listing and browser storage credentials are not required.

Templates must be UTF-8 HTML between 1 and 60,000 bytes. Use `{{expiresOn}}` for the inclusive UTC expiry date (`YYYY-MM-DD`) and optionally `{{memberName}}` for the member's name; whitespace inside placeholders is accepted, other placeholders are rejected, and substituted values are HTML-escaped. Inline email styling is preserved and a plain-text alternative is generated. Only trusted administrators should be able to upload templates; HTML is used as authored, not passed through the announcement editor's sanitizer. The subject defaults to **Welcome to Gold Membership!**; optionally set the blob's `subject` metadata to a nonempty value of at most 200 characters without line breaks.

Configuration, recipient and template validation happens before membership changes. Email submission happens only after membership is persisted, with a 30-second timeout and no automatic retries. When email is requested, the result also includes `emailStatus: "accepted"` (accepted by Mailgun, not guaranteed inbox delivery) or `"unconfirmed"` (membership saved, email failed or acceptance could not be confirmed). The UI displays an explicit warning for unconfirmed submissions. Check Mailgun logs before saving again with a template selected; another save requests another email. A lost HTTP response can also leave both membership and email submission completed, so check the member's profile and Mailgun logs before retrying.

## Email announcements

Administrators can open **Email announcements** from Member Home (`/email-announcements`). The page and all announcement APIs require the `admin` role; club owners, balance staff, and regular members cannot send announcements or read the announcement recipient directory.

Choose **All members**, **Members of a specific club**, or **Specific users**. Recipients must be approved members with verified, valid email addresses. Club targeting uses current club assignments, not the profile's club display name. Selected users who become ineligible are rejected rather than silently omitted. Each distinct email address receives one private copy, even when several members share that address.

The HTML editor supports formatting buttons for headings, paragraphs, bold, italic, underline, lists, and links. Paste/edit HTML directly and select **Preview and count recipients** to review the server-sanitized email and plain-text alternative. Subjects are limited to 200 characters and message HTML to 60,000 UTF-8 bytes. Scripts, images, custom styles, forms, and unsafe links are removed. The preview shows the exact number of Mailgun emails before confirmation; 50 distinct recipients consume 50 emails. Changed content or recipient addresses require a new preview.

Sending reuses `MAILGUN_API_KEY`, `MAILGUN_DOMAIN`, `EMAIL_FROM`, and optional `MAILGUN_BASE_URL`. No new credentials or tables are needed. Send reservations and progress use the existing members table with partition `email-announcements` and a unique request-ID row key. Atomic reservation prevents the same send request from running twice, including concurrent requests. Emails are submitted privately with up to five concurrent submissions and a 30-second timeout per submission. There are no automatic delivery retries.

The result distinguishes emails **accepted by Mailgun** from **failed or unconfirmed** submissions; accepted does not guarantee inbox delivery. Keep the page open while sending. The last request ID is retained in the browser tab's session storage, so **Check send status** can recover progress after a lost response or reload. If the API process stops, a reservation may remain in `sending`; counts represent the last saved batch and an interrupted send is not automatically resumed. Check Mailgun logs before sending again: an unconfirmed submission may already have been accepted. Starting a new announcement does not cancel an existing send.

Admin endpoints (cookie-authenticated, private/no-store responses):

- `GET /admin/email-announcements/recipients`: eligible members, names and email addresses.
- `POST /admin/email-announcements/preview`: `{ subject, html, audience }`, where audience is `{ mode: "all" }`, `{ mode: "club", clubId }`, or `{ mode: "users", memberIds }`; returns sanitized HTML/text, recipient count, and a confirmation fingerprint.
- `POST /admin/email-announcements/send`: the same payload plus the preview's `fingerprint` and a UUID v4 `requestId`; resolves current recipients again, verifies the fingerprint, reserves the request, and sends.
- `GET /admin/email-announcements/:requestId`: persisted `status`, `total`, `accepted`, and `unconfirmed` counts.

## Tournament registrations

Roster gender requirements include the member sending the invitations:

- Mens Doubles: two male players.
- Mixed Doubles: one male and one female player; either player can send the invitation.
- Womens Doubles: two female players.
- Team Tournament: four players, exactly two male and two female.

Tournament slot counts include approved teams only (statuses **Approved**, **Payment Submitted**, and **Paid**). **Invitation Pending** and **Pending Approval** entries are shown separately as pending and do not reserve slots. New registrations remain open until approved teams reach the maximum; admins cannot approve additional teams once that limit is reached. Declined entries count toward neither total.

Each player must upload a school, government, or company ID (PDF, JPEG, or PNG, up to 10 MB): the sender when registering and each invitee when accepting. Players may optionally list club memberships and officers who can verify eligibility, including the club, officer's name, and contact details if possible (up to 4,000 characters). Registration and acceptance use multipart form data with `idFile`, optional `clubDetails`, and JSON-encoded questionnaire/consent fields. Declining still accepts JSON and needs no ID. Existing registrations remain reviewable without retroactive uploads.

IDs use the existing private tournament document storage and managed identity, under `tournament-player-ids/`. Only administrators receive the ID links and club details, in the approval queue, registration browser, and archived registration details. ID downloads are administrator-only, authenticated, and non-cacheable; teammates cannot access them. Archiving preserves the documents; permanent tournament deletion removes their blobs and versions along with the other tournament data.

In **Tournament management**, select **Export approved teams (CSV)** for an event to download its current Approved, Payment Submitted, and Paid teams. The export fetches fresh records through the existing administrator-only registration API and includes one row per team: tournament details, registration ID/status/timestamps, and up to four player IDs and names (unused player columns are blank for doubles). Empty rosters produce a header-only file. The UTF-8 CSV supports commas, quotes and line breaks in names; formula-like cells are prefixed with an apostrophe for spreadsheet safety. This is a team-list backup, not a complete database backup: it excludes uploaded files, questionnaires, protests and schedules, and has no automatic restore/import feature.

Tournament definitions and team registrations are stored in Azure Tables using the member storage account. Configure `TOURNAMENTS_AZURE_TABLE` (default `Tournaments`) and `TOURNAMENT_REGISTRATIONS_AZURE_TABLE` (default `TournamentRegistrations`) alongside `MEMBERS_AZURE_STORAGE_ACCOUNT` and the existing member-table settings. Both tables must exist before members use tournament registration.

Admins can attach an optional terms and conditions PDF (up to 10 MB) when creating a tournament. The document uses the same private blob storage and managed-identity configuration as payment proofs and is viewable by authenticated members through a link that opens in a separate browser tab/window. When terms exist, the sender and every invited player must select **I Agree** before submitting or accepting; the API enforces agreement and stores each player's acceptance timestamp. Declining does not require agreement. Existing tournaments and new tournaments without a document do not require agreement. Terms cannot be replaced after creation.

Payment-proof uploads use the existing `OP_PARTICIPATION_AZURE_STORAGE_ACCOUNT` and `OP_PARTICIPATION_AZURE_CONTAINER` settings with managed-identity credentials. After approval, every roster member may upload a PDF, JPEG, or PNG up to 10 MB. Each player has one current proof; a replacement updates only that player's proof. Other members may still upload after the first submission. Proofs are served through an authenticated API endpoint for team members and admins, so the blob container need not be public. Existing single-proof registrations remain viewable.

In **Tournament management → View registrations & payments**, admins can view each uploaded proof and mark an approved registration **Paid** at any time, with zero, some, or all proofs present. Uploading a proof sets **Payment Submitted**, not **Paid**. Only admins can confirm payment. Once Paid, players cannot upload/replace proofs or cancel; admins may still remove the registration after confirmation (this does not issue a refund).

Before payment is confirmed, any team member can cancel an active registration, including one with submitted proofs. The confirmation warns that leaving cancels the registration for the entire team. Cancellation removes the entry, releases its slot, and allows all members to register again.

Admins can close and reopen registration from **Tournament management** (`PATCH /admin/tournaments/:tournamentId/registration-status`). While closed, new registrations and invitation acceptance are blocked; declining invitations and admin actions still work.

Once registration is closed, confirmed participants (registrations that are Approved, Payment Submitted, or Paid) can open the tournament roster (`GET /tournaments/:tournamentId/roster`), which lists confirmed teams with each player's name and gender. Admins can view the roster at any time and can remove a team or replace a player from the roster. Replacement candidates must be approved members who are neither registered nor invited for that tournament, and must preserve the category’s gender composition. From the roster, a confirmed participant may protest a player on another team (`POST /tournaments/:tournamentId/protests`, multipart) by choosing the eligibility or terms requirement not met, giving a detailed reason, and attaching 1–5 evidence files (PDF, JPEG, PNG, DOC, or DOCX, up to 10 MB each). Players cannot protest themselves or teammates, and only one open protest per player pair is allowed. Protests are stored in the Azure Table configured by `TOURNAMENT_PROTESTS_AZURE_TABLE` (default `TournamentProtests`; the API creates it when the first protest is filed); evidence uses the payment-proof blob storage. Admins review protests on **/tournament-protests** (`GET /admin/tournament-protests`), view evidence, and mark each protest **Upheld** or **Dismissed** with an optional note (`PATCH /admin/tournaments/:tournamentId/protests/:protestId`).

Cross-origin cancellation requires `DELETE` in the API's allowed CORS methods. An `OPTIONS` preflight returning `204 No Content` is normal; its allowed-methods header must include `DELETE` for the browser to send the cancellation request.

On the Tournament Roster page, click any player's name to open the existing embedded profile popup without leaving the roster. Close the popup to return to the same roster and any in-progress protest or replacement form.

## Tournament pools and scheduling

Administrators can choose **Plan pools & schedule** from tournament management or the tournament roster. The planner starts with the existing confirmed teams (Approved, Payment Submitted, and Paid); it never rematches partners and supports both doubles and four-player Team Tournament rosters.

Choose the number of pools, then **Randomize pools** to distribute teams evenly. Each pool must contain at least two teams. Choose the number of courts and **Generate schedule** for one round-robin match per pair within each pool. A team never plays twice in the same time slot; resting teams are preferred when possible. Equally sized pools use dedicated courts when the court and pool counts match. Time slots represent match order, not clock times.

Both steps save immediately and are shared across administrator sessions. Re-randomizing pools clears the saved schedule; replacing a saved draw or schedule requires confirmation. Roster changes invalidate the saved draw, requiring fresh pools before generating another schedule. Concurrent administrator updates return a conflict instead of silently overwriting a newer draw; use **Reload saved draw** to refresh.

The admin-only endpoints are `GET /admin/tournaments/:tournamentId/planning`, `POST /admin/tournaments/:tournamentId/planning/pools` (`poolCount`, `version`), and `POST /admin/tournaments/:tournamentId/planning/schedule` (`courtCount`, `version`). Draw JSON uses the existing private tournament-document blob storage under `tournament-draws/`; the existing tournaments table stores its blob reference (`DrawBlobName`). No new table or credentials are required.

## Live tournament pool draws

From tournament management or the pool planner, use **Schedule / view live pool draw** (`/tournaments/:tournamentId/live-draw`). Administrators must close registration, confirm the finalized roster, choose the pool count (at least two teams per pool), and schedule a time at least one minute ahead. Scheduling clears any saved pools and match schedule. Confirmed participants can join from their tournament registration or roster; login is required. Partners stay together.

The shared server-authoritative timeline is:

1. Countdown to the scheduled start.
2. A 10-second animated draw, then the same initial pools appear for everyone.
3. A fixed **60-second voting window**, with totals hidden. Each eligible player can cast one irreversible vote to reroll. Not voting keeps the first draw.
4. A **10-second vote-results reveal** showing totals and whether a reroll was approved, before any next action.
5. A strict majority triggers **at most one** 10-second reroll animation; otherwise the original pools become final. The result panel remains visible. Final pools save into the normal planner, where administrators choose courts and generate matches. Manual pool randomization is blocked while a valid live event controls the pools.

Eligibility is fixed at the start: a confirmed player must have sent a presence heartbeat in the preceding 15 seconds. Leave the page open before the countdown ends; late arrivals may watch but cannot vote. Each member counts once across tabs/devices. The majority denominator stays fixed even if players disconnect; a tie or no attendees keeps the initial draw. Reconnecting restores the persisted state and any recorded vote. Roster changes or reopening registration invalidate the live event and require rescheduling.

This first version uses authenticated polling every 3–4 seconds with extra refreshes at phase boundaries and a server-clock-adjusted countdown, not WebSockets or frame-perfect synchronization. Network delays and throttled background tabs can delay visual transitions; the server alone enforces deadlines. Stages advance on requests using absolute UTC timestamps, so API restarts or an empty page do not reset the event. There is no background job: when nobody is watching, the next request catches up and publishes final pools. Randomization is server-side, not a publicly verifiable draw.

The admin scheduling form appears once the first live-draw request loads, even before an event is scheduled. Requests allow up to 30 seconds for storage-backed responses. Connection errors distinguish timeouts, unreachable APIs and HTTP failures; a failed refresh retains the form but disables scheduling/voting until reconnection. If a submission times out, reconnect to confirm whether it was saved before trying again.

Endpoints: `GET /tournaments/:id/live-draw`, `POST /tournaments/:id/live-draw/presence`, `POST /tournaments/:id/live-draw/vote` (`eventId`), and admin-only `POST /admin/tournaments/:id/live-draw` (`scheduledAt`, `poolCount`, `rosterFinalized: true`, `expectedEventId`, initially `null`). Private blobs under `tournament-live-draws/:tournamentId/` store the event, attendance, votes and draws. The tournaments row stores `LiveDrawBlobName` and `LiveDrawPublishedVersion`. Blob ETags protect simultaneous votes; table ETags protect event replacement and final publication. No new dependencies, tables or credentials are required; the existing storage identity needs blob read/write permissions. Archive retains these blobs and final pools; permanent deletion cleans up all live-event versions as well.

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