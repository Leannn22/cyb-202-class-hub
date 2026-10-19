# CYB-202 Semester Command Center

Shared, browser-based section hub with a Node.js API, SQLite class-state database, server-side administrator sessions, and the CYB-202 timetable seed.

## Requirements

- Node.js 20.12 or later
- A persistent writable directory for SQLite database files
- HTTPS and a reverse proxy for public deployment

## Run locally

1. Install dependencies with `npm install`.
2. Set a long, random session secret in the server environment. For example, in PowerShell:

   ```powershell
   $env:SESSION_SECRET = (node -e "process.stdout.write(require('node:crypto').randomBytes(48).toString('base64url'))")
   ```

3. Configure the three administrator accounts from a private terminal:

   ```powershell
   npm run setup:admins
   ```

   Enter a unique passphrase of at least 16 characters for each named admin. Input is not echoed. The command stores salted scrypt hashes in the private SQLite database; the original passphrases are not written to files or printed. To rotate all three accounts, run `npm run setup:admins -- --replace`.

4. Start the application:

   ```powershell
   npm start
   ```

5. Open `http://localhost:3000`.

Without administrator accounts, the class hub remains readable but shared edits stay unavailable. Do not put database files, passphrases, or session secrets in source control.

## Production deployment''=''

- Set `NODE_ENV=production`, `SESSION_SECRET` to at least 32 unpredictable bytes, `APP_ORIGIN` to the exact public origin without a trailing slash, `PORT` as required, and `DB_PATH` to a persistent private database path.
- Terminate TLS at a trusted reverse proxy. When that proxy forwards the original protocol and host, set `TRUST_PROXY=1`; restrict direct access to the Node port.
- Keep one application instance when using SQLite. Use managed PostgreSQL and a shared session store before horizontal scaling.
- Protect the SQLite database and its backups as credentials: it contains the administrator password hashes and shared class information. Run backups and restore tests on the persistent volume.
- Review CDN availability and content policies before publishing. Tailwind's browser CDN is useful for a self-contained prototype, but Tailwind recommends compiling CSS for production. Pin and self-host external scripts/fonts where your deployment policy requires a software supply-chain review.
- Review dates, reminders, changes, and study material with the relevant instructor. Seed data intentionally does not invent official exam dates.

## Security model

Passwords are verified by the server using per-account random salts and Node's scrypt KDF (N=32768, r=8, p=1), with constant-time hash comparison. They are never included in frontend code or sent to other class members. The setup command is the only supported way to create/rotate admin accounts.

Administrator permissions are enforced by the API, not by hidden controls in the browser. The API uses a rolling, HTTP-only, SameSite=Strict, 30-minute session cookie, CSRF tokens and same-origin checks for writes, login request limiting, and a persistent three-failure/60-second account-and-client lockout. Class-state imports are validated by both the browser and server; all displayed user-managed strings are rendered as escaped text, and external links are limited to HTTP(S).

Serve the frontend and API from the same origin over HTTPS in production. The SHA-256-in-browser scheme from the original static-only proposal is deliberately not used: it would expose verifier material to every visitor and still could not enforce authorization. Likewise, a first-visitor-wins setup page is deliberately not provided.

## Shared state

The server seeds the initial state from `data.js` on first startup. Changes to reminders, review guides, cheat sheets, emergency broadcasts, and date-specific schedule overrides are stored in SQLite and shared by every visitor. The timetable seed remains the baseline; temporary schedule changes can be reset without losing it. Exported snapshots use schema version 1 and are checked before server-side replacement.

Reminders support Exam, Quiz, Assignment, Project, and General categories. Authenticated administrators can use Ai-Ai's chat pills to complete a reminder draft and load it into the existing editable reminder form; nothing is published until the administrator reviews and submits that form.
