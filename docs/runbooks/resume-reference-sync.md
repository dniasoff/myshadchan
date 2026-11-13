# Resume Reference Sync Runbook

**Status:** Active  
**Story:** myshadchan-6f2 + myshadchan-n14

## What the migration does

The migration reads parsed `resumes.sections.references` for suggestions that
already have a resume. It runs account by account and resume by resume, using a
transaction advisory lock for each account and parsed identity. It creates only
safe missing `references` identities and `reference_links` rows. It never
updates an existing reference, link, status, note, conversation log,
relationship override, or interaction.

Before writing, the migration prints a dry-run count of resumes and parsed
candidates. At the end it prints counts for accounts, resumes read, links and
identities created, links reused, and ambiguous/invalid candidates skipped. It
does not print names, phone numbers, or call notes. A malformed candidate stays
unlinked. An account or resume error is isolated and counted; a structural
database error fails the migration closed.

The same `sync_resume_references` operation is called after a newly filed
parsed resume is stored. That filing hook is asynchronous: a sync error is
logged and swallowed so filing does not fail or wait on reference creation.
The migration is the retry and existing-data path, and rerunning the operation
is idempotent.

## Matching and rollback

Names and phones use the database's canonical normalizers. A candidate matches
an existing identity only on exact normalized name plus phone, a unique phone
whose stored name is blank or agrees, or a unique name when no phone is
present. Duplicate phone matches, conflicting names, duplicate names, blank or
invalid candidates are skipped rather than attached to the wrong person.

New links have `resume_id` and a `link_created` interaction whose metadata has
`source = "resume_reference_sync"`. That is the rollback identification query:
review only those marked links and delete a newly created identity only when it
has no other links. Do not run a broad delete. Preserve the deploy's private R2
backup and use a forward fix or the database restore runbook if a production
rollback is needed.

Before deploying, Captain/Deploy must tell Concierge/Ronit that existing
suggestion resumes will be scanned and that safe references may appear in the
shared Diligence data; ambiguous candidates will remain unlinked for review.
