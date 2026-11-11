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

## Password reset

Members can enter their email on the login screen and select **Forgot password?**. The response is the same whether an account exists or not. Reset links expire after 60 minutes and can be used once; a newer request replaces the previous link, with a one-minute per-account request cooldown. A successful reset signs out existing sessions. Pending registrations still require approval before login.

The API uses the existing members table and Mailgun settings (`MAILGUN_API_KEY`, `MAILGUN_DOMAIN`, `EMAIL_FROM`, optional `MAILGUN_BASE_URL`). Set `PUBLIC_APP_URL` to the public frontend origin so emailed links work. Delivery failures are logged on the API but are not exposed to the requester, to avoid revealing account existence. The API identity needs read/write access to the members table. Expired unused token records are not automatically purged.

## Reclub Names

Registration and profile editing display **Reclub Name**, while API payloads still use `reClubId` and existing Azure Table member entities still store `ReclubId`. Enter the name used in Reclub, not an identifier. If another account here already uses that name, players must update their name in Reclub to a unique name and use it here. The application does not change or verify names on Reclub itself.

Both forms check availability as the name is entered and block submission while the check is pending, fails, or finds a duplicate. Registration retains its required field; the edit form still allows an empty name. Comparisons are **case-sensitive** and ignore surrounding whitespace: `Alex` and `alex` are different, but ` Alex ` and `Alex` are the same. Profile checks exclude the signed-in member's own record, so keeping your name is allowed unless another account also has it.

`GET /members/reclub-name-availability?name=...` returns only `{ available }` for registration. `GET /members/me/reclub-name-availability?name=...` requires a member session and excludes only that session's member ID. Both disable caching. The registration and profile-save APIs repeat the check and return `409 Conflict` for duplicate names; storage failures block saving rather than treating the name as available. Checks include all member statuses, not only approved accounts.

This uses the existing table without schema changes, reservation entities, or database uniqueness constraints. Each nonempty-name check reads `RowKey` and `ReclubId` from the `members` partition and trims existing values for compatibility. It is not an atomic uniqueness guarantee: simultaneous submissions or direct storage edits can still introduce duplicates. Existing duplicates are not migrated automatically.

## Member and admin menus

Member Home groups administrator-only destinations under **Admin** (`/admin`): **Rewards store**, **Email announcements**, **Open Play matching**, **Upload participation**, **Registration approvals**, **Manage clubs**, and **Manage tournaments**. Open **Member Home → Admin → Rewards store** to configure rewards/merchant emails and view all redemptions. The Admin page and its destinations require an authenticated `admin` account; other roles cannot open them directly.

**Member points** and **Member balances** remain on Member Home for both admins and balance staff. **My points & rewards** remains on Member Home for all members. Existing destination URLs continue to work, and admin destinations include an **Admin** breadcrumb for returning to the grouped menu.

## Open Play roster

Admins can prepare one shared roster under **Open Play matching** and select **Save changes** to persist it. The API uses `MEMBERS_AZURE_STORAGE_ACCOUNT` and `DefaultAzureCredential`; `OPEN_PLAY_AZURE_TABLE` defaults to `OpenPlay`. The table must already exist, and the API identity needs **Storage Table Data Contributor** access. Missing tables and storage errors are reported rather than treated as empty rosters.

The current draft is one entity in partition `drafts`, row `current`; it stores player names, categories and linked member IDs, plus the updating admin and timestamp. This is a shared draft, not a history of separate Open Play events, and it does not award points. Admin-only `GET /open-play/draft` and `PUT /open-play/draft` use a revision and conditional table updates to reject stale saves. Changes stay unsaved until the save succeeds; reload requires confirmation when edits are pending. A previous browser-local draft can be restored when the shared roster is empty, then explicitly saved.

Only one Open Play session can be active. Admins start and end sessions from **Open Play matching**; the member board shows player data only while a session is active. Ending requires all matches to be ended or canceled, then presents Gold members from the roster. Participation is preselected for checked-in or match participants; admins can opt other listed members in, exclude candidates or individual awards, or close the review with no awards. Participation and Top 5 each award one point, for up to two points per Gold member per session. **Archive** saves the matches, Top 5, and award review to the pre-created `OpenPlayHistory` table (override with `OPEN_PLAY_HISTORY_AZURE_TABLE`), then clears players, matches and lines while retaining court configuration.

Open Play screens label each player as **Non-member**, **Member**, or **Gold member**. Gold is active through the saved inclusive expiry date, using the same rule as member points.

Authenticated members can open **Open Play board** from Member Home. The read-only `/open-play/board` endpoint returns only the regular and winners lines, Top 5, and two ordered waiting groups: **Next Players** and **On Deck**, each with four player slots. The screen polls every five seconds without generating or reshuffling suggestions. Automatic previews become fixed player IDs when the admin publishes or saves them, and remain fixed through waiting-time updates, match results, reloads, and session start. **Start Game** starts the first group, promotes On Deck unchanged, generates a new non-overlapping group behind it, and saves the match and advanced queue together. With fewer than four eligible players remaining, the new group has open slots instead of repeating reserved or playing players. **Refresh suggestions**, slot swaps, and **Not available** explicitly change the waiting groups. Removing a selected player or marking them inactive clears only their slot, without automatically filling it. Secondary Suggested Players is no longer available, and legacy secondary settings are ignored.

New players default to Not Arrived. Mark a player Active to add them to the end of the normal line; Rest, Left and Not Arrived players are not in either waiting line. Re-activating a player puts them at the end of the normal line. Players in an ongoing match display In Play and are excluded from the visible lines; their status can be changed after the match. Ending a match sends its winning team to the end of the winners line and the other team to the end of the normal line. Canceling a match restores players to their previous lines and positions. Changing the winner of a completed match moves its active players to the appropriate line only when that match is still their most recent completed game. Existing single-line rosters retain their order in the normal line; for rosters without a saved line, previously Active players are placed in roster order because activation times were not recorded.

Admins can add or remove players during play and start doubles matches with four distinct, available Active players; a player cannot be assigned to two ongoing matches. To end a match, select the winning team and optionally enter both scores. Results can be corrected; win/loss totals are derived from completed matches. Match history retains names and linked member IDs after roster removal. Statuses, the player line, matches and results are shared only after **Save changes** succeeds. Scores must be non-negative whole numbers, different from each other and consistent with the chosen winner. The shared roster supports up to 250 players and 250 matches.

Each roster entry shows when the player's most recent completed game ended; an elapsed-since-game label is shown while the player is active and waiting. This is not necessarily time waiting to play because Rest, Left and in-game periods may have occurred since the match. Players with no completed game in the current roster show `No completed games`. Linked members retain their match history when removed and re-added; non-members have no cross-entry identity.

Active waiting time is tracked separately: it starts on activation, pauses during Rest, Left, Not Arrived and In Play, resumes after a canceled match, and resets when a match ends. The lines show waiting time, an above-average indicator compared with other currently waiting players, and a warning at 30 minutes. Existing sessions without bench clocks start from zero when first loaded; save the initialized clocks because earlier resting and waiting periods cannot be reconstructed.

**Next Players** has a persisted **Matching mode** selector. Currently, **Wait-time priority** compares suitable four-player groups from each line and selects the group with the highest combined waiting time. On equal waits, the normal line is selected first. Suggestions favor the same skill level and line, mix lines only when neither line can form a suitable group, and prioritize waits of 30 minutes, waits nearing 30 minutes (25 minutes or more), then above-average waits. Suggestions can include a player from the adjacent lower level after at least five completed games, four wins and an 80% win rate, alongside higher-level players with at least five games and a lower win percentage. These thresholds are initial defaults. **Force category** defaults to **Automatic**. Choosing a category restricts automatic suggestions to that level, while retaining the same wait, line and qualified adjacent-level promotion rules; if no valid group exists for that category, no automatic suggestion is shown. Admins can lock 2–4 roster players together; locked groups are indivisible in automatic suggestions and manual matches, and a lock takes precedence over normal category and line grouping. Locked groups are considered only when every member is active and available. Unlock a group before changing its members; removing a roster player updates their lock. Admins can drag a player from either line onto a slot, or select the player and then the slot, reset to the automatic suggestion, select an available court and choose **Start Game**. Marking a suggested player **Not available** places them at the front of their existing line, excludes them from matching and fills the open slot when a suitable replacement exists. **Make available** restores eligibility without changing that position; their Active bench clock continues until they rest or play. These changes are shared after **Save changes**. A warning identifies overdue players not included, and the system cannot guarantee a match when suitable players or courts are unavailable. New strategies can be added as independent modes without changing the existing strategy.

When a forced category has fewer than four eligible players, the suggestion includes as many players of that category as possible, then fills remaining places from the nearest skill levels across both lines. Wait urgency and duration, available win-rate history, line mixing and queue order help rank otherwise suitable groups. If no player from the forced category is eligible, the closest available level is suggested and shown as the suggestion category.

The roster shows each player's session win percentage. **Top 5** ranks players with at least one completed game by win percentage, then wins, games and name; it is not an all-time ranking, and percentages based on few games are less reliable.

Admins can configure up to 32 virtual courts, each with a name and a Novice, Intermediate, or High Intermediate category. When no name is entered, a numbered name such as `Court 1` is used; existing unnamed courts also receive numbered names. New matches require an available court; occupied courts cannot be removed, recategorized, or double-booked until their match ends or is canceled. The category labels the court and does not restrict player selection. Completed matches retain their court name, number and category even if the court is later changed or removed; older matches remain unassigned, though ongoing matches can be assigned to an available court. Court configuration is saved with the shared roster using **Save changes**.

## Balance staff and email reminders

The `balance-staff` account role can open **Member balances** (`/member-balances`) and list, add, edit and delete member balances, and send balance reminder emails. It does not grant other administrator pages or APIs; normal member features remain available. Administrators retain all balance permissions. To assign/revoke access, sign in as an admin, open **Member balances**, select the staff member and choose **Grant balance staff access** or **Remove balance staff access**. These controls are only shown for regular member/balance-staff accounts, not admins or club owners. Roles are mutually exclusive, and only admins can change them through `PATCH /members/:memberId/role`.

Select a member and click **Remind by email** to email all current unpaid balance records, dates, types, amounts and the total in PHP. Existing balances have no paid flag: settled records should be removed or adjusted using the existing controls. Credits/negative adjustments are included in the total; reminders require a positive outstanding total. The email uses the member's stored email address and existing Mailgun configuration (`MAILGUN_API_KEY`, `MAILGUN_DOMAIN`, `EMAIL_FROM`, optional `MAILGUN_BASE_URL`), and links to **My balances** using the existing public application URL.

Each member can receive at most one reminder trigger in any **24-hour period**, shared across all admins, staff, tabs and API instances. The next allowed time is displayed in the staff member's local time. `GET /members/:memberId/balance-reminder` reads the cooldown; `POST /members/:memberId/balance-reminder` triggers delivery. Both require admin/balance-staff access. Reminder reservations are stored in the existing members table, partition `balance-reminders`, row key equal to the member ID; no new table or credentials are needed. Atomic creation/ETag updates prevent simultaneous triggers. The reservation is saved **before** contacting Mailgun, so a failed or uncertain delivery attempt also consumes the 24-hour window to prevent accidental duplicate emails. Delivery errors are surfaced explicitly and never reported as successful. Reload reminder status after an interrupted request to check its cooldown.

## Manual member points

Admins and `balance-staff` can open **Member points** from Member Home (`/member-points`). Select a member to review available points, tokens, and paginated award history, including converted/fully-used amounts. Only members with currently active Gold membership can receive new awards; history remains accessible to staff after expiry. Member self-service conversion and redemption are described below. Automatic awards, award editing/deletion, and reversals are not implemented.

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
- `GET /member-points/:memberId?continuation=...` returns `{ memberId, memberName, goldMembershipExpiresOn, balance, tokens, awards, continuationToken }`, with up to 50 awards per page, newest activity date first. `balance` is the available, unconverted points. Each award includes `convertedPoints` and `used`. Same-day activities have deterministic key ordering, not entry-time ordering.
- `POST /member-points/:memberId` accepts `{ requestId, source, activityDate, scheduleName? , startHour?, courtNumber?, points?, reason? }`. Use a UUID request ID. Retry the same request with unchanged details after an uncertain response; do not generate a new ID. Reusing an ID with different details or awarding a duplicate standard activity returns `409 Conflict`. Successful retries return the original award, including its original amount.

`MemberPoints` uses the member ID as `PartitionKey`. Each immutable `award:...` ledger entity stores `TransactionType=Earn`, the source, activity details, points, reason, request ID and actor audit fields. A `request:...` entity tracks idempotency, and a `balance` entity maintains the total. These three writes occur in a single Azure Table transaction; ETag checks and bounded conflict retries prevent lost balance updates. A duplicate award never increments the balance. Missing-table and permission failures are surfaced, not treated as an empty history.

Missing request markers and balances are normal for a member's first award. The API recognizes Azure's `404 ResourceNotFound` in either the top-level error code or the SDK's `details.odataError.code`; these missing entities must not cause a 502. A `TableNotFound`, permission failure, or unrecognized storage error still fails explicitly and is logged by the API.

The staff UI prevents double submission and reuses an unconfirmed award request ID while the page remains open. Check history before reloading or leaving after an uncertain award submission, especially for Custom Awards: a new page session generates a new award request ID. Staff should verify all details before awarding because correction workflows are intentionally deferred.

## Member tokens and rewards store

Every signed-in member can open **My points & rewards** (`/my-rewards`) from Member Home to see their own available points, tokens, earning records, token conversions, and reward redemptions. **Active Gold membership is required for new conversions and redemptions.** Expiry does not delete balances or history; they become usable again after Gold renewal.

- **Conversion:** 1 point = 1 token. Members choose a positive whole-number amount, up to their available points. The chosen points are deducted and the same number of tokens credited atomically. Partial conversions leave the rest available.
- **Redemption:** members select an enabled store item and explicitly confirm spending its token cost for **one** item. Tokens are deducted atomically and an immutable transaction snapshot records the item name, image, price, member, merchant email, and timestamp. There are no refunds, reversals, stock limits, or merchant fulfillment tracking in this release.
- **History:** each history type is paginated (50 records). Conversions/redemptions are newest first; earning history retains activity-date ordering. New operations cannot overspend even across concurrent tabs or API instances. UUID request IDs make uncertain financial requests safe to replay; changed details with the same request ID are rejected.

### Storage and used earning records

Token balances and transactions live in **MemberPoints**, in the same member partition as points, rather than a separate table. Azure Table transactions cannot atomically move balances across tables or partitions. The **Store** table contains only the catalog, with `PartitionKey=items`; set `STORE_AZURE_TABLE=Store` (the default) and create it before use. The API identity needs **Storage Table Data Contributor** access to both tables.

The existing `balance` entity retains `Balance` (available points) and adds `Tokens`, `ConvertedPoints`, `TokensSpent`, and `LifetimePoints`. Financial operations atomically write the balance, a `conversion:...` or `redemption:...` transaction, and a `wallet-request:...` idempotency marker, protected by the balance ETag. Awarding new points preserves token balances.

An earning record's original points/activity are never overwritten. New awards receive stable `EarnedStart`/`EarnedEnd` ranges in the lifetime point sequence. Conversion transactions store the consumed `PointRangeStart`/`PointRangeEnd`. An award's converted amount and fully-used status are calculated from these ranges and the converted total; `used=true` means **all** points in that award were converted into tokens, not that those tokens were already spent. This supports partial use and histories larger than Azure's 100-operation transaction limit without unsafe multi-batch updates.

Pre-existing awards without ranges are assigned a stable virtual sequence by their recorded timestamp, then row key, before newer ranged awards. They remain unchanged in storage; legacy awards may require a partition scan when calculating use. Existing balances must match their awarded points, as in the original manual-award feature. Do not edit financial entities directly or run older API versions concurrently with the updated wallet API.

### Admin catalog and images

Only admins can open **Rewards store** (`/store-admin`) to add or edit:

- Item name (up to 150 characters).
- Image uploaded through the page (PNG, JPEG, GIF, or WebP, up to 5 MB).
- Merchant **To emails** (at least one), plus optional **CC emails** and **BCC emails** for the merchant receipt. Enter plain addresses separated by commas or semicolons; each field supports up to 10,000 characters, with at most 254 per address. Whitespace is trimmed and case-insensitive duplicates within each field are removed. Invalid addresses or line breaks block saving.
- Positive whole-number token cost.
- Enabled/disabled setting. Disable an item instead of deleting its history.

Images use the existing `OP_PARTICIPATION_AZURE_STORAGE_ACCOUNT` and `OP_PARTICIPATION_AZURE_CONTAINER`, under `store-images/`. The API identity needs **Storage Blob Data Contributor** access, and image URLs need the same public-read setup as existing profile images. Replaced and unused uploaded images are retained; they are not automatically deleted.

Catalog edits use ETags to prevent overwriting concurrent admin changes. Checkout verifies the catalog version selected by the member and uses the server price, never a submitted token amount. A changed/disabled item requires refreshing before starting a new redemption. The saved transaction uses the catalog snapshot read during checkout; edits made after that read do not retroactively change it. Items have no stock limit.

The same admin page includes **All redemptions**, with the member's name/email and ID, reward name, merchant To/CC/BCC emails, token cost, Philippine-time timestamp, transaction reference, and both notification statuses. Merchant configuration remains per reward (its receipt recipients), not a separate merchant-account directory. Redemption details come from the original transaction snapshot, so changing a merchant or disabling a reward does not change historical receipts.

Existing rewards with one `MerchantEmail` continue working. Recipient lists remain strings in Azure Table Storage: `MerchantEmail` holds the normalized To list, with `MerchantCc` and `MerchantBcc` added on save and copied into new redemption snapshots. Missing copy fields on older rewards/redemptions mean no copies; no migration is required. Merchant recipient fields, including BCC, are available only in admin catalog/history responses, not member catalog/history responses.

The list reads all member partitions in `MemberPoints` using bounded pages of up to 50 records. Use **Load more redemptions** to continue, and **Refresh redemptions** to restart. Azure orders these records by member partition, then newest redemption within that member; this is **not** a global newest-first feed. Cross-partition filtering can scan nonmatching entities and return an empty page with a continuation token; continue loading when offered. No new table/index or migration is required. Only admins can access this cross-member view; balance staff and regular members cannot.

### Redemption emails and recovery

Existing Mailgun settings (`MAILGUN_API_KEY`, `MAILGUN_DOMAIN`, `EMAIL_FROM`, optional `MAILGUN_BASE_URL`) send **separate emails to the member and merchant** containing the same redemption reference, item, token cost, member contact email, and UTC timestamp. Configure these before redemption; missing settings reject checkout before tokens are deducted.

The member confirmation goes only to the member. The separate merchant notification sends one message to all configured To recipients, with CC/BCC applied **only to that merchant message**. BCC is sent via Mailgun's BCC field and never added to receipt text/HTML. Retries use the original redemption's recipient snapshot, not the current reward configuration.

The redemption and token deduction are saved **before** sending email. Email failure never rolls back the purchase or spends tokens again. Each notification (member and merchant) has an audited delivery state: `pending`, `sending`, `accepted`, or `unconfirmed`. The merchant state covers the entire To/CC/BCC message, not individual mailbox delivery. `accepted` means Mailgun accepted the request, not guaranteed inbox delivery. Per-notification ETag claims prevent concurrent automatic attempts. An interrupted `sending` attempt may be retried explicitly after two minutes.

The member page saves a pending conversion/redemption request in browser **session storage**, scoped to the signed-in member, before submitting. Reloading the same tab recovers the original request. After a network/5xx/concurrency error, retry the saved request instead of creating a new one. Check history before clearing recovery data or starting a new request in another tab/device.

Replaying a committed redemption resumes only `pending` notifications; accepted or unconfirmed attempts are not automatically repeated. The history provides an explicit **Retry notifications** action for incomplete emails. It never spends additional tokens, and warns that an unconfirmed email may be delivered twice. A crash or uncertain provider response cannot provide exactly-once email delivery. There is no background delivery worker; use the saved transaction retry or notification action to recover interrupted delivery.

Member-session APIs (the member ID always comes from the session):

- `GET /my-rewards` returns `{ memberId, activeGold, points, tokens, convertedPoints, tokensSpent }`.
- `GET /my-rewards/history?kind=award|conversion|redemption&continuation=...` returns `{ records, continuationToken }`.
- `POST /my-rewards/convert` accepts `{ requestId, points }`.
- `POST /my-rewards/redeem` accepts `{ requestId, itemId, version }`.
- `POST /my-rewards/redemptions/:transactionId/email` accepts `{ confirmResend: true }` to explicitly retry incomplete notifications, even after Gold expiry.
- `GET /store` lists enabled catalog entries without exposing merchant addresses.

Admin-session APIs:

- `GET /admin/redemptions?continuation=...` returns `{ records, continuationToken }` across all members, including original merchant/member details and notification states.
- `GET /admin/store` lists all items.
- `POST /admin/store` creates `{ name, imageUrl, merchantEmail, merchantCc?, merchantBcc?, tokenCost, enabled }`; recipient fields are comma- or semicolon-separated strings. Omit or clear optional CC/BCC fields to send no copies.
- `PATCH /admin/store/:itemId` updates the same fields plus the current `version`.
- `POST /admin/store-images` uploads multipart field `image` and returns `{ imageUrl }`.

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

Administrators can open **Email announcements** from Member Home → Admin (`/email-announcements`). The page and all announcement APIs require the `admin` role; club owners, balance staff, and regular members cannot send announcements or read the announcement recipient directory.

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

Administrators can edit a tournament's name, level, maximum team slots, date and location from **Tournament management**. Category remains fixed. Pricing and T-shirt sizes are edited using their existing controls. The maximum cannot be set below the number of already approved teams; pending teams are not guaranteed a slot. Existing registration records retain the name and level recorded when they were created. Changes use the tournament version to detect stale edits; reload the page and retry after a conflict.

The terms PDF can be replaced or removed only while registration is closed and no registration records exist. This protects existing agreements, which reference the tournament's current terms document. Close registration before editing terms and reopen it afterward. The existing registration and tournament records are in separate tables, so the capacity and terms checks are not atomic with a registration already in progress; avoid editing while registrations are actively being submitted. Replaced or removed PDFs remain in storage until the tournament is permanently deleted.

Administrators can configure a **Registration fee (PHP per player)** when creating a tournament or use **Edit registration pricing** on a published event. Set a regular price and optionally an early-bird price with an end date. Prices allow up to two decimal places, from PHP 0 to 1,000,000; the early-bird price cannot exceed the regular price. Early bird is valid through the entire selected calendar date in **Asia/Manila (UTC+8)**, including 11:59 PM; regular pricing applies from midnight the next day. Players see the current fee, both configured prices, and the Philippine-time deadline when browsing, registering, and accepting invitations. The display updates while the page remains open.

Leave all pricing fields blank to show **not yet announced**, not free; enter 0 explicitly for free registration. Clearing all fields on an existing event removes its advertised pricing. Creation accepts `pricing` as a JSON object (JSON-encoded for multipart requests), e.g. `{ "regularPrice": 500, "earlyBirdPrice": 400, "earlyBirdEndDate": "2026-10-31" }`. Administrators can update it with `PATCH /admin/tournaments/:tournamentId/pricing` and `{ "pricing": { ... } }`, or `{ "pricing": null }` to clear. Pricing is stored with the tournament and retained in archives. These are advertised fee details only: this feature does not charge players, calculate payment balances, lock in individual rates, or change existing payment-status workflows.

Roster gender requirements include the member sending the invitations:

- Mens Doubles: two male players.
- Mixed Doubles: one male and one female player; either player can send the invitation.
- Womens Doubles: two female players.
- Team Tournament: four players, exactly two male and two female.

Tournament slot counts include approved teams only (statuses **Approved**, **Payment Submitted**, and **Paid**). **Invitation Pending** and **Pending Approval** entries are shown separately as pending and do not reserve slots. New registrations remain open until approved teams reach the maximum; admins cannot approve additional teams once that limit is reached. Declined entries count toward neither total.

### Tournament approval emails

Approving a complete team emails each player separately with registration and payment instructions. Before enabling approvals, upload [email-templates/tournament-approval.html](email-templates/tournament-approval.html) to the existing blob container at the fixed name `email-templates/tournament-approval.html`, and verify its payment details. The API reads this blob at approval time, so replace its contents to change future emails without redeploying. This file is not automatically uploaded. Keep template write access limited to trusted administrators because its HTML is used as authored.

Use the existing `OP_PARTICIPATION_AZURE_STORAGE_ACCOUNT`, `OP_PARTICIPATION_AZURE_CONTAINER`, Mailgun settings (`MAILGUN_API_KEY`, `MAILGUN_DOMAIN`, `EMAIL_FROM`, optional `MAILGUN_BASE_URL`), and `PUBLIC_APP_URL` for the Tournaments link. The API identity needs blob read access to the template. The UTF-8 HTML must be 1 to 60,000 bytes. Supported placeholders are `{{memberName}}`, `{{tournamentName}}`, `{{tournamentCategory}}`, `{{tournamentLevel}}`, `{{tournamentDate}}`, `{{tournamentLocation}}`, and `{{tournamentsUrl}}`; values are HTML-escaped. Optional blob metadata `subject` overrides the default subject and must be 1 to 200 characters without line breaks. A plain-text alternative is generated automatically. Prices are not captured per registration and no amount is automatically inserted; direct players to confirm the applicable fee.

Approval requires a readable, valid template, configured Mailgun settings, and a valid email address for each participant. Failures before approval leave the registration pending. Approval is saved with an ETag before sending; Mailgun acceptance does not guarantee inbox delivery. Unconfirmed addresses are shown to the admin for manual follow-up, and messages may already have arrived. There is no automatic retry or persistent delivery queue: after an interrupted request, check the registration and contact participants as needed. `PATCH /admin/tournaments/:tournamentId/registrations/:registrationId/approve` returns the approved registration plus `approvalEmailFailedRecipients` (an empty array when all submissions were accepted). The approval email template is excluded from Gold membership template selection.

Admins can decline a pending team from **Team approvals**, or any unpaid active registration from **View registrations & payments**. A reason is required (up to 4,000 characters). Like player cancellation, this deletes the registration and releases its players and slot; paid and already-declined invitations cannot be declined. Each registered team member receives a separate email with the reason, using the existing Mailgun configuration. The API requires valid email addresses for all players and configured Mailgun settings before deleting the registration; an ETag prevents a concurrent change from being overwritten. It does not issue refunds or delete uploaded files immediately, matching cancellation.

The registration is deleted before sending emails. Mailgun accepting a message does not guarantee inbox delivery. If delivery cannot be confirmed, the page displays the affected email addresses and reason so the admin can contact them directly; an unconfirmed email may already have arrived. There is no automatic retry or persistent delivery queue: if the request or API is interrupted after deletion, check the registration and contact the players manually. `PATCH /admin/tournaments/:tournamentId/registrations/:registrationId/decline` requires an admin session and `{ "reason": "..." }`, and returns `{ "deleted": true, "failedRecipients": [] }` with any unconfirmed addresses in `failedRecipients`.

Each player must upload a school, government, or company ID (PDF, JPEG, or PNG, up to 10 MB): the sender when registering and each invitee when accepting. Players may optionally list club memberships and officers who can verify eligibility, including the club, officer's name, and contact details if possible (up to 4,000 characters). Registration and acceptance use multipart form data with `idFile`, optional `clubDetails`, and JSON-encoded questionnaire/consent fields. Declining still accepts JSON and needs no ID. Existing registrations remain reviewable without retroactive uploads.

New IDs are stored under `tournament-player-ids/` in a separate container, `spaprivate` by default, using the account configured by `OP_PARTICIPATION_AZURE_STORAGE_ACCOUNT`. Optionally set `TOURNAMENT_ID_AZURE_CONTAINER` to a different private container before deploying; keep the name stable unless its contents are migrated. The ID container must differ from `OP_PARTICIPATION_AZURE_CONTAINER`, exist beforehand, and have **Private (no anonymous access)** selected. Before each ID upload the API checks the container access setting and refuses uploads if anonymous access is enabled. Restrict permission to change that setting; the check cannot prevent an authorized storage administrator from making the container public later.

The API uses `DefaultAzureCredential`: enable a managed identity for the hosted API and grant it **Storage Blob Data Contributor** on the private container (including access to read container properties, upload, download, list and delete blobs). For local development, sign in with a development identity that has the same required blob access. No storage keys, SAS tokens, or browser-to-blob credentials are needed. Only admins can fetch IDs through the authenticated, non-cacheable API; teammates cannot access them. Archiving preserves IDs; permanent tournament deletion removes matching IDs, snapshots and versions in both containers.

**Existing IDs are not moved by this update.** Older records without a private-storage marker still read from the original shared container, and their original blob URLs remain accessible if that container allows anonymous reads. Make the old container private immediately to contain exposure, noting that public logos and images in it may stop working. Migrating old IDs requires copying and verifying the blobs, updating both active and archived registration metadata, and removing or otherwise securing every public original, including retained versions and snapshots. Do not make the old container public again while sensitive copies remain. Review existing SAS access and potential past exposure. Payment proofs, protest evidence and other tournament files remain in the original container and must also be assessed separately.

Admins select **Available T-shirt sizes** when creating a tournament or update them on a published event using **Save T-shirt sizes**. The supported sizes are **XXS, XS, S, M, L, XL, XXL, XXXL**. Selecting none disables size collection, including for existing tournaments without a size configuration. When sizes are configured, the sender must choose their own size during registration and every invitee must choose their own size when accepting; dropdowns offer only the configured sizes. The API validates the `tshirtSize` form field against the tournament's current options. Declining never requires a size. Updating options affects future submissions only and preserves existing selections. Sizes appear in player entries, administrator approval/registration views, archives, and approved-team CSV exports. Replacing a roster player clears the outgoing player's size rather than assigning it to the replacement. Tournament creation accepts `tshirtSizes` as a JSON array (JSON-encoded for multipart requests); administrators can update options with `PATCH /admin/tournaments/:tournamentId/tshirt-sizes` and `{ "tshirtSizes": ["XS", "S", "M", "L", "XL", "XXL"] }`.

For printing, open an event's **T-shirt printing & player export** link in tournament management or registrations. This administrator-only page (`/tournaments/:tournamentId/printing`) lists individual players from **Approved**, **Payment Submitted**, and **Paid** registrations, with their T-shirt sizes and **Exported for printing** status. **Export untagged players (CSV)** refreshes the list and downloads one row per currently untagged eligible player, regardless of the display filter. It includes tournament/registration/player identifiers, player name, size, and registration status. Missing sizes remain blank rather than omitting the player. After starting the download, only the included players are tagged; subsequent exports skip them. Administrators can manually **Tag as exported** or **Untag player** individually, including one member of a doubles/four-player team. Untagging makes that player eligible for the next export. The existing approved-team backup CSV does not change printing tags.

Printing tags persist per registration/player in the existing registrations table; no new storage resources are needed. Replacing a roster player clears the outgoing player's tag so the replacement is not considered printed. Reads and changes require an administrator and an active tournament. Tag requests carry the registration versions used for the export; concurrent roster/status/tag changes are rejected rather than overwritten. Tags are saved per registration, so a failed multi-registration update may leave partial progress. The page explicitly reports this and reloads the actual tags for review. A browser cannot confirm that a download was saved: if a download was blocked or discarded after it started, manually untag those players before exporting again. If tagging fails after a download, review the file and refreshed list before retrying to avoid duplicate printing.

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